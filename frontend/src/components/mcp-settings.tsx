"use client";

import { useState, useEffect } from "react";
import {
  X, Plus, Trash2, Zap, Loader2, ChevronDown, ChevronRight,
  Terminal, Copy, Check, AlertCircle, CheckCircle2,
} from "lucide-react";
import {
  listMCPServers, addMCPServer, deleteMCPServer, probeMCPServer,
  importClaudeDesktopConfig, type MCPServer, type MCPTool,
} from "@/lib/api";
import { toast } from "sonner";

interface Props {
  onClose: () => void;
}

const BLANK_FORM: Omit<MCPServer, "id"> = {
  name: "",
  command: "",
  args: [],
  env: {},
  description: "",
};

// Preset templates (common MCP servers)
const TEMPLATES: { label: string; value: Omit<MCPServer, "id"> }[] = [
  {
    label: "Filesystem (local)",
    value: {
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/"],
      env: {},
      description: "Read/write local files via MCP",
    },
  },
  {
    label: "GitHub",
    value: {
      name: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
      description: "GitHub repos, issues, PRs",
    },
  },
  {
    label: "PostgreSQL",
    value: {
      name: "postgres",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@localhost/db"],
      env: {},
      description: "Query a PostgreSQL database",
    },
  },
  {
    label: "Brave Search",
    value: {
      name: "brave-search",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "" },
      description: "Web search via Brave",
    },
  },
];

export default function MCPSettings({ onClose }: Props) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [probeState, setProbeState] = useState<Record<string, { loading: boolean; tools?: MCPTool[]; error?: string }>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [importMode, setImportMode] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);

  const refresh = () => {
    setLoading(true);
    listMCPServers()
      .then(setServers)
      .catch(() => toast.error("Failed to load MCP servers"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleAdd = async () => {
    let args: string[] = [];
    let env: Record<string, string> = {};
    try {
      args = argsText.trim()
        ? (JSON.parse(argsText.trim()) as string[])
        : [];
    } catch {
      toast.error("Args must be a JSON array, e.g. [\"-y\", \"@mcp/server\"]");
      return;
    }
    try {
      env = envText.trim() ? (JSON.parse(envText.trim()) as Record<string, string>) : {};
    } catch {
      toast.error("Env must be a JSON object, e.g. {\"KEY\": \"value\"}");
      return;
    }
    if (!form.name.trim() || !form.command.trim()) {
      toast.error("Name and command are required");
      return;
    }
    setSaving(true);
    try {
      await addMCPServer({ ...form, args, env });
      toast.success(`MCP server "${form.name}" added`);
      setShowForm(false);
      setForm(BLANK_FORM);
      setArgsText("");
      setEnvText("");
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to add server");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove MCP server "${name}"?`)) return;
    await deleteMCPServer(id).catch(() => {});
    refresh();
  };

  const handleProbe = async (id: string) => {
    setProbeState((s) => ({ ...s, [id]: { loading: true } }));
    setExpanded((e) => ({ ...e, [id]: true }));
    try {
      const result = await probeMCPServer(id);
      setProbeState((s) => ({ ...s, [id]: { loading: false, tools: result.tools } }));
      toast.success(`Found ${result.tool_count} tools`);
    } catch (err: any) {
      setProbeState((s) => ({ ...s, [id]: { loading: false, error: err.message } }));
      toast.error(err.message || "Probe failed");
    }
  };

  const handleImport = async () => {
    let parsed: any;
    try {
      parsed = JSON.parse(importJson);
    } catch {
      toast.error("Invalid JSON");
      return;
    }
    setImporting(true);
    try {
      const result = await importClaudeDesktopConfig(parsed);
      toast.success(`Imported ${result.imported} server(s)`);
      setImportMode(false);
      setImportJson("");
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const applyTemplate = (t: Omit<MCPServer, "id">) => {
    setForm({ ...t });
    setArgsText(JSON.stringify(t.args, null, 2));
    setEnvText(Object.keys(t.env).length ? JSON.stringify(t.env, null, 2) : "");
    setShowForm(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-2xl mx-4 bg-[#0d1117] border border-gray-800/60 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800/50">
          <Terminal size={16} className="text-indigo-400 shrink-0" />
          <h2 className="text-sm font-semibold text-gray-200 flex-1">MCP Servers</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setImportMode((v) => !v); setShowForm(false); }}
              className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
            >
              Import Config
            </button>
            <button
              onClick={() => { setShowForm((v) => !v); setImportMode(false); }}
              className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors"
            >
              <Plus size={12} /> Add Server
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Import from Claude Desktop config */}
          {importMode && (
            <div className="m-4 p-4 bg-gray-900/50 rounded-lg border border-gray-800/50 space-y-3">
              <p className="text-xs text-gray-400">
                Paste your <code className="text-indigo-400">claude_desktop_config.json</code> content (or just the <code className="text-indigo-400">mcpServers</code> object):
              </p>
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                rows={8}
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono focus:outline-none focus:border-indigo-500 resize-none"
                placeholder='{ "mcpServers": { "filesystem": { "command": "npx", "args": [...] } } }'
              />
              <div className="flex gap-2">
                <button
                  onClick={handleImport}
                  disabled={importing || !importJson.trim()}
                  className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {importing ? <Loader2 size={11} className="animate-spin" /> : <Copy size={11} />}
                  Import
                </button>
                <button onClick={() => setImportMode(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Add server form */}
          {showForm && (
            <div className="m-4 p-4 bg-gray-900/50 rounded-lg border border-gray-800/50 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs font-medium text-gray-300 flex-1">New MCP Server</p>
                <div className="flex gap-1 flex-wrap">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      onClick={() => applyTemplate(t.value)}
                      className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                    placeholder="my-server"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Command *</label>
                  <input
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                    className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
                    placeholder="npx"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Args (JSON array)</label>
                <input
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-indigo-500"
                  placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]'
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Env vars (JSON object)</label>
                <input
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-indigo-500"
                  placeholder='{"API_KEY": "sk-..."}'
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                  placeholder="Optional description"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Add Server
                </button>
                <button
                  onClick={() => { setShowForm(false); setForm(BLANK_FORM); setArgsText(""); setEnvText(""); }}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Server list */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={22} className="animate-spin text-gray-500" />
            </div>
          ) : servers.length === 0 && !showForm && !importMode ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
              <Terminal size={36} className="text-gray-700" />
              <p className="text-sm text-gray-500">No MCP servers configured</p>
              <p className="text-xs text-gray-700">
                MCP servers extend the AI with extra tools — filesystem access, web search, databases, GitHub, and more.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-xs rounded-lg hover:bg-indigo-600/30 transition-colors"
              >
                <Plus size={12} /> Add your first server
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-800/40">
              {servers.map((s) => {
                const probe = probeState[s.id];
                const isExpanded = expanded[s.id];
                return (
                  <div key={s.id} className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpanded((e) => ({ ...e, [s.id]: !e[s.id] }))}
                        className="p-0.5 text-gray-600 hover:text-gray-400 transition-colors"
                      >
                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-200">{s.name}</span>
                          {probe?.tools && (
                            <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
                              {probe.tools.length} tools
                            </span>
                          )}
                          {probe?.error && (
                            <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                              <AlertCircle size={9} /> error
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-600 font-mono truncate">
                          {s.command} {s.args.join(" ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleProbe(s.id)}
                          disabled={probe?.loading}
                          className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded transition-colors disabled:opacity-50"
                          title="Test connection and list tools"
                        >
                          {probe?.loading ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : probe?.tools ? (
                            <CheckCircle2 size={10} />
                          ) : (
                            <Zap size={10} />
                          )}
                          Test
                        </button>
                        <button
                          onClick={() => handleDelete(s.id, s.name)}
                          className="p-1 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded — show tools */}
                    {isExpanded && (
                      <div className="mt-2 ml-5 space-y-1">
                        {s.description && (
                          <p className="text-[10px] text-gray-600 mb-2">{s.description}</p>
                        )}
                        {probe?.loading && (
                          <div className="flex items-center gap-2 text-[10px] text-gray-600">
                            <Loader2 size={10} className="animate-spin" /> Probing server…
                          </div>
                        )}
                        {probe?.error && (
                          <p className="text-[10px] text-red-500 bg-red-500/10 px-2 py-1 rounded">
                            {probe.error}
                          </p>
                        )}
                        {probe?.tools && probe.tools.length === 0 && (
                          <p className="text-[10px] text-gray-600">No tools returned</p>
                        )}
                        {probe?.tools?.map((t) => (
                          <div key={t.name} className="flex items-start gap-2 px-2 py-1.5 rounded bg-gray-900/50">
                            <Check size={10} className="text-emerald-400 mt-0.5 shrink-0" />
                            <div>
                              <span className="text-[10px] font-medium text-gray-300 font-mono">{t.name}</span>
                              {t.description && (
                                <p className="text-[10px] text-gray-600">{t.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                        {!probe && (
                          <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
                            <span className="font-mono">{s.command}</span>
                            {s.args.map((a, i) => (
                              <span key={i} className="font-mono text-gray-700">{a}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="px-5 py-3 border-t border-gray-800/50">
          <p className="text-[10px] text-gray-700">
            MCP tools are available to the AI agent automatically. Configure servers using the same format as{" "}
            <code className="text-gray-600">claude_desktop_config.json</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
