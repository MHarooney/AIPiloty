"use client";

import { useEffect, useState } from "react";
import {
  RefreshCw, Clock, CheckCircle2, XCircle, Loader2, BarChart3,
  FlaskConical, Zap, Globe, ChevronRight, Activity, Cpu, History,
} from "lucide-react";
import { useTestingStore, TestRun } from "@/stores/testing-store";
import { cn } from "@/lib/utils";
import TestingReport from "./testing-report";
import TestingSessions from "./testing-sessions";

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  running:   "text-amber-400 bg-amber-900/30 border-amber-800/30",
  passed:    "text-emerald-400 bg-emerald-900/30 border-emerald-800/30",
  failed:    "text-red-400 bg-red-900/30 border-red-800/30",
  pending:   "text-gray-400 bg-gray-800/40 border-gray-700/30",
  cancelled: "text-gray-500 bg-gray-900/40 border-gray-700/20",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(
      "text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border",
      STATUS_STYLES[status] ?? "text-gray-400 bg-gray-800 border-gray-700"
    )}>
      {status === "running"
        ? <span className="flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />live</span>
        : status}
    </span>
  );
}

// ── Mini donut ────────────────────────────────────────────────────────────────

function MiniDonut({ pass, fail }: { pass: number; fail: number }) {
  const total = pass + fail || 1;
  const pct = pass / total;
  const R = 12; const C = 2 * Math.PI * R;
  const arc = pct * C;
  const color = pct >= 0.8 ? "#10b981" : pct >= 0.5 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative w-8 h-8 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r={R} fill="none" stroke="#1f2937" strokeWidth="3.5" />
        <circle cx="14" cy="14" r={R} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${arc} ${C - arc}`} strokeLinecap="round"
          className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[8px] font-bold tabular-nums" style={{ color }}>
          {total > 1 ? `${Math.round(pct * 100)}` : "—"}
        </span>
      </div>
    </div>
  );
}

// ── Run card (history list) ───────────────────────────────────────────────────

function RunCard({ run, active, onClick }: { run: TestRun; active: boolean; onClick: () => void }) {
  const date = new Date(run.created_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  let urlLabel = "";
  try {
    const parsed = run.output_json ? JSON.parse(run.output_json) : null;
    urlLabel = parsed?.url ? new URL(parsed.url).hostname : "";
  } catch { /* ignore */ }

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-2.5 rounded-xl border transition-all duration-200 group",
        active
          ? "bg-emerald-900/20 border-emerald-700/40 shadow-lg shadow-emerald-900/20"
          : "bg-gray-900/50 border-gray-800/50 hover:border-gray-700/60 hover:bg-gray-900/70"
      )}
    >
      <div className="flex items-center gap-2">
        <MiniDonut pass={run.pass_count} fail={run.fail_count} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-gray-500">#{run.id}</span>
            {urlLabel && <span className="text-[10px] text-gray-500 truncate">{urlLabel}</span>}
            <StatusBadge status={run.status} />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-emerald-400 tabular-nums">{run.pass_count}✓</span>
            {run.fail_count > 0 && <span className="text-[10px] text-red-400 tabular-nums">{run.fail_count}✗</span>}
          </div>
        </div>
        <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", active ? "text-emerald-400 rotate-90" : "text-gray-700 group-hover:text-gray-500")} />
      </div>
      <div className="flex items-center gap-1 mt-1.5 text-[9px] text-gray-700">
        <Clock className="w-2 h-2" />
        {date}
      </div>
    </button>
  );
}

// ── Live session panel ────────────────────────────────────────────────────────

function LiveSessionPanel() {
  const messages      = useTestingStore((s) => s.messages);
  const currentTool   = useTestingStore((s) => s.currentToolCall);
  const systemState   = useTestingStore((s) => s.systemState);
  const screenshots   = useTestingStore((s) => s.screenshots);

  const lastMsg       = messages.at(-1);
  const toolCalls     = lastMsg?.toolCalls ?? [];
  const toolResults   = lastMsg?.toolResults ?? [];

  const steps = toolCalls.map((tc, i) => {
    const result = toolResults[i];
    return { tool: tc.tool, done: !!result, success: result?.success ?? true };
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-amber-800/30 bg-amber-950/20">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
        </span>
        <span className="text-xs font-semibold text-amber-400">Live Session</span>
        {currentTool && (
          <span className="text-[10px] text-amber-600 font-mono truncate ml-auto">
            {currentTool.replace(/_/g, " ")}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {steps.length > 0 && (
          <div>
            <p className="text-[9px] uppercase text-gray-600 tracking-wider mb-2">Steps</p>
            <div className="space-y-1">
              {steps.map((s, i) => (
                <div key={i} className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border",
                  s.done
                    ? s.success
                      ? "border-emerald-800/30 bg-emerald-950/20 text-emerald-300"
                      : "border-red-800/30 bg-red-950/20 text-red-300"
                    : "border-amber-800/30 bg-amber-950/20 text-amber-300"
                )}>
                  {s.done
                    ? s.success ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <XCircle className="w-3 h-3 shrink-0" />
                    : <Loader2 className="w-3 h-3 shrink-0 animate-spin" />}
                  <span className="font-mono text-[10px] truncate">{s.tool.replace(/_/g, " ")}</span>
                </div>
              ))}
              {systemState === "thinking" && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-gray-800/30 bg-gray-900/30 text-gray-500">
                  <Activity className="w-3 h-3 shrink-0 animate-pulse" />
                  <span className="text-[10px]">Agent thinking…</span>
                </div>
              )}
            </div>
          </div>
        )}

        {screenshots.length > 0 && (
          <div className="flex items-center gap-2 bg-purple-950/30 border border-purple-800/30 rounded-xl px-3 py-2">
            <Cpu className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span className="text-xs text-purple-300">
              {screenshots.length} screenshot{screenshots.length !== 1 ? "s" : ""} captured
            </span>
          </div>
        )}

        {steps.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <div className="relative">
              <Globe className="w-8 h-8 text-gray-700" />
              <Loader2 className="w-4 h-4 text-amber-500 animate-spin absolute -bottom-1 -right-1" />
            </div>
            <p className="text-xs text-gray-600">Agent working…</p>
            <p className="text-[10px] text-gray-700">Results save automatically when complete.</p>
          </div>
        )}

        <p className="text-[10px] text-gray-700 text-center pt-2">
          Full report saved when session ends →
        </p>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onShowHistory, hasHistory }: { onShowHistory: () => void; hasHistory: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
      <div className="w-14 h-14 rounded-2xl bg-emerald-950/30 border border-emerald-800/30 flex items-center justify-center">
        <FlaskConical className="w-7 h-7 text-emerald-700" />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-400">No report selected</p>
        <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">
          Run a test in the chat panel.<br />Results appear here automatically.
        </p>
      </div>
      {hasHistory && (
        <button
          onClick={onShowHistory}
          className="flex items-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400 transition-colors border border-emerald-800/30 hover:border-emerald-700/50 px-3 py-1.5 rounded-lg"
        >
          <BarChart3 className="w-3 h-3" />
          View previous runs
        </button>
      )}
      <div className="mt-2 flex gap-2 flex-wrap justify-center">
        {["smoke test your site", "discover API endpoints", "test login flow"].map((chip) => (
          <span key={chip} className="text-[9px] text-gray-700 bg-gray-900/50 border border-gray-800/40 rounded-full px-2 py-0.5">
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

type DashTab = "report" | "sessions";

export default function TestingDashboard() {
  const runs        = useTestingStore((s) => s.runs);
  const activeRunId = useTestingStore((s) => s.activeRunId);
  const setActive   = useTestingStore((s) => s.setActiveRun);
  const loadRuns    = useTestingStore((s) => s.loadRuns);
  const isStreaming = useTestingStore((s) => s.isStreaming);

  const [tab, setTab] = useState<DashTab>("report");
  const activeRun = runs.find((r) => r.id === activeRunId) ?? null;

  // Load on mount
  useEffect(() => { loadRuns(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When stream ends, load runs and auto-select newest
  useEffect(() => {
    if (!isStreaming) {
      const timer = setTimeout(async () => {
        await loadRuns();
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select newest run when runs load (and nothing is active)
  useEffect(() => {
    if (!isStreaming && runs.length > 0 && activeRunId === null) {
      setActive(runs[0].id);
    }
  }, [runs.length, isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // When sessions tab: selecting a run should jump back to report
  const handleSessionSelect = (id: number) => {
    setActive(id);
    setTab("report");
  };

  return (
    <div className="flex flex-col h-full bg-gray-950/20">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-0 border-b border-gray-800/50">
        {/* Tabs */}
        <div className="flex items-end gap-0">
          <button
            onClick={() => setTab("report")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all",
              tab === "report"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-gray-600 hover:text-gray-400",
            )}
          >
            <BarChart3 className="w-3 h-3" />
            Report
            {isStreaming && (
              <span className="flex items-center gap-0.5 text-[9px] text-amber-400 bg-amber-900/30 border border-amber-800/30 rounded-full px-1.5 py-0.5">
                <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                live
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("sessions")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all",
              tab === "sessions"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-gray-600 hover:text-gray-400",
            )}
          >
            <History className="w-3 h-3" />
            Sessions
            {runs.length > 0 && (
              <span className={cn(
                "text-[9px] font-mono px-1.5 py-0.5 rounded-full border",
                tab === "sessions"
                  ? "bg-indigo-900/40 border-indigo-800/40 text-indigo-400"
                  : "bg-gray-800/50 border-gray-700/30 text-gray-500",
              )}>
                {runs.length}
              </span>
            )}
          </button>
        </div>

        {/* Refresh */}
        <button
          onClick={() => loadRuns()}
          disabled={isStreaming}
          title="Refresh"
          className="text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-40 pb-2"
        >
          <RefreshCw className={cn("w-3 h-3", isStreaming && "animate-spin")} />
        </button>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden">
        {tab === "sessions" ? (
          // Sessions panel wraps with its own store subscription
          // but we override onClick to jump to report tab
          <SessionsTabWrapper onSelect={handleSessionSelect} />
        ) : isStreaming && !activeRun ? (
          <LiveSessionPanel />
        ) : activeRun ? (
          <TestingReport run={activeRun} />
        ) : (
          <EmptyState hasHistory={runs.length > 0} onShowHistory={() => setTab("sessions")} />
        )}
      </div>
    </div>
  );
}

// Thin wrapper so TestingSessions uses handleSessionSelect for clicks
function SessionsTabWrapper({ onSelect }: { onSelect: (id: number) => void }) {
  // We override the store's setActiveRun by using a local wrapper component.
  // TestingSessions reads from the store directly, so we patch it via a mini
  // provider trick: just render it and listen — then after mount intercept clicks
  // by re-exporting. Simplest approach: render TestingSessions and wrap the
  // setActiveRun in the store before rendering.
  const setActive = useTestingStore((s) => s.setActiveRun);
  // Temporarily swap setActiveRun to also call onSelect
  useEffect(() => {
    const orig = useTestingStore.getState().setActiveRun;
    useTestingStore.setState({
      setActiveRun: (id) => { orig(id); if (id !== null) onSelect(id); },
    });
    return () => useTestingStore.setState({ setActiveRun: orig });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  void setActive;
  return <TestingSessions />;
}
