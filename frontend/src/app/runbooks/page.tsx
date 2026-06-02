"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/app-shell";
import { getRunbooks, createRunbook, deleteRunbook, executeRunbook, getVMs } from "@/lib/api";
import {
  FileText, Plus, Trash2, Loader2, X, Play, CheckCircle2,
  Terminal, ChevronDown, ChevronUp, GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function RunbooksPage() {
  const [runbooks, setRunbooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [vms, setVMs] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [executing, setExecuting] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "", steps: [{ command: "", description: "" }] });
  const [creating, setCreating] = useState(false);

  const refresh = () => {
    setLoading(true);
    Promise.all([getRunbooks(), getVMs()])
      .then(([rb, v]) => { setRunbooks(rb); setVMs(v); })
      .catch(() => toast.error("Failed to load data"))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const addStep = () => setForm((p) => ({ ...p, steps: [...p.steps, { command: "", description: "" }] }));
  const removeStep = (i: number) => setForm((p) => ({ ...p, steps: p.steps.filter((_, idx) => idx !== i) }));
  const updateStep = (i: number, field: string, value: string) => {
    setForm((p) => ({
      ...p,
      steps: p.steps.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)),
    }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const validSteps = form.steps.filter((s) => s.command.trim());
    if (validSteps.length === 0) { toast.error("Add at least one step"); return; }
    setCreating(true);
    try {
      await createRunbook({ name: form.name, description: form.description, steps: validSteps });
      toast.success("Runbook created");
      setShowCreate(false);
      setForm({ name: "", description: "", steps: [{ command: "", description: "" }] });
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleExecute = async (id: number, vmId?: number) => {
    setExecuting(id);
    try {
      const result = await executeRunbook(id, vmId);
      toast.success(result.message || "Runbook executed");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setExecuting(null);
    }
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto animate-page-enter">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
                <FileText size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">Runbooks</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">{runbooks.length} automation scripts</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <Plus size={16} />
              New Runbook
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-gray-100 dark:bg-gray-800/50 skeleton-shimmer" />)}
            </div>
          ) : runbooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500/20 to-pink-600/20 border border-rose-500/20 flex items-center justify-center mb-4">
                <FileText size={28} className="text-rose-400" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">No runbooks yet</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">
                Create reusable automation scripts to run SSH commands across your VMs with one click.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-500/20"
              >
                <Plus size={16} />
                Create your first runbook
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {runbooks.map((rb, i) => (
                <div
                  key={rb.id}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 overflow-hidden card-hover animate-data-row-in"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex items-center justify-between p-5">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{rb.name}</h3>
                      {rb.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rb.description}</p>}
                      <p className="text-[10px] text-gray-400 mt-1">{rb.steps?.length || 0} steps</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs"
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) handleExecute(rb.id, Number(e.target.value)); }}
                      >
                        <option value="" disabled>Run on VM...</option>
                        {vms.map((vm) => <option key={vm.id} value={vm.id}>{vm.name}</option>)}
                      </select>
                      <button
                        onClick={() => handleExecute(rb.id)}
                        disabled={executing === rb.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        {executing === rb.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                        Run
                      </button>
                      <button
                        onClick={() => setExpanded(expanded === rb.id ? null : rb.id)}
                        className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      >
                        {expanded === rb.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <button
                        onClick={async () => { await deleteRunbook(rb.id); refresh(); }}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Steps */}
                  {expanded === rb.id && rb.steps && (
                    <div className="border-t border-gray-100 dark:border-gray-800/50 p-4 bg-gray-50/50 dark:bg-gray-950/30">
                      <div className="space-y-2">
                        {rb.steps.map((step: any, idx: number) => (
                          <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800/30">
                            <span className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {idx + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-mono text-gray-900 dark:text-white">{step.command}</p>
                              {step.description && <p className="text-[10px] text-gray-500 mt-0.5">{step.description}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Create Runbook Modal */}
          {showCreate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-gray-200 dark:border-gray-800 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Create Runbook</h2>
                  <button onClick={() => setShowCreate(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
                </div>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                    <input
                      type="text" required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="Server setup"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description</label>
                    <input
                      type="text" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="Initial server provisioning steps"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Steps</label>
                      <button type="button" onClick={addStep} className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1"><Plus size={12} /> Add step</button>
                    </div>
                    <div className="space-y-2">
                      {form.steps.map((step, i) => (
                        <div key={i} className="flex items-start gap-2 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <span className="text-xs text-gray-400 mt-2 font-bold">{i + 1}</span>
                          <div className="flex-1 space-y-2">
                            <input
                              type="text" placeholder="Command" value={step.command}
                              onChange={(e) => updateStep(i, "command", e.target.value)}
                              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                            <input
                              type="text" placeholder="Description (optional)" value={step.description}
                              onChange={(e) => updateStep(i, "description", e.target.value)}
                              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                          </div>
                          {form.steps.length > 1 && (
                            <button type="button" onClick={() => removeStep(i)} className="p-1 text-gray-400 hover:text-red-500 mt-1"><X size={14} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    type="submit" disabled={creating}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {creating ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                    Create Runbook
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
