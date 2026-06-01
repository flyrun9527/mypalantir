import mermaid from "mermaid";
import { GitBranch, ListChecks, ScrollText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useConsoleStore } from "../store/useConsoleStore";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });

export function WorkflowPanel() {
  const ontology = useConsoleStore((state) => state.ontology);
  const [diagram, setDiagram] = useState("");

  const source = useMemo(() => buildMermaid(ontology), [ontology]);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!source) {
        setDiagram("");
        return;
      }
      const { svg } = await mermaid.render(`workflow-${Date.now()}`, source);
      if (!cancelled) setDiagram(svg);
    }
    render().catch(() => setDiagram(""));
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (!ontology) return <EmptyState title="未加载流程" detail="选择 domain 后会展示规则和 workflow。" />;

  const rules = Object.entries(ontology.rules ?? {});
  const workflows = Object.entries(ontology.workflows ?? {});

  return (
    <section className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="console-panel min-h-0 overflow-auto p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 panel-title">
              <GitBranch className="h-4 w-4" style={{ color: "var(--accent-strong)" }} />
              Workflow Mermaid
            </div>
            <p className="panel-subtitle">流程定义、步骤依赖和函数编排。</p>
          </div>
          <Badge tone="green">{workflows.length} workflows</Badge>
        </div>
        {diagram ? (
          <div className="rounded-md border p-4" style={{ borderColor: "var(--line)", background: "var(--bg-elevated)" }} dangerouslySetInnerHTML={{ __html: diagram }} />
        ) : (
          <EmptyState title="没有 workflow 图" detail="当前本体没有 workflow，或流程定义无法渲染。" />
        )}

        <div className="mt-4 grid gap-3">
          {workflows.map(([name, workflow]) => (
            <div key={name} className="resource-card">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold" style={{ color: "var(--text)" }}>{name}</h3>
                <Badge tone="green">{workflow.steps?.length ?? 0} steps</Badge>
              </div>
              <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-muted)" }}>{workflow.description || workflow.trigger || "没有描述"}</p>
              <ol className="mt-3 space-y-2">
                {(workflow.steps ?? []).map((step, index) => (
                  <li key={`${name}-${step.name}-${index}`} className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                    <div className="flex items-center justify-between">
                      <span style={{ color: "var(--text)" }}>{index + 1}. {step.name}</span>
                      {step.function ? <Badge tone="purple">{step.function}</Badge> : null}
                    </div>
                    {step.description ? <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>{step.description}</p> : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>

      <aside className="console-panel min-h-0 overflow-auto">
        <div className="panel-header">
          <div className="flex items-center gap-2 panel-title">
            <ListChecks className="h-4 w-4" style={{ color: "var(--warning)" }} />
            规则
          </div>
          <Badge tone="amber">{rules.length}</Badge>
        </div>
        <div className="space-y-3 p-4">
          {rules.length ? rules.map(([name, rule]) => (
            <div key={name} className="resource-card">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{name}</h3>
                <Badge tone="amber">{rule.rule_type || "rule"}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5" style={{ color: "var(--text-faint)" }}>{rule.description}</p>
              {rule.applies_to?.length ? <div className="mt-2 flex flex-wrap gap-1">{rule.applies_to.map((item) => <Badge key={item}>{item}</Badge>)}</div> : null}
            </div>
          )) : <EmptyState title="没有规则" detail="当前本体没有 rules 定义。" />}
        </div>
        <div className="border-t p-4" style={{ borderColor: "var(--line)" }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
            <ScrollText className="h-4 w-4" style={{ color: "var(--info)" }} />
            Mermaid Source
          </div>
          <pre className="json-block max-h-64">{source || "graph TD"}</pre>
        </div>
      </aside>
    </section>
  );
}

function buildMermaid(ontology: ReturnType<typeof useConsoleStore.getState>["ontology"]): string {
  const workflows = Object.entries(ontology?.workflows ?? {});
  if (!workflows.length) return "";
  const lines = ["graph TD"];
  for (const [workflowName, workflow] of workflows) {
    const safeWorkflow = workflowName.replace(/[^\w]/g, "_");
    lines.push(`subgraph ${safeWorkflow}["${workflowName}"]`);
    (workflow.steps ?? []).forEach((step, index, steps) => {
      const node = `${safeWorkflow}_${index}`;
      lines.push(`${node}["${step.name}${step.function ? `\\n${step.function}` : ""}"]`);
      if (index < steps.length - 1) lines.push(`${node} --> ${safeWorkflow}_${index + 1}`);
    });
    lines.push("end");
  }
  return lines.join("\n");
}
