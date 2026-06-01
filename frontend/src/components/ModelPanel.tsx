import Editor from "@monaco-editor/react";
import { Network, TableProperties } from "lucide-react";
import { api } from "../lib/api";
import { firstLine, stringify } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";
import { OntologyGraph } from "./OntologyGraph";

export function ModelPanel() {
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const selectedObject = useConsoleStore((state) => state.selectedObject);
  const setSelectedObject = useConsoleStore((state) => state.setSelectedObject);
  const setQueryRows = useConsoleStore((state) => state.setQueryRows);
  const setLoading = useConsoleStore((state) => state.setLoading);

  const objectDef = selectedObject ? ontology?.objects?.[selectedObject] : null;

  async function loadRows() {
    if (!selectedObject) return;
    setLoading("query", true);
    try {
      setQueryRows(await api.queryObject(currentDomain, selectedObject, 50));
    } finally {
      setLoading("query", false);
    }
  }

  if (!ontology) return <EmptyState title="未加载本体" detail="选择 domain 后会展示对象、关系、规则与函数。" />;

  return (
    <section className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="console-panel min-h-0 overflow-auto p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 panel-title">
              <Network className="h-4 w-4" style={{ color: "var(--accent-strong)" }} />
              本体关系图
            </div>
            <p className="panel-subtitle">点击节点查看对象定义，边表示 ontology links。</p>
          </div>
          <Badge tone="green">{Object.keys(ontology.objects ?? {}).length} objects</Badge>
        </div>
        <OntologyGraph ontology={ontology} onSelectObject={setSelectedObject} />

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(ontology.objects ?? {}).map(([name, object]) => (
            <button
              type="button"
              key={name}
              onClick={() => setSelectedObject(name)}
              className={`resource-card ${selectedObject === name ? "resource-card-active" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{name}</span>
                <Badge>{object.kind ?? "entity"}</Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5" style={{ color: "var(--text-faint)" }}>{firstLine(object.summary || object.description)}</p>
              <div className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>{Object.keys(object.properties ?? {}).length} properties</div>
            </button>
          ))}
        </div>
      </div>

      <aside className="console-panel min-h-0 overflow-auto">
        <div className="panel-header">
          <div className="flex items-center gap-2 panel-title">
            <TableProperties className="h-4 w-4" style={{ color: "var(--info)" }} />
            对象详情
          </div>
        </div>
        {objectDef && selectedObject ? (
          <div className="space-y-4 p-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{selectedObject}</h2>
                <Badge tone="blue">{objectDef.kind ?? "entity"}</Badge>
              </div>
              <p className="text-sm leading-6" style={{ color: "var(--text-muted)" }}>{objectDef.summary || objectDef.description || "没有描述"}</p>
            </div>

            <button
              type="button"
              onClick={loadRows}
              className="primary-button w-full"
            >
              查询样例数据
            </button>

            <div>
              <div className="section-label mb-2">Properties</div>
              <div className="space-y-2">
                {Object.entries(objectDef.properties ?? {}).map(([name, property]) => (
                  <div key={name} className="resource-card">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{name}</span>
                      <div className="flex gap-1">
                        {property.required ? <Badge tone="amber">required</Badge> : null}
                        <Badge>{property.type ?? "str"}</Badge>
                      </div>
                    </div>
                    {property.description ? <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-faint)" }}>{property.description}</p> : null}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="section-label mb-2">Raw Definition</div>
              <div className="h-72 overflow-hidden rounded-md border" style={{ borderColor: "var(--line)" }}>
                <Editor
                  value={stringify(objectDef)}
                  language="json"
                  theme="vs-dark"
                  options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, lineNumbers: "off" }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState title="选择对象" detail="在关系图或对象卡片中点击一个对象查看字段、约束和样例数据。" />
          </div>
        )}
      </aside>
    </section>
  );
}
