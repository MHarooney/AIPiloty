"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/app-shell";
import KGExplorer from "@/components/kg-explorer";
import { getKBHealth, getKBDocuments, searchKB, deleteKBDocument, getRAGHealth, ragIngest } from "@/lib/api";
import {
  BookOpen, Search, Trash2, Loader2, AlertTriangle,
  CheckCircle, FileText, RefreshCw, Database, FolderUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function KnowledgePage() {
  const [health, setHealth] = useState<any>(null);
  const [ragHealth, setRagHealth] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [ingestPath, setIngestPath] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<any>(null);
  const [forceIngest, setForceIngest] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [h, rh] = await Promise.allSettled([getKBHealth(), getRAGHealth()]);
      setHealth(h.status === "fulfilled" ? h.value : { available: false, error: "Failed to connect" });
      setRagHealth(rh.status === "fulfilled" ? rh.value : null);
      if (h.status === "fulfilled" && h.value.available) {
        const d = await getKBDocuments();
        setDocs(Array.isArray(d) ? d : d.documents || d.items || []);
      }
    } catch {
      setHealth({ available: false, error: "Failed to connect" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) { loadData(); return; }
    setSearching(true);
    try {
      const results = await searchKB(query.trim());
      setDocs(Array.isArray(results) ? results : results.documents || results.results || []);
    } catch {
      // search failed
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteKBDocument(id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingestPath.trim()) return;
    setIngesting(true);
    setIngestResult(null);
    try {
      const result = await ragIngest(ingestPath.split(",").map((p) => p.trim()), forceIngest);
      setIngestResult(result);
      // Refresh RAG health after ingest
      try { const rh = await getRAGHealth(); setRagHealth(rh); } catch {}
    } catch (err: any) {
      setIngestResult({ errors: [err.message || "Ingest failed"] });
    } finally {
      setIngesting(false);
    }
  };

  const available = health?.available === true;
  const qdrantOk = ragHealth?.qdrant === "ok";
  const embedOk = ragHealth?.embedding_model === "ok";

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-4 pt-14 md:p-6 md:pt-6">
        <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-900/20 flex items-center justify-center">
                <BookOpen size={20} className="text-emerald-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-100">Knowledge Base</h1>
                <p className="text-xs text-gray-500">Native RAG (Qdrant) + DeployPilot bridge</p>
              </div>
            </div>
            <button onClick={loadData} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 transition-colors">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Native RAG Status */}
          {ragHealth && (
            <div className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-blue-400" />
                <span className="text-sm font-medium text-gray-200">Native RAG (Qdrant + Ollama Embeddings)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg border",
                  qdrantOk
                    ? "bg-emerald-900/10 border-emerald-800/30 text-emerald-300"
                    : "bg-red-900/10 border-red-800/30 text-red-300"
                )}>
                  {qdrantOk ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                  Qdrant: {ragHealth.qdrant}
                </div>
                <div className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg border",
                  embedOk
                    ? "bg-emerald-900/10 border-emerald-800/30 text-emerald-300"
                    : "bg-amber-900/10 border-amber-800/30 text-amber-300"
                )}>
                  {embedOk ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                  Embeddings: {ragHealth.embedding_model}
                </div>
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700/50 text-gray-300">
                  <FileText size={12} />
                  {ragHealth.doc_count ?? 0} chunks indexed
                </div>
              </div>

              {/* Ingest */}
              <form onSubmit={handleIngest} className="flex gap-2">
                <div className="relative flex-1">
                  <FolderUp size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={ingestPath}
                    onChange={(e) => setIngestPath(e.target.value)}
                    placeholder="Path(s) to ingest (comma-separated, must be in KB_ALLOWED_ROOTS)"
                    className="w-full bg-gray-800/80 border border-gray-700/50 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <button type="submit" disabled={ingesting || !ingestPath.trim()} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                  {ingesting ? <Loader2 size={16} className="animate-spin" /> : "Ingest"}
                </button>
              </form>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                <input type="checkbox" checked={forceIngest} onChange={(e) => setForceIngest(e.target.checked)} className="rounded border-gray-600 bg-gray-800" />
                Force re-ingest (skip change detection)
              </label>

              {ingestResult && (
                <div className={cn(
                  "text-xs px-3 py-2 rounded-lg border",
                  ingestResult.errors?.length
                    ? "bg-amber-900/10 border-amber-800/30 text-amber-300"
                    : "bg-emerald-900/10 border-emerald-800/30 text-emerald-300"
                )}>
                  {ingestResult.files_processed != null && (
                    <span>{ingestResult.files_processed} files processed, {ingestResult.chunks_created} chunks created{ingestResult.skipped_unchanged ? `, ${ingestResult.skipped_unchanged} unchanged skipped` : ""}. </span>
                  )}
                  {ingestResult.errors?.length > 0 && (
                    <span>Errors: {ingestResult.errors.join("; ")}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* DeployPilot Bridge Status */}
          {health && (
            <div className={cn(
              "flex items-center gap-2 px-4 py-3 rounded-xl border text-sm",
              available
                ? "bg-emerald-900/10 border-emerald-800/30 text-emerald-300"
                : "bg-gray-900/50 border-gray-800/30 text-gray-400"
            )}>
              {available ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              {available
                ? "DeployPilot KB bridge connected"
                : `DeployPilot KB bridge — ${health.error || "configure DEPLOYPILOT_KB_URL in backend .env (optional)"}`}
            </div>
          )}

          {/* Phase 4: Knowledge Graph Explorer */}
          <KGExplorer />

          {/* Search */}
          {available && (
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search knowledge base..."
                  className="w-full bg-gray-800/80 border border-gray-700/50 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              <button type="submit" disabled={searching} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                {searching ? <Loader2 size={16} className="animate-spin" /> : "Search"}
              </button>
            </form>
          )}

          {/* Content */}
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-gray-500" size={32} />
            </div>
          ) : !available ? (
            <div className="text-center py-20 text-gray-500">
              <BookOpen size={40} className="mx-auto mb-3 opacity-30" />
              <p>Knowledge base not available</p>
              <p className="text-xs mt-1">Set <code className="text-gray-400">DEPLOYPILOT_KB_URL</code> in your backend .env file</p>
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-20 text-gray-500">
              <FileText size={40} className="mx-auto mb-3 opacity-30" />
              <p>{query ? "No results found" : "No documents yet"}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {docs.map((doc) => (
                <div key={doc.id} className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 hover:border-gray-700/50 transition-all group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-gray-200 truncate">{doc.title}</h3>
                      <div className="flex items-center gap-2 mt-1.5">
                        {doc.source_type && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/30 text-indigo-300 border border-indigo-700/30">
                            {doc.source_type}
                          </span>
                        )}
                        {doc.chunk_count != null && (
                          <span className="text-[10px] text-gray-500">{doc.chunk_count} chunks</span>
                        )}
                      </div>
                      {doc.tags && doc.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {doc.tags.map((t: string) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-500 hover:text-red-400 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
