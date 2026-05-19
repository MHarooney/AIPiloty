"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/app-shell";
import { getDeployments, createDeployment, deploymentAction, deleteDeployment } from "@/lib/api";
import { Rocket, Plus, Play, Square, Trash2, RotateCcw, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-900/30 text-amber-300 border-amber-700/30",
  building: "bg-blue-900/30 text-blue-300 border-blue-700/30",
  deploying: "bg-blue-900/30 text-blue-300 border-blue-700/30",
  running: "bg-emerald-900/30 text-emerald-300 border-emerald-700/30",
  stopped: "bg-gray-700/30 text-gray-300 border-gray-600/30",
  failed: "bg-red-900/30 text-red-300 border-red-700/30",
  rolling_back: "bg-orange-900/30 text-orange-300 border-orange-700/30",
};

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", project_name: "", environment: "production", repository_url: "", branch: "main" });

  const refresh = () => {
    setLoading(true);
    getDeployments().then(setDeployments).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createDeployment(form);
    setShowForm(false);
    setForm({ name: "", project_name: "", environment: "production", repository_url: "", branch: "main" });
    refresh();
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-900/20 flex items-center justify-center">
                <Rocket size={20} className="text-indigo-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Deployments</h1>
                <p className="text-xs text-gray-500">{deployments.length} total</p>
              </div>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-indigo-500/10"
            >
              {showForm ? <X size={16} /> : <Plus size={16} />}
              {showForm ? "Cancel" : "New Deployment"}
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleCreate} className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-6 mb-6 space-y-4 animate-slide-up">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(["name", "project_name", "repository_url", "branch", "environment"] as const).map((field) => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 capitalize">{field.replace("_", " ")}</label>
                    <input
                      value={(form as any)[field]}
                      onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                      className="w-full bg-gray-800/80 border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                      required={field === "name" || field === "project_name"}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <button type="submit" className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-sm font-medium transition-colors">
                  Create Deployment
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-gray-500" size={32} />
            </div>
          ) : deployments.length === 0 ? (
            <div className="text-center py-20 text-gray-500 animate-fade-in">
              <Rocket size={40} className="mx-auto mb-3 opacity-30" />
              <p>No deployments yet</p>
              <p className="text-xs mt-1">Create one to get started</p>
            </div>
          ) : (
            <div className="bg-gray-900/80 border border-gray-800/50 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/50 text-gray-500 text-left text-xs">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Project</th>
                    <th className="px-4 py-3 font-medium">Env</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((d) => (
                    <tr key={d.id} className="border-b border-gray-800/30 hover:bg-gray-800/20 transition-colors">
                      <td className="px-4 py-3 font-medium">{d.name}</td>
                      <td className="px-4 py-3 text-gray-400">{d.project_name}</td>
                      <td className="px-4 py-3 text-gray-400">{d.environment}</td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border", STATUS_COLORS[d.status] || "bg-gray-700 text-gray-300")}>
                          {d.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {d.status === "stopped" && (
                            <button onClick={() => { deploymentAction(d.id, "start"); refresh(); }} className="p-1.5 rounded-lg hover:bg-gray-700 text-emerald-400" title="Start"><Play size={14} /></button>
                          )}
                          {d.status === "running" && (
                            <button onClick={() => { deploymentAction(d.id, "stop"); refresh(); }} className="p-1.5 rounded-lg hover:bg-gray-700 text-amber-400" title="Stop"><Square size={14} /></button>
                          )}
                          {d.status === "failed" && (
                            <button onClick={() => { deploymentAction(d.id, "rollback"); refresh(); }} className="p-1.5 rounded-lg hover:bg-gray-700 text-orange-400" title="Rollback"><RotateCcw size={14} /></button>
                          )}
                          <button onClick={() => { deleteDeployment(d.id); refresh(); }} className="p-1.5 rounded-lg hover:bg-gray-700 text-red-400" title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
