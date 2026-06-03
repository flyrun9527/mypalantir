import Editor from "@monaco-editor/react";
import { ChevronDown, Play, SquareFunction, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { firstLine, stringify, cx } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import type { FunctionDef, FunctionParam } from "../types/oag";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

type FunctionResult = {
  status: "idle" | "running" | "success" | "error";
  value?: unknown;
};

function defaultArgs(def: FunctionDef | null) {
  const args: Record<string, unknown> = {};
  for (const [name, param] of Object.entries(def?.params ?? {})) {
    if (param.default !== undefined) args[name] = param.default;
  }
  return args;
}

function coerceValue(value: string, param: FunctionParam) {
  if (value === "") return undefined;
  if (param.type === "int" || param.type === "integer") return Number.parseInt(value, 10);
  if (param.type === "float" || param.type === "number") return Number(value);
  if (param.type === "bool" || param.type === "boolean") return value === "true" || value === "1";
  if (param.type === "dict" || param.type === "object" || param.type === "list" || param.type === "array") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function FunctionsPanel() {
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const selectedFunction = useConsoleStore((state) => state.selectedFunction);
  const setSelectedFunction = useConsoleStore((state) => state.setSelectedFunction);
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<FunctionResult>({ status: "idle" });
  const [openRaw, setOpenRaw] = useState(false);

  const functions = useMemo(() => {
    return Object.entries(ontology?.functions ?? {}).sort(([a], [b]) => a.localeCompare(b));
  }, [ontology]);

  const activeName = selectedFunction ?? functions[0]?.[0] ?? null;
  const activeDef = activeName ? functions.find(([name]) => name === activeName)?.[1] ?? null : null;

  useEffect(() => {
    if (!selectedFunction && functions[0]) setSelectedFunction(functions[0][0]);
  }, [functions, selectedFunction, setSelectedFunction]);

  useEffect(() => {
    setArgs(defaultArgs(activeDef));
    setResult({ status: "idle" });
    setOpenRaw(false);
  }, [activeDef, activeName]);

  async function runFunction() {
    if (!activeName) return;
    setResult({ status: "running" });
    try {
      const output = await api.callMcpTool(currentDomain, activeName, args);
      setResult({ status: "success", value: output.result });
      toast.success("MCP 工具调用完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP 工具调用失败";
      setResult({ status: "error", value: message });
      toast.error(message);
    }
  }

  function updateArg(name: string, param: FunctionParam, value: string) {
    setArgs((current) => {
      const next = { ...current };
      const coerced = coerceValue(value, param);
      if (coerced === undefined) delete next[name];
      else next[name] = coerced;
      return next;
    });
  }

  if (!ontology) return <EmptyState title="未加载函数" detail="选择 domain 后会展示 ontology 中声明、由 MCP 暴露的函数。" />;

  return (
    <section className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[392px_minmax(0,1fr)]">
      <aside className="console-panel flex min-h-0 flex-col">
        <div className="panel-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2 panel-title">
              <SquareFunction className="h-4 w-4" style={{ color: "var(--purple)" }} />
              函数目录
            </div>
            <p className="panel-subtitle">函数执行统一通过远程 MCP 工具调用。</p>
          </div>
          <Badge tone="purple">{functions.length}</Badge>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
          {functions.map(([name, def]) => {
            const open = activeName === name;
            return (
              <button
                type="button"
                key={name}
                onClick={() => {
                  setSelectedFunction(name);
                  setResult({ status: "idle" });
                }}
                className={cx("resource-card w-full", open && "resource-card-active")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{name}</span>
                  {def.writes_to?.length ? <Badge tone="amber">write</Badge> : <Badge>{def.function_type || "tool"}</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5" style={{ color: "var(--text-faint)" }}>{firstLine(def.summary || def.description || def.hint)}</p>
                {def.depends_on?.length ? <div className="mt-2 text-[11px]" style={{ color: "var(--purple)" }}>depends: {def.depends_on.join(", ")}</div> : null}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="console-panel min-h-0 overflow-auto p-4">
          {activeDef && activeName ? (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" style={{ color: "var(--purple)" }} />
                  <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{activeName}</h2>
                </div>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-muted)" }}>{activeDef.summary || activeDef.description || activeDef.hint || "没有描述"}</p>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <Info label="类型" value={activeDef.function_type || "tool"} />
                <Info label="分组" value={activeDef.group || "-"} />
                <Info label="写入对象" value={activeDef.writes_to?.join(", ") || "无"} />
              </div>

              {activeDef.hint ? <div className="rounded-md border p-3 text-xs leading-5" style={{ borderColor: "color-mix(in srgb, var(--warning) 50%, var(--line))", background: "var(--warning-soft)", color: "var(--warning)" }}>{activeDef.hint}</div> : null}

              <div>
                <div className="section-label mb-2">Parameters</div>
                <div className="space-y-2">
                  {Object.entries(activeDef.params ?? {}).length ? Object.entries(activeDef.params ?? {}).map(([name, param]) => (
                    <label key={name} className="resource-card block">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{name}</span>
                        <Badge>{param.type || "str"}</Badge>
                      </div>
                      <input
                        className="control-input"
                        value={args[name] == null ? "" : typeof args[name] === "string" ? String(args[name]) : stringify(args[name])}
                        placeholder={param.description || name}
                        onChange={(event) => updateArg(name, param, event.target.value)}
                      />
                      {param.description ? <p className="mt-2 text-xs leading-5" style={{ color: "var(--text-faint)" }}>{param.description}</p> : null}
                    </label>
                  )) : <div className="resource-card text-sm" style={{ color: "var(--text-faint)" }}>无参数定义，执行时传空对象。</div>}
                </div>
              </div>

              <button
                type="button"
                onClick={runFunction}
                disabled={!activeName || result.status === "running"}
                className="primary-button w-full"
              >
                <Play className="h-4 w-4" />
                {result.status === "running" ? "executing..." : "Execute"}
              </button>

              <button
                type="button"
                onClick={() => setOpenRaw((value) => !value)}
                className="command-button"
              >
                <ChevronDown className={`h-4 w-4 transition ${openRaw ? "rotate-180" : ""}`} />
                Raw Definition
              </button>
              {openRaw ? (
                <div className="h-72 overflow-hidden rounded-md border" style={{ borderColor: "var(--line)" }}>
                  <Editor value={stringify(activeDef)} language="json" theme="vs-dark" options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }} />
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState title="没有函数" detail="当前 domain 没有返回可用函数。" />
          )}
        </div>

        <aside className="console-panel min-h-0 overflow-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="panel-title">MCP 调用调试</div>
              <div className="panel-subtitle">调用当前函数对应的远程 MCP tool。</div>
            </div>
            <Badge tone={result.status === "error" ? "red" : result.status === "success" ? "green" : "neutral"}>{result.status}</Badge>
          </div>
          <div className="section-label mb-2">Args JSON</div>
          <div className="h-56 overflow-hidden rounded-md border" style={{ borderColor: "var(--line)" }}>
            <Editor
              value={stringify(args)}
              onChange={(value) => {
                try {
                  setArgs(value?.trim() ? JSON.parse(value) : {});
                } catch {
                  return;
                }
              }}
              language="json"
              theme="vs-dark"
              options={{ minimap: { enabled: false }, fontSize: 12 }}
            />
          </div>
          <div className="section-label mt-4">Result</div>
          <pre className={`json-block mt-2 max-h-96 ${result.status === "error" ? "text-red-300" : result.status === "success" ? "text-emerald-300" : ""}`}>
            {result.status === "idle" ? "尚未调用" : result.status === "running" ? "executing..." : stringify(result.value)}
          </pre>
        </aside>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <div className="metric-label">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{value}</div>
    </div>
  );
}
