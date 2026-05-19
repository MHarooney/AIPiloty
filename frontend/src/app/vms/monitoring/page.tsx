"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/app-shell";
import { getVMs, getVMMonitoring, testVMConnection } from "@/lib/api";
import {
  Server, Cpu, HardDrive, MemoryStick, Clock, Wifi, WifiOff,
  RefreshCw, Loader2, Activity, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function ProgressRing({ value, color, size = 80 }: { value: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={6} fill="none" className="text-gray-200 dark:text-gray-800" />
      <circle
        cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={6} fill="none"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
      <text
        x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        className="fill-gray-900 dark:fill-white text-sm font-bold" transform={`rotate(90, ${size / 2}, ${size / 2})`}
      >
        {value}%
      </text>
    </svg>
  );
}

export default function VMMonitoringPage() {
  const [vms, setVMs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVM, setSelectedVM] = useState<number | null>(null);
  const [monitoring, setMonitoring] = useState<any>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Record<number, { ok: boolean; latency: number }>>({});

  useEffect(() => {
    setLoading(true);
    getVMs().then(setVMs).catch(() => toast.error("Failed to load VMs")).finally(() => setLoading(false));
  }, []);

  const loadMonitoring = useCallback(async (vmId: number) => {
    setSelectedVM(vmId);
    setMonitoringLoading(true);
    try {
      const data = await getVMMonitoring(vmId);
      setMonitoring(data);
    } catch {
      setMonitoring(null);
      toast.error("Could not fetch monitoring data — VM may be unreachable");
    } finally {
      setMonitoringLoading(false);
    }
  }, []);

  const handleTest = async (vmId: number) => {
    setTesting(vmId);
    try {
      const res = await testVMConnection(vmId);
      setConnectionStatus((p) => ({ ...p, [vmId]: { ok: res.success, latency: res.latency_ms } }));
      toast.success(res.message || "Connection successful");
    } catch (e: any) {
      setConnectionStatus((p) => ({ ...p, [vmId]: { ok: false, latency: 0 } }));
      toast.error(e.message);
    } finally {
      setTesting(null);
    }
  };

  const cpuColor = (monitoring?.cpu_percent ?? 0) > 80 ? "#ef4444" : (monitoring?.cpu_percent ?? 0) > 50 ? "#f59e0b" : "#22c55e";
  const memColor = (monitoring?.memory_percent ?? 0) > 80 ? "#ef4444" : (monitoring?.memory_percent ?? 0) > 50 ? "#f59e0b" : "#6366f1";
  const diskColor = (monitoring?.disk_percent ?? 0) > 90 ? "#ef4444" : (monitoring?.disk_percent ?? 0) > 70 ? "#f59e0b" : "#8b5cf6";

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto animate-page-enter">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Activity size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">VM Monitoring</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">{vms.length} virtual machines</p>
            </div>
          </div>

          {loading ? (
            <div className="grid md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-2xl bg-gray-100 dark:bg-gray-800/50 skeleton-shimmer" />)}
            </div>
          ) : vms.length === 0 ? (
            <div className="text-center py-20">
              <Server size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400">No VMs registered. Add one from the VMs page.</p>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-6">
              {/* VM List */}
              <div className="lg:col-span-1 space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Select VM</h2>
                {vms.map((vm) => {
                  const conn = connectionStatus[vm.id];
                  return (
                    <button
                      key={vm.id}
                      onClick={() => loadMonitoring(vm.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-4 rounded-2xl border text-left transition-all card-hover",
                        selectedVM === vm.id
                          ? "border-indigo-300 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-900/10 shadow-sm"
                          : "border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 hover:border-gray-300 dark:hover:border-gray-700"
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center",
                        conn?.ok ? "bg-emerald-100 dark:bg-emerald-900/20" : "bg-gray-100 dark:bg-gray-800"
                      )}>
                        <Server size={18} className={conn?.ok ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{vm.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{vm.host_ip}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTest(vm.id); }}
                          disabled={testing === vm.id}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          {testing === vm.id ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                        </button>
                        <ChevronRight size={14} className="text-gray-300 dark:text-gray-600" />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Monitoring Dashboard */}
              <div className="lg:col-span-2">
                {!selectedVM ? (
                  <div className="flex items-center justify-center h-64 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <p className="text-gray-400 dark:text-gray-500">Select a VM to view monitoring data</p>
                  </div>
                ) : monitoringLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <Loader2 className="animate-spin text-indigo-500" size={32} />
                  </div>
                ) : !monitoring ? (
                  <div className="flex flex-col items-center justify-center h-64 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <WifiOff size={32} className="text-gray-400 mb-2" />
                    <p className="text-gray-500">Unable to fetch monitoring data</p>
                    <button
                      onClick={() => loadMonitoring(selectedVM!)}
                      className="mt-3 flex items-center gap-2 text-sm text-indigo-500 hover:text-indigo-600"
                    >
                      <RefreshCw size={14} /> Retry
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Gauges */}
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { label: "CPU", value: monitoring.cpu_percent, color: cpuColor, icon: Cpu },
                        { label: "Memory", value: monitoring.memory_percent, color: memColor, icon: MemoryStick },
                        { label: "Disk", value: monitoring.disk_percent, color: diskColor, icon: HardDrive },
                      ].map(({ label, value, color, icon: Icon }) => (
                        <div key={label} className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 p-5 flex flex-col items-center card-hover">
                          <ProgressRing value={Math.round(value || 0)} color={color} />
                          <div className="flex items-center gap-1.5 mt-3 text-sm font-medium text-gray-900 dark:text-white">
                            <Icon size={14} className="text-gray-400" />
                            {label}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Details */}
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 p-5">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Memory</h3>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{monitoring.memory_used_mb || 0} MB</p>
                        <p className="text-xs text-gray-500">of {monitoring.memory_total_mb || 0} MB total</p>
                        <div className="mt-3 w-full h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${monitoring.memory_percent}%`, background: memColor }} />
                        </div>
                      </div>
                      <div className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 p-5">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Disk</h3>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{monitoring.disk_used_gb || 0} GB</p>
                        <p className="text-xs text-gray-500">of {monitoring.disk_total_gb || 0} GB total</p>
                        <div className="mt-3 w-full h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${monitoring.disk_percent}%`, background: diskColor }} />
                        </div>
                      </div>
                    </div>

                    {/* System info */}
                    <div className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 p-5">
                      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">System</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Clock size={14} className="text-gray-400" />
                          <span className="text-gray-500">Uptime:</span>
                          <span className="font-medium text-gray-900 dark:text-white">{monitoring.uptime || "—"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Activity size={14} className="text-gray-400" />
                          <span className="text-gray-500">Load:</span>
                          <span className="font-medium text-gray-900 dark:text-white">{monitoring.load_avg || "—"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
