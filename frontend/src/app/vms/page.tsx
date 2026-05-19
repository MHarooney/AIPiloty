"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/app-shell";
import { getVMs, createVM, deleteVM, trustHostKey } from "@/lib/api";
import { Server, Plus, Trash2, ShieldCheck, Loader2, Wifi, WifiOff, X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function VMsPage() {
  const [vms, setVMs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", provider: "custom", host_ip: "", ssh_username: "root", ssh_password: "", ssh_port: 22 });

  const refresh = () => {
    setLoading(true);
    getVMs().then(setVMs).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createVM(form);
    setShowForm(false);
    setForm({ name: "", provider: "custom", host_ip: "", ssh_username: "root", ssh_password: "", ssh_port: 22 });
    refresh();
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-900/20 flex items-center justify-center">
                <Server size={20} className="text-purple-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">VM Credentials</h1>
                <p className="text-xs text-gray-500">{vms.length} servers</p>
              </div>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-indigo-500/10"
            >
              {showForm ? <X size={16} /> : <Plus size={16} />}
              {showForm ? "Cancel" : "Add VM"}
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleCreate} className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-6 mb-6 space-y-4 animate-slide-up">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { key: "name", label: "Name", required: true },
                  { key: "provider", label: "Provider" },
                  { key: "host_ip", label: "Host IP", required: true },
                  { key: "ssh_username", label: "SSH Username", required: true },
                  { key: "ssh_password", label: "SSH Password", type: "password" },
                  { key: "ssh_port", label: "SSH Port", type: "number" },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">{field.label}</label>
                    <input
                      type={field.type || "text"}
                      value={(form as any)[field.key]}
                      onChange={(e) => setForm((f) => ({ ...f, [field.key]: field.type === "number" ? parseInt(e.target.value) || 0 : e.target.value }))}
                      className="w-full bg-gray-800/80 border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                      required={field.required}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <button type="submit" className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-sm font-medium transition-colors">
                  Add Server
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-gray-500" size={32} />
            </div>
          ) : vms.length === 0 ? (
            <div className="text-center py-20 text-gray-500 animate-fade-in">
              <Server size={40} className="mx-auto mb-3 opacity-30" />
              <p>No VMs added yet</p>
              <p className="text-xs mt-1">Add a server to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vms.map((vm) => (
                <div key={vm.id} className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3 hover:border-gray-700/50 transition-all">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-200">{vm.name}</h3>
                    <span className={cn("flex items-center gap-1 text-xs", vm.is_active ? "text-emerald-400" : "text-gray-500")}>
                      {vm.is_active ? <Wifi size={12} /> : <WifiOff size={12} />}
                      {vm.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs text-gray-400">
                    <p><span className="text-gray-500 w-16 inline-block">Host:</span> <span className="font-mono">{vm.host_ip}</span></p>
                    <p><span className="text-gray-500 w-16 inline-block">User:</span> {vm.ssh_username}</p>
                    <p><span className="text-gray-500 w-16 inline-block">Provider:</span> {vm.provider}</p>
                    <p><span className="text-gray-500 w-16 inline-block">Port:</span> {vm.ssh_port}</p>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-800/50">
                    {!vm.ssh_host_key_fingerprint && (
                      <button onClick={() => trustHostKey(vm.id).then(refresh)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-indigo-600/15 text-indigo-300 rounded-lg hover:bg-indigo-600/25 border border-indigo-500/20 transition-colors">
                        <ShieldCheck size={12} /> Trust Key
                      </button>
                    )}
                    <button onClick={() => deleteVM(vm.id).then(refresh)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-900/15 rounded-lg ml-auto transition-colors">
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
