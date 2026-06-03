import mermaid from "mermaid";
import { GitBranch, ListChecks } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cx } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import type { WorkflowDef } from "../types/oag";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });

export function WorkflowPanel() {
  const ontology = useConsoleStore((state) => state.ontology);
  const [selected, setSelected] = useState<string | null>(null);
  const [diagram, setDiagram] = useState("");

  const workflows = useMemo(() => Object.entries(ontology?.workflows ?? {}), [ontology]);
  const rules = useMemo(() => Object.entries(ontology?.rules ?? {}), [ontology]);
  const activeEntry = useMemo(
    () => workflows.find(([n]) => n === selected) ?? workflows[0] ?? null,
    [workflows, selected],
  );
  const activeName = activeEntry?.[0] ?? null;
  const activeWorkflow = activeEntry?.[1] ?? null;

  const source = useMemo(() => {
    if (!activeName || !activeWorkflow) return "";
    return buildSingleMermaid(activeName, activeWorkflow);
  }, [activeName, activeWorkflow]);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!source) { setDiagram(""); return; }
      const { svg } = await mermaid.render(`wf-${Date.now()}`, source);
      if (!cancelled) setDiagram(svg);
    }
    render().catch(() => setDiagram(""));
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    if (workflows.length && !selected) setSelected(workflows[0][0]);
  }, [workflows, selected]);

  if (!ontology) return <EmptyState title="未加载流程" detail="选择 domain 后会展示流程和规则。" />;

  return (
    <section className="workflow-layout">
      <aside className="console-panel workflow-sidebar">
        <div className="panel-header">
          <div className="panel-title">流程</div>
          <Badge tone="green">{workflows.length}</Badge>
        </div>
        <div className="workflow-list">
          {workflows.map(([name, wf]) => (
            <button
              type="button"
              key={name}
              onClick={() => setSelected(name)}
              className={cx("model-object-item", activeName === name && "model-object-item-active")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>{name}</span>
                <span className="shrink-0 text-[10px]" style={{ color: "var(--text-faint)" }}>{wf.steps?.length ?? 0} 步</span>
              </div>
              <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-faint)" }}>
                {wf.description || wf.trigger || ""}
              </div>
            </button>
          ))}
          {!workflows.length ? (
            <div className="p-3 text-xs" style={{ color: "var(--text-faint)" }}>没有流程定义</div>
          ) : null}
        </div>

        {rules.length ? (
          <>
            <div className="panel-header" style={{ borderTop: "1px solid var(--line)" }}>
              <div className="flex items-center gap-2 panel-title">
                <ListChecks className="h-4 w-4" style={{ color: "var(--warning)" }} />
                规则
              </div>
              <Badge tone="amber">{rules.length}</Badge>
            </div>
            <div className="workflow-list">
              {rules.map(([name, rule]) => (
                <div key={name} className="model-object-item" style={{ cursor: "default" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>{name}</span>
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--warning)" }}>{rule.rule_type || "rule"}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-faint)" }}>
                    {rule.description || ""}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </aside>

      <div className="console-panel workflow-graph-panel">
        <div className="panel-header">
          <div className="flex items-center gap-2 panel-title">
            <GitBranch className="h-4 w-4" style={{ color: "var(--accent-strong)" }} />
            {activeName || "流程图"}
          </div>
          {activeWorkflow?.steps?.length ? (
            <Badge tone="green">{activeWorkflow.steps.length} steps</Badge>
          ) : null}
        </div>
        <div className="workflow-graph-body">
          {diagram ? (
            <div
              className="workflow-mermaid-container"
              dangerouslySetInnerHTML={{ __html: diagram }}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState title="没有流程图" detail="选择左侧流程查看图表。" />
            </div>
          )}
        </div>
      </div>

      <aside className="console-panel workflow-detail-panel">
        <div className="panel-header">
          <div className="panel-title">步骤详情</div>
        </div>
        {activeWorkflow && activeName ? (
          <div className="workflow-detail-scroll">
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>{activeName}</h2>
              <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-muted)" }}>
                {activeWorkflow.description || activeWorkflow.trigger || "没有描述"}
              </p>
              {activeWorkflow.involves_objects?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {activeWorkflow.involves_objects.map((obj) => (
                    <Badge key={obj}>{obj}</Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <ol className="space-y-2">
              {(activeWorkflow.steps ?? []).map((step, index) => (
                <li key={`${activeName}-${step.name}-${index}`} className="workflow-step-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                      <span className="workflow-step-num">{index + 1}</span>
                      {step.name}
                    </span>
                    {step.function ? <Badge tone="purple">{step.function}</Badge> : null}
                  </div>
                  {step.description ? (
                    <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-faint)" }}>{step.description}</p>
                  ) : null}
                  {step.sla ? (
                    <div className="mt-1 text-[11px]" style={{ color: "var(--warning)" }}>SLA: {step.sla}</div>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState title="选择流程" detail="在左侧选择一个流程查看步骤详情。" />
          </div>
        )}
      </aside>
    </section>
  );
}

function buildSingleMermaid(name: string, workflow: WorkflowDef): string {
  const steps = workflow.steps ?? [];
  if (!steps.length) return "";
  const safe = name.replace(/[^\w]/g, "_");
  const lines = ["graph TD"];
  steps.forEach((step, index) => {
    const node = `${safe}_${index}`;
    const label = step.function ? `${step.name}\\n${step.function}` : step.name;
    lines.push(`${node}["${label}"]`);
    if (index < steps.length - 1) {
      lines.push(`${node} --> ${safe}_${index + 1}`);
    }
  });
  return lines.join("\n");
}
