import { ErrorBoundary } from "react-error-boundary";
import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { api } from "./lib/api";
import { getDomainFromPath } from "./lib/domain";
import { useConsoleStore } from "./store/useConsoleStore";
import { ChatPanel } from "./components/ChatPanel";
import { DataPanel } from "./components/DataPanel";
import { EmptyState } from "./components/EmptyState";
import { FunctionsPanel } from "./components/FunctionsPanel";
import { Header } from "./components/Header";
import { McpPanel } from "./components/McpPanel";
import { ModelPanel } from "./components/ModelPanel";
import { WorkflowPanel } from "./components/WorkflowPanel";

const views = new Set(["chat", "model", "functions", "data", "workflows", "mcp"]);

function getViewFromUrl() {
  const view = new URLSearchParams(window.location.search).get("view");
  return view && views.has(view) ? view : "chat";
}

export default function App() {
  const [activeView, setActiveView] = useState(getViewFromUrl);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("oag-theme");
    return saved === "light" ? "light" : "dark";
  });
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const setDomains = useConsoleStore((state) => state.setDomains);
  const setCurrentDomain = useConsoleStore((state) => state.setCurrentDomain);
  const setOntology = useConsoleStore((state) => state.setOntology);
  const setPrompts = useConsoleStore((state) => state.setPrompts);
  const setMcpStatus = useConsoleStore((state) => state.setMcpStatus);
  const setMcpTools = useConsoleStore((state) => state.setMcpTools);
  const setSelectedMcpTool = useConsoleStore((state) => state.setSelectedMcpTool);
  const setMcpCallResult = useConsoleStore((state) => state.setMcpCallResult);
  const setMcpError = useConsoleStore((state) => state.setMcpError);
  const setAgentTools = useConsoleStore((state) => state.setAgentTools);
  const setSelectedObject = useConsoleStore((state) => state.setSelectedObject);
  const setSelectedFunction = useConsoleStore((state) => state.setSelectedFunction);
  const setQueryRows = useConsoleStore((state) => state.setQueryRows);
  const setLoading = useConsoleStore((state) => state.setLoading);

  const loadAgentTools = useCallback(async (domain: string | null) => {
    try {
      const payload = await api.getAgentTools(domain);
      setAgentTools(payload.agent_tools, payload.mcp_tool_count);
    } catch {
      setAgentTools([], 0);
    }
  }, [setAgentTools]);

  const loadMcp = useCallback(async (domain: string | null) => {
    setLoading("mcp", true);
    setMcpStatus({
      status: "loading",
      domain,
      tool_count: 0,
      read_only_count: 0,
      write_count: 0,
      requires_confirmation_count: 0
    });
    setMcpTools([]);
    setSelectedMcpTool(null);
    setMcpCallResult(null);
    setMcpError(null);
    try {
      const status = await api.getMcpStatus(domain);
      setMcpStatus(status);
      if (status.status !== "online") {
        setMcpTools([]);
        setSelectedMcpTool(null);
        setMcpError(status.error ?? "远程 MCP 未连接");
        return;
      }
      const toolPayload = await api.getMcpTools(domain);
      setMcpTools(toolPayload.tools);
      setSelectedMcpTool(toolPayload.tools[0]?.name ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载 MCP 状态失败";
      setMcpStatus({
        status: "error",
        domain,
        tool_count: 0,
        read_only_count: 0,
        write_count: 0,
        requires_confirmation_count: 0,
        error: message
      });
      setMcpError(message);
    } finally {
      setLoading("mcp", false);
    }
  }, [setLoading, setMcpCallResult, setMcpError, setMcpStatus, setMcpTools, setSelectedMcpTool]);

  const loadDomain = useCallback(async (domain: string | null) => {
    setCurrentDomain(domain);
    setLoading("schema", true);
    setOntology(null);
    setPrompts([]);
    setMcpStatus(null);
    setMcpTools([]);
    setSelectedMcpTool(null);
    setMcpCallResult(null);
    setMcpError(null);
    setSelectedObject(null);
    setSelectedFunction(null);
    setQueryRows([]);
    try {
      const [schema, prompts] = await Promise.all([
        api.getSchema(domain),
        api.getPrompts(domain).catch(() => [])
      ]);
      setOntology(schema);
      setPrompts(prompts);
      setSelectedObject(Object.keys(schema.objects ?? {})[0] ?? null);
      setSelectedFunction(Object.keys(schema.functions ?? {})[0] ?? null);
      void loadMcp(domain);
      void loadAgentTools(domain);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载 domain 失败");
    } finally {
      setLoading("schema", false);
      setLoading("boot", false);
    }
  }, [loadAgentTools, loadMcp, setCurrentDomain, setLoading, setMcpCallResult, setMcpError, setMcpStatus, setMcpTools, setOntology, setPrompts, setQueryRows, setSelectedFunction, setSelectedMcpTool, setSelectedObject]);

  const boot = useCallback(async () => {
    setLoading("boot", true);
    try {
      const domains = await api.listDomains().catch(() => []);
      setDomains(domains);
      const pathDomain = getDomainFromPath();
      const initial = pathDomain ?? domains[0]?.name ?? null;
      await loadDomain(initial);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "启动失败");
      setLoading("boot", false);
    }
  }, [loadDomain, setDomains, setLoading]);

  useEffect(() => {
    boot();
    const handler = (event: Event) => {
      const domain = (event as CustomEvent<string>).detail;
      loadDomain(domain);
    };
    const viewHandler = (event: Event) => {
      const view = (event as CustomEvent<string>).detail;
      if (views.has(view)) setActiveView(view);
    };
    const popstate = () => {
      setActiveView(getViewFromUrl());
      loadDomain(getDomainFromPath());
    };
    window.addEventListener("oag-domain-change", handler);
    window.addEventListener("oag-view-change", viewHandler);
    window.addEventListener("popstate", popstate);
    return () => {
      window.removeEventListener("oag-domain-change", handler);
      window.removeEventListener("oag-view-change", viewHandler);
      window.removeEventListener("popstate", popstate);
    };
  }, [boot, loadDomain]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("oag-theme", theme);
  }, [theme]);

  function changeView(view: string) {
    setActiveView(view);
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  return (
    <ErrorBoundary fallback={<div className="p-6 text-red-300">前端渲染出错，请查看控制台。</div>}>
      <div className="app-frame">
        <main className="app-main">
          <Header
            onRefresh={() => loadDomain(currentDomain)}
            activeView={activeView}
            onViewChange={changeView}
            theme={theme}
            onToggleTheme={() => setTheme((value) => value === "dark" ? "light" : "dark")}
          />
          <div className="content-stage">
            {!ontology ? (
              <EmptyState title="请选择 domain" detail="在顶部选择业务域后，可以进入对话、MCP服务、本体、数据、函数和流程视图。" />
            ) : activeView === "chat" ? (
              <ChatPanel />
            ) : activeView === "model" ? (
              <ModelPanel />
            ) : activeView === "functions" ? (
              <FunctionsPanel />
            ) : activeView === "data" ? (
              <DataPanel />
            ) : activeView === "mcp" ? (
              <McpPanel onRefresh={() => loadMcp(currentDomain)} />
            ) : (
              <WorkflowPanel />
            )}
          </div>
        </main>
        <Toaster richColors closeButton position="top-right" />
      </div>
    </ErrorBoundary>
  );
}
