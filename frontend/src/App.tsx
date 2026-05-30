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
import { ModelPanel } from "./components/ModelPanel";
import { Sidebar } from "./components/Sidebar";
import { WorkflowPanel } from "./components/WorkflowPanel";

const views = new Set(["chat", "model", "functions", "data", "workflows"]);

function getViewFromUrl() {
  const view = new URLSearchParams(window.location.search).get("view");
  return view && views.has(view) ? view : "chat";
}

export default function App() {
  const [activeView, setActiveView] = useState(getViewFromUrl);
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const setDomains = useConsoleStore((state) => state.setDomains);
  const setCurrentDomain = useConsoleStore((state) => state.setCurrentDomain);
  const setOntology = useConsoleStore((state) => state.setOntology);
  const setRegistryFunctions = useConsoleStore((state) => state.setRegistryFunctions);
  const setPrompts = useConsoleStore((state) => state.setPrompts);
  const setSelectedObject = useConsoleStore((state) => state.setSelectedObject);
  const setSelectedFunction = useConsoleStore((state) => state.setSelectedFunction);
  const setQueryRows = useConsoleStore((state) => state.setQueryRows);
  const setLoading = useConsoleStore((state) => state.setLoading);

  const loadDomain = useCallback(async (domain: string | null) => {
    setCurrentDomain(domain);
    setLoading("schema", true);
    setOntology(null);
    setRegistryFunctions({});
    setPrompts([]);
    setSelectedObject(null);
    setSelectedFunction(null);
    setQueryRows([]);
    try {
      const [schema, registryFunctions, prompts] = await Promise.all([
        api.getSchema(domain),
        api.getRegistryFunctions(domain),
        api.getPrompts(domain).catch(() => [])
      ]);
      setOntology(schema);
      setRegistryFunctions(registryFunctions);
      setPrompts(prompts);
      setSelectedObject(Object.keys(schema.objects ?? {})[0] ?? null);
      setSelectedFunction(Object.keys(schema.functions ?? {})[0] ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载 domain 失败");
    } finally {
      setLoading("schema", false);
      setLoading("boot", false);
    }
  }, [setCurrentDomain, setLoading, setOntology, setPrompts, setQueryRows, setRegistryFunctions, setSelectedFunction, setSelectedObject]);

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
    const popstate = () => {
      setActiveView(getViewFromUrl());
      loadDomain(getDomainFromPath());
    };
    window.addEventListener("oag-domain-change", handler);
    window.addEventListener("popstate", popstate);
    return () => {
      window.removeEventListener("oag-domain-change", handler);
      window.removeEventListener("popstate", popstate);
    };
  }, [boot, loadDomain]);

  function changeView(view: string) {
    setActiveView(view);
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  return (
    <ErrorBoundary fallback={<div className="p-6 text-red-300">前端渲染出错，请查看控制台。</div>}>
      <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
        <Sidebar activeView={activeView} onViewChange={changeView} />
        <main className="flex min-w-0 flex-1 flex-col">
          <Header onRefresh={() => loadDomain(currentDomain)} />
          <div className="min-h-0 flex-1 overflow-hidden p-4">
            {!ontology ? (
              <EmptyState title="请选择 domain" detail="左侧选择一个业务域后，可以查看本体模型、函数、规则、数据和 Agent 对话。" />
            ) : activeView === "chat" ? (
              <ChatPanel />
            ) : activeView === "model" ? (
              <ModelPanel />
            ) : activeView === "functions" ? (
              <FunctionsPanel />
            ) : activeView === "data" ? (
              <DataPanel />
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
