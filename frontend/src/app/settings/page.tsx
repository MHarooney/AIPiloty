"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/app-shell";
import { getConfig, updateConfig } from "@/lib/api";
import { Settings, Bot, Globe, Wrench, BookOpen, Loader2, Info, Server, Save, Check } from "lucide-react";
import { toast } from "sonner";

interface ToolInfo { name: string; description: string; category?: string; risk_level?: string }

export default function SettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Editable fields
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.1);
  const [contextLength, setContextLength] = useState(8192);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setConfig(cfg);
        setModel(cfg?.ollama_model || "");
        setTemperature(cfg?.ollama_temperature ?? 0.1);
        setContextLength(cfg?.ollama_context_length ?? 8192);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateConfig({
        ollama_model: model,
        ollama_temperature: temperature,
        ollama_context_length: contextLength,
      });
      setDirty(false);
      toast.success("Settings saved — changes apply to the next chat message");
    } catch (e: any) {
      toast.error(e.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-gray-500" size={28} />
        </div>
      </AppShell>
    );
  }

  const tools: ToolInfo[] = config?.tools_registered || [];

  const riskColor = (level?: string) => {
    switch (level?.toLowerCase()) {
      case "critical": return "text-red-400 bg-red-900/20 border-red-800/30";
      case "high": return "text-orange-400 bg-orange-900/20 border-orange-800/30";
      case "medium": return "text-amber-400 bg-amber-900/20 border-amber-800/30";
      default: return "text-emerald-400 bg-emerald-900/20 border-emerald-800/30";
    }
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-4 pt-14 md:p-6 md:pt-6">
        <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
              <Settings size={20} className="text-gray-400" />
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-100">Settings</h1>
              <p className="text-xs text-gray-500">Edit AI parameters below. Other settings require backend .env changes.</p>
            </div>
            {dirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* AI Engine — EDITABLE */}
            <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                <Bot size={16} className="text-purple-400" /> AI Engine
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Model</label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => { setModel(e.target.value); setDirty(true); }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                    placeholder="deepseek-coder-v2:16b"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Temperature ({temperature})</label>
                  <input
                    type="range"
                    min="0" max="2" step="0.05"
                    value={temperature}
                    onChange={(e) => { setTemperature(parseFloat(e.target.value)); setDirty(true); }}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-[10px] text-gray-600">
                    <span>Precise</span><span>Creative</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Context Length</label>
                  <select
                    value={contextLength}
                    onChange={(e) => { setContextLength(parseInt(e.target.value)); setDirty(true); }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value={4096}>4,096 tokens</option>
                    <option value={8192}>8,192 tokens</option>
                    <option value={16384}>16,384 tokens</option>
                    <option value={32768}>32,768 tokens</option>
                    <option value={65536}>65,536 tokens</option>
                    <option value={131072}>131,072 tokens</option>
                  </select>
                </div>
                <Row label="Base URL" value={config?.ollama_base_url} />
              </div>
            </section>

            {/* Application — read-only */}
            <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                <Server size={16} className="text-cyan-400" /> Application
              </h2>
              <div className="space-y-2 text-xs">
                <Row label="App Name" value={config?.app_name} />
                <Row label="Environment" value={config?.app_env} />
                <Row label="CORS Origins" value={config?.cors_origins} />
                <Row label="Workspace" value={config?.workspace_root} />
              </div>
            </section>

            {/* Knowledge */}
            <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                <BookOpen size={16} className="text-emerald-400" /> Knowledge Base
              </h2>
              <div className="space-y-2 text-xs">
                <Row label="KB URL" value={config?.deploypilot_kb_url || "Not configured"} />
                <Row label="Status" value={config?.deploypilot_kb_url ? "Configured" : "Disabled"} />
              </div>
            </section>

            {/* Network */}
            <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                <Globe size={16} className="text-blue-400" /> Network
              </h2>
              <div className="space-y-2 text-xs">
                <Row label="Database" value={config?.database_url} />
              </div>
            </section>
          </div>

          {/* Tools */}
          <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
              <Wrench size={16} className="text-amber-400" /> Registered Tools
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 font-normal">{tools.length}</span>
            </h2>
            {tools.length === 0 ? (
              <p className="text-xs text-gray-600">No tools registered</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {tools.map((t) => (
                  <div key={t.name} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-gray-950/60 border border-gray-800/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-300 truncate">{t.name}</p>
                      <p className="text-[10px] text-gray-500 truncate">{t.description}</p>
                    </div>
                    {t.risk_level && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${riskColor(t.risk_level)}`}>
                        {t.risk_level}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 truncate text-right max-w-[200px]">{value ?? "—"}</span>
    </div>
  );
}
