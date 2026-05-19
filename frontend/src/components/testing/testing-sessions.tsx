"use client";

import { useState, useMemo } from "react";
import {
  Clock, CheckCircle2, XCircle, Camera, Lightbulb,
  Globe, Zap, RefreshCw, Search, Filter, ChevronRight,
  TrendingUp, TrendingDown, Minus, Calendar, Timer,
  AlertTriangle, ShieldCheck, FlaskConical,
} from "lucide-react";
import { useTestingStore, TestRun } from "@/stores/testing-store";
import { cn } from "@/lib/utils";

// ── Types from output_json ─────────────────────────────────────────────────────

interface RunMeta {
  url: string;
  env_label: string;
  screenshots_taken: number;
  suggestions: { severity: string }[];
  final_summary: string;
  steps: unknown[];
}

function parseRunMeta(run: TestRun): RunMeta | null {
  try {
    if (!run.output_json) return null;
    return JSON.parse(run.output_json) as RunMeta;
  } catch {
    return null;
  }
}

function formatDuration(started: string | null, finished: string | null): string {
  if (!started || !finished) return "—";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Score ring ─────────────────────────────────────────────────────────────────

function ScoreRing({ pass, fail, size = 52 }: { pass: number; fail: number; size?: number }) {
  const total = pass + fail || 1;
  const pct = pass / total;
  const R = (size / 2) - 5;
  const C = 2 * Math.PI * R;
  const arc = pct * C;
  const score = total > 1 ? Math.round(pct * 100) : null;
  const color = pct >= 0.8 ? "#10b981" : pct >= 0.5 ? "#f59e0b" : "#ef4444";
  const glow = pct >= 0.8 ? "drop-shadow(0 0 4px #10b98140)" : pct >= 0.5 ? "drop-shadow(0 0 4px #f59e0b40)" : "drop-shadow(0 0 4px #ef444440)";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90 w-full h-full" viewBox={`0 0 ${size} ${size}`} style={{ filter: glow }}>
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#1f2937" strokeWidth="4" />
        {total > 1 && (
          <circle
            cx={size / 2} cy={size / 2} r={R}
            fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={`${arc} ${C - arc}`}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {score !== null ? (
          <span className="text-sm font-bold tabular-nums leading-none" style={{ color }}>{score}</span>
        ) : (
          <FlaskConical className="w-4 h-4 text-gray-600" />
        )}
        {score !== null && <span className="text-[7px] text-gray-600 font-medium">%</span>}
      </div>
    </div>
  );
}

// ── Trend arrow ────────────────────────────────────────────────────────────────

function TrendBadge({ current, prev }: { current: number; prev: number | null }) {
  if (prev === null) return null;
  const diff = current - prev;
  if (Math.abs(diff) < 2) return <Minus className="w-3 h-3 text-gray-600" />;
  if (diff > 0) return <TrendingUp className="w-3 h-3 text-emerald-500" />;
  return <TrendingDown className="w-3 h-3 text-red-500" />;
}

// ── Status pill ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { text: string; bg: string; dot: string }> = {
  passed:    { text: "text-emerald-300", bg: "bg-emerald-900/30 border-emerald-700/40", dot: "bg-emerald-400" },
  failed:    { text: "text-red-300",     bg: "bg-red-900/30 border-red-700/40",         dot: "bg-red-400"     },
  running:   { text: "text-amber-300",   bg: "bg-amber-900/30 border-amber-700/40",     dot: "bg-amber-400 animate-pulse" },
  pending:   { text: "text-gray-400",    bg: "bg-gray-800/40 border-gray-700/30",       dot: "bg-gray-500"    },
  cancelled: { text: "text-gray-500",    bg: "bg-gray-900/40 border-gray-700/20",       dot: "bg-gray-600"    },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border", s.text, s.bg)}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />
      {status}
    </span>
  );
}

// ── Severity dot counts ────────────────────────────────────────────────────────

function SeverityDots({ suggestions }: { suggestions: { severity: string }[] }) {
  const counts = suggestions.reduce<Record<string, number>>((acc, s) => {
    acc[s.severity] = (acc[s.severity] ?? 0) + 1;
    return acc;
  }, {});
  const order: { key: string; color: string }[] = [
    { key: "error",   color: "bg-red-500"    },
    { key: "warning", color: "bg-amber-500"  },
    { key: "info",    color: "bg-blue-500"   },
    { key: "success", color: "bg-emerald-500"},
  ];
  const visible = order.filter((o) => counts[o.key]);
  if (visible.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {visible.map((o) => (
        <span key={o.key} className="flex items-center gap-0.5">
          <span className={cn("w-1.5 h-1.5 rounded-full", o.color)} />
          <span className="text-[9px] text-gray-500">{counts[o.key]}</span>
        </span>
      ))}
    </div>
  );
}

// ── Session card ───────────────────────────────────────────────────────────────

function SessionCard({
  run, active, prevScore, onClick,
}: {
  run: TestRun;
  active: boolean;
  prevScore: number | null;
  onClick: () => void;
}) {
  const meta = parseRunMeta(run);
  const total = run.pass_count + run.fail_count || 1;
  const score = run.pass_count + run.fail_count > 0 ? Math.round((run.pass_count / total) * 100) : null;

  let hostname = "";
  let envLabel = meta?.env_label ?? "";
  try {
    if (meta?.url) hostname = new URL(meta.url).hostname;
  } catch { /* ignore */ }

  const duration = formatDuration(run.started_at, run.finished_at);
  const date = formatDate(run.created_at);
  const screenshots = meta?.screenshots_taken ?? 0;
  const suggestions = meta?.suggestions ?? [];

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-2xl border overflow-hidden transition-all duration-200 group",
        "hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50",
        active
          ? "border-emerald-600/50 shadow-emerald-900/30 shadow-md bg-gradient-to-br from-emerald-950/40 to-gray-900/60"
          : "border-gray-800/60 bg-gray-900/40 hover:border-gray-700/60 hover:bg-gray-900/70",
      )}
    >
      {/* Top strip */}
      <div className={cn(
        "h-0.5 w-full transition-all duration-300",
        run.status === "passed"
          ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
          : run.status === "failed"
          ? "bg-gradient-to-r from-red-700 to-red-500"
          : run.status === "running"
          ? "bg-gradient-to-r from-amber-600 to-amber-400 animate-pulse"
          : "bg-gray-800",
      )} />

      <div className="p-3 flex items-start gap-3">
        {/* Score ring */}
        <ScoreRing pass={run.pass_count} fail={run.fail_count} />

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Row 1: hostname + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 min-w-0">
              <Globe className="w-2.5 h-2.5 text-gray-600 shrink-0" />
              <span className="text-[11px] font-semibold text-gray-300 truncate">
                {hostname || `Run #${run.id}`}
              </span>
            </div>
            {envLabel && (
              <span className="text-[9px] text-indigo-400 bg-indigo-900/30 border border-indigo-800/30 px-1.5 py-0.5 rounded-full shrink-0">
                {envLabel}
              </span>
            )}
            <div className="ml-auto shrink-0 flex items-center gap-1.5">
              {score !== null && (
                <TrendBadge current={score} prev={prevScore} />
              )}
              <StatusPill status={run.status} />
            </div>
          </div>

          {/* Row 2: pass/fail/skip */}
          <div className="flex items-center gap-3">
            {run.pass_count > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                <CheckCircle2 className="w-2.5 h-2.5" />
                {run.pass_count} passed
              </span>
            )}
            {run.fail_count > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-red-400">
                <XCircle className="w-2.5 h-2.5" />
                {run.fail_count} failed
              </span>
            )}
            {run.skip_count > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-gray-600">
                <Minus className="w-2.5 h-2.5" />
                {run.skip_count} skipped
              </span>
            )}
          </div>

          {/* Row 3: meta stats */}
          <div className="flex items-center gap-3 flex-wrap">
            {screenshots > 0 && (
              <span className="flex items-center gap-1 text-[9px] text-gray-600">
                <Camera className="w-2.5 h-2.5" />
                {screenshots}
              </span>
            )}
            {suggestions.length > 0 && (
              <span className="flex items-center gap-1 text-[9px] text-gray-600">
                <Lightbulb className="w-2.5 h-2.5" />
                {suggestions.length}
                <SeverityDots suggestions={suggestions} />
              </span>
            )}
            {duration !== "—" && (
              <span className="flex items-center gap-1 text-[9px] text-gray-700">
                <Timer className="w-2.5 h-2.5" />
                {duration}
              </span>
            )}
            <span className="flex items-center gap-1 text-[9px] text-gray-700 ml-auto">
              <Calendar className="w-2.5 h-2.5" />
              {date}
            </span>
          </div>
        </div>
      </div>

      {/* Hover arrow */}
      <div className={cn(
        "flex items-center justify-end px-3 py-1.5 border-t transition-all",
        active
          ? "border-emerald-800/30 bg-emerald-950/20"
          : "border-gray-800/40 bg-gray-900/30 opacity-0 group-hover:opacity-100",
      )}>
        <span className="text-[9px] text-gray-500 group-hover:text-gray-400 transition-colors">
          {active ? "Currently viewing" : "View report"}
        </span>
        <ChevronRight className={cn(
          "w-3 h-3 ml-1 transition-all",
          active ? "text-emerald-500 rotate-90" : "text-gray-600 group-hover:translate-x-0.5",
        )} />
      </div>
    </button>
  );
}

// ── Stats bar ──────────────────────────────────────────────────────────────────

function StatsBar({ runs }: { runs: TestRun[] }) {
  const finished = runs.filter((r) => r.status === "passed" || r.status === "failed");
  const avgScore = finished.length === 0
    ? null
    : Math.round(
        finished.reduce((acc, r) => {
          const t = r.pass_count + r.fail_count || 1;
          return acc + (r.pass_count / t) * 100;
        }, 0) / finished.length,
      );

  const passRate = finished.length === 0 ? null : Math.round(
    (finished.filter((r) => r.status === "passed").length / finished.length) * 100,
  );

  const totalTests = runs.reduce((a, r) => a + r.pass_count + r.fail_count, 0);

  return (
    <div className="grid grid-cols-3 gap-2 px-3 pb-3">
      {[
        {
          label: "Avg Score",
          value: avgScore !== null ? `${avgScore}%` : "—",
          icon: ShieldCheck,
          color: avgScore !== null && avgScore >= 80 ? "text-emerald-400" : avgScore !== null && avgScore >= 50 ? "text-amber-400" : "text-red-400",
        },
        {
          label: "Pass Rate",
          value: passRate !== null ? `${passRate}%` : "—",
          icon: TrendingUp,
          color: passRate !== null && passRate >= 80 ? "text-emerald-400" : "text-amber-400",
        },
        {
          label: "Total Tests",
          value: totalTests > 0 ? String(totalTests) : "—",
          icon: Zap,
          color: "text-indigo-400",
        },
      ].map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-gray-900/50 rounded-xl border border-gray-800/50 p-2 flex flex-col items-center gap-0.5">
          <Icon className={cn("w-3 h-3", color)} />
          <span className={cn("text-sm font-bold tabular-nums", color)}>{value}</span>
          <span className="text-[9px] text-gray-600 uppercase tracking-wide">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────────────

type FilterType = "all" | "passed" | "failed" | "running";

function FilterBar({
  active, onChange, counts,
}: {
  active: FilterType;
  onChange: (f: FilterType) => void;
  counts: Record<FilterType, number>;
}) {
  const filters: { key: FilterType; label: string; color: string }[] = [
    { key: "all",     label: "All",     color: "text-gray-400"     },
    { key: "passed",  label: "Passed",  color: "text-emerald-400"  },
    { key: "failed",  label: "Failed",  color: "text-red-400"      },
    { key: "running", label: "Live",    color: "text-amber-400"    },
  ];

  return (
    <div className="flex gap-1 px-3 pb-2">
      {filters.map(({ key, label, color }) => (
        counts[key] > 0 || key === "all" ? (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={cn(
              "flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all",
              active === key
                ? cn("border-gray-600/60 bg-gray-800/80", color)
                : "border-gray-800/40 text-gray-600 hover:text-gray-400 hover:border-gray-700/50",
            )}
          >
            {label}
            {counts[key] > 0 && (
              <span className={cn(
                "text-[8px] font-mono px-1 py-0.5 rounded",
                active === key ? "bg-gray-700/60" : "bg-gray-800/60",
              )}>
                {counts[key]}
              </span>
            )}
          </button>
        ) : null
      ))}
    </div>
  );
}

// ── Main sessions panel ────────────────────────────────────────────────────────

export default function TestingSessions() {
  const runs        = useTestingStore((s) => s.runs);
  const activeRunId = useTestingStore((s) => s.activeRunId);
  const setActive   = useTestingStore((s) => s.setActiveRun);
  const loadRuns    = useTestingStore((s) => s.loadRuns);
  const isStreaming = useTestingStore((s) => s.isStreaming);

  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const counts = useMemo<Record<FilterType, number>>(() => ({
    all:     runs.length,
    passed:  runs.filter((r) => r.status === "passed").length,
    failed:  runs.filter((r) => r.status === "failed").length,
    running: runs.filter((r) => r.status === "running").length,
  }), [runs]);

  const filtered = useMemo(() => {
    let list = filter === "all" ? runs : runs.filter((r) => r.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => {
        const meta = parseRunMeta(r);
        return (
          String(r.id).includes(q) ||
          (meta?.url ?? "").toLowerCase().includes(q) ||
          (meta?.env_label ?? "").toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [runs, filter, search]);

  // Build prev-score map for trend arrows
  const scoreByRun = useMemo(() => {
    const map: Record<number, number | null> = {};
    [...runs].reverse().forEach((r, idx, arr) => {
      const t = r.pass_count + r.fail_count;
      const score = t > 0 ? Math.round((r.pass_count / t) * 100) : null;
      const prev = arr[idx - 1];
      const prevT = prev ? prev.pass_count + prev.fail_count : 0;
      map[r.id] = prev && prevT > 0 ? Math.round((prev.pass_count / prevT) * 100) : null;
      void score;
    });
    return map;
  }, [runs]);

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-6">
        <div className="w-16 h-16 rounded-2xl bg-gray-900/60 border border-gray-800/50 flex items-center justify-center">
          <FlaskConical className="w-8 h-8 text-gray-700" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-400">No sessions yet</p>
          <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">
            Run your first test in the chat panel.<br />
            Sessions appear here automatically.
          </p>
        </div>
        <button
          onClick={() => loadRuns()}
          disabled={isStreaming}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-400 transition-colors border border-gray-800/40 hover:border-gray-700/50 px-3 py-1.5 rounded-lg"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      <div className="pt-3">
        <StatsBar runs={runs} />
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by URL or label…"
            className="w-full bg-gray-900/60 border border-gray-800/60 rounded-xl pl-7 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-700/80 focus:ring-1 focus:ring-gray-700/50"
          />
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar active={filter} onChange={setFilter} counts={counts} />

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
            <Filter className="w-5 h-5 text-gray-700" />
            <p className="text-xs text-gray-600">No sessions match</p>
          </div>
        ) : (
          filtered.map((run) => (
            <SessionCard
              key={run.id}
              run={run}
              active={run.id === activeRunId}
              prevScore={scoreByRun[run.id] ?? null}
              onClick={() => setActive(run.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
