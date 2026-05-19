"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getDeployment, deploymentAction, getDeploymentLogs, getDeploymentHealthCheck } from "@/lib/api";
import {
  Rocket, ArrowLeft, Play, Square, RotateCcw, Loader2,
  CheckCircle2, XCircle, Clock, Terminal, Shield, Activity,
  GitBranch, Globe, Server,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
  pending: { color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", icon: Clock, label: "Pending" },
  building: { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", icon: Loader2, label: "Building" },
  deploying: { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", icon: Loader2, label: "Deploying" },
  running: { color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", icon: CheckCircle2, label: "Running" },
  stopped: { color: "bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-300", icon: Square, label: "Stopped" },
  failed: { color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300", icon: XCircle, label: "Failed" },
};

export default function DeploymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [deployment, setDeployment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [healthCheck, setHealthCheck] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "health">("overview");
  const [actionLoading, setActionLoading] = useState(false);

  const id = Number(params.id);

  useEffect(() => {
    setLoading(true);
    getDeployment(id)
      .then(setDeployment)
      .catch(() => toast.error("Failed to load deployment"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (activeTab === "logs") {
      getDeploymentLogs(id).then((d) => setLogs(d.logs || [])).catch(() => {});
    }
    if (activeTab === "health") {
      getDeploymentHealthCheck(id).then(setHealthCheck).catch(() => {});
    }
  }, [activeTab, id]);

  const handleAction = async (action: string) => {
    setActionLoading(true);
    try {
      await deploymentAction(id, action);
      const d = await getDeployment(id);
      setDeployment(d);
      toast.success(`Action "${action}" executed`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const status = deployment?.status || "pending";
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto animate-page-enter">
          {/* Back button */}
          <button
            onClick={() => router.push("/deployments")}
            className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors mb-6"
          >
            <ArrowLeft size={16} />
            Back to Deployments
          </button>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800/50 skeleton-shimmer" />
              ))}
            </div>
          ) : !deployment ? (
            <div className="text-center py-20 text-gray-500">Deployment not found</div>
          ) : (
            <>
              {/* Header Card */}
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 backdrop-blur-sm p-6 mb-6 card-hover">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                      <Rocket size={28} className="text-white" />
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{deployment.name}</h1>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{deployment.project_name}</p>
                    </div>
                  </div>
                  <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border", cfg.color)}>
                    <StatusIcon size={14} className={cn(status === "building" || status === "deploying" ? "animate-spin" : "")} />
                    {cfg.label}
                  </div>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  {[
                    { icon: Globe, label: "Environment", value: deployment.environment || "production" },
                    { icon: GitBranch, label: "Branch", value: deployment.branch || "main" },
                    { icon: Server, label: "Repository", value: deployment.repository_url ? new URL(deployment.repository_url).pathname.slice(1) : "—" },
                    { icon: Clock, label: "Updated", value: deployment.updated_at ? new Date(deployment.updated_at).toLocaleString() : "—" },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="rounded-xl bg-gray-50 dark:bg-gray-800/30 p-3">
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <Icon size={12} />
                        {label}
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800/50">
                  {status !== "running" && (
                    <button
                      onClick={() => handleAction("deploy")}
                      disabled={actionLoading}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                    >
                      {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      Deploy
                    </button>
                  )}
                  {status === "running" && (
                    <button
                      onClick={() => handleAction("stop")}
                      disabled={actionLoading}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      <Square size={14} />
                      Stop
                    </button>
                  )}
                  <button
                    onClick={() => handleAction("restart")}
                    disabled={actionLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    <RotateCcw size={14} />
                    Restart
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800/50 mb-6">
                {(["overview", "logs", "health"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize",
                      activeTab === tab
                        ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {activeTab === "overview" && (
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 p-5">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                      <Activity size={16} className="text-indigo-500" />
                      Deployment Timeline
                    </h3>
                    <div className="space-y-3">
                      {["Created", "Building", "Deploying", "Running"].map((step, i) => {
                        const stepMap: Record<string, number> = { pending: 0, building: 1, deploying: 2, running: 3, stopped: 3, failed: 1 };
                        const current = stepMap[status] ?? 0;
                        const done = i <= current;
                        return (
                          <div key={step} className="flex items-center gap-3">
                            <div className={cn(
                              "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                              done
                                ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
                                : "bg-gray-100 dark:bg-gray-800 text-gray-400"
                            )}>
                              {done ? "✓" : i + 1}
                            </div>
                            <span className={cn("text-sm", done ? "text-gray-900 dark:text-white font-medium" : "text-gray-400")}>{step}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 p-5">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                      <Shield size={16} className="text-emerald-500" />
                      Configuration
                    </h3>
                    <dl className="space-y-2 text-sm">
                      {Object.entries(deployment.config || { docker: true, auto_restart: true, health_check: true }).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                          <dd className="text-gray-900 dark:text-white font-mono">{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              )}

              {activeTab === "logs" && (
                <div className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-gray-950 p-4 font-mono text-xs text-green-400 max-h-[500px] overflow-y-auto scrollbar-thin">
                  {logs.length === 0 ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Terminal size={14} />
                      No logs available yet
                    </div>
                  ) : (
                    logs.map((line, i) => (
                      <div key={i} className="py-0.5 hover:bg-gray-900/50">
                        <span className="text-gray-600 select-none mr-3">{String(i + 1).padStart(3)}</span>
                        {line}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "health" && (
                <div className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 p-6">
                  {!healthCheck ? (
                    <p className="text-gray-500 text-sm">Loading health data...</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {Object.entries(healthCheck).map(([key, val]) => (
                        <div key={key} className="rounded-xl bg-gray-50 dark:bg-gray-800/30 p-4">
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{key.replace(/_/g, " ")}</p>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{String(val)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
