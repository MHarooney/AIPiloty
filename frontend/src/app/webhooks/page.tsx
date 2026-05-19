"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/app-shell";
import { getWebhooks, createWebhook, deleteWebhook, testWebhook } from "@/lib/api";
import {
  Globe, Plus, Trash2, Loader2, X, Zap, Send,
  CheckCircle2, XCircle, Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const EVENT_OPTIONS = [
  "deployment.created", "deployment.started", "deployment.completed", "deployment.failed",
  "vm.connected", "vm.disconnected",
  "chat.tool_executed", "chat.error",
  "scheduler.job_completed", "scheduler.job_failed",
];

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", events: [] as string[], secret: "" });
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);

  const refresh = () => {
    setLoading(true);
    getWebhooks().then(setWebhooks).catch(() => toast.error("Failed to load webhooks")).finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.events.length === 0) { toast.error("Select at least one event"); return; }
    setCreating(true);
    try {
      await createWebhook(form);
      toast.success("Webhook created");
      setShowCreate(false);
      setForm({ name: "", url: "", events: [], secret: "" });
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleTest = async (id: number) => {
    setTesting(id);
    try {
      await testWebhook(id);
      toast.success("Webhook test sent");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTesting(null);
    }
  };

  const toggleEvent = (ev: string) => {
    setForm((p) => ({
      ...p,
      events: p.events.includes(ev) ? p.events.filter((e) => e !== ev) : [...p.events, ev],
    }));
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto animate-page-enter">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <Globe size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">Webhooks</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">{webhooks.length} configured</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <Plus size={16} />
              Add Webhook
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800/50 skeleton-shimmer" />)}
            </div>
          ) : webhooks.length === 0 ? (
            <div className="text-center py-20">
              <Zap size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400 mb-2">No webhooks configured</p>
              <p className="text-xs text-gray-400">Get notified when events happen in your platform</p>
            </div>
          ) : (
            <div className="space-y-3">
              {webhooks.map((wh, i) => (
                <div
                  key={wh.id}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 p-5 card-hover animate-data-row-in"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link2 size={14} className="text-indigo-500" />
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{wh.name}</h3>
                        {wh.active !== false && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full">
                            <CheckCircle2 size={8} /> Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1 truncate max-w-md">{wh.url}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(wh.events || []).map((ev: string) => (
                          <span key={ev} className="px-2 py-0.5 rounded-md text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{ev}</span>
                        ))}
                      </div>
                      {wh.last_triggered && (
                        <p className="text-[10px] text-gray-400 mt-2">Last triggered: {new Date(wh.last_triggered).toLocaleString()}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTest(wh.id)}
                        disabled={testing === wh.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                      >
                        {testing === wh.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        Test
                      </button>
                      <button
                        onClick={async () => { await deleteWebhook(wh.id); refresh(); }}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create Webhook Modal */}
          {showCreate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-gray-200 dark:border-gray-800" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Create Webhook</h2>
                  <button onClick={() => setShowCreate(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
                </div>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                    <input
                      type="text" required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="Slack notifications"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">URL</label>
                    <input
                      type="url" required value={form.url} onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="https://hooks.slack.com/services/..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Secret (optional)</label>
                    <input
                      type="password" value={form.secret} onChange={(e) => setForm((p) => ({ ...p, secret: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="HMAC signing secret"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Events</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {EVENT_OPTIONS.map((ev) => (
                        <button
                          key={ev} type="button"
                          onClick={() => toggleEvent(ev)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs text-left transition-colors border",
                            form.events.includes(ev)
                              ? "border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400"
                              : "border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300 dark:hover:border-gray-600"
                          )}
                        >
                          {ev}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="submit" disabled={creating}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {creating ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
                    Create Webhook
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
