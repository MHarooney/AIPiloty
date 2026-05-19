"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/app-shell";
import { getDBTables, getDBTableSchema, getDBTableRows } from "@/lib/api";
import { Database, Table2, Loader2, ChevronRight, Columns3, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Column { name: string; type: string; nullable: boolean; primary_key: boolean }

export default function DatabasePage() {
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [schema, setSchema] = useState<Column[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const PAGE_SIZE = 50;

  useEffect(() => {
    getDBTables()
      .then((t) => setTables(Array.isArray(t) ? t : t.tables || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectTable = async (name: string) => {
    setSelectedTable(name);
    setPage(0);
    setTableLoading(true);
    try {
      const [s, r] = await Promise.all([
        getDBTableSchema(name),
        getDBTableRows(name, PAGE_SIZE, 0),
      ]);
      setSchema(s.columns || []);
      setRows(r.rows || []);
      setTotal(r.total ?? 0);
    } catch {
      setSchema([]);
      setRows([]);
    } finally {
      setTableLoading(false);
    }
  };

  const changePage = async (newPage: number) => {
    if (!selectedTable) return;
    setTableLoading(true);
    setPage(newPage);
    try {
      const r = await getDBTableRows(selectedTable, PAGE_SIZE, newPage * PAGE_SIZE);
      setRows(r.rows || []);
      setTotal(r.total ?? 0);
    } catch {
      setRows([]);
    } finally {
      setTableLoading(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AppShell>
      <div className="flex-1 flex overflow-hidden animate-fade-in">
        {/* Sidebar - table list */}
        <aside className="w-60 flex-shrink-0 border-r border-gray-800/50 bg-gray-950/50 flex flex-col">
          <div className="p-4 border-b border-gray-800/50 flex items-center gap-2">
            <Database size={16} className="text-cyan-400" />
            <h2 className="text-sm font-semibold text-gray-200">Tables</h2>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-cyan-900/30 text-cyan-300 border border-cyan-800/30 flex items-center gap-1">
              <Lock size={10} /> Read-only
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="animate-spin text-gray-500" size={20} />
              </div>
            ) : tables.length === 0 ? (
              <p className="text-xs text-gray-600 p-3">No tables found</p>
            ) : (
              tables.map((t) => (
                <button
                  key={t}
                  onClick={() => selectTable(t)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors",
                    selectedTable === t
                      ? "bg-cyan-900/20 text-cyan-300"
                      : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
                  )}
                >
                  <Table2 size={14} />
                  <span className="truncate">{t}</span>
                  {selectedTable === t && <ChevronRight size={12} className="ml-auto" />}
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedTable ? (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
              <div className="text-center">
                <Columns3 size={40} className="mx-auto mb-3 opacity-30" />
                <p>Select a table to browse</p>
              </div>
            </div>
          ) : tableLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="animate-spin text-gray-500" size={28} />
            </div>
          ) : (
            <>
              {/* Schema strip */}
              <div className="p-4 border-b border-gray-800/50 space-y-2">
                <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                  <Table2 size={14} className="text-cyan-400" />
                  {selectedTable}
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 font-normal">{total} rows</span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {schema.map((col) => (
                    <span key={col.name} className={cn(
                      "text-[10px] px-2 py-1 rounded-md border",
                      col.primary_key
                        ? "bg-amber-900/20 border-amber-800/30 text-amber-300"
                        : "bg-gray-900 border-gray-800/50 text-gray-400"
                    )}>
                      {col.primary_key && "🔑 "}{col.name}{" "}
                      <span className="opacity-60">{col.type}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Rows */}
              <div className="flex-1 overflow-auto">
                {rows.length === 0 ? (
                  <p className="text-center text-gray-600 text-sm py-10">No rows</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-950">
                      <tr>
                        {schema.map((col) => (
                          <th key={col.name} className="px-3 py-2 text-left font-medium text-gray-400 border-b border-gray-800/50 whitespace-nowrap">
                            {col.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-900/60 transition-colors">
                          {schema.map((col) => (
                            <td key={col.name} className="px-3 py-2 border-b border-gray-800/30 text-gray-300 whitespace-nowrap max-w-xs truncate">
                              {row[col.name] == null ? <span className="text-gray-600 italic">null</span> : String(row[col.name])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800/50 text-xs text-gray-400">
                  <span>Page {page + 1} of {totalPages}</span>
                  <div className="flex gap-2">
                    <button onClick={() => changePage(page - 1)} disabled={page === 0} className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 transition-colors">Prev</button>
                    <button onClick={() => changePage(page + 1)} disabled={page >= totalPages - 1} className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 transition-colors">Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
