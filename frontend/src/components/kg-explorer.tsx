"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getGraphStats,
  getGraphEntities,
  getEntityNeighbors,
  type KGEntity,
  type KGNeighbor,
  type GraphStats,
} from "@/lib/api";
import {
  Network, GitBranch, Search, Loader2, ChevronRight,
  X, Tag, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Entity type colours ───────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  service:    "bg-blue-100 text-blue-700 border-blue-200",
  tool:       "bg-green-100 text-green-700 border-green-200",
  file:       "bg-amber-100 text-amber-700 border-amber-200",
  concept:    "bg-purple-100 text-purple-700 border-purple-200",
  host:       "bg-orange-100 text-orange-700 border-orange-200",
  error:      "bg-red-100 text-red-700 border-red-200",
  person:     "bg-pink-100 text-pink-700 border-pink-200",
  version:    "bg-zinc-100 text-zinc-600 border-zinc-200",
  other:      "bg-zinc-100 text-zinc-500 border-zinc-200",
};

const typeClass = (type: string) =>
  TYPE_COLORS[type] ?? TYPE_COLORS.other;

// ── Size scale for tag cloud ───────────────────────────────────────────────
function tagSize(count: number, maxCount: number): string {
  const ratio = count / Math.max(maxCount, 1);
  if (ratio >= 0.8) return "text-xl font-bold";
  if (ratio >= 0.6) return "text-lg font-semibold";
  if (ratio >= 0.4) return "text-base font-medium";
  if (ratio >= 0.2) return "text-sm";
  return "text-xs";
}

// ── Sub-components ────────────────────────────────────────────────────────
function EntityBadge({
  entity,
  maxCount,
  selected,
  onClick,
}: {
  entity: KGEntity;
  maxCount: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full border transition-all cursor-pointer",
        typeClass(entity.type),
        tagSize(entity.chunk_count, maxCount),
        selected && "ring-2 ring-offset-1 ring-purple-500 scale-105",
        !selected && "hover:scale-105 hover:shadow-sm opacity-90 hover:opacity-100"
      )}
      title={`${entity.name} (${entity.type}) — appears in ${entity.chunk_count} chunks`}
    >
      {entity.name}
      <span className="text-[9px] opacity-60 ml-0.5">×{entity.chunk_count}</span>
    </button>
  );
}

function NeighborCard({ neighbor }: { neighbor: KGNeighbor }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs hover:border-zinc-300 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium", typeClass(neighbor.neighbor_type))}>
            {neighbor.neighbor_type}
          </span>
          <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">
            {neighbor.neighbor_name}
          </span>
        </div>
        <p className="text-zinc-400 mt-0.5 flex items-center gap-1">
          <ArrowRight size={9} />
          {neighbor.relation}
          <span className="ml-auto text-[10px]">weight {neighbor.weight.toFixed(1)}</span>
        </p>
      </div>
    </div>
  );
}

// ── Main KG Explorer ──────────────────────────────────────────────────────
export default function KGExplorer() {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [entities, setEntities] = useState<KGEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<KGEntity | null>(null);
  const [neighbors, setNeighbors] = useState<KGNeighbor[]>([]);
  const [loadingNeighbors, setLoadingNeighbors] = useState(false);
  const [filterType, setFilterType] = useState<string>("");
  const [searchQ, setSearchQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, e] = await Promise.allSettled([
        getGraphStats(),
        getGraphEntities(100, filterType || undefined),
      ]);
      if (s.status === "fulfilled") setStats(s.value);
      if (e.status === "fulfilled") setEntities(e.value.entities);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => { load(); }, [load]);

  const handleEntityClick = async (entity: KGEntity) => {
    if (selectedEntity?.id === entity.id) {
      setSelectedEntity(null);
      setNeighbors([]);
      return;
    }
    setSelectedEntity(entity);
    setLoadingNeighbors(true);
    try {
      const { neighbors: n } = await getEntityNeighbors(entity.id, 15);
      setNeighbors(n);
    } catch {
      setNeighbors([]);
    } finally {
      setLoadingNeighbors(false);
    }
  };

  const allTypes = Array.from(new Set(entities.map((e) => e.type))).sort();
  const maxCount = Math.max(...entities.map((e) => e.chunk_count), 1);

  const filtered = entities.filter((e) =>
    !searchQ || e.name.toLowerCase().includes(searchQ.toLowerCase())
  );

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-2xl bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-indigo-600 dark:text-indigo-400" />
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Knowledge Graph Explorer
          </span>
          <span className="text-[10px] text-indigo-500 font-medium px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50">
            Phase 4 — LazyGraphRAG
          </span>
        </div>
        {stats && (
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span><GitBranch size={9} className="inline mr-0.5" />{stats.nodes} entities</span>
            <span>{stats.edges} relations</span>
            <span>{stats.chunk_entity_links} chunk links</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400 text-sm">
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading knowledge graph…
        </div>
      ) : error ? (
        <div className="px-4 py-4 text-sm text-amber-600">
          Graph not available: {error}. Ingest documents first to build the KG.
        </div>
      ) : entities.length === 0 ? (
        <div className="px-4 py-8 text-center text-zinc-400 text-sm">
          <Network size={32} className="mx-auto mb-2 opacity-30" />
          <p>No entities in the knowledge graph yet.</p>
          <p className="text-xs mt-1">Ingest documents above to build the graph automatically.</p>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Filters + search */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                className="pl-7 pr-3 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 w-40"
                placeholder="Filter entities…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setFilterType("")}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full border transition-all",
                  !filterType ? "bg-zinc-800 text-white border-zinc-800" : "border-zinc-300 text-zinc-500 hover:border-zinc-500"
                )}
              >
                all
              </button>
              {allTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(filterType === t ? "" : t)}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full border transition-all",
                    filterType === t
                      ? typeClass(t) + " ring-1 ring-offset-1 ring-purple-400"
                      : typeClass(t) + " opacity-70 hover:opacity-100"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            {searchQ && (
              <button onClick={() => setSearchQ("")} className="text-zinc-400 hover:text-zinc-700">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Tag cloud */}
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
            {filtered.map((entity) => (
              <EntityBadge
                key={entity.id}
                entity={entity}
                maxCount={maxCount}
                selected={selectedEntity?.id === entity.id}
                onClick={() => handleEntityClick(entity)}
              />
            ))}
          </div>

          {/* Entity detail panel */}
          {selectedEntity && (
            <div className="border border-indigo-200 dark:border-indigo-800 rounded-xl p-3 bg-indigo-50/50 dark:bg-indigo-950/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Tag size={12} className="text-indigo-600" />
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    {selectedEntity.name}
                  </span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", typeClass(selectedEntity.type))}>
                    {selectedEntity.type}
                  </span>
                  <span className="text-[10px] text-zinc-500">{selectedEntity.chunk_count} chunk(s)</span>
                </div>
                <button onClick={() => { setSelectedEntity(null); setNeighbors([]); }} className="text-zinc-400 hover:text-zinc-700">
                  <X size={14} />
                </button>
              </div>

              {loadingNeighbors ? (
                <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Loading neighbours…
                </div>
              ) : neighbors.length === 0 ? (
                <p className="text-xs text-zinc-400">No connected entities found.</p>
              ) : (
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1.5 flex items-center gap-1">
                    <ChevronRight size={10} />{neighbors.length} connected entities
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {neighbors.map((n, i) => (
                      <NeighborCard key={i} neighbor={n} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
