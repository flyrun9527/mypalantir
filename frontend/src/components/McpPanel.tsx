import Editor from "@monaco-editor/react";
import { AlertTriangle, CheckCircle2, Play, RefreshCw, ServerCog, ShieldCheck, ShieldAlert, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { cx, stringify } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import type { McpTool } from "../types/oag";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

type McpPanelProps = {
  onRefresh: () => void;
};

type FilterMode = "all" | "read" | "write" | "confirm";

const filters: Array<{ id: FilterMode; label: string }> = [
  { id: "all", label: "全部" },
  { id: "read", label: "只读" },
  { id: "write", label: "写入" },
  { id: "confirm", label: "需确认" },
];

function mcpStatusLabel(status: string | undefined, loading: boolean) {
  if (loading || status === "loading") return "加载中";
  if (status === "online") return "在线";
  if (status === "offline") return "未连接";
  if (status === "error") return "异常";
  return "未知";
}

function mcpStatusTone(status: string | undefined, loading: boolean): "green" | "blue" | "amber" | "red" | "neutral" {
  if (loading || status === "loading") return "blue";
  if (status === "online") return "green";
  if (status === "error") return "red";
  if (status === "offline") return "amber";
  return "neutral";
}

export function McpPanel({ onRefresh }: McpPanelProps) {
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const status = useConsoleStore((state) => state.mcpStatus);
  const tools = useConsoleStore((state) => state.mcpTools);
  const selectedTool = useConsoleStore((state) => state.selectedMcpTool);
  const result = useConsoleStore((state) => state.mcpCallResult);
  const error = useConsoleStore((state) => state.mcpError);
  const loading = useConsoleStore((state) => state.loading.mcp);
  const setSelectedTool = useConsoleStore((state) => state.setSelectedMcpTool);
  const setCallResult = useConsoleStore((state) => state.setMcpCallResult);
  const setMcpError = useConsoleStore((state) => state.setMcpError);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [argumentsText, setArgumentsText] = useState("{}");
  const [running, setRunning] = useState(false);

  const activeTool = useMemo(() => (
    tools.find((tool) => tool.name === selectedTool) ?? tools[0] ?? null
  ), [selectedTool, tools]);

  const filteredTools = useMemo(() => tools.filter((tool) => {
    if (filter === "read") return tool.read_only;
    if (filter === "write") return !tool.read_only;
    if (filter === "confirm") return tool.requires_confirmation;
    return true;
  }), [filter, tools]);

  const destructive = Boolean(activeTool?.policy?.destructive);
  const endpoint = status?.endpoint ?? "http://127.0.0.1:8765/mcp";
  const transport = status?.transport ?? "streamable-http";
  const online = status?.status === "online";
  const filterCounts: Record<FilterMode, number> = {
    all: status?.tool_count ?? tools.length,
    read: status?.read_only_count ?? tools.filter((tool) => tool.read_only).length,
    write: status?.write_count ?? tools.filter((tool) => !tool.read_only).length,
    confirm: status?.requires_confirmation_count ?? tools.filter((tool) => tool.requires_confirmation).length,
  };

  async function callTool(tool: McpTool | null) {
    if (!tool) return;
    let args: Record<string, unknown>;
    try {
      const parsed = argumentsText.trim() ? JSON.parse(argumentsText) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("arguments 必须是 JSON object");
      }
      args = parsed as Record<string, unknown>;
    } catch (callError) {
      const message = callError instanceof Error ? callError.message : "arguments JSON 无效";
      setMcpError(message);
      toast.error(message);
      return;
    }

    setRunning(true);
    setMcpError(null);
    setCallResult(null);
    try {
      const output = await api.callMcpTool(currentDomain, tool.name, args);
      setCallResult(output);
      toast.success("MCP 调用完成");
    } catch (callError) {
      const message = callError instanceof Error ? callError.message : "MCP 调用失败";
      setMcpError(message);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  }

  if (!currentDomain && !status) {
    return <EmptyState title="未选择 domain" detail="选择业务域后可以查看远程 MCP 连接状态、工具清单和调试调用。" />;
  }

  return (
    <section className="mcp-layout">
      <aside className="console-panel flex min-h-0 flex-col">
        <div className="panel-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2 panel-title">
              <ServerCog className="h-4 w-4" style={{ color: "var(--info)" }} />
              远程 MCP
            </div>
            <p className="panel-subtitle">Agent 通过这个 endpoint 发现并调用本体工具。</p>
          </div>
          <button type="button" onClick={onRefresh} className="icon-button" title="刷新远程 MCP">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="mcp-status-card">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {status?.status === "online" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "var(--accent-strong)" }} />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--warning)" }} />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>MCP Server</div>
                <div className="truncate text-xs" style={{ color: "var(--text-faint)" }}>{endpoint}</div>
              </div>
            </div>
            <Badge tone={mcpStatusTone(status?.status, loading)}>
              {mcpStatusLabel(status?.status, loading)}
            </Badge>
          </div>
          <div className="mcp-server-fields mt-3">
            <InfoPill label="Domain" value={status?.domain ?? currentDomain ?? "-"} />
            <InfoPill label="Transport" value={transport} />
            <InfoPill label="Endpoint" value={endpoint} />
          </div>
          {status?.error || error ? (
            <div className="mt-3 rounded-md border p-2 text-xs leading-5" style={{ borderColor: "color-mix(in srgb, var(--danger) 44%, var(--line))", background: "var(--danger-soft)", color: "var(--danger)" }}>
              {status?.error ?? error}
            </div>
          ) : null}
        </div>

        <div className="segmented mx-3 mb-2">
          {filters.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setFilter(item.id)}
              aria-label={`${item.label} ${filterCounts[item.id]}`}
              className={cx("segment-button", filter === item.id && "segment-button-active")}
            >
              <span>{item.label}</span>
              <span className="segment-count">{filterCounts[item.id]}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
          {filteredTools.length ? filteredTools.map((tool) => (
            <button
              type="button"
              key={tool.name}
              onClick={() => {
                setSelectedTool(tool.name);
                setCallResult(null);
                setMcpError(null);
              }}
              className={cx("resource-card w-full", activeTool?.name === tool.name && "resource-card-active")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{tool.name}</span>
                <div className="flex shrink-0 gap-1">
                  {tool.requires_confirmation ? <Badge tone="amber">confirm</Badge> : null}
                  <Badge tone={tool.read_only ? "green" : "red"}>{tool.read_only ? "read" : "write"}</Badge>
                </div>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5" style={{ color: "var(--text-faint)" }}>{tool.description || "没有描述"}</p>
              <div className="mt-2 text-[11px]" style={{ color: "var(--info)" }}>{tool.category || "query"}</div>
            </button>
          )) : (
            <EmptyState title="没有 MCP 工具" detail={online ? "当前过滤条件下没有工具。" : "远程 MCP 未连接，当前没有可用工具。"} />
          )}
        </div>
      </aside>

      <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="console-panel min-h-0 overflow-auto p-4">
          {activeTool ? (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" style={{ color: "var(--info)" }} />
                  <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{activeTool.name}</h2>
                </div>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-muted)" }}>{activeTool.description || "没有描述"}</p>
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                <Info label="分类" value={activeTool.category || "query"} />
                <Info label="访问" value={activeTool.read_only ? "只读" : "写入"} />
                <Info label="确认" value={activeTool.requires_confirmation ? "需要" : "无需"} />
                <Info label="危险操作" value={destructive ? "是" : "否"} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <PolicyCard
                  icon={activeTool.read_only ? ShieldCheck : ShieldAlert}
                  title="执行策略"
                  tone={activeTool.read_only ? "green" : destructive ? "red" : "amber"}
                  value={activeTool.read_only ? "只读工具，可安全查询" : destructive ? "写入/破坏性工具，需要确认" : "写入工具"}
                />
                <PolicyCard
                  icon={activeTool.requires_confirmation ? AlertTriangle : CheckCircle2}
                  title="确认策略"
                  tone={activeTool.requires_confirmation ? "amber" : "green"}
                  value={activeTool.requires_confirmation ? "调用前应触发确认流" : "无需额外确认"}
                />
              </div>

              <div>
                <div className="section-label mb-2">Input Schema</div>
                <div className="h-80 overflow-hidden rounded-md border" style={{ borderColor: "var(--line)" }}>
                  <Editor
                    value={stringify(activeTool.input_schema ?? activeTool.parameters ?? {})}
                    language="json"
                    theme="vs-dark"
                    options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, wordWrap: "on" }}
                  />
                </div>
              </div>

              <div>
                <div className="section-label mb-2">Policy</div>
                <pre className="json-block max-h-72">{stringify(activeTool.policy ?? {})}</pre>
              </div>
            </div>
          ) : (
            <EmptyState title="未选择工具" detail="选择左侧 MCP 工具后查看 schema 和策略。" />
          )}
        </div>

        <aside className="console-panel min-h-0 overflow-auto p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="panel-title">调试调用</div>
              <div className="panel-subtitle">向当前远程 MCP 发送一次 tool call。</div>
            </div>
            <Badge tone={running ? "blue" : error ? "red" : result ? "green" : "neutral"}>
              {running ? "running" : error ? "error" : result ? "success" : "idle"}
            </Badge>
          </div>

          <div className="section-label mb-2">Arguments JSON</div>
          <div className="h-56 overflow-hidden rounded-md border" style={{ borderColor: "var(--line)" }}>
            <Editor
              value={argumentsText}
              onChange={(value) => setArgumentsText(value ?? "{}")}
              language="json"
              theme="vs-dark"
              options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: "on" }}
            />
          </div>

          <button
            type="button"
            onClick={() => callTool(activeTool)}
            disabled={!activeTool || running}
            className="primary-button mt-3 w-full"
          >
            <Play className="h-4 w-4" />
            {running ? "调用中..." : "调用工具"}
          </button>

          {error ? (
            <div className="mt-4 rounded-md border p-3 text-xs leading-5" style={{ borderColor: "color-mix(in srgb, var(--danger) 44%, var(--line))", background: "var(--danger-soft)", color: "var(--danger)" }}>
              {error}
            </div>
          ) : null}

          {result ? (
            <div className="mt-4">
              <div className="section-label mb-2">Result</div>
              <pre className="json-block max-h-[420px]">{stringify(result.result)}</pre>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="resource-card">
      <div className="section-label">{label}</div>
      <div className="mt-2 truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{value}</div>
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

function PolicyCard({
  icon: Icon,
  title,
  value,
  tone,
}: {
  icon: typeof ShieldCheck;
  title: string;
  value: string;
  tone: "green" | "amber" | "red";
}) {
  const color = tone === "green" ? "var(--accent-strong)" : tone === "amber" ? "var(--warning)" : "var(--danger)";
  const background = tone === "green" ? "var(--accent-soft)" : tone === "amber" ? "var(--warning-soft)" : "var(--danger-soft)";
  return (
    <div className="resource-card" style={{ background }}>
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color }}>
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <div className="mt-2 text-xs leading-5" style={{ color: "var(--text-muted)" }}>{value}</div>
    </div>
  );
}
