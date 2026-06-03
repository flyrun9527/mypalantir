import { ArrowDownUp, Database, Filter, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { firstLine, stringify } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import type { QueryRow } from "../types/oag";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

type SortState = {
  column: string;
  desc: boolean;
};

function parseFilterValue(value: string) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function parseFilters(input: string) {
  const filters: Record<string, unknown> = {};
  for (const part of input.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1);
    if (key) filters[key] = parseFilterValue(value);
  }
  return Object.keys(filters).length ? filters : undefined;
}

function isNumeric(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  return !Number.isNaN(Number(value));
}

function compareValues(a: unknown, b: unknown) {
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
  return String(a ?? "").localeCompare(String(b ?? ""), "zh-CN");
}

export function DataPanel() {
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const selectedObject = useConsoleStore((state) => state.selectedObject);
  const setSelectedObject = useConsoleStore((state) => state.setSelectedObject);
  const rows = useConsoleStore((state) => state.queryRows);
  const setRows = useConsoleStore((state) => state.setQueryRows);
  const setLoading = useConsoleStore((state) => state.setLoading);
  const loading = useConsoleStore((state) => state.loading.query);
  const [filterText, setFilterText] = useState("");
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [sort, setSort] = useState<SortState | null>(null);

  const queryViaMcp = useCallback(async (objectName: string, filters?: Record<string, unknown>, limit?: number) => {
    const output = await api.callMcpTool(currentDomain, "query", {
      object_type: objectName,
      ...(filters ? { filters } : {}),
      ...(limit == null ? {} : { limit })
    });
    return Array.isArray(output.result) ? output.result as QueryRow[] : [];
  }, [currentDomain]);

  const query = useCallback(async (objectName = selectedObject, explicitFilters = parseFilters(filterText)) => {
    if (!objectName) return;
    setLoading("query", true);
    try {
      setSelectedObject(objectName);
      const nextRows = await queryViaMcp(objectName, explicitFilters, undefined);
      setRows(nextRows);
      setSort(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "查询失败");
    } finally {
      setLoading("query", false);
    }
  }, [filterText, queryViaMcp, selectedObject, setLoading, setRows, setSelectedObject]);

  const updateCounts = useCallback(async () => {
    if (!ontology?.objects) return;
    const nextCounts: Record<string, number | null> = {};
    await Promise.all(Object.keys(ontology.objects).map(async (name) => {
      try {
        const output = await api.callMcpTool(currentDomain, "count", { object_type: name });
        const result = output.result;
        nextCounts[name] = result && typeof result === "object" && "count" in result
          ? Number((result as { count: unknown }).count)
          : null;
      } catch {
        nextCounts[name] = null;
      }
    }));
    setCounts(nextCounts);
  }, [currentDomain, ontology]);

  useEffect(() => {
    if (!selectedObject && ontology?.objects) {
      const first = Object.keys(ontology.objects)[0];
      if (first) setSelectedObject(first);
    }
  }, [ontology, selectedObject, setSelectedObject]);

  useEffect(() => {
    if (selectedObject) void query(selectedObject);
  }, [query, selectedObject]);

  useEffect(() => {
    void updateCounts();
  }, [updateCounts]);

  const columns = useMemo(() => Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => key !== "_id")))), [rows]);
  const numericColumns = useMemo(() => new Set(columns.filter((column) => rows.some((row) => isNumeric(row[column])))), [columns, rows]);
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const result = compareValues(a[sort.column], b[sort.column]);
      return sort.desc ? -result : result;
    });
  }, [rows, sort]);

  function toggleSort(column: string) {
    setSort((current) => {
      if (current?.column === column) return { column, desc: !current.desc };
      return { column, desc: false };
    });
  }

  if (!ontology) return <EmptyState title="未加载数据模型" detail="选择 domain 后可以按对象查询样例数据。" />;

  return (
    <section className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[352px_minmax(0,1fr)]">
      <aside className="console-panel flex min-h-0 flex-col">
        <div className="panel-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2 panel-title">
              <Database className="h-4 w-4" style={{ color: "var(--info)" }} />
              对象数据
            </div>
            <p className="panel-subtitle">通过远程 MCP 的 query/count 工具读取对象数据。</p>
          </div>
          <Badge tone="blue">{Object.keys(ontology.objects ?? {}).length}</Badge>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
          {Object.entries(ontology.objects ?? {}).map(([name, object]) => (
            <button
              type="button"
              key={name}
              onClick={() => query(name)}
              className={`resource-card w-full ${selectedObject === name ? "resource-card-active" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{object.summary ? `${name} · ${firstLine(object.summary).split("(")[0].split("（")[0].trim()}` : name}</span>
                <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--text-faint)" }}>{counts[name] == null ? "-" : counts[name]}</span>
              </div>
              <div className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>{Object.keys(object.properties ?? {}).length} properties</div>
            </button>
          ))}
        </div>
      </aside>

      <div className="console-panel flex min-h-0 flex-col">
        <div className="panel-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="panel-title truncate">{selectedObject ?? "选择对象"}</div>
              {selectedObject ? <Badge tone="blue">{rows.length} rows</Badge> : null}
              {sort ? <Badge>{sort.column} {sort.desc ? "desc" : "asc"}</Badge> : null}
            </div>
            <div className="panel-subtitle truncate">过滤格式：field=value, name__like=乐陵, risk__gte=5</div>
          </div>
          <button type="button" onClick={() => updateCounts()} className="command-button">
            <RefreshCw className="h-4 w-4" />
            计数
          </button>
        </div>

        <div className="border-b p-3" style={{ borderColor: "var(--line)", background: "var(--bg-elevated)" }}>
          <div className="flex flex-col gap-2 md:flex-row">
            <div className="relative flex-1">
              <Filter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4" style={{ color: "var(--text-faint)" }} />
              <input
                className="control-input py-2 pl-9 pr-3"
                value={filterText}
                placeholder="field=value, name__like=乐陵"
                onChange={(event) => setFilterText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void query();
                }}
              />
            </div>
            <button type="button" onClick={() => query()} disabled={!selectedObject || loading} className="primary-button">
              <Search className="h-4 w-4" />
              Query
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? <div className="p-6 text-sm" style={{ color: "var(--text-faint)" }}>查询中...</div> : sortedRows.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-16 text-right">#</th>
                  {columns.map((column) => (
                    <th key={column}>
                      <button type="button" onClick={() => toggleSort(column)} className="inline-flex items-center gap-1 transition hover:opacity-80">
                        {column}
                        {numericColumns.has(column) ? <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>num</span> : null}
                        <ArrowDownUp className="h-3 w-3" />
                        {sort?.column === column ? <span>{sort.desc ? "▼" : "▲"}</span> : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => (
                  <tr key={index}>
                    <td className="text-right text-xs tabular-nums" style={{ color: "var(--text-faint)" }}>{index + 1}</td>
                    {columns.map((column) => (
                      <td key={column} className={`max-w-80 ${numericColumns.has(column) ? "text-right tabular-nums" : ""}`}>
                        <span className="line-clamp-2" title={String(row[column] ?? "")}>{stringify(row[column])}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <EmptyState title="暂无查询结果" detail="选择对象并点击 Query，或调整过滤条件。" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
