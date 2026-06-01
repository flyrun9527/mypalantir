import { Activity, BrainCircuit, FunctionSquare, GitBranch, Moon, Network, RefreshCw, Search, Sun } from "lucide-react";
import { buildDomainPath } from "../lib/domain";
import { cx } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import { Badge } from "./Badge";

type HeaderProps = {
  activeView: string;
  onViewChange: (view: string) => void;
  onRefresh: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
};

const views = [
  { id: "chat", label: "对话", icon: BrainCircuit },
  { id: "model", label: "本体", icon: Network },
  { id: "functions", label: "函数", icon: FunctionSquare },
  { id: "data", label: "数据", icon: Search },
  { id: "workflows", label: "流程", icon: GitBranch }
];

export function Header({ activeView, onViewChange, onRefresh, theme, onToggleTheme }: HeaderProps) {
  const domains = useConsoleStore((state) => state.domains);
  const ontology = useConsoleStore((state) => state.ontology);
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const loading = useConsoleStore((state) => state.loading);
  const objectCount = Object.keys(ontology?.objects ?? {}).length;
  const functionCount = Object.keys(ontology?.functions ?? {}).length;
  const workflowCount = Object.keys(ontology?.workflows ?? {}).length;

  return (
    <header className="topbar">
      <div className="topbar-main">
        <nav className="topnav" aria-label="主导航">
          {views.map((view) => {
            const Icon = view.icon;
            return (
              <button
                type="button"
                key={view.id}
                onClick={() => onViewChange(view.id)}
                className={cx("topnav-item", activeView === view.id && "topnav-item-active")}
              >
                <Icon className="h-4 w-4" />
                {view.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="topbar-side">
        <select
          className="domain-select"
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
        <div className="topbar-metrics">
          <Badge>{objectCount} 对象</Badge>
          <Badge tone="purple">{functionCount} 函数</Badge>
          <Badge tone="blue">{workflowCount} 流程</Badge>
        </div>
        <button type="button" onClick={onToggleTheme} className="icon-button" title="切换主题">
          {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
        <button type="button" onClick={onRefresh} className="icon-button" title="刷新">
          {loading.schema ? <Activity className="h-4 w-4 animate-pulse" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
