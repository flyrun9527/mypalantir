import { Database, Search } from "lucide-react";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { stringify } from "../lib/format";
import { useConsoleStore } from "../store/useConsoleStore";
import { EmptyState } from "./EmptyState";

export function DataPanel() {
  const currentDomain = useConsoleStore((state) => state.currentDomain);
  const ontology = useConsoleStore((state) => state.ontology);
  const selectedObject = useConsoleStore((state) => state.selectedObject);
  const setSelectedObject = useConsoleStore((state) => state.setSelectedObject);
  const rows = useConsoleStore((state) => state.queryRows);
  const setRows = useConsoleStore((state) => state.setQueryRows);
  const setLoading = useConsoleStore((state) => state.setLoading);
  const loading = useConsoleStore((state) => state.loading.query);

  const query = useCallback(async (objectName = selectedObject) => {
    if (!objectName) return;
    setLoading("query", true);
    try {
      setRows(await api.queryObject(currentDomain, objectName, 50));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "查询失败");
    } finally {
      setLoading("query", false);
    }
  }, [currentDomain, selectedObject, setLoading, setRows]);

  useEffect(() => {
    if (!selectedObject && ontology?.objects) {
      const first = Object.keys(ontology.objects)[0];
      if (first) setSelectedObject(first);
    }
  }, [ontology, selectedObject, setSelectedObject]);

  useEffect(() => {
    if (selectedObject) void query(selectedObject);
  }, [query, selectedObject]);

  if (!ontology) return <EmptyState title="未加载数据模型" detail="选择 domain 后可以按对象查询样例数据。" />;

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 12);

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-auto rounded border border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Database className="h-4 w-4 text-sky-300" />
            对象数据
          </div>
        </div>
        <div className="space-y-1 p-2">
          {Object.keys(ontology.objects ?? {}).map((name) => (
            <button
              type="button"
              key={name}
              onClick={() => {
                setSelectedObject(name);
                query(name);
              }}
              className={`w-full rounded px-3 py-2 text-left text-sm transition ${selectedObject === name ? "bg-sky-950 text-sky-200" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}`}
            >
              {name}
            </button>
          ))}
        </div>
      </aside>

      <div className="min-h-0 overflow-auto rounded border border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div>
            <div className="text-sm font-semibold text-zinc-100">{selectedObject ?? "选择对象"}</div>
            <div className="text-xs text-zinc-500">最多显示 50 行，适合快速验证 ontology 与数据映射。</div>
          </div>
          <button type="button" onClick={() => query()} className="inline-flex items-center gap-2 rounded bg-sky-500 px-3 py-2 text-sm font-semibold text-zinc-950">
            <Search className="h-4 w-4" />
            查询
          </button>
        </div>
        {loading ? <div className="p-6 text-sm text-zinc-500">查询中...</div> : rows.length ? (
          <div className="overflow-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-zinc-900">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="border-b border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="odd:bg-zinc-950 even:bg-zinc-900/40">
                    {columns.map((column) => (
                      <td key={column} className="max-w-72 border-b border-zinc-900 px-3 py-2 text-xs text-zinc-300">
                        <span className="line-clamp-2">{stringify(row[column])}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState title="暂无查询结果" detail="选择对象并点击查询，或从本体对象详情中打开样例数据。" />
          </div>
        )}
      </div>
    </section>
  );
}
