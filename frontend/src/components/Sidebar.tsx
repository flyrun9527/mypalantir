import { Boxes, BrainCircuit, Cable, FunctionSquare, GitBranch, Network, Search } from "lucide-react";
import { buildDomainPath } from "../lib/domain";
import { firstLine, cx } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import { Badge } from "./Badge";

type SidebarProps = {
  activeView: string;
  onViewChange: (view: string) => void;
};

const views = [
  { id: "chat", label: "对话", icon: BrainCircuit },
  { id: "model", label: "本体模型", icon: Network },
  { id: "functions", label: "函数", icon: FunctionSquare },
  { id: "data", label: "数据", icon: Search },
  { id: "workflows", label: "流程", icon: GitBranch }
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const domains = useConsoleStore((state) => state.domains);
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const setSelectedObject = useConsoleStore((state) => state.setSelectedObject);

  const objects = Object.entries(ontology?.objects ?? {});
  const functions = Object.keys(ontology?.functions ?? {});
  const links = Object.keys(ontology?.links ?? {});

  return (
    <aside className="flex min-h-0 w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-4">
        <div className="flex items-center gap-2 text-emerald-300">
          <Boxes className="h-5 w-5" />
          <span className="font-semibold tracking-wide">OAG Console</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-500">Ontology Augmented Generation 工作台</p>
      </div>

      <div className="border-b border-zinc-800 p-3">
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Domain</label>
        <select
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-500"
          value={currentDomain ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            if (next) window.history.pushState({}, "", buildDomainPath(next));
            window.dispatchEvent(new CustomEvent("oag-domain-change", { detail: next }));
          }}
        >
          <option value="">选择领域</option>
          {domains.map((domain) => (
            <option value={domain.name} key={domain.name}>
              {domain.name}
            </option>
          ))}
        </select>
        {ontology ? <p className="mt-2 line-clamp-2 text-xs text-zinc-500">{ontology.description}</p> : null}
      </div>

      <nav className="border-b border-zinc-800 p-2">
        {views.map((view) => {
          const Icon = view.icon;
          return (
            <button
              type="button"
              key={view.id}
              onClick={() => onViewChange(view.id)}
              className={cx(
                "flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm transition",
                activeView === view.id ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              )}
            >
              <Icon className="h-4 w-4" />
              {view.label}
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Metric label="对象" value={objects.length} />
          <Metric label="关系" value={links.length} />
          <Metric label="函数" value={functions.length} />
        </div>

        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Objects</div>
          <Badge tone="blue">{objects.length}</Badge>
        </div>
        <div className="space-y-1">
          {objects.map(([name, object]) => (
            <button
              type="button"
              key={name}
              onClick={() => {
                setSelectedObject(name);
                onViewChange("model");
              }}
              className="w-full rounded border border-transparent px-2 py-2 text-left transition hover:border-zinc-800 hover:bg-zinc-900"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-zinc-200">{name}</span>
                <Badge>{object.kind ?? "entity"}</Badge>
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{firstLine(object.summary || object.description)}</div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
      <div className="text-lg font-semibold text-zinc-100">{value}</div>
      <div className="text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}
