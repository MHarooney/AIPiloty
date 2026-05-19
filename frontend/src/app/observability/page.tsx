"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/app-shell";
import { getLogs, getMetrics } from "@/lib/api";
import {
  Activity, Clock, AlertTriangle, BarChart3,
  RefreshCw, Loader2, Filter, Zap, Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LogEntry = { timestamp: string; level: string; event: string; logger: string; [k: string]: unknown };
type MetricsSummary = {
  timings: Record<string, { count: number; p50_ms: number; p95_ms: number; avg_ms: number; max_ms: number }>;
  counters: Record<string, number>;
  errors: Record<string, number>;
};

export default function ObservabilityPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metricsData, setMetricsData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async () => {
    try {
      const [logsRes, metricsRes] = await Promise.all([
        getLogs(200, levelFilter || undefined),
        getMetrics(),
      ]);
      setLogs(logsRes.entries);
      setMetricsData(metricsRes);
    } catch {}
    setLoading(false);
  }, [levelFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const levelColor = (level: string) => {
    switch (level?.toUpperCase()) {
      case "ERROR": return "text-red-400 bg-red-900/20";
      case "WARNING": return "text-amber-400 bg-amber-900/20";
      case "DEBUG": return "text-gray-500 bg-gray-800/30";
      default: return "text-blue-400 bg-blue-900/20";
    }
  };

  const fmtMs = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

  if (loading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-gray-500" size={28} />
        </div>
      </AppShell>
    );
  }

  const timings = metricsData?.timings || {};
  const counters = metricsData?.counters || {};
  const errors = metricsData?.errors || {};
  const totalErrors = Object.values(errors).reduce((a, b) => a + b, 0);

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-4 pt-14 md:p-6 md:pt-6">
        <div className="max-w-6xl mx-auto space-y-5 animate-fade-in">
          {/* Header */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
              <Activity size={20} className="text-indigo-400" />
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-100">Observability</h1>
              <p className="text-xs text-gray-500">Metrics, logs & system performance</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={cn(
                  "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors",
                  autoRefresh
                    ? "border-emerald-800/50 bg-emerald-900/20 text-emerald-400"
                    : "border-gray-800/50 bg-gray-900/50 text-gray-500 hover:text-gray-300"
                )}
              >
                <RefreshCw size={12} className={autoRefresh ? "animate-spin" : ""} />
                {autoRefresh ? "Live" : "Auto-refresh"}
              </button>
              <button
                onClick={load}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-800/50 bg-gray-900/50 text-gray-400 hover:text-gray-200 transition-colors"
              >
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard icon={Hash} label="Chat Requests" value={counters.chat_requests ?? 0} color="text-indigo-400" bg="bg-indigo-900/20" />
            <SummaryCard icon={Zap} label="Tool Calls" value={counters.tool_calls ?? 0} color="text-purple-400" bg="bg-purple-900/20" />
            <SummaryCard icon={Clock} label="Avg Latency" value={timings.chat_response ? fmtMs(timings.chat_response.avg_ms) : "—"} color="text-cyan-400" bg="bg-cyan-900/20" />
            <SummaryCard icon={AlertTriangle} label="Errors" value={totalErrors} color={totalErrors > 0 ? "text-red-400" : "text-emerald-400"} bg={totalErrors > 0 ? "bg-red-900/20" : "bg-emerald-900/20"} />
          </div>

          {/* Timing Details */}
          {Object.keys(timings).length > 0 && (
            <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                <BarChart3 size={16} className="text-cyan-400" /> Latency Breakdown
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 text-left">
                      <th className="py-1.5 px-2">Operation</th>
                      <th className="py-1.5 px-2 text-right">Count</th>
                      <th className="py-1.5 px-2 text-right">p50</th>
                      <th className="py-1.5 px-2 text-right">p95</th>
                      <th className="py-1.5 px-2 text-right">Avg</th>
                      <th className="py-1.5 px-2 text-right">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(timings).map(([name, t]) => (
                      <tr key={name} className="border-t border-gray-800/30">
                        <td className="py-1.5 px-2 text-gray-300 font-mono">{name}</td>
                        <td className="py-1.5 px-2 text-right text-gray-400">{t.count}</td>
                        <td className="py-1.5 px-2 text-right text-gray-300">{fmtMs(t.p50_ms)}</td>
                        <td className="py-1.5 px-2 text-right text-amber-400">{fmtMs(t.p95_ms)}</td>
                        <td className="py-1.5 px-2 text-right text-gray-300">{fmtMs(t.avg_ms)}</td>
                        <td className="py-1.5 px-2 text-right text-red-400">{fmtMs(t.max_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Logs */}
          <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                <Filter size={16} className="text-amber-400" /> Recent Logs
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 font-normal">{logs.length}</span>
              </h2>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:outline-none"
              >
                <option value="">All levels</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>
            <div className="max-h-[400px] overflow-y-auto space-y-0.5 font-mono text-[11px]">
              {logs.length === 0 ? (
                <p className="text-gray-600 text-center py-4">No log entries yet</p>
              ) : (
                [...logs].reverse().map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 px-2 py-1 rounded hover:bg-gray-800/30">
                    <span className="text-gray-600 whitespace-nowrap">{entry.timestamp?.split("T")[1]?.slice(0, 8) || ""}</span>
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium min-w-[50px] text-center", levelColor(entry.level))}>
                      {entry.level}
                    </span>
                    <span className="text-gray-300 break-all">{entry.event}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function SummaryCard({ icon: Icon, label, value, color, bg }: { icon: any; label: string; value: string | number; color: string; bg: string }) {
  return (
    <div className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-4">
      <div className="flex items-center gap-2.5">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bg)}>
          <Icon size={16} className={color} />
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
          <p className={cn("text-lg font-bold", color)}>{value}</p>
        </div>
      </div>
    </div>
  );
}
