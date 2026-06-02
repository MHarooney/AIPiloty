"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import AppShell from "@/components/app-shell";
import {
  getDeployments, createDeployment, updateDeployment, deleteDeployment,
  streamDeploymentRun, seedDeployments, getVMs,
} from "@/lib/api";
import {
  Rocket, Plus, Trash2, Loader2, X, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, CircleDot, RefreshCw, Zap, Settings2,
  GitBranch, Package, Server, Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────────────────────

interface Deployment {
  id: number;
  name: string;
  project_name: string;
  environment: string;
  status: string;
  dockerhub_image?: string;
  dockerhub_tag?: string;
  container_name?: string;
  port_mapping?: string;
  branch?: string;
  last_deployed_at?: string;
  webhook_secret?: string;
  vm_credential_id?: number;
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

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending:      "bg-amber-900/30 text-amber-300 border-amber-700/30",
  building:     "bg-blue-900/30 text-blue-300 border-blue-700/30",
  deploying:    "bg-blue-900/30 text-blue-300 border-blue-700/30",
  running:      "bg-emerald-900/30 text-emerald-300 border-emerald-700/30",
  stopped:      "bg-gray-700/30 text-gray-300 border-gray-600/30",
  failed:       "bg-red-900/30 text-red-300 border-red-700/30",
  rolling_back: "bg-orange-900/30 text-orange-300 border-orange-700/30",
};

const ENV_COLORS: Record<string, string> = {
  production:  "text-rose-400",
  staging:     "text-amber-400",
  development: "text-sky-400",
};

const DEFAULT_FORM = {
  name: "", project_name: "", environment: "production",
  branch: "main", dockerfile: "Dockerfile", build_platform: "linux/amd64",
  docker_image: "", dockerhub_image: "", dockerhub_tag: "latest",
  container_name: "", port_mapping: "", docker_network: "",
  docker_run_extra_args: "--restart unless-stopped",
  vm_credential_id: "", repository_url: "",
};

// ── Step icon helper ─────────────────────────────────────────────────────────

function StepIcon({ status }: { status: StepState["status"] }) {
  if (status === "running") return <Loader2 size={14} className="animate-spin text-blue-400" />;
  if (status === "success") return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (status === "failed")  return <XCircle size={14} className="text-red-400" />;
  return <CircleDot size={14} className="text-gray-600" />;
}

// ── Pipeline panel ────────────────────────────────────────────────────────────

function PipelinePanel({ pipeline, onClose }: { pipeline: PipelineState; onClose: () => void }) {
  const logRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  });

  return (
    <div className="mt-3 rounded-xl border border-gray-700/50 bg-gray-900/60 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/40">
        <span className="text-xs font-semibold text-gray-300 tracking-wide">Pipeline</span>
        {pipeline.done && (
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Step list */}
      <div className="divide-y divide-gray-800/50">
        {pipeline.steps.map((step) => {
          const state = pipeline.stepStates[step] ?? { status: "pending", lines: [] };
          const isExpanded = expanded === step;
          return (
            <div key={step}>
              <button
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 transition-colors text-left"
                onClick={() => setExpanded(isExpanded ? null : step)}
              >
                <StepIcon status={state.status} />
                <span className={cn("text-xs flex-1", state.status === "pending" ? "text-gray-500" : "text-gray-200")}>
                  {pipeline.labels[step] ?? step}
                </span>
                {state.lines.length > 0 && (
                  isExpanded ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />
                )}
              </button>
              {isExpanded && state.lines.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="rounded-lg bg-black/50 p-3 max-h-32 overflow-y-auto font-mono text-[10px] text-gray-400 space-y-0.5">
                    {state.lines.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pipeline.error && (
        <div className="px-4 py-3 bg-red-900/20 border-t border-red-800/30 text-xs text-red-300">
          {pipeline.error}
        </div>
      )}
    </div>
  );
}

// ── Deployment card ──────────────────────────────────────────────────────────

function DeploymentCard({
  dep, onDelete, onEdit,
}: {
  dep: Deployment;
  onDelete: (id: number) => void;
  onEdit: (dep: Deployment) => void;
}) {
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleDeploy = useCallback(() => {
    if (pipeline?.active) {
      abortRef.current?.abort();
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const init: PipelineState = { active: true, steps: [], labels: {}, stepStates: {}, done: false };
    setPipeline(init);

    streamDeploymentRun(dep.id, (evt) => {
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
            const prev_step = prev.stepStates[step] ?? { status: "running", lines: [] };
            return {
              ...prev,
              stepStates: { ...prev.stepStates, [step]: { ...prev_step, lines: [...prev_step.lines, evt.data.line] } },
            };
          }
          case "step_done":
            return {
              ...prev,
              stepStates: { ...prev.stepStates, [evt.data.step]: { ...(prev.stepStates[evt.data.step] ?? { lines: [] }), status: evt.data.status } },
            };
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
  }, [dep.id, pipeline]);

  const deploying = pipeline?.active;
  const allSuccess = pipeline?.done && !pipeline?.error && pipeline?.steps.every(
    (s) => (pipeline.stepStates[s]?.status ?? "pending") === "success"
  );
  const anyFailed = pipeline?.done && pipeline?.steps.some(
    (s) => (pipeline.stepStates[s]?.status ?? "pending") === "failed"
  );

  return (
    <div className="rounded-2xl border border-gray-700/50 bg-gray-900/40 backdrop-blur-sm p-5 flex flex-col gap-3 hover:border-gray-600/60 transition-all">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <Link href={`/deployments/${dep.id}`} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-lg bg-indigo-900/30 flex items-center justify-center shrink-0">
            <Rocket size={15} className="text-indigo-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-100 truncate">{dep.name}</p>
            <p className={cn("text-xs font-medium", ENV_COLORS[dep.environment] ?? "text-gray-400")}>
              {dep.environment}
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", STATUS_COLORS[dep.status] ?? STATUS_COLORS.pending)}>
            {dep.status ?? "pending"}
          </span>
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-gray-400">
        {dep.dockerhub_image && (
          <div className="flex items-center gap-1.5 col-span-2 truncate">
            <Package size={11} className="shrink-0 text-gray-500" />
            <span className="truncate font-mono">{dep.dockerhub_image}:{dep.dockerhub_tag ?? "latest"}</span>
          </div>
        )}
        {dep.container_name && (
          <div className="flex items-center gap-1.5">
            <Terminal size={11} className="shrink-0 text-gray-500" />
            <span className="truncate font-mono">{dep.container_name}</span>
          </div>
        )}
        {dep.port_mapping && (
          <div className="flex items-center gap-1.5">
            <Server size={11} className="shrink-0 text-gray-500" />
            <span className="font-mono">{dep.port_mapping}</span>
          </div>
        )}
        {dep.branch && (
          <div className="flex items-center gap-1.5">
            <GitBranch size={11} className="shrink-0 text-gray-500" />
            <span>{dep.branch}</span>
          </div>
        )}
        {dep.last_deployed_at && (
          <div className="col-span-2 text-[10px] text-gray-600">
            Last deployed {new Date(dep.last_deployed_at).toLocaleString()}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={handleDeploy}
          disabled={false}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all",
            deploying
              ? "bg-amber-800/30 text-amber-300 border border-amber-700/30 hover:bg-amber-800/40"
              : allSuccess
                ? "bg-emerald-800/30 text-emerald-300 border border-emerald-700/30 hover:bg-emerald-800/40"
                : anyFailed
                  ? "bg-red-800/30 text-red-300 border border-red-700/30 hover:bg-red-800/40"
                  : "bg-indigo-900/30 text-indigo-300 border border-indigo-700/30 hover:bg-indigo-800/40"
          )}
        >
          {deploying ? (
            <><Loader2 size={13} className="animate-spin" /> Deploying…</>
          ) : allSuccess ? (
            <><CheckCircle2 size={13} /> Deployed</>
          ) : anyFailed ? (
            <><RefreshCw size={13} /> Retry</>
          ) : (
            <><Zap size={13} /> Deploy Now</>
          )}
        </button>
        <button
          onClick={() => onEdit(dep)}
          className="p-2 rounded-lg border border-gray-700/40 text-gray-400 hover:text-gray-200 hover:border-gray-600/60 transition-all"
        >
          <Settings2 size={13} />
        </button>
        <button
          onClick={() => onDelete(dep.id)}
          className="p-2 rounded-lg border border-gray-700/40 text-gray-400 hover:text-red-400 hover:border-red-700/40 transition-all"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Pipeline panel */}
      {pipeline && (
        <PipelinePanel pipeline={pipeline} onClose={() => setPipeline(null)} />
      )}
    </div>
  );
}

// ── Create/Edit modal ─────────────────────────────────────────────────────────

function DeploymentModal({
  initial, vms, onSave, onClose,
}: {
  initial?: Deployment | null;
  vms: any[];
  onSave: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => ({
    ...DEFAULT_FORM,
    ...(initial ? {
      name: initial.name ?? "",
      project_name: initial.project_name ?? "",
      environment: initial.environment ?? "production",
      branch: (initial as any).branch ?? "main",
      dockerfile: (initial as any).dockerfile ?? "Dockerfile",
      build_platform: (initial as any).build_platform ?? "linux/amd64",
      docker_image: (initial as any).docker_image ?? "",
      dockerhub_image: initial.dockerhub_image ?? "",
      dockerhub_tag: initial.dockerhub_tag ?? "latest",
      container_name: initial.container_name ?? "",
      port_mapping: initial.port_mapping ?? "",
      docker_network: (initial as any).docker_network ?? "",
      docker_run_extra_args: (initial as any).docker_run_extra_args ?? "--restart unless-stopped",
      vm_credential_id: String(initial.vm_credential_id ?? ""),
      repository_url: (initial as any).repository_url ?? "",
    } : {}),
  }));
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, vm_credential_id: form.vm_credential_id ? Number(form.vm_credential_id) : null };
      if (initial) await updateDeployment(initial.id, payload);
      else await createDeployment(payload);
      onSave();
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: string, placeholder = "", type = "text") => (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400 font-medium">{label}</label>
      <input
        type={type}
        value={form[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/60"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700/50 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/40">
          <h2 className="text-base font-semibold">{initial ? "Edit Deployment" : "New Deployment"}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 grid grid-cols-2 gap-4">
          {field("Name", "name", "e.g. Demo Production LMS")}
          {field("Project Name", "project_name", "e.g. lms-frontend")}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">Environment</label>
            <select value={form.environment} onChange={(e) => set("environment", e.target.value)}
              className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500/60">
              {["production","staging","development"].map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          {field("Branch", "branch", "main")}
          <div className="col-span-2 border-t border-gray-800 pt-3">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">Docker Configuration</p>
          </div>
          {field("Docker Image (local build tag)", "docker_image", "harooney/docker-vue-lms-demo")}
          {field("DockerHub Image", "dockerhub_image", "harooney/docker-vue-lms-demo")}
          {field("DockerHub Tag", "dockerhub_tag", "latest or lms-vue-app")}
          {field("Container Name", "container_name", "frontend-vue-app-demo")}
          {field("Port Mapping", "port_mapping", "8082:80")}
          {field("Dockerfile", "dockerfile", "Dockerfile")}
          {field("Build Platform", "build_platform", "linux/amd64")}
          {field("Docker Network", "docker_network", "")}
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">Extra Run Args</label>
            <input value={form.docker_run_extra_args} onChange={(e) => set("docker_run_extra_args", e.target.value)}
              placeholder="--restart unless-stopped"
              className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/60" />
          </div>
          <div className="col-span-2 border-t border-gray-800 pt-3">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">Target Server</p>
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">VM / Server</label>
            <select value={form.vm_credential_id} onChange={(e) => set("vm_credential_id", e.target.value)}
              className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500/60">
              <option value="">— None —</option>
              {vms.map((vm: any) => <option key={vm.id} value={vm.id}>{vm.name} ({vm.host_ip})</option>)}
            </select>
          </div>
          <div className="col-span-2 flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-700/50 text-sm text-gray-400 hover:text-gray-200 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {initial ? "Save Changes" : "Create Deployment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [vms, setVMs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Deployment | null>(null);
  const [seeding, setSeeding] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([getDeployments(), getVMs()])
      .then(([deps, vms]) => { setDeployments(deps); setVMs(vms); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this deployment?")) return;
    await deleteDeployment(id);
    refresh();
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const result = await seedDeployments();
      alert(`Created: ${result.created.join(", ") || "none"}\nSkipped: ${result.skipped.join(", ") || "none"}`);
      refresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-900/20 flex items-center justify-center">
                <Rocket size={20} className="text-indigo-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Deployments</h1>
                <p className="text-xs text-gray-500">{deployments.length} configured</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {deployments.length === 0 && (
                <button onClick={handleSeed} disabled={seeding}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-indigo-700/40 bg-indigo-900/20 text-indigo-300 text-sm hover:bg-indigo-900/30 transition-all disabled:opacity-50">
                  {seeding ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  Seed Defaults
                </button>
              )}
              <button onClick={refresh}
                className="p-2 rounded-xl border border-gray-700/40 text-gray-400 hover:text-gray-200 transition-all">
                <RefreshCw size={15} />
              </button>
              <button onClick={() => { setEditTarget(null); setShowModal(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors">
                <Plus size={15} /> New Deployment
              </button>
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-500">
              <Loader2 size={24} className="animate-spin mr-3" /> Loading…
            </div>
          ) : deployments.length === 0 ? (
            <div className="text-center py-20 text-gray-500">
              <Rocket size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No deployments yet. Create one or seed the defaults.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {deployments.map((dep) => (
                <DeploymentCard key={dep.id} dep={dep}
                  onDelete={handleDelete}
                  onEdit={(d) => { setEditTarget(d); setShowModal(true); }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <DeploymentModal
          initial={editTarget}
          vms={vms}
          onSave={() => { setShowModal(false); refresh(); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </AppShell>
  );
}
