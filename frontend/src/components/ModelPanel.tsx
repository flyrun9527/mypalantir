import Editor from "@monaco-editor/react";
import { Network, Search, TableProperties } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { cx, firstLine, stringify } from "../lib/format";
import { getObjectRelations } from "../lib/ontologyGraph";
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
  const [query, setQuery] = useState("");

  const objectDef = selectedObject ? ontology?.objects?.[selectedObject] : null;
  const objectRelations = getObjectRelations(ontology, selectedObject);
  const objectEntries = useMemo(() => Object.entries(ontology?.objects ?? {}), [ontology]);
  const relationCount = Object.keys(ontology?.links ?? {}).length;

  const filteredObjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return objectEntries;
    return objectEntries.filter(([name, obj]) =>
      name.toLowerCase().includes(q)
      || (obj.summary ?? "").toLowerCase().includes(q)
      || (obj.description ?? "").toLowerCase().includes(q)
    );
  }, [objectEntries, query]);

  async function loadRows() {
    if (!selectedObject) return;
    setLoading("query", true);
    try {
      const output = await api.callMcpTool(currentDomain, "query", {
        object_type: selectedObject,
        limit: 50
      });
      setQueryRows(Array.isArray(output.result) ? output.result : []);
    } finally {
      setLoading("query", false);
    }
  }

  if (!ontology) return <EmptyState title="未加载本体" detail="选择 domain 后会展示对象、关系、规则与函数。" />;

  return (
    <section className="model-layout-v2">
      <aside className="console-panel model-sidebar">
        <div className="panel-header">
          <div className="min-w-0">
            <div className="panel-title">对象</div>
            <div className="panel-subtitle">{objectEntries.length} 个对象</div>
          </div>
          <Badge tone="green">{objectEntries.length}</Badge>
        </div>
        <div className="p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
            <input
              className="control-input"
              style={{ paddingLeft: 28 }}
              placeholder="搜索对象..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="model-object-list">
          {filteredObjects.map(([name, obj]) => (
            <button
              type="button"
              key={name}
              onClick={() => setSelectedObject(name)}
              className={cx("model-object-item", selectedObject === name && "model-object-item-active")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>{name}</span>
                <span className="shrink-0 text-[10px]" style={{ color: "var(--text-faint)" }}>{obj.kind ?? "entity"}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-faint)" }}>
                {firstLine(obj.summary || obj.description)}
              </div>
            </button>
          ))}
          {!filteredObjects.length ? (
            <div className="p-3 text-xs" style={{ color: "var(--text-faint)" }}>无匹配对象</div>
          ) : null}
        </div>
      </aside>

      <div className="console-panel model-graph-panel">
        <div className="panel-header">
          <div className="flex items-center gap-2 panel-title">
            <Network className="h-4 w-4" style={{ color: "var(--accent-strong)" }} />
            本体关系图
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="green">{objectEntries.length} objects</Badge>
            <Badge tone="blue">{relationCount} links</Badge>
          </div>
        </div>
        <div className="model-graph-body">
          <OntologyGraph ontology={ontology} selectedObject={selectedObject} onSelectObject={setSelectedObject} />
        </div>
      </div>

      <aside className="console-panel model-detail-panel">
        <div className="panel-header">
          <div className="flex items-center gap-2 panel-title">
            <TableProperties className="h-4 w-4" style={{ color: "var(--info)" }} />
            对象详情
          </div>
        </div>
        {objectDef && selectedObject ? (
          <div className="model-detail-scroll">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{selectedObject}</h2>
                <Badge tone="blue">{objectDef.kind ?? "entity"}</Badge>
              </div>
              <p className="text-sm leading-6" style={{ color: "var(--text-muted)" }}>{objectDef.summary || objectDef.description || "没有描述"}</p>
            </div>

            <button type="button" onClick={loadRows} className="primary-button w-full">
              查询样例数据
            </button>

            <div>
              <div className="section-label mb-2">Relations</div>
              {objectRelations.incoming.length || objectRelations.outgoing.length ? (
                <div className="space-y-2">
                  {objectRelations.outgoing.map((relation) => (
                    <button
                      type="button"
                      key={relation.id}
                      className="resource-card w-full"
                      onClick={() => setSelectedObject(relation.target)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                          {selectedObject} → {relation.target}
                        </span>
                        <Badge tone="green">out</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                        {relation.type || relation.label}
                        {relation.cardinality ? ` · ${relation.cardinality}` : ""}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>{relation.label}</p>
                    </button>
                  ))}
                  {objectRelations.incoming.map((relation) => (
                    <button
                      type="button"
                      key={relation.id}
                      className="resource-card w-full"
                      onClick={() => setSelectedObject(relation.source)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                          {relation.source} → {selectedObject}
                        </span>
                        <Badge tone="blue">in</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                        {relation.type || relation.label}
                        {relation.cardinality ? ` · ${relation.cardinality}` : ""}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>{relation.label}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                  暂无显式关系。
                </div>
              )}
            </div>

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
              <div className="h-64 overflow-hidden rounded-md border" style={{ borderColor: "var(--line)" }}>
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
            <EmptyState title="选择对象" detail="在左侧列表或关系图中点击一个对象查看详情。" />
          </div>
        )}
      </aside>
    </section>
  );
}
