import { Activity, BrainCircuit, FunctionSquare, GitBranch, Moon, Network, RefreshCw, Search, ServerCog, Sun } from "lucide-react";
import { buildDomainPath } from "../lib/domain";
import { cx } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";

type HeaderProps = {
  activeView: string;
  onViewChange: (view: string) => void;
  onRefresh: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
};

const views = [
  { id: "chat", label: "对话", icon: BrainCircuit },
  { id: "mcp", label: "MCP", icon: ServerCog },
  { id: "model", label: "本体", icon: Network },
  { id: "data", label: "数据", icon: Search },
  { id: "functions", label: "函数", icon: FunctionSquare },
  { id: "workflows", label: "流程", icon: GitBranch }
];

export function Header({ activeView, onViewChange, onRefresh, theme, onToggleTheme }: HeaderProps) {
  const domains = useConsoleStore((state) => state.domains);
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const loading = useConsoleStore((state) => state.loading);

  return (
    <header className="topbar">
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
