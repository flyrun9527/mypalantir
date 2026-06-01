import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Eraser,
  ListRestart,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  Wrench,
  X,
  PanelRightOpen
} from "lucide-react";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { api, parseSseFrames } from "../lib/api";
import { formatTime, stringify } from "../lib/format";
import { createClientId } from "../lib/id";
import { useConsoleStore } from "../store/useConsoleStore";
import type { ChatMessage, ChatPhase, Ontology, StreamEvent, TraceEvent, TraceTone } from "../types/oag";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

type PromptItem = {
  group: string;
  prompt: string;
  desc?: string;
};

type TimelineStep = {
  id: string;
  label: string;
  status: "running" | "done" | "error";
};

type SubmitOptions = {
  replaceRunning?: boolean;
};

const traceMeta: Record<TraceTone, { tag: string; label: string; className: string }> = {
  turn: { tag: "TURN", label: "对话回合", className: "border-zinc-700 bg-zinc-900/70 text-zinc-300" },
  "tool-call": { tag: "CALL", label: "Agent 调用工具", className: "border-sky-900 bg-sky-950/40 text-sky-200" },
  "tool-result": { tag: "RESULT", label: "工具返回结果", className: "border-emerald-900 bg-emerald-950/30 text-emerald-200" },
  text: { tag: "TEXT", label: "LLM 生成回复", className: "border-zinc-800 bg-zinc-900/60 text-zinc-300" },
  "debug-request": { tag: "LLM->", label: "发送给 LLM", className: "border-amber-900 bg-amber-950/30 text-amber-200" },
  "debug-response": { tag: "<-LLM", label: "LLM 原始响应", className: "border-purple-900 bg-purple-950/30 text-purple-200" },
  reasoning: { tag: "THINK", label: "模型思考", className: "border-amber-900 bg-amber-950/20 text-amber-200" },
  planner: { tag: "PLAN", label: "Planner 规划", className: "border-sky-900 bg-sky-950/30 text-sky-200" },
  executor: { tag: "EXEC", label: "Executor 执行", className: "border-emerald-900 bg-emerald-950/30 text-emerald-200" },
  reviewer: { tag: "REVIEW", label: "Reviewer 审查", className: "border-purple-900 bg-purple-950/30 text-purple-200" },
  synth: { tag: "SYNTH", label: "Synthesizer 合成", className: "border-zinc-700 bg-zinc-900/70 text-zinc-300" },
  error: { tag: "ERR", label: "异常", className: "border-red-900 bg-red-950/30 text-red-200" }
};

function sessionStorageKey(domain: string | null) {
  return `oag-session-${domain ?? (window.location.pathname.replace(/\/+$/, "") || "root")}`;
}

function createSessionId() {
  return `web_${Date.now()}`;
}

function normalizePromptItems(prompts: unknown[]) {
  const items: PromptItem[] = [];
  for (const item of prompts) {
    if (typeof item === "string") {
      items.push({ group: "推荐", prompt: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      const group = String(record.group ?? "示例");
      for (const child of record.items) {
        if (typeof child === "string") {
          items.push({ group, prompt: child });
          continue;
        }
        if (!child || typeof child !== "object") continue;
        const childRecord = child as Record<string, unknown>;
        const prompt = String(childRecord.prompt ?? childRecord.question ?? childRecord.text ?? childRecord.name ?? "");
        if (prompt) {
          items.push({
            group,
            prompt,
            desc: childRecord.desc == null ? undefined : String(childRecord.desc)
          });
        }
      }
      continue;
    }
    const prompt = String(record.prompt ?? record.question ?? record.text ?? record.name ?? "");
    if (prompt) {
      items.push({
        group: String(record.group ?? "推荐"),
        prompt,
        desc: record.desc == null ? undefined : String(record.desc)
      });
    }
  }
  return items;
}

function clipText(value: string, max = 48) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function readableTool(name: string, args: unknown, ontology?: Ontology | null) {
  const functionDef = ontology?.functions?.[name];
  const label = clipText(functionDef?.summary || functionDef?.description || name);
  const record = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const parts = Object.entries(record)
    .filter(([, value]) => value != null && value !== "" && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key}=${clipText(String(value), 24)}`);
  return `${label}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

function isErrorResult(result: unknown) {
  const text = typeof result === "string" ? result : stringify(result);
  return text.includes("\"error\"") || text.includes("不存在") || text.includes("Error:");
}

const phaseOrder: Record<ChatPhase, number> = {
  request: 0,
  work: 1,
  notice: 2,
  response: 3
};

function orderMessagesForDisplay(messages: ChatMessage[]) {
  const ordered: ChatMessage[] = [];
  const turnBuffer: Array<{ message: ChatMessage; index: number }> = [];

  function flushTurnBuffer() {
    if (!turnBuffer.length) return;
    const isStructuredTurn = turnBuffer.every(({ message }) => message.turnId && message.phase);
    if (!isStructuredTurn) {
      ordered.push(...turnBuffer.map(({ message }) => message));
      turnBuffer.length = 0;
      return;
    }

    ordered.push(...turnBuffer
      .slice()
      .sort((left, right) => {
        const leftPhase = phaseOrder[left.message.phase as ChatPhase];
        const rightPhase = phaseOrder[right.message.phase as ChatPhase];
        if (leftPhase !== rightPhase) return leftPhase - rightPhase;
        return (left.message.sequence ?? left.index) - (right.message.sequence ?? right.index);
      })
      .map(({ message }) => message));
    turnBuffer.length = 0;
  }

  for (const [index, message] of messages.entries()) {
    if (!message.turnId || !message.phase) {
      flushTurnBuffer();
      ordered.push(message);
      continue;
    }

    const activeTurnId = turnBuffer[0]?.message.turnId;
    if (activeTurnId && activeTurnId !== message.turnId) flushTurnBuffer();
    turnBuffer.push({ message, index });
  }

  flushTurnBuffer();
  return ordered;
}

export function ChatPanel() {
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const prompts = useConsoleStore((state) => state.prompts);
  const messages = useConsoleStore((state) => state.messages);
  const traceEvents = useConsoleStore((state) => state.traceEvents);
  const pendingAction = useConsoleStore((state) => state.pendingAction);
  const appendMessage = useConsoleStore((state) => state.appendMessage);
  const appendAssistantText = useConsoleStore((state) => state.appendAssistantText);
  const replaceMessages = useConsoleStore((state) => state.replaceMessages);
  const clearMessages = useConsoleStore((state) => state.clearMessages);
  const appendTraceEvent = useConsoleStore((state) => state.appendTraceEvent);
  const appendTraceDetail = useConsoleStore((state) => state.appendTraceDetail);
  const clearTraceEvents = useConsoleStore((state) => state.clearTraceEvents);
  const setPendingAction = useConsoleStore((state) => state.setPendingAction);
  const setLoading = useConsoleStore((state) => state.setLoading);
  const loading = useConsoleStore((state) => state.loading.chat);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(createSessionId);
  const [turnCount, setTurnCount] = useState(0);
  const [activePromptIndex, setActivePromptIndex] = useState(0);
  const [timelineSteps, setTimelineSteps] = useState<TimelineStep[]>([]);
  const [sidePanel, setSidePanel] = useState<"trace" | "prompts">("trace");
  const assistantId = useRef<string>("");
  const reasoningTraceId = useRef<string>("");
  const currentTurnId = useRef<string>("");
  const messageSequence = useRef(0);
  const streamRef = useRef<EventSource | null>(null);
  const streamTimeoutRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);

  const promptItems = useMemo(() => normalizePromptItems(prompts), [prompts]);
  const filteredPrompts = useMemo(() => {
    if (!input.startsWith("/")) return [];
    const query = input.slice(1).trim().toLowerCase();
    return promptItems
      .filter((item) => !query || item.prompt.toLowerCase().includes(query) || (item.desc ?? "").toLowerCase().includes(query))
      .slice(0, 12);
  }, [input, promptItems]);

  const promptGroups = useMemo(() => {
    const grouped = new Map<string, PromptItem[]>();
    for (const item of promptItems) {
      const group = grouped.get(item.group) ?? [];
      if (group.length < 8) group.push(item);
      grouped.set(item.group, group);
    }
    return Array.from(grouped.entries()).slice(0, 5);
  }, [promptItems]);

  const addTrace = useCallback((tone: TraceTone, label: string, detail?: unknown) => {
    appendTraceEvent({
      id: createClientId(),
      tone,
      label,
      detail,
      createdAt: new Date().toISOString()
    });
  }, [appendTraceEvent]);

  const nextMessageFlow = useCallback((phase: ChatPhase) => {
    if (!currentTurnId.current) {
      currentTurnId.current = createClientId();
      messageSequence.current = 0;
    }
    return {
      turnId: currentTurnId.current,
      phase,
      sequence: messageSequence.current++
    };
  }, []);

  const ensureAssistantMessage = useCallback(() => {
    if (!assistantId.current) {
      assistantId.current = createClientId();
      appendMessage({
        id: assistantId.current,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        ...nextMessageFlow("response")
      });
    }
    return assistantId.current;
  }, [appendMessage, nextMessageFlow]);

  const addMessage = useCallback((role: ChatMessage["role"], content: string, extra?: Partial<ChatMessage>) => {
    appendMessage({
      id: createClientId(),
      role,
      content,
      createdAt: new Date().toISOString(),
      ...extra
    });
  }, [appendMessage]);

  const finishRunningSteps = useCallback((ok: boolean) => {
    setTimelineSteps((steps) => steps.map((step) => (
      step.status === "running" ? { ...step, status: ok ? "done" : "error" } : step
    )));
  }, []);

  const addTimelineStep = useCallback((label: string, status: TimelineStep["status"] = "running") => {
    setTimelineSteps((steps) => [...steps, { id: createClientId(), label, status }]);
  }, []);

  const clearStreamTimeout = useCallback(() => {
    if (streamTimeoutRef.current == null) return;
    window.clearTimeout(streamTimeoutRef.current);
    streamTimeoutRef.current = null;
  }, []);

  const stopStream = useCallback((message?: string, trace = true) => {
    clearStreamTimeout();
    streamRef.current?.close();
    streamRef.current = null;
    finishRunningSteps(false);
    assistantId.current = "";
    currentTurnId.current = "";
    messageSequence.current = 0;
    reasoningTraceId.current = "";
    setLoading("chat", false);
    if (message && trace) addTrace("error", "stream stopped", message);
  }, [addTrace, clearStreamTimeout, finishRunningSteps, setLoading]);

  const handleEvent = useCallback((event: StreamEvent) => {
    if (event.type === "text") {
      finishRunningSteps(true);
      reasoningTraceId.current = "";
      const id = ensureAssistantMessage();
      appendAssistantText(id, String(event.content ?? ""));
      return;
    }

    if (event.type === "tool_call") {
      reasoningTraceId.current = "";
      finishRunningSteps(true);
      const name = String(event.name ?? "");
      addTimelineStep(readableTool(name, event.args, ontology));
      addTrace("tool-call", name, event.args);
      if (event.result) {
        if (isErrorResult(event.result)) finishRunningSteps(false);
        addTrace("tool-result", `${name} result`, event.result);
      }
      addMessage("tool", String(event.result ?? ""), {
        ...nextMessageFlow("work"),
        toolName: name,
        toolArgs: event.args,
        toolResult: String(event.result ?? "")
      });
      return;
    }

    if (event.type === "debug") {
      const stage = String(event.stage ?? "");
      if (stage === "request") reasoningTraceId.current = "";
      addTrace(stage === "request" ? "debug-request" : "debug-response", stage === "request" ? "LLM Request" : "LLM Response", event.content ?? "");
      return;
    }

    if (event.type === "reasoning") {
      if (!reasoningTraceId.current) {
        reasoningTraceId.current = createClientId();
        appendTraceEvent({
          id: reasoningTraceId.current,
          tone: "reasoning",
          label: "Reasoning",
          detail: "",
          createdAt: new Date().toISOString()
        });
      }
      appendTraceDetail(reasoningTraceId.current, String(event.content ?? ""));
      return;
    }

    if (event.type === "compact") {
      addMessage("system", "对话历史已压缩。", nextMessageFlow("notice"));
      addTrace("text", "上下文压缩", "对话历史已压缩");
      return;
    }

    if (event.type === "confirmation_required") {
      reasoningTraceId.current = "";
      finishRunningSteps(true);
      addTimelineStep(`需要确认: ${readableTool(String(event.tool_name ?? "工具"), event.args, ontology)}`);
      setPendingAction({
        kind: "confirmation",
        sessionId,
        title: `确认执行 ${String(event.tool_name ?? "工具")}`,
        detail: String(event.reason ?? stringify(event.args))
      });
      addTrace("tool-call", `需确认: ${String(event.tool_name ?? "工具")}`, event.reason ?? event.args);
      setLoading("chat", false);
      streamRef.current?.close();
      return;
    }

    if (event.type === "question") {
      reasoningTraceId.current = "";
      finishRunningSteps(true);
      addTimelineStep("等待用户选择");
      const options = Array.isArray(event.options)
        ? event.options.map((option) => ({
          label: String((option as { label?: unknown }).label ?? ""),
          description: (option as { description?: unknown }).description == null
            ? undefined
            : String((option as { description?: unknown }).description)
        })).filter((option) => option.label)
        : undefined;
      setPendingAction({
        kind: "question",
        sessionId,
        title: String(event.question ?? "需要你选择"),
        options,
        multiSelect: Boolean(event.multi_select)
      });
      addTrace("tool-call", "ask_user", event.question ?? "");
      setLoading("chat", false);
      streamRef.current?.close();
      return;
    }

    if (event.type === "hook_blocked") {
      finishRunningSteps(false);
      addTrace("error", String(event.hook_event ?? "hook blocked"), event.reason ?? "");
      addMessage("system", `Hook 阻断: ${String(event.reason ?? "")}`, nextMessageFlow("notice"));
      setLoading("chat", false);
      return;
    }

    if (event.type === "done") {
      clearStreamTimeout();
      finishRunningSteps(true);
      reasoningTraceId.current = "";
      assistantId.current = "";
      currentTurnId.current = "";
      messageSequence.current = 0;
      streamRef.current = null;
      setLoading("chat", false);
      return;
    }

    if ((event as Record<string, unknown>).type === "error") {
      clearStreamTimeout();
      finishRunningSteps(false);
      setLoading("chat", false);
      assistantId.current = "";
      currentTurnId.current = "";
      messageSequence.current = 0;
      reasoningTraceId.current = "";
      streamRef.current = null;
      addTrace("error", "stream closed", event);
      toast.error("对话流已关闭，请确认后端服务和模型服务是否可用。");
    }
  }, [
    addMessage,
    addTimelineStep,
    addTrace,
    appendAssistantText,
    appendTraceDetail,
    appendTraceEvent,
    clearStreamTimeout,
    ensureAssistantMessage,
    finishRunningSteps,
    nextMessageFlow,
    ontology,
    sessionId,
    setLoading,
    setPendingAction
  ]);

  useEffect(() => {
    const key = sessionStorageKey(currentDomain);
    const stored = localStorage.getItem(key) || createSessionId();
    localStorage.setItem(key, stored);
    setSessionId(stored);
    setInput("");
    setTurnCount(0);
    setTimelineSteps([]);
    assistantId.current = "";
    reasoningTraceId.current = "";
    currentTurnId.current = "";
    messageSequence.current = 0;
    clearStreamTimeout();
    streamRef.current?.close();
    streamRef.current = null;
    setPendingAction(null);
    clearTraceEvents();
    clearMessages();
    if (!ontology) return;
    api.getHistory(currentDomain, stored)
      .then((history) => {
        replaceMessages(history.map((message) => ({
          id: createClientId(),
          role: message.role,
          content: message.content,
          createdAt: new Date().toISOString()
        })));
      })
      .catch(() => undefined);
  }, [clearMessages, clearStreamTimeout, clearTraceEvents, currentDomain, ontology, replaceMessages, setPendingAction]);

  useEffect(() => () => {
    clearStreamTimeout();
    streamRef.current?.close();
  }, [clearStreamTimeout]);

  function newChat() {
    const next = createSessionId();
    localStorage.setItem(sessionStorageKey(currentDomain), next);
    streamRef.current?.close();
    setSessionId(next);
    setInput("");
    setTurnCount(0);
    setTimelineSteps([]);
    assistantId.current = "";
    reasoningTraceId.current = "";
    currentTurnId.current = "";
    messageSequence.current = 0;
    clearStreamTimeout();
    streamRef.current = null;
    setPendingAction(null);
    clearMessages();
    clearTraceEvents();
    setLoading("chat", false);
    inputRef.current?.focus();
  }

  function submit(event?: FormEvent, override?: string, options?: SubmitOptions) {
    event?.preventDefault();
    const message = (override ?? input).trim();
    if (!message || !ontology) return;
    if (loading && !options?.replaceRunning) return;
    if (loading) stopStream(undefined, false);
    clearStreamTimeout();
    streamRef.current?.close();
    setInput("");
    assistantId.current = "";
    reasoningTraceId.current = "";
    currentTurnId.current = createClientId();
    messageSequence.current = 0;
    setTimelineSteps([]);
    const nextTurn = turnCount + 1;
    setTurnCount(nextTurn);
    addTrace("turn", `Turn ${nextTurn}`, message);
    addMessage("user", message, nextMessageFlow("request"));
    setLoading("chat", true);
    streamRef.current = api.streamChat(currentDomain, message, sessionId, handleEvent);
    streamTimeoutRef.current = window.setTimeout(() => {
      stopStream("请求长时间没有完成，已自动停止。可以重新发送或换一个示例问题。");
      toast.error("请求长时间没有完成，已自动停止。");
    }, 45000);
  }

  async function consumeFollowup(res: Response) {
    if (!res.ok || !res.body) throw new Error(await res.text());
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = parseSseFrames(buffer, handleEvent);
    }
    buffer += decoder.decode();
    parseSseFrames(`${buffer}\n\n`, handleEvent);
  }

  async function confirm(approved: boolean, answer?: string) {
    if (!pendingAction || !ontology) return;
    setPendingAction(null);
    setLoading("chat", true);
    assistantId.current = "";
    reasoningTraceId.current = "";
    try {
      const res = await api.confirm(currentDomain, pendingAction.sessionId, approved, answer);
      await consumeFollowup(res);
    } catch (error) {
      finishRunningSteps(false);
      toast.error(error instanceof Error ? error.message : "确认操作失败");
    } finally {
      setLoading("chat", false);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (filteredPrompts.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActivePromptIndex((index) => Math.min(index + 1, filteredPrompts.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActivePromptIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setInput("");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        submit(undefined, filteredPrompts[activePromptIndex]?.prompt);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) submit(event);
  }

  useEffect(() => {
    setActivePromptIndex(0);
  }, [input]);

  const lastMessage = messages[messages.length - 1];
  const lastMessageContent = lastMessage?.content ?? "";
  const visibleMessages = useMemo(() => orderMessagesForDisplay(messages.filter((message) => (
    message.role !== "assistant" || message.content.trim()
  ))), [messages]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = messageScrollRef.current;
      if (!element) return;
      if (typeof element.scrollTo === "function") {
        element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      } else {
        element.scrollTop = element.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lastMessage?.id, lastMessageContent, loading, messages.length, pendingAction?.title, timelineSteps.length]);

  return (
    <section className="chat-layout">
      <div className="console-panel chat-main">
        <div className="panel-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={loading ? "status-dot" : "status-dot status-dot-muted"} />
              <div className="panel-title">Agent Workspace</div>
              <Badge tone="green">{sessionId}</Badge>
            </div>
            <div className="panel-subtitle truncate">对话、工具执行、确认流和会话历史</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge>{visibleMessages.length} 消息</Badge>
            <Badge tone={traceEvents.length ? "blue" : "neutral"}>{traceEvents.length} Trace</Badge>
            <button type="button" onClick={newChat} className="command-button">
              <ListRestart className="h-4 w-4" />
              新对话
            </button>
            <button type="button" onClick={clearMessages} title="只清空当前页面消息，不创建新会话" className="icon-button">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="message-scroll" ref={messageScrollRef}>
          {visibleMessages.length === 0 ? (
            <div className="flex h-full min-h-80 items-center justify-center">
              <div className="w-full max-w-3xl rounded-md border border-dashed p-6" style={{ borderColor: "var(--line)", background: "var(--bg-elevated)" }}>
                <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
                  <Bot className="h-4 w-4" style={{ color: "var(--accent-strong)" }} />
                  开始一个业务查询
                </div>
                <div className="mt-2 text-sm leading-6" style={{ color: "var(--text-faint)" }}>输入问题或用右侧 Prompts 选择示例。会话按当前 domain 保存，工具调用和确认节点会同步进入 Trace。</div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {promptItems.slice(0, 4).map((item) => (
                    <button
                      key={`${item.group}-${item.prompt}`}
                      type="button"
                      disabled={!ontology}
                      onClick={() => submit(undefined, item.prompt, { replaceRunning: true })}
                      className="resource-card"
                    >
                      <div className="line-clamp-2 text-xs leading-5" style={{ color: "var(--text-muted)" }}>{item.prompt}</div>
                      <div className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>{item.group}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="message-stack">
              {visibleMessages.map((message) => (
                <MessageBubble message={message} key={message.id} />
              ))}
              {loading ? <ProcessingBubble onStop={() => stopStream("用户停止了当前请求。")} /> : null}
            </div>
          )}
        </div>

        {timelineSteps.length ? (
          <div className="timeline-strip">
            <div className="section-label mb-2">Agent 执行进度</div>
            <div className="flex gap-2 overflow-auto">
              {timelineSteps.map((step) => (
                <div key={step.id} className={`timeline-item ${step.status === "done" ? "timeline-done" : step.status === "error" ? "timeline-error" : "timeline-running"}`}>
                  <span className="truncate">{step.label}</span>
                  <span className="ml-3 shrink-0">{step.status === "done" ? "✓" : step.status === "error" ? "✕" : "..."}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {pendingAction ? (
          <div className="border-t p-4" style={{ borderColor: "color-mix(in srgb, var(--warning) 50%, var(--line))", background: "var(--warning-soft)" }}>
            <div className="mb-3 text-sm font-semibold" style={{ color: "var(--warning)" }}>{pendingAction.title}</div>
            {pendingAction.detail ? <pre className="json-block mb-3 max-h-32">{pendingAction.detail}</pre> : null}
            {pendingAction.options?.length ? (
              <div className="mb-3 grid gap-2">
                {pendingAction.options.map((option) => (
                  <button
                    type="button"
                    key={option.label}
                    onClick={() => confirm(true, option.label)}
                    className="resource-card"
                  >
                    <div className="font-medium" style={{ color: "var(--text)" }}>{option.label}</div>
                    {option.description ? <div className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>{option.description}</div> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => confirm(true)} className="primary-button">
                <Check className="h-4 w-4" />
                同意
              </button>
              <button type="button" onClick={() => confirm(false)} className="command-button">
                <X className="h-4 w-4" />
                拒绝
              </button>
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} className="composer">
          {promptItems.length ? (
            <div className="composer-prompts">
              {promptItems.slice(0, 6).map((item) => (
                <button
                  key={`${item.group}-${item.prompt}`}
                  type="button"
                  disabled={!ontology}
                  onClick={() => submit(undefined, item.prompt, { replaceRunning: true })}
                  className="prompt-chip"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>{item.prompt}</span>
                </button>
              ))}
            </div>
          ) : null}
          {filteredPrompts.length ? (
            <div className="prompt-popover">
              {filteredPrompts.map((item, index) => (
                <button
                  type="button"
                  key={`${item.group}-${item.prompt}`}
                  onMouseDown={(event) => event.preventDefault()}
                  disabled={!ontology}
                  onClick={() => submit(undefined, item.prompt, { replaceRunning: true })}
                  className={`prompt-option ${index === activePromptIndex ? "prompt-option-active" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>{item.prompt}</span>
                    <span className="shrink-0 text-[11px]" style={{ color: "var(--text-faint)" }}>{item.group}</span>
                  </div>
                  {item.desc ? <div className="mt-1 text-[11px]" style={{ color: "var(--text-faint)" }}>{item.desc}</div> : null}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={inputRef}
            className="control-input flex-1"
            placeholder={ontology ? "输入问题... 输入 / 查看示例" : "先选择一个 domain"}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <button
            type="submit"
            disabled={loading || !ontology || !input.trim()}
            className="primary-button h-[46px]"
          >
            <Send className="h-4 w-4" />
            发送
          </button>
        </form>
      </div>

      <aside className="console-panel assistant-panel">
        <div className="panel-header">
          <div className="flex items-center gap-2 panel-title">
            <PanelRightOpen className="h-4 w-4" style={{ color: "var(--text-faint)" }} />
            Assistant Panel
          </div>
          <div className="segmented">
            <button type="button" onClick={() => setSidePanel("trace")} className={`segment-button ${sidePanel === "trace" ? "segment-button-active" : ""}`}>Trace</button>
            <button type="button" onClick={() => setSidePanel("prompts")} className={`segment-button ${sidePanel === "prompts" ? "segment-button-active" : ""}`}>Prompts</button>
          </div>
        </div>
        {sidePanel === "trace" ? (
          <TracePanel events={traceEvents} onClear={clearTraceEvents} />
        ) : (
          <PromptPanel groups={promptGroups} disabled={!ontology} onSubmit={(prompt) => submit(undefined, prompt, { replaceRunning: true })} />
        )}
      </aside>
    </section>
  );
}

function ProcessingBubble({ onStop }: { onStop: () => void }) {
  return (
    <div className="message-row">
      <div className="processing-card" role="status" aria-live="polite">
        <span className="processing-dot" />
        <span>正在处理请求</span>
        <button type="button" className="processing-stop" onClick={onStop}>停止</button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const Icon = message.role === "user" ? UserRound : message.role === "tool" ? Wrench : Bot;
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";

  if (isTool) return <ToolMessageBubble message={message} />;

  return (
    <div className={`message-row ${isUser ? "message-row-user" : ""}`}>
      <div className={`message-card ${isUser ? "message-card-user" : isTool ? "message-card-tool" : isSystem ? "message-card-system" : ""}`}>
        <div className="message-meta">
          <Icon className="h-4 w-4" />
          <span>{message.role}</span>
          <span>{formatTime(message.createdAt)}</span>
          {message.toolName ? <Badge tone="blue">{message.toolName}</Badge> : null}
        </div>
        {message.toolArgs ? <pre className="json-block mb-2 max-h-32">{stringify(message.toolArgs)}</pre> : null}
        <div className="prose prose-invert prose-sm max-w-none" style={{ color: "var(--text)" }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || " "}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function ToolMessageBubble({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeToolResult(message.content);
  const error = isErrorResult(message.content);

  return (
    <div className="message-row tool-message-row">
      <div className={`tool-call-card ${error ? "tool-call-error" : ""}`}>
        <div className="tool-call-line">
          <div className="flex min-w-0 items-center gap-2">
            <Wrench className="h-4 w-4 shrink-0" />
            <span className="tool-call-title">{message.toolName || "tool"}</span>
            <span className={`tool-call-status ${error ? "tool-call-status-error" : ""}`}>{error ? "error" : "done"}</span>
          </div>
          <div className="tool-call-actions">
            <span className="shrink-0 text-xs" style={{ color: "var(--text-faint)" }}>{formatTime(message.createdAt)}</span>
            <button type="button" className="tool-detail-toggle" onClick={() => setExpanded((value) => !value)}>
              <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`} />
              详情
            </button>
          </div>
        </div>
        <div className="tool-call-summary">{summary}</div>
        {expanded ? (
          <div className="tool-detail-grid">
            {message.toolArgs ? (
              <div>
                <div className="section-label mb-1">Args</div>
                <pre className="json-block max-h-56">{stringify(message.toolArgs)}</pre>
              </div>
            ) : null}
            <div>
              <div className="section-label mb-1">Result</div>
              <pre className="json-block max-h-72">{formatToolResult(message.content)}</pre>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function summarizeToolResult(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return "工具已执行，未返回正文。";
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return `返回 ${parsed.length} 条记录。`;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (record.error) return `错误：${String(record.error)}`;
      if (Array.isArray(record.result)) return `返回 ${record.result.length} 条结果。`;
      if (record.data && typeof record.data === "object") {
        return `返回 data：${Object.keys(record.data as Record<string, unknown>).slice(0, 5).join(", ")}`;
      }
      const keys = Object.keys(record).slice(0, 6);
      return keys.length ? `返回字段：${keys.join(", ")}` : "工具已执行。";
    }
  } catch {
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
  }
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
}

function formatToolResult(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function TracePanel({ events, onClear }: { events: TraceEvent[]; onClear: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
          <Wrench className="h-4 w-4" style={{ color: "var(--info)" }} />
          Agent Trace
          <Badge tone="blue">{events.length}</Badge>
        </div>
        <button type="button" onClick={onClear} className="icon-button" title="清空 Trace">
          <Eraser className="h-4 w-4" />
        </button>
      </div>
      <div className="trace-list">
        {events.length ? events.map((event) => <TraceItem event={event} key={event.id} />) : (
          <div className="p-3 text-xs leading-5" style={{ color: "var(--text-faint)" }}>Trace 会显示 LLM 请求、推理片段、工具调用、工具结果和确认节点。</div>
        )}
      </div>
    </div>
  );
}

function TraceItem({ event }: { event: TraceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = traceMeta[event.tone] ?? traceMeta.text;
  const detail = typeof event.detail === "string" ? event.detail : event.detail == null ? "" : stringify(event.detail);
  const isLong = detail.length > 220;

  return (
    <div className={`trace-event ${meta.className}`}>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
        <span>{formatTime(event.createdAt)} · {meta.label}</span>
        <span className="trace-tag">{meta.tag}</span>
      </div>
      <div className="break-words text-xs font-medium">{event.label}</div>
      {detail ? (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-2 block w-full text-left">
          <pre className={`json-block whitespace-pre-wrap break-words text-[11px] ${!expanded && isLong ? "line-clamp-4" : ""}`}>{detail}</pre>
          {isLong ? <div className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: "var(--text-faint)" }}><ChevronDown className="h-3 w-3" />{expanded ? "收起" : "展开"}</div> : null}
        </button>
      ) : null}
    </div>
  );
}

function PromptPanel({ groups, disabled, onSubmit }: { groups: Array<[string, PromptItem[]]>; disabled: boolean; onSubmit: (prompt: string) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
        <Sparkles className="h-4 w-4" style={{ color: "var(--accent-strong)" }} />
        示例问题
      </div>
      <div className="grid gap-3">
        {groups.length ? groups.map(([group, items]) => (
          <div key={group} className="space-y-2">
            <div className="section-label">{group}</div>
            {items.map((item) => (
              <button
                type="button"
                key={`${group}-${item.prompt}`}
                disabled={disabled}
                onClick={() => onSubmit(item.prompt)}
                className="resource-card w-full"
              >
                <div className="flex items-start gap-2">
                  <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-faint)" }} />
                  <span className="text-xs leading-5" style={{ color: "var(--text-muted)" }}>{item.prompt}</span>
                </div>
                {item.desc ? <div className="mt-1 pl-5 text-[11px]" style={{ color: "var(--text-faint)" }}>{item.desc}</div> : null}
              </button>
            ))}
          </div>
        )) : <div className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>当前领域没有 prompts.json 示例。</div>}
      </div>
    </div>
  );
}
