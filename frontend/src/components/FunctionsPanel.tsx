import Editor from "@monaco-editor/react";
import { Play, SquareFunction, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { firstLine, stringify, cx } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import type { FunctionDef } from "../types/oag";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

export function FunctionsPanel() {
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const selectedFunction = useConsoleStore((state) => state.selectedFunction);
  const setSelectedFunction = useConsoleStore((state) => state.setSelectedFunction);
  const registryFunctions = useConsoleStore((state) => state.registryFunctions);
  const [argsText, setArgsText] = useState("{}");
  const [result, setResult] = useState<unknown>(null);
  const [running, setRunning] = useState(false);

  const functions = useMemo(() => {
    const merged = new Map<string, FunctionDef>();
    for (const [name, def] of Object.entries(ontology?.functions ?? {})) merged.set(name, def);
    for (const [name, raw] of Object.entries(registryFunctions ?? {})) {
      if (!merged.has(name)) merged.set(name, (raw && typeof raw === "object" ? raw : {}) as FunctionDef);
    }
    return Array.from(merged.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [ontology, registryFunctions]);

  const activeName = selectedFunction ?? functions[0]?.[0] ?? null;
  const activeDef = activeName ? functions.find(([name]) => name === activeName)?.[1] : null;

  async function runFunction() {
    if (!activeName) return;
    setRunning(true);
    try {
      const args = argsText.trim() ? JSON.parse(argsText) : {};
      const output = await api.callFunction(currentDomain, activeName, args);
      setResult(output);
      toast.success("函数调用完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "函数调用失败");
    } finally {
      setRunning(false);
    }
  }

  if (!ontology) return <EmptyState title="未加载函数" detail="选择 domain 后会展示 ontology 和 registry 中可调用的函数。" />;

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-auto rounded border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <SquareFunction className="h-4 w-4 text-purple-300" />
            函数目录
          </div>
          <p className="mt-1 text-xs text-zinc-500">业务函数、查询函数、写操作和隐藏 registry 函数。</p>
        </div>
        <div className="space-y-1 p-2">
          {functions.map(([name, def]) => (
            <button
              type="button"
              key={name}
              onClick={() => {
                setSelectedFunction(name);
                setResult(null);
              }}
              className={cx(
                "w-full rounded border px-3 py-3 text-left transition",
                activeName === name ? "border-purple-700 bg-purple-950/40" : "border-transparent hover:border-zinc-800 hover:bg-zinc-900"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-zinc-100">{name}</span>
                {def.writes_to?.length ? <Badge tone="amber">write</Badge> : <Badge>{def.function_type || "tool"}</Badge>}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{firstLine(def.summary || def.description || def.hint)}</p>
            </button>
          ))}
        </div>
      </aside>

      <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-h-0 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-4">
          {activeDef && activeName ? (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-purple-300" />
                  <h2 className="text-lg font-semibold text-zinc-100">{activeName}</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{activeDef.summary || activeDef.description || activeDef.hint || "没有描述"}</p>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <Info label="类型" value={activeDef.function_type || "tool"} />
                <Info label="分组" value={activeDef.group || "-"} />
                <Info label="写入对象" value={activeDef.writes_to?.join(", ") || "无"} />
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Parameters</div>
                <div className="space-y-2">
                  {Object.entries(activeDef.params ?? {}).length ? Object.entries(activeDef.params ?? {}).map(([name, param]) => (
                    <div key={name} className="rounded border border-zinc-800 bg-zinc-900/70 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-100">{name}</span>
                        <Badge>{param.type || "str"}</Badge>
                      </div>
                      {param.description ? <p className="mt-1 text-xs leading-5 text-zinc-500">{param.description}</p> : null}
                    </div>
                  )) : <div className="text-sm text-zinc-500">无参数定义</div>}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Raw Definition</div>
                <div className="h-72 overflow-hidden rounded border border-zinc-800">
                  <Editor value={stringify(activeDef)} language="json" theme="vs-dark" options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }} />
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title="没有函数" detail="当前 domain 没有返回可用函数。" />
          )}
        </div>

        <aside className="min-h-0 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-3 text-sm font-semibold text-zinc-100">调用调试</div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Args JSON</div>
          <div className="h-56 overflow-hidden rounded border border-zinc-800">
            <Editor value={argsText} onChange={(value) => setArgsText(value ?? "{}")} language="json" theme="vs-dark" options={{ minimap: { enabled: false }, fontSize: 12 }} />
          </div>
          <button
            type="button"
            onClick={runFunction}
            disabled={!activeName || running}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded bg-purple-500 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            <Play className="h-4 w-4" />
            调用函数
          </button>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Result</div>
          <pre className="mt-2 max-h-80 overflow-auto rounded border border-zinc-800 bg-zinc-900 p-3 text-xs leading-5 text-zinc-300">{result == null ? "尚未调用" : stringify(result)}</pre>
        </aside>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/70 p-3">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm text-zinc-100">{value}</div>
    </div>
  );
}
