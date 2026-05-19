"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/app-shell";
import { getSchedulerJobs, createSchedulerJob, deleteSchedulerJob, toggleSchedulerJob } from "@/lib/api";
import {
  Clock, Plus, Trash2, Loader2, X, Play, Pause,
  Timer, Terminal, CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function SchedulerPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", cron: "", command: "" });
  const [creating, setCreating] = useState(false);

  const refresh = () => {
    setLoading(true);
    getSchedulerJobs().then(setJobs).catch(() => toast.error("Failed to load jobs")).finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await createSchedulerJob({ name: form.name, cron: form.cron, command: form.command, enabled: true });
      toast.success("Job created");
      setShowCreate(false);
      setForm({ name: "", cron: "", command: "" });
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await toggleSchedulerJob(id, !enabled);
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, enabled: !enabled } : j)));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSchedulerJob(id);
      toast.success("Job deleted");
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const cronPresets = [
    { label: "Every minute", value: "* * * * *" },
    { label: "Every 5 min", value: "*/5 * * * *" },
    { label: "Every hour", value: "0 * * * *" },
    { label: "Daily midnight", value: "0 0 * * *" },
    { label: "Weekly Sunday", value: "0 0 * * 0" },
  ];

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto animate-page-enter">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <CalendarClock size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">Job Scheduler</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">{jobs.length} scheduled jobs</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <Plus size={16} />
              New Job
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-gray-100 dark:bg-gray-800/50 skeleton-shimmer" />)}
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-20">
              <Clock size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400 mb-2">No scheduled jobs yet</p>
              <button
                onClick={() => setShowCreate(true)}
                className="text-sm text-indigo-500 hover:text-indigo-600"
              >
                Create your first job →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job, i) => (
                <div
                  key={job.id}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-2xl border transition-all card-hover animate-data-row-in",
                    job.enabled
                      ? "border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40"
                      : "border-gray-200 dark:border-gray-800/50 bg-gray-50 dark:bg-gray-900/20 opacity-60"
                  )}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center",
                    job.enabled ? "bg-amber-100 dark:bg-amber-900/20" : "bg-gray-100 dark:bg-gray-800"
                  )}>
                    <Timer size={18} className={job.enabled ? "text-amber-600 dark:text-amber-400" : "text-gray-400"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{job.name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="font-mono text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded-md">{job.cron}</span>
                      <span className="flex items-center gap-1 text-xs text-gray-500"><Terminal size={10} /> {job.command}</span>
                    </div>
                    {job.last_run && (
                      <p className="text-[10px] text-gray-400 mt-1">Last run: {new Date(job.last_run).toLocaleString()}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggle(job.id, job.enabled)}
                      className={cn(
                        "p-2 rounded-xl transition-colors",
                        job.enabled
                          ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                          : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      )}
                      title={job.enabled ? "Pause" : "Resume"}
                    >
                      {job.enabled ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      onClick={() => handleDelete(job.id)}
                      className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Job Modal */}
          {showCreate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-800" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Create Scheduled Job</h2>
                  <button onClick={() => setShowCreate(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
                </div>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Job Name</label>
                    <input
                      type="text" required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="Database backup"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Cron Expression</label>
                    <input
                      type="text" required value={form.cron} onChange={(e) => setForm((p) => ({ ...p, cron: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="0 */6 * * *"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {cronPresets.map((p) => (
                        <button
                          key={p.value} type="button"
                          onClick={() => setForm((f) => ({ ...f, cron: p.value }))}
                          className="px-2 py-0.5 rounded-md text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Command</label>
                    <input
                      type="text" required value={form.command} onChange={(e) => setForm((p) => ({ ...p, command: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="pg_dump mydb > /backups/db.sql"
                    />
                  </div>
                  <button
                    type="submit" disabled={creating}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {creating ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
                    Create Job
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
