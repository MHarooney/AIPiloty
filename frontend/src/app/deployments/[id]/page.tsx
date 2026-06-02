"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import {
  getDeployment, getDeploymentRuns, getDeploymentRun, streamDeploymentRun,
} from "@/lib/api";
import {
  Rocket, ArrowLeft, Loader2, CheckCircle2, XCircle, CircleDot,
  ChevronDown, ChevronRight, RefreshCw, Zap, Package, Terminal,
  Server, GitBranch, Clock, X, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface Run {
  id: number;
  trigger: string;
  triggered_by: string;
  status: string;
  started_at: string;
  completed_at?: string;
  duration_seconds?: number;
  log?: string;
}

interface StepState {
  status: "pending" | "running" | "success" | "failed";
  lines: string[];
}

interface PipelineState {
  active: boolean;
  steps: string[];
  labels: Record<string, string>;
  stepStates: Record<string, StepState>;
  error?: string;
  done: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  success: "bg-emerald-900/30 text-emerald-300 border-emerald-700/30",
  failed:  "bg-red-900/30 text-red-300 border-red-700/30",
  running: "bg-blue-900/30 text-blue-300 border-blue-700/30",
  pending: "bg-amber-900/30 text-amber-300 border-amber-700/30",
  cancelled: "bg-gray-700/30 text-gray-300 border-gray-600/30",
};

// ── Step icon ────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: StepState["status"] }) {
  if (status === "running") return <Loader2 size={13} className="animate-spin text-blue-400" />;
  if (status === "success") return <CheckCircle2 size={13} className="text-emerald-400" />;
  if (status === "failed")  return <XCircle size={13} className="text-red-400" />;
  return <CircleDot size={13} className="text-gray-600" />;
}

// ── Pipeline panel ────────────────────────────────────────────────────────────

function PipelinePanel({ pipeline, onClose }: { pipeline: PipelineState; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/60 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/40">
        <span className="text-sm font-semibold text-gray-200">Live Pipeline</span>
        {pipeline.done && (
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="divide-y divide-gray-800/50">
        {pipeline.steps.map((step) => {
          const state = pipeline.stepStates[step] ?? { status: "pending", lines: [] };
          const isExp = expanded === step;
          return (
            <div key={step}>
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 transition-colors text-left"
                onClick={() => setExpanded(isExp ? null : step)}
              >
                <StepIcon status={state.status} />
                <span className={cn("text-sm flex-1", state.status === "pending" ? "text-gray-500" : "text-gray-200")}>
                  {pipeline.labels[step] ?? step}
                </span>
                {state.lines.length > 0 && (
                  isExp ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />
                )}
              </button>
              {isExp && state.lines.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="rounded-lg bg-black/60 p-3 max-h-40 overflow-y-auto font-mono text-[10px] text-gray-400 space-y-0.5">
                    {state.lines.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {pipeline.error && (
        <div className="px-4 py-3 bg-red-900/20 border-t border-red-800/30 text-sm text-red-300">
          {pipeline.error}
        </div>
      )}
    </div>
  );
}

// ── Run log modal ─────────────────────────────────────────────────────────────

function RunLogModal({ depId, runId, onClose }: { depId: number; runId: number; onClose: () => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getDeploymentRun(depId, runId).then(setRun).finally(() => setLoading(false));
  }, [depId, runId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-gray-700/50 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/40 shrink-0">
          <div>
            <p className="text-sm font-semibold">Run #{runId}</p>
            {run && <p className="text-xs text-gray-500 mt-0.5">{run.trigger} · {run.triggered_by}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-gray-300 bg-black/50 rounded-b-2xl">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-gray-500 mx-auto mt-8" />
          ) : run?.log ? (
            run.log.split("\n").map((line, i) => <div key={i} className="py-0.5">{line}</div>)
          ) : (
            <p className="text-gray-600 text-center mt-8">No log recorded</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DeploymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);

  const [deployment, setDeployment] = useState<any>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [viewRunId, setViewRunId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([getDeployment(id), getDeploymentRuns(id)])
      .then(([dep, rs]) => { setDeployment(dep); setRuns(rs); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDeploy = useCallback(() => {
    if (pipeline?.active) { abortRef.current?.abort(); return; }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const init: PipelineState = { active: true, steps: [], labels: {}, stepStates: {}, done: false };
    setPipeline(init);

    streamDeploymentRun(id, (evt) => {
      setPipeline((prev) => {
        if (!prev) return prev;
        switch (evt.type) {
          case "pipeline_start":
            return {
              ...prev,
              steps: evt.data.steps ?? [],
              labels: evt.data.labels ?? {},
              stepStates: Object.fromEntries((evt.data.steps ?? []).map((s: string) => [s, { status: "pending", lines: [] }])),
            };
          case "step_start":
            return { ...prev, stepStates: { ...prev.stepStates, [evt.data.step]: { status: "running", lines: [] } } };
          case "log": {
            const step = evt.data.step;
            const pstep = prev.stepStates[step] ?? { status: "running", lines: [] };
            return { ...prev, stepStates: { ...prev.stepStates, [step]: { ...pstep, lines: [...pstep.lines, evt.data.line] } } };
          }
          case "step_done":
            return { ...prev, stepStates: { ...prev.stepStates, [evt.data.step]: { ...(prev.stepStates[evt.data.step] ?? { lines: [] }), status: evt.data.status } } };
          case "pipeline_done":
            return { ...prev, active: false, done: true };
          case "error":
            return { ...prev, active: false, done: true, error: evt.data?.error ?? evt.data?.message };
          case "done":
            return { ...prev, active: false, done: true };
          default:
            return prev;
        }
      });
    }, ctrl.signal);
  }, [id, pipeline]);

  // Refresh runs after pipeline finishes
  useEffect(() => {
    if (pipeline?.done) {
      setTimeout(() => getDeploymentRuns(id).then(setRuns), 1500);
    }
  }, [pipeline?.done, id]);

  const deploying = pipeline?.active;

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto animate-fade-in space-y-6">
          {/* Back */}
          <button
            onClick={() => router.push("/deployments")}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-400 transition-colors"
          >
            <ArrowLeft size={15} /> Back to Deployments
          </button>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-500">
              <Loader2 size={24} className="animate-spin mr-3" /> Loading…
            </div>
          ) : !deployment ? (
            <p className="text-center text-gray-500 py-20">Deployment not found</p>
          ) : (
            <>
              {/* Header */}
              <div className="rounded-2xl border border-gray-700/50 bg-gray-900/40 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-900/30 flex items-center justify-center">
                      <Rocket size={22} className="text-indigo-400" />
                    </div>
                    <div>
                      <h1 className="text-xl font-bold">{deployment.name}</h1>
                      <p className="text-sm text-gray-400">{deployment.project_name} · {deployment.environment}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={refresh} className="p-2 rounded-lg border border-gray-700/40 text-gray-400 hover:text-gray-200 transition-all">
                      <RefreshCw size={14} />
                    </button>
                    <button
                      onClick={handleDeploy}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
                        deploying
                          ? "bg-amber-800/30 text-amber-300 border border-amber-700/30"
                          : "bg-indigo-600 hover:bg-indigo-500 text-white"
                      )}
                    >
                      {deploying ? <><Loader2 size={13} className="animate-spin" /> Deploying…</> : <><Zap size={13} /> Deploy Now</>}
                    </button>
                  </div>
                </div>

                {/* Config grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
                  {deployment.dockerhub_image && (
                    <div className="rounded-xl bg-gray-800/30 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><Package size={11} /> DockerHub Image</div>
                      <p className="text-sm font-mono text-gray-200 truncate">{deployment.dockerhub_image}:{deployment.dockerhub_tag ?? "latest"}</p>
                    </div>
                  )}
                  {deployment.container_name && (
                    <div className="rounded-xl bg-gray-800/30 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><Terminal size={11} /> Container</div>
                      <p className="text-sm font-mono text-gray-200">{deployment.container_name}</p>
                    </div>
                  )}
                  {deployment.port_mapping && (
                    <div className="rounded-xl bg-gray-800/30 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><Server size={11} /> Ports</div>
                      <p className="text-sm font-mono text-gray-200">{deployment.port_mapping}</p>
                    </div>
                  )}
                  {deployment.branch && (
                    <div className="rounded-xl bg-gray-800/30 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><GitBranch size={11} /> Branch</div>
                      <p className="text-sm text-gray-200">{deployment.branch}</p>
                    </div>
                  )}
                  {deployment.last_deployed_at && (
                    <div className="rounded-xl bg-gray-800/30 p-3 md:col-span-2">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><Clock size={11} /> Last Deployed</div>
                      <p className="text-sm text-gray-200">{new Date(deployment.last_deployed_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Live pipeline */}
              {pipeline && (
                <PipelinePanel pipeline={pipeline} onClose={() => setPipeline(null)} />
              )}

              {/* Run history */}
              <div className="rounded-2xl border border-gray-700/50 bg-gray-900/40 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-700/40">
                  <h2 className="text-sm font-semibold text-gray-200">Run History</h2>
                </div>
                {runs.length === 0 ? (
                  <p className="text-center text-gray-600 text-sm py-8">No runs yet — click Deploy Now to start</p>
                ) : (
                  <div className="divide-y divide-gray-800/50">
                    {runs.map((run) => (
                      <div key={run.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-800/30 transition-colors">
                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0", STATUS_COLORS[run.status] ?? STATUS_COLORS.pending)}>
                          {run.status}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-200">Run #{run.id}</p>
                          <p className="text-xs text-gray-500">{run.trigger} · {run.triggered_by} · {new Date(run.started_at).toLocaleString()}</p>
                        </div>
                        {run.duration_seconds != null && (
                          <span className="text-xs text-gray-500 shrink-0">{run.duration_seconds.toFixed(1)}s</span>
                        )}
                        <button
                          onClick={() => setViewRunId(run.id)}
                          className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-700/40 transition-all"
                        >
                          <Eye size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {viewRunId != null && (
        <RunLogModal depId={id} runId={viewRunId} onClose={() => setViewRunId(null)} />
      )}
    </AppShell>
  );
}
