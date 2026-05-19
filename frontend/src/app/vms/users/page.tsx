"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/app-shell";
import { getVMs, getVMUsers, createVMUser, deleteVMUser } from "@/lib/api";
import {
  Users, Server, Plus, Trash2, Loader2, UserPlus, X, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function VMUsersPage() {
  const [vms, setVMs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVM, setSelectedVM] = useState<number | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: "", shell: "/bin/bash", groups: "" });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setLoading(true);
    getVMs().then(setVMs).catch(() => toast.error("Failed to load VMs")).finally(() => setLoading(false));
  }, []);

  const loadUsers = async (vmId: number) => {
    setSelectedVM(vmId);
    setUsersLoading(true);
    try {
      const data = await getVMUsers(vmId);
      setUsers(data);
    } catch {
      setUsers([]);
      toast.error("Could not fetch users");
    } finally {
      setUsersLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVM) return;
    setCreating(true);
    try {
      await createVMUser(selectedVM, {
        username: form.username,
        shell: form.shell,
        groups: form.groups ? form.groups.split(",").map((g) => g.trim()) : [],
      });
      toast.success(`User "${form.username}" created`);
      setShowCreate(false);
      setForm({ username: "", shell: "/bin/bash", groups: "" });
      loadUsers(selectedVM);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (username: string) => {
    if (!selectedVM) return;
    try {
      await deleteVMUser(selectedVM, username);
      toast.success(`User "${username}" deleted`);
      loadUsers(selectedVM);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto animate-page-enter">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Users size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">VM User Management</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">Manage OS users on your virtual machines</p>
              </div>
            </div>
            {selectedVM && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                <UserPlus size={16} />
                Add User
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <div key={i} className="h-20 rounded-2xl bg-gray-100 dark:bg-gray-800/50 skeleton-shimmer" />)}
            </div>
          ) : (
            <div className="grid lg:grid-cols-4 gap-6">
              {/* VM Selector */}
              <div className="lg:col-span-1 space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">VMs</h2>
                {vms.map((vm) => (
                  <button
                    key={vm.id}
                    onClick={() => loadUsers(vm.id)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                      selectedVM === vm.id
                        ? "border-indigo-300 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-900/10"
                        : "border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 hover:border-gray-300 dark:hover:border-gray-700"
                    )}
                  >
                    <Server size={16} className="text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{vm.name}</p>
                      <p className="text-[10px] text-gray-500">{vm.host_ip}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Users Table */}
              <div className="lg:col-span-3">
                {!selectedVM ? (
                  <div className="flex items-center justify-center h-64 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <p className="text-gray-400">Select a VM to manage users</p>
                  </div>
                ) : usersLoading ? (
                  <div className="flex items-center justify-center h-48"><Loader2 className="animate-spin text-indigo-500" size={28} /></div>
                ) : (
                  <div className="rounded-2xl border border-gray-200 dark:border-gray-800/50 bg-white/80 dark:bg-gray-900/40 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-800/50">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Username</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">UID</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Shell</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Groups</th>
                          <th className="text-right px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.length === 0 ? (
                          <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No users found</td></tr>
                        ) : (
                          users.map((u, i) => (
                            <tr key={u.username || i} className="border-b border-gray-100 dark:border-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors animate-data-row-in" style={{ animationDelay: `${i * 50}ms` }}>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <Shield size={14} className="text-indigo-400" />
                                  <span className="font-medium text-gray-900 dark:text-white">{u.username}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-gray-500 font-mono">{u.uid || "—"}</td>
                              <td className="px-4 py-3 text-gray-500 font-mono text-xs">{u.shell || "/bin/bash"}</td>
                              <td className="px-4 py-3">
                                <div className="flex gap-1 flex-wrap">
                                  {(u.groups || []).map((g: string) => (
                                    <span key={g} className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{g}</span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                {u.username !== "root" && (
                                  <button
                                    onClick={() => handleDelete(u.username)}
                                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Create User Modal */}
          {showCreate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-800" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Create User</h2>
                  <button onClick={() => setShowCreate(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
                </div>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Username</label>
                    <input
                      type="text" required value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Shell</label>
                    <input
                      type="text" value={form.shell} onChange={(e) => setForm((p) => ({ ...p, shell: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Groups (comma-separated)</label>
                    <input
                      type="text" value={form.groups} onChange={(e) => setForm((p) => ({ ...p, groups: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="sudo, docker"
                    />
                  </div>
                  <button
                    type="submit" disabled={creating}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {creating ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                    Create User
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
