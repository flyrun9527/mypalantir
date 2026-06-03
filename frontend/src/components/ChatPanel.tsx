import {
  Bot,
  Check,
  ChevronDown,
  Eraser,
  ListRestart,
  Send,
  UserRound,
  Wrench,
  X,
  ServerCog
} from "lucide-react";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { api, parseSseFrames } from "../lib/api";
import { formatTime, stringify } from "../lib/format";
import { createClientId } from "../lib/id";
import { useConsoleStore } from "../store/useConsoleStore";
import type { ChatMessage, ChatPhase, McpStatus, Ontology, StreamEvent, TraceEvent, TraceTone } from "../types/oag";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

type PromptItem = {
  group: string;
  prompt: string;
  desc?: string;
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

function mcpStatusLabel(status: McpStatus | null, toolCount: number) {
  if (!status) return "未连接";
  if (status.status === "loading") return "加载中";
  if (status.status === "online") return `在线 · ${toolCount}`;
  if (status.status === "offline") return "未连接";
  return "异常";
}

function mcpStatusTone(status: McpStatus | null) {
  if (status?.status === "online") return "green";
  if (status?.status === "loading") return "blue";
  return "amber";
}

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
  const mcpStatus = useConsoleStore((state) => state.mcpStatus);
  const mcpTools = useConsoleStore((state) => state.mcpTools);
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
  const [toolsOpen, setToolsOpen] = useState(false);
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

  const clearStreamTimeout = useCallback(() => {
    if (streamTimeoutRef.current == null) return;
    window.clearTimeout(streamTimeoutRef.current);
    streamTimeoutRef.current = null;
  }, []);

  const stopStream = useCallback((message?: string, trace = true) => {
    clearStreamTimeout();
    streamRef.current?.close();
    streamRef.current = null;
    assistantId.current = "";
    currentTurnId.current = "";
    messageSequence.current = 0;
    reasoningTraceId.current = "";
    setLoading("chat", false);
    if (message && trace) addTrace("error", "stream stopped", message);
  }, [addTrace, clearStreamTimeout, setLoading]);

  const handleEvent = useCallback((event: StreamEvent) => {
    if (event.type === "text") {
      reasoningTraceId.current = "";
      const id = ensureAssistantMessage();
      appendAssistantText(id, String(event.content ?? ""));
      return;
    }

    if (event.type === "tool_call") {
      reasoningTraceId.current = "";
      const name = String(event.name ?? "");
      addTrace("tool-call", name, event.args);
      if (event.result) {
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
      addTrace("error", String(event.hook_event ?? "hook blocked"), event.reason ?? "");
      addMessage("system", `Hook 阻断: ${String(event.reason ?? "")}`, nextMessageFlow("notice"));
      setLoading("chat", false);
      return;
    }

    if (event.type === "done") {
      clearStreamTimeout();
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
    addTrace,
    appendAssistantText,
    appendTraceDetail,
    appendTraceEvent,
    clearStreamTimeout,
    ensureAssistantMessage,
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
  }, [lastMessage?.id, lastMessageContent, loading, messages.length, pendingAction?.title]);

  return (
    <section className="chat-layout">
      <div className="console-panel chat-main">
        <div className="panel-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={loading ? "status-dot" : "status-dot status-dot-muted"} />
              <div className="panel-title">{ontology?.description?.split(/[。.]/)[0] || ontology?.name || "智能体对话"}</div>
              <Badge tone="green">{sessionId}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loading ? <ProcessingHeaderStatus onStop={() => stopStream("用户停止了当前请求。")} /> : null}
            <button type="button" onClick={newChat} className="command-button">
              <ListRestart className="h-4 w-4" />
              新对话
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
            </div>
          )}
        </div>

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
          <McpToolsMenu open={toolsOpen} onOpenChange={setToolsOpen} />
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
          <div className="composer-input-shell">
            <textarea
              ref={inputRef}
              className="composer-textarea"
              placeholder={ontology ? "输入问题... 输入 / 查看示例" : "先选择一个 domain"}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <div className="composer-toolbar">
              <button
                type="button"
                className={`tool-menu-button ${toolsOpen ? "tool-menu-button-active" : ""} tool-menu-button-${mcpStatus?.status ?? "offline"}`}
                onClick={() => setToolsOpen((v) => !v)}
                disabled={!ontology}
                aria-label="MCP"
                title="查看 MCP 工具"
              >
                <span className={`mcp-dot mcp-dot-${mcpStatus?.status ?? "offline"}`} />
                <span>MCP</span>
              </button>
              <div className="composer-hint">{ontology ? "Enter 发送，Shift + Enter 换行，/ 查看示例" : "选择 domain 后可开始对话"}</div>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !ontology || !input.trim()}
            className="send-button"
            aria-label="发送"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      <aside className="console-panel assistant-panel">
        <TracePanel events={traceEvents} onClear={clearTraceEvents} />
      </aside>
    </section>
  );
}
function McpToolsMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const ontology = useConsoleStore((state) => state.ontology);
  const status = useConsoleStore((state) => state.mcpStatus);
  const tools = useConsoleStore((state) => state.mcpTools);
  const setSelectedMcpTool = useConsoleStore((state) => state.setSelectedMcpTool);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "read" | "write" | "confirm">("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const readCount = status?.read_only_count ?? tools.filter((tool) => tool.read_only).length;
  const writeCount = status?.write_count ?? tools.filter((tool) => !tool.read_only).length;
  const confirmCount = status?.requires_confirmation_count ?? tools.filter((tool) => tool.requires_confirmation).length;
  const registeredCount = status?.tool_count ?? tools.length;
  const statusText = mcpStatusLabel(status, registeredCount);
  const online = status?.status === "online";
  const visibleTools = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tools.filter((tool) => {
      if (filter === "read" && !tool.read_only) return false;
      if (filter === "write" && tool.read_only) return false;
      if (filter === "confirm" && !tool.requires_confirmation) return false;
      if (!normalizedQuery) return true;
      return [
        tool.name,
        tool.description,
        tool.category
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [filter, query, tools]);
  const activeTool = useMemo(() => (
    visibleTools.find((tool) => tool.name === selectedName) ?? visibleTools[0] ?? null
  ), [visibleTools, selectedName]);

  useEffect(() => {
    if (!visibleTools.length) {
      if (selectedName) setSelectedName(null);
      return;
    }
    if (!selectedName || !visibleTools.some((tool) => tool.name === selectedName)) {
      setSelectedName(visibleTools[0].name);
    }
  }, [visibleTools, selectedName]);

  function openMcpView() {
    if (activeTool) setSelectedMcpTool(activeTool.name);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "mcp");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    window.dispatchEvent(new CustomEvent("oag-view-change", { detail: "mcp" }));
    onOpenChange(false);
  }

  if (!open) return null;

  return (
    <div className="tool-menu-popover">
      <div className="tool-menu-header">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
            <ServerCog className="h-4 w-4" style={{ color: "var(--accent-strong)" }} />
            MCP
            <Badge tone={mcpStatusTone(status)}>{statusText}</Badge>
          </div>
          <div className="tool-menu-endpoint">
            {status?.domain ?? ontology?.name ?? "-"} · {status?.transport ?? "streamable-http"} · {status?.endpoint ?? "未配置 endpoint"}
          </div>
        </div>
        <button type="button" className="tool-detail-toggle" onClick={() => onOpenChange(false)}>关闭</button>
      </div>

      {!online ? (
        <div className="tool-menu-error">
          {status?.error || "远程 MCP 未连接，启动 MCP server 后刷新。"}
        </div>
      ) : null}

      <div className="tool-menu-controls">
        <input
          className="control-input"
          placeholder="搜索 MCP 暴露的工具"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="segmented">
          {[
            { id: "all" as const, label: "全部", count: registeredCount },
            { id: "read" as const, label: "只读", count: readCount },
            { id: "write" as const, label: "写入", count: writeCount },
            { id: "confirm" as const, label: "需确认", count: confirmCount }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-label={`${item.label} ${item.count}`}
              className={`segment-button ${filter === item.id ? "segment-button-active" : ""}`}
            >
              <span>{item.label}</span>
              <span className="segment-count">{item.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tool-menu-body">
        <div className="tool-menu-list">
          {visibleTools.length ? visibleTools.map((tool) => (
            <button
              type="button"
              key={tool.name}
              className={`tool-menu-item ${activeTool?.name === tool.name ? "tool-menu-item-active" : ""}`}
              onClick={() => setSelectedName(tool.name)}
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>{tool.name}</div>
                <div className="line-clamp-2 text-[11px]" style={{ color: "var(--text-faint)" }}>{tool.description || tool.category || "tool"}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                {tool.requires_confirmation ? <Badge tone="amber">确认</Badge> : null}
                <Badge tone={tool.read_only ? "green" : "red"}>{tool.read_only ? "读" : "写"}</Badge>
              </div>
            </button>
          )) : (
            <div className="tool-menu-empty">{online ? "没有匹配的 MCP 工具。" : "远程 MCP 未连接，当前没有可用工具。"}</div>
          )}
        </div>

        <div className="tool-menu-detail-panel">
          {activeTool ? (
            <div className="min-w-0">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="section-label mb-1">工具详情</div>
                  <div className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{activeTool.name}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {activeTool.requires_confirmation ? <Badge tone="amber">确认</Badge> : null}
                  <Badge tone={activeTool.read_only ? "green" : "red"}>{activeTool.read_only ? "只读" : "写入"}</Badge>
                </div>
              </div>
              <p className="tool-menu-detail-desc">{activeTool.description || "没有描述"}</p>
              <div className="tool-menu-detail-grid">
                <InfoPill label="分类" value={activeTool.category || "tool"} />
                <InfoPill label="危险操作" value={activeTool.policy?.destructive ? "是" : "否"} />
              </div>
              <div className="section-label mt-3 mb-1">Input Schema</div>
              <pre className="json-block tool-menu-schema">{stringify(activeTool.input_schema ?? activeTool.parameters ?? {})}</pre>
              <div className="section-label mt-3 mb-1">Policy</div>
              <pre className="json-block tool-menu-policy">{stringify(activeTool.policy ?? {})}</pre>
            </div>
          ) : (
            <div className="tool-menu-empty">{online ? "选择左侧工具后查看详情。" : "连接远程 MCP 后可查看工具详情。"}</div>
          )}
        </div>
      </div>

      <button type="button" className="command-button tool-menu-manage-button" onClick={openMcpView}>
        在 MCP 管理页查看完整详情
      </button>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="tool-menu-info-pill">
      <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>{label}</div>
      <div className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>{value}</div>
    </div>
  );
}

function ProcessingHeaderStatus({ onStop }: { onStop: () => void }) {
  return (
    <div className="processing-header-status" role="status" aria-live="polite">
      <span className="processing-dot" />
      <span>正在处理</span>
      <button type="button" className="processing-stop" onClick={onStop}>停止</button>
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
