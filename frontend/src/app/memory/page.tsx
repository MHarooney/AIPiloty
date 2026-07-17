"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/app-shell";
import {
  getMemoryEntries,
  getMemoryStats,
  listEpisodes,
  searchEpisodes,
  deleteMemoryEntry,
  deleteEpisode,
  clearMemoryEntries,
  createMemoryEntry,
  type MemoryEntry,
  type Episode,
  type MemoryStats,
} from "@/lib/api";
import {
  Brain,
  Clock,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  Plus,
  Tag,
  Star,
  AlertTriangle,
  Database,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Category colours ──────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  fix:          "bg-red-100 text-red-700 border-red-200",
  incident:     "bg-orange-100 text-orange-700 border-orange-200",
  pattern:      "bg-purple-100 text-purple-700 border-purple-200",
  discovery:    "bg-blue-100 text-blue-700 border-blue-200",
  conversation: "bg-gray-100 text-gray-600 border-gray-200",
  general:      "bg-zinc-100 text-zinc-600 border-zinc-200",
  tool_result:  "bg-green-100 text-green-700 border-green-200",
};
const catClass = (cat: string) =>
  CATEGORY_COLORS[cat] ?? "bg-zinc-100 text-zinc-600 border-zinc-200";

// ── Format helpers ────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso.slice(0, 16); }
}

function ImportanceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`Importance: ${(value * 100).toFixed(0)}%`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={cn(
            "h-1.5 w-3 rounded-full",
            value >= i / 5 ? "bg-amber-400" : "bg-zinc-200 dark:bg-zinc-700"
          )}
        />
      ))}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────
function MemoryEntryCard({
  entry,
  onDelete,
}: {
  entry: MemoryEntry;
  onDelete: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const valStr =
    typeof entry.value === "string"
      ? entry.value
      : JSON.stringify(entry.value, null, 2);

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 p-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[200px]">
              {entry.key}
            </span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", catClass(entry.category))}>
              {entry.category}
            </span>
          </div>
          <p className={cn("text-xs text-zinc-600 dark:text-zinc-400", !expanded && "line-clamp-2")}>
            {valStr}
          </p>
          {valStr.length > 120 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-[10px] text-blue-500 hover:underline flex items-center gap-0.5"
            >
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {expanded ? "collapse" : "expand"}
            </button>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={() => onDelete(entry.key)}
            className="text-zinc-400 hover:text-red-500 transition-colors"
            title="Forget this memory"
          >
            <Trash2 size={13} />
          </button>
          <ImportanceBar value={entry.importance} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-400">
        <span title="Created"><Clock size={9} className="inline mr-0.5" />{fmtDate(entry.created_at)}</span>
        {entry.access_count > 0 && (
          <span title="Access count"><Star size={9} className="inline mr-0.5" />{entry.access_count}×</span>
        )}
      </div>
    </div>
  );
}

function EpisodeCard({
  episode,
  onDelete,
}: {
  episode: Episode;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 p-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", catClass(episode.category))}>
              {episode.category}
            </span>
            {episode.score > 0 && (
              <span className="text-[10px] text-blue-500 font-medium">
                score {episode.score.toFixed(2)}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-3">{episode.summary}</p>
        </div>
        <button
          onClick={() => onDelete(episode.id)}
          className="text-zinc-400 hover:text-red-500 transition-colors shrink-0"
          title="Forget this episode"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-400">
        <span><Clock size={9} className="inline mr-0.5" />{fmtDate(episode.created_at)}</span>
        <span className="font-mono">session: {episode.session_id.slice(0, 12)}…</span>
        <ImportanceBar value={episode.importance} />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function MemoryPage() {
  const [tab, setTab] = useState<"agent" | "episodic">("agent");
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [filterCat, setFilterCat] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCat, setNewCat] = useState("general");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, e, ep] = await Promise.allSettled([
        getMemoryStats(),
        getMemoryEntries(),
        listEpisodes(50),
      ]);
      if (s.status === "fulfilled") setStats(s.value);
      if (e.status === "fulfilled") setEntries(e.value);
      if (ep.status === "fulfilled") setEpisodes(ep.value);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleDeleteEntry = async (key: string) => {
    await deleteMemoryEntry(key);
    setEntries((prev) => prev.filter((e) => e.key !== key));
    setStats((prev) =>
      prev ? { ...prev, agent_memory: { ...prev.agent_memory, total_entries: prev.agent_memory.total_entries - 1 } } : prev
    );
  };

  const handleDeleteEpisode = async (id: string) => {
    await deleteEpisode(id);
    setEpisodes((prev) => prev.filter((e) => e.id !== id));
    setStats((prev) =>
      prev ? { ...prev, episodic_memory: { ...prev.episodic_memory, total_episodes: prev.episodic_memory.total_episodes - 1 } } : prev
    );
  };

  const handleSearchEpisodes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQ.trim()) { loadAll(); return; }
    setSearching(true);
    try {
      const results = await searchEpisodes(searchQ.trim(), 10);
      setEpisodes(results);
    } finally {
      setSearching(false);
    }
  };

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim()) return;
    setAdding(true);
    try {
      const entry = await createMemoryEntry(newKey.trim(), newValue.trim(), newCat);
      setEntries((prev) => [entry, ...prev]);
      setNewKey(""); setNewValue(""); setShowAdd(false);
    } finally {
      setAdding(false);
    }
  };

  const filteredEntries = filterCat
    ? entries.filter((e) => e.category === filterCat)
    : entries;

  const allCategories = Array.from(new Set(entries.map((e) => e.category)));

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow">
              <Brain size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Memory Browser</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Phase 3 — Agent memory + episodic vector store
              </p>
            </div>
          </div>
          <button
            onClick={loadAll}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Agent Memories", value: stats.agent_memory.total_entries, icon: Tag },
              { label: "Episodes", value: stats.episodic_memory.total_episodes, icon: Clock },
              { label: "Categories", value: stats.agent_memory.categories.length, icon: Star },
              {
                label: "Episodic Store",
                value: stats.episodic_memory.available ? "online" : "offline",
                icon: Database,
                ok: stats.episodic_memory.available,
              },
            ].map(({ label, value, icon: Icon, ok }) => (
              <div key={label} className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 bg-white dark:bg-zinc-900 text-center">
                <Icon size={16} className="mx-auto mb-1 text-zinc-400" />
                <p className={cn("text-lg font-bold", ok === false && "text-red-500")}>{value}</p>
                <p className="text-[10px] text-zinc-500">{label}</p>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b border-zinc-200 dark:border-zinc-700">
          {(["agent", "episodic"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                tab === t
                  ? "border-purple-500 text-purple-600 dark:text-purple-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              )}
            >
              {t === "agent" ? `🗄️ Agent Memory (${entries.length})` : `🔮 Episodic Memory (${episodes.length})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <Loader2 size={28} className="animate-spin mr-2" />
            Loading memory…
          </div>
        ) : (
          <>
            {/* ── Agent Memory Tab ── */}
            {tab === "agent" && (
              <div>
                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {allCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setFilterCat(filterCat === cat ? "" : cat)}
                      className={cn(
                        "text-[11px] px-2 py-1 rounded-full border font-medium transition-all",
                        filterCat === cat ? catClass(cat) + " ring-2 ring-offset-1 ring-purple-400" : catClass(cat) + " opacity-70 hover:opacity-100"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                  {filterCat && (
                    <button onClick={() => setFilterCat("")} className="text-[11px] text-zinc-400 hover:text-zinc-700 flex items-center gap-1">
                      <X size={10} /> clear
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => setShowAdd(!showAdd)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>

                {/* Add form */}
                {showAdd && (
                  <form
                    onSubmit={handleAddEntry}
                    className="mb-4 p-4 border border-purple-200 dark:border-purple-800 rounded-xl bg-purple-50 dark:bg-purple-900/20 space-y-2"
                  >
                    <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-2">New memory entry</p>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 text-xs px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                        placeholder="Key (e.g. preferred_model)"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        required
                      />
                      <select
                        className="text-xs px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                        value={newCat}
                        onChange={(e) => setNewCat(e.target.value)}
                      >
                        {["general", "fix", "pattern", "config", "discovery"].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      className="w-full text-xs px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 resize-none"
                      rows={3}
                      placeholder="Value…"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      required
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={adding}
                        className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                      >
                        {adding ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAdd(false)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {filteredEntries.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400">
                    <Brain size={36} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No memories found.</p>
                    <p className="text-xs mt-1">Memories are created automatically as the agent uses tools.</p>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {filteredEntries.map((entry) => (
                      <MemoryEntryCard key={entry.key} entry={entry} onDelete={handleDeleteEntry} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Episodic Memory Tab ── */}
            {tab === "episodic" && (
              <div>
                {stats && !stats.episodic_memory.available && (
                  <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                    <AlertTriangle size={14} />
                    Qdrant is not reachable — episodic memory requires Qdrant. Start Qdrant via Docker Compose.
                  </div>
                )}

                {/* Search */}
                <form onSubmit={handleSearchEpisodes} className="flex gap-2 mb-4">
                  <div className="flex-1 relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      placeholder="Semantic search past episodes…"
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={searching}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    Search
                  </button>
                  {searchQ && (
                    <button
                      type="button"
                      onClick={() => { setSearchQ(""); loadAll(); }}
                      className="text-xs px-2 py-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100"
                    >
                      <X size={12} />
                    </button>
                  )}
                </form>

                {episodes.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400">
                    <Clock size={36} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No episodes stored yet.</p>
                    <p className="text-xs mt-1">Episodes are created automatically after conversations that use tools.</p>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {episodes.map((ep) => (
                      <EpisodeCard key={ep.id} episode={ep} onDelete={handleDeleteEpisode} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
