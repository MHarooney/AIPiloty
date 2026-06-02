"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getHealth, getDeployments, getVMs } from "@/lib/api";
import {
  LayoutDashboard, Activity, Server, Rocket, Brain,
  CheckCircle, XCircle, Cpu, HardDrive, ArrowRight, Plus, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

function SkeletonCard() {
  return (
    <div className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-800" />
        <div className="space-y-2 flex-1">
          <div className="h-2 w-20 bg-gray-800 rounded" />
          <div className="h-4 w-12 bg-gray-700 rounded" />
        </div>
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3 animate-pulse">
      <div className="h-4 w-32 bg-gray-800 rounded" />
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-8 bg-gray-800/60 rounded-lg" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<{ health: any; deployments: any[]; vms: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    Promise.all([getHealth(), getDeployments(), getVMs()])
      .then(([health, deployments, vms]) => setData({ health, deployments, vms }))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-800 animate-pulse" />
              <div className="space-y-1.5">
                <div className="h-4 w-28 bg-gray-800 rounded animate-pulse" />
                <div className="h-3 w-44 bg-gray-800/60 rounded animate-pulse" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SkeletonList />
              <SkeletonList />
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const running = data?.deployments.filter((d) => d.status === "running").length || 0;
  const failed = data?.deployments.filter((d) => d.status === "failed").length || 0;
  const activeVMs = data?.vms.filter((v) => v.is_active).length || 0;

  const stats = [
    { label: "LLM Status", value: data?.health?.ollama_connected ? "Online" : "Offline", icon: Brain, color: data?.health?.ollama_connected ? "text-emerald-400" : "text-red-400", bg: data?.health?.ollama_connected ? "bg-emerald-900/20" : "bg-red-900/20" },
    { label: "Deployments", value: data?.deployments.length || 0, icon: Rocket, color: "text-indigo-400", bg: "bg-indigo-900/20" },
    { label: "Running", value: running, icon: Activity, color: "text-emerald-400", bg: "bg-emerald-900/20" },
    { label: "Active VMs", value: activeVMs, icon: Server, color: "text-purple-400", bg: "bg-purple-900/20" },
  ];

  // Recent activity: last 5 deployments sorted by updated_at
  const recentActivity = [...(data?.deployments || [])]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  const quickActions = [
    { label: "New Deployment", icon: Rocket, href: "/deployments", color: "text-indigo-400" },
    { label: "New Chat", icon: MessageSquare, href: "/", color: "text-purple-400" },
    { label: "Add VM", icon: Server, href: "/vms", color: "text-emerald-400" },
    { label: "Doc Studio", icon: Plus, href: "/doc-studio", color: "text-amber-400" },
  ];

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-900/20 flex items-center justify-center">
              <LayoutDashboard size={20} className="text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-100">Dashboard</h1>
              <p className="text-xs text-gray-500">System overview & health monitoring</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickActions.map((qa) => (
              <button
                key={qa.label}
                onClick={() => router.push(qa.href)}
                className="flex items-center gap-2.5 px-4 py-3 bg-gray-900/80 border border-gray-800/50 rounded-xl hover:border-gray-700/60 hover:bg-gray-800/60 transition-all text-sm text-gray-300 hover:text-gray-100"
              >
                <qa.icon size={16} className={qa.color} />
                {qa.label}
              </button>
            ))}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((s) => (
              <div key={s.label} className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 hover:border-gray-700/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", s.bg)}>
                    <s.icon size={20} className={s.color} />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</p>
                    <p className={cn("text-lg font-bold", s.color)}>{s.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Getting started nudge */}
            {!data?.deployments.length && !data?.vms.length && (
              <div className="lg:col-span-2 bg-gradient-to-r from-indigo-900/20 to-purple-900/20 border border-indigo-800/30 rounded-xl p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                  <Rocket size={20} className="text-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-200">Get started</p>
                  <p className="text-xs text-gray-500">Create your first deployment or add a VM to start managing infrastructure.</p>
                </div>
                <a href="/deployments" className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 whitespace-nowrap">
                  Deployments <ArrowRight size={12} />
                </a>
              </div>
            )}

            {/* System health */}
            <div className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <h2 className="font-semibold text-gray-200 flex items-center gap-2">
                <Cpu size={16} className="text-indigo-400" />
                System Health
              </h2>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">API</span>
                  <span className="flex items-center gap-1.5 text-emerald-400 text-xs">
                    <CheckCircle size={13} /> Healthy
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Ollama</span>
                  <span className={cn("flex items-center gap-1.5 text-xs", data?.health?.ollama_connected ? "text-emerald-400" : "text-red-400")}>
                    {data?.health?.ollama_connected ? <CheckCircle size={13} /> : <XCircle size={13} />}
                    {data?.health?.ollama_connected ? "Connected" : "Disconnected"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Model</span>
                  <span className="text-gray-300 text-xs font-mono">{data?.health?.model || "N/A"}</span>
                </div>
              </div>
            </div>

            {/* Alerts */}
            <div className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <h2 className="font-semibold text-gray-200 flex items-center gap-2">
                <HardDrive size={16} className="text-amber-400" />
                Alerts ({failed})
              </h2>
              {failed > 0 ? (
                <div className="space-y-2">
                  {data?.deployments.filter((d) => d.status === "failed").map((d) => (
                    <div key={d.id} className="flex items-center gap-2 text-sm p-2.5 bg-red-900/10 rounded-lg border border-red-900/20">
                      <XCircle size={14} className="text-red-400 flex-shrink-0" />
                      <span className="text-red-300 truncate">{d.name}</span>
                      <span className="text-red-400/60 text-xs ml-auto truncate max-w-[180px]">{d.error_message || "Failed"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 flex items-center gap-2">
                  <CheckCircle size={14} className="text-emerald-500" />
                  All systems operational
                </p>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          {recentActivity.length > 0 && (
            <div className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <h2 className="font-semibold text-gray-200 flex items-center gap-2">
                <Activity size={16} className="text-indigo-400" />
                Recent Activity
              </h2>
              <div className="space-y-1.5">
                {recentActivity.map((d) => {
                  const statusColor = {
                    running: "text-emerald-400",
                    failed: "text-red-400",
                    stopped: "text-gray-400",
                    pending: "text-amber-400",
                    building: "text-indigo-400",
                    deploying: "text-indigo-400",
                  }[d.status as string] ?? "text-gray-400";
                  return (
                    <div key={d.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-800/40 last:border-0">
                      <Rocket size={13} className="text-indigo-400/60 shrink-0" />
                      <span className="text-gray-300 truncate flex-1">{d.name}</span>
                      <span className={cn("text-xs font-mono shrink-0", statusColor)}>{d.status}</span>
                      <span className="text-gray-600 text-xs shrink-0 hidden sm:block">
                        {d.updated_at ? new Date(d.updated_at).toLocaleDateString() : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => router.push("/deployments")}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
              >
                View all deployments <ArrowRight size={11} />
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
