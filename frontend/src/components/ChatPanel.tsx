import { Send, Sparkles, Trash2, Wrench, UserRound, Bot, Check, X } from "lucide-react";
import { FormEvent, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { api } from "../lib/api";
import { formatTime, stringify } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import type { ChatMessage, StreamEvent } from "../types/oag";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

const sessionId = `frontend-${Math.random().toString(36).slice(2)}`;

export function ChatPanel() {
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const prompts = useConsoleStore((state) => state.prompts);
  const messages = useConsoleStore((state) => state.messages);
  const pendingAction = useConsoleStore((state) => state.pendingAction);
  const appendMessage = useConsoleStore((state) => state.appendMessage);
  const appendAssistantText = useConsoleStore((state) => state.appendAssistantText);
  const clearMessages = useConsoleStore((state) => state.clearMessages);
  const setPendingAction = useConsoleStore((state) => state.setPendingAction);
  const setLoading = useConsoleStore((state) => state.setLoading);
  const loading = useConsoleStore((state) => state.loading.chat);
  const [input, setInput] = useState("");
  const assistantId = useRef<string>("");
  const streamRef = useRef<EventSource | null>(null);

  const promptGroups = useMemo(() => {
    const groups: Array<{ group: string; items: Array<{ prompt: string; desc?: string }> }> = [];
    const loose: Array<{ prompt: string; desc?: string }> = [];

    for (const item of prompts) {
      if (typeof item === "string") {
        loose.push({ prompt: item });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (Array.isArray(record.items)) {
        const nested = record.items
          .map((child) => {
            if (typeof child === "string") return { prompt: child };
            if (!child || typeof child !== "object") return null;
            const childRecord = child as Record<string, unknown>;
            const prompt = String(childRecord.prompt ?? childRecord.question ?? childRecord.text ?? childRecord.name ?? "");
            if (!prompt) return null;
            return {
              prompt,
              desc: childRecord.desc == null ? undefined : String(childRecord.desc)
            };
          })
          .filter(Boolean) as Array<{ prompt: string; desc?: string }>;
        if (nested.length) {
          groups.push({ group: String(record.group ?? "示例"), items: nested.slice(0, 8) });
        }
        continue;
      }
      const prompt = String(record.prompt ?? record.question ?? record.text ?? record.name ?? "");
      if (prompt) loose.push({ prompt, desc: record.desc == null ? undefined : String(record.desc) });
    }

    if (loose.length) groups.unshift({ group: "推荐", items: loose.slice(0, 8) });
    return groups.slice(0, 5);
  }, [prompts]);

  function addMessage(role: ChatMessage["role"], content: string, extra?: Partial<ChatMessage>) {
    appendMessage({
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
      ...extra
    });
  }

  function handleEvent(event: StreamEvent) {
    if (event.type === "text") {
      if (!assistantId.current) {
        assistantId.current = crypto.randomUUID();
        appendMessage({
          id: assistantId.current,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString()
        });
      }
      appendAssistantText(assistantId.current, String(event.content ?? ""));
      return;
    }

    if (event.type === "tool_call") {
      addMessage("tool", String(event.result ?? ""), {
        toolName: String(event.name ?? ""),
        toolArgs: event.args,
        toolResult: String(event.result ?? "")
      });
      return;
    }

    if (event.type === "confirmation") {
      setPendingAction({
        kind: "confirmation",
        sessionId,
        title: `确认执行 ${String(event.tool_name ?? "工具")}`,
        detail: String(event.reason ?? stringify(event.args))
      });
      setLoading("chat", false);
      return;
    }

    if (event.type === "question") {
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
      setLoading("chat", false);
      return;
    }

    if (event.type === "compact") {
      addMessage("system", "对话历史已压缩。");
      return;
    }

    if (event.type === "done") {
      assistantId.current = "";
      setLoading("chat", false);
      return;
    }

    if ((event as Record<string, unknown>).type === "error") {
      setLoading("chat", false);
      assistantId.current = "";
      toast.error("对话流已关闭，请确认后端服务和模型服务是否可用。");
    }
  }

  function submit(event?: FormEvent, override?: string) {
    event?.preventDefault();
    const message = (override ?? input).trim();
    if (!message || loading || !ontology) return;
    streamRef.current?.close();
    setInput("");
    assistantId.current = "";
    addMessage("user", message);
    setLoading("chat", true);
    streamRef.current = api.streamChat(currentDomain, message, sessionId, handleEvent);
  }

  async function confirm(approved: boolean, answer?: string) {
    if (!pendingAction || !ontology) return;
    setPendingAction(null);
    setLoading("chat", true);
    try {
      const res = await api.confirm(currentDomain, pendingAction.sessionId, approved, answer);
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) {
          const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
          if (dataLine) handleEvent(JSON.parse(dataLine.slice(5).trim()) as StreamEvent);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "确认操作失败");
    } finally {
      setLoading("chat", false);
    }
  }

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col rounded border border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Agent 对话</div>
            <div className="text-xs text-zinc-500">流式响应、工具调用、确认和用户决策</div>
          </div>
          <button type="button" onClick={clearMessages} className="rounded p-2 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {messages.length === 0 ? (
            <EmptyState title="还没有对话" detail="选择一个示例问题，或直接询问当前本体中的对象、规则、函数和业务流程。" />
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <MessageBubble message={message} key={message.id} />
              ))}
            </div>
          )}
        </div>

        {pendingAction ? (
          <div className="border-t border-amber-900/60 bg-amber-950/30 p-4">
            <div className="mb-3 text-sm font-semibold text-amber-200">{pendingAction.title}</div>
            {pendingAction.detail ? <pre className="mb-3 max-h-32 overflow-auto rounded bg-zinc-950 p-3 text-xs text-zinc-300">{pendingAction.detail}</pre> : null}
            {pendingAction.options?.length ? (
              <div className="mb-3 grid gap-2">
                {pendingAction.options.map((option) => (
                  <button
                    type="button"
                    key={option.label}
                    onClick={() => confirm(true, option.label)}
                    className="rounded border border-amber-800 bg-amber-950 px-3 py-2 text-left text-sm text-amber-100 transition hover:border-amber-500"
                  >
                    <div className="font-medium">{option.label}</div>
                    {option.description ? <div className="mt-1 text-xs text-amber-300/70">{option.description}</div> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => confirm(true)} className="inline-flex items-center gap-2 rounded bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950">
                <Check className="h-4 w-4" />
                同意
              </button>
              <button type="button" onClick={() => confirm(false)} className="inline-flex items-center gap-2 rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300">
                <X className="h-4 w-4" />
                拒绝
              </button>
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} className="flex gap-3 border-t border-zinc-800 p-4">
          <textarea
            className="min-h-12 flex-1 resize-none rounded border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-500"
            placeholder={ontology ? "询问当前本体、调用函数或执行工作流..." : "先选择一个 domain"}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) submit(event);
            }}
          />
          <button
            type="submit"
            disabled={loading || !ontology || !input.trim()}
            className="inline-flex h-12 items-center gap-2 rounded bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            <Send className="h-4 w-4" />
            发送
          </button>
        </form>
      </div>

      <aside className="min-h-0 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Sparkles className="h-4 w-4 text-emerald-300" />
          示例问题
        </div>
        <div className="grid gap-2">
          {promptGroups.length ? promptGroups.map((group) => (
            <div key={group.group} className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{group.group}</div>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={`${group.group}-${item.prompt}`}
                  onClick={() => submit(undefined, item.prompt)}
                  className="w-full rounded border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-left text-xs leading-5 text-zinc-300 transition hover:border-emerald-700 hover:text-emerald-200"
                >
                  <div>{item.prompt}</div>
                  {item.desc ? <div className="mt-1 text-[11px] text-zinc-500">{item.desc}</div> : null}
                </button>
              ))}
            </div>
          )) : <div className="text-xs leading-5 text-zinc-500">当前领域没有 prompts.json 示例。</div>}
        </div>
      </aside>
    </section>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const Icon = message.role === "user" ? UserRound : message.role === "tool" ? Wrench : Bot;
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className={`max-w-[86%] rounded border p-3 ${isUser ? "border-emerald-800 bg-emerald-950/50" : isTool ? "border-sky-900 bg-sky-950/30" : "border-zinc-800 bg-zinc-900/70"}`}>
        <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
          <Icon className="h-4 w-4" />
          <span>{message.role}</span>
          <span>{formatTime(message.createdAt)}</span>
          {message.toolName ? <Badge tone="blue">{message.toolName}</Badge> : null}
        </div>
        {message.toolArgs ? <pre className="mb-2 max-h-32 overflow-auto rounded bg-zinc-950 p-2 text-xs text-zinc-400">{stringify(message.toolArgs)}</pre> : null}
        <div className="prose prose-invert prose-sm max-w-none text-zinc-200">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || " "}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
