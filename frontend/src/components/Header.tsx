import { Activity, RefreshCw, ShieldCheck } from "lucide-react";
import { useConsoleStore } from "../store/useConsoleStore";
import { Badge } from "./Badge";

type HeaderProps = {
  onRefresh: () => void;
};

export function Header({ onRefresh }: HeaderProps) {
  const ontology = useConsoleStore((state) => state.ontology);
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const loading = useConsoleStore((state) => state.loading);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-base font-semibold text-zinc-100">{ontology?.name ?? currentDomain ?? "OAG"}</h1>
          {currentDomain ? <Badge tone="green">{currentDomain}</Badge> : null}
        </div>
        <p className="mt-1 truncate text-xs text-zinc-500">{ontology?.description ?? "选择一个 domain 开始查看本体与对话能力"}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400 md:flex">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          Harness 审计 / 权限 / 工具调用
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition hover:border-emerald-500 hover:text-emerald-300"
        >
          {loading.schema ? <Activity className="h-4 w-4 animate-pulse" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </button>
      </div>
    </header>
  );
}
