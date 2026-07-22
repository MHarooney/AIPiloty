"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/app-shell";
import {
  getConfig,
  updateConfig,
  listImageProviders,
  upsertImageProvider,
  deleteImageProvider,
  getLlmProviderHealth,
  type ProviderSecretInfo,
  type ImageModelOption,
  type LlmProvidersConfig,
} from "@/lib/api";
import {
  Settings,
  Bot,
  Globe,
  Wrench,
  BookOpen,
  Loader2,
  Server,
  Save,
  Image as ImageIcon,
  KeyRound,
  Trash2,
  Eye,
  EyeOff,
  Cpu,
} from "lucide-react";
import { toast } from "sonner";

// ── LLM provider definitions ──────────────────────────────────────────────────
const LLM_PROVIDERS = [
  {
    id: "claude",
    name: "Anthropic Claude",
    hint: "console.anthropic.com → API keys",
    placeholder: "sk-ant-…",
    configKey: "anthropic_api_key",
    priority: 1,
  },
  {
    id: "openai",
    name: "OpenAI GPT",
    hint: "platform.openai.com → API keys",
    placeholder: "sk-…",
    configKey: "openai_api_key",
    priority: 2,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    hint: "aistudio.google.com → API key",
    placeholder: "AIza…",
    configKey: "gemini_api_key",
    priority: 3,
  },
] as const;

interface ToolInfo { name: string; description: string; category?: string; risk_level?: string }

const PROVIDER_META: Record<string, { title: string; hint: string; placeholder: string }> = {
  openai: {
    title: "OpenAI",
    hint: "DALL·E 3 / GPT Image — platform.openai.com → API keys",
    placeholder: "sk-…",
  },
  gemini: {
    title: "Google Gemini",
    hint: "Imagen 3 / Nano Banana — aistudio.google.com → API key",
    placeholder: "AIza…",
  },
};

export default function SettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.1);
  const [contextLength, setContextLength] = useState(8192);
  const [dirty, setDirty] = useState(false);

  const [secrets, setSecrets] = useState<ProviderSecretInfo[]>([]);
  const [imageModels, setImageModels] = useState<ImageModelOption[]>([]);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({ openai: "", gemini: "" });
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({
    openai: "dall-e-3",
    gemini: "gemini-2.5-flash-image",
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  // LLM chat provider state (Claude / OpenAI / Gemini for agent chat)
  const [llmKeyDrafts, setLlmKeyDrafts] = useState<Record<string, string>>({
    claude: "", openai: "", gemini: "",
  });
  const [llmKeySaved, setLlmKeySaved] = useState<Record<string, boolean>>({});
  const [llmSaving, setLlmSaving] = useState<Record<string, boolean>>({});
  const [showLlmKeys, setShowLlmKeys] = useState<Record<string, boolean>>({});
  const [llmHealth, setLlmHealth] = useState<LlmProvidersConfig | null>(null);
  const [providerPriority, setProviderPriority] = useState("claude,openai,gemini,ollama");
  const [savingPriority, setSavingPriority] = useState(false);


  const loadLlmStatus = useCallback(async () => {
    try {
      const [cfg, health] = await Promise.all([
        getConfig(),
        getLlmProviderHealth().catch(() => null),
      ]);
      const llm = cfg?.llm_providers as LlmProvidersConfig | undefined;
      if (llm) {
        setLlmHealth(llm);
        if (llm.priority) setProviderPriority(llm.priority);
        setLlmKeySaved({
          claude: !!llm.providers?.claude?.configured,
          openai: !!llm.providers?.openai?.configured,
          gemini: !!llm.providers?.gemini?.configured,
        });
      } else if (health) {
        setLlmHealth({
          priority: "claude,openai,gemini,ollama",
          active: health.active,
          chain: health.chain,
          providers: {
            claude: { configured: false },
            openai: { configured: false },
            gemini: { configured: false },
            ollama: { configured: true },
          },
        });
      }
    } catch {
      /* backend may still be reloading */
    }
  }, []);

  const saveLlmKey = async (providerId: string) => {
    const meta = LLM_PROVIDERS.find((p) => p.id === providerId);
    if (!meta) return;
    const raw = (llmKeyDrafts[providerId] || "").trim();
    if (raw.length < 8) {
      toast.error("Paste a valid API key first (min 8 characters)");
      return;
    }
    setLlmSaving((s) => ({ ...s, [providerId]: true }));
    try {
      const payload: Record<string, string> = { [meta.configKey]: raw };
      const res = await updateConfig(payload);
      setLlmKeyDrafts((d) => ({ ...d, [providerId]: "" }));
      setLlmKeySaved((s) => ({ ...s, [providerId]: true }));
      const chain = (res.updated?.provider_chain as string[]) || [];
      toast.success(
        chain.length
          ? `${meta.name} key saved — chain: ${chain.join(" → ")}`
          : `${meta.name} key saved`,
      );
      await loadLlmStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to save LLM key");
    } finally {
      setLlmSaving((s) => ({ ...s, [providerId]: false }));
    }
  };

  const clearLlmKey = async (providerId: string) => {
    const meta = LLM_PROVIDERS.find((p) => p.id === providerId);
    if (!meta) return;
    if (!confirm(`Remove ${meta.name} API key?`)) return;
    setLlmSaving((s) => ({ ...s, [providerId]: true }));
    try {
      await updateConfig({ [meta.configKey]: "" });
      setLlmKeySaved((s) => ({ ...s, [providerId]: false }));
      toast.success(`${meta.name} key removed`);
      await loadLlmStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to remove key");
    } finally {
      setLlmSaving((s) => ({ ...s, [providerId]: false }));
    }
  };

  const savePriority = async () => {
    const cleaned = providerPriority
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .join(",");
    if (!cleaned) {
      toast.error("Priority chain cannot be empty");
      return;
    }
    setSavingPriority(true);
    try {
      const res = await updateConfig({ provider_priority: cleaned });
      setProviderPriority(cleaned);
      const chain = (res.updated?.provider_chain as string[]) || cleaned.split(",");
      toast.success(`Priority updated — chain: ${chain.join(" → ")}`);
      await loadLlmStatus();
    } catch (e: any) {
      toast.error(e.message || "Failed to update priority");
    } finally {
      setSavingPriority(false);
    }
  };


  const loadProviders = useCallback(async () => {
    try {
      const data = await listImageProviders();
      setSecrets(data.secrets || []);
      setImageModels(data.models || []);
      setDefaultModels((prev) => {
        const next = { ...prev };
        for (const s of data.secrets || []) {
          if (s.default_model) next[s.provider] = s.default_model;
        }
        return next;
      });
    } catch {
      /* backend may still be reloading */
    }
  }, []);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setConfig(cfg);
        setModel(cfg?.ollama_model || "");
        setTemperature(cfg?.ollama_temperature ?? 0.1);
        setContextLength(cfg?.ollama_context_length ?? 8192);
        const llm = cfg?.llm_providers as LlmProvidersConfig | undefined;
        if (llm) {
          setLlmHealth(llm);
          if (llm.priority) setProviderPriority(llm.priority);
          setLlmKeySaved({
            claude: !!llm.providers?.claude?.configured,
            openai: !!llm.providers?.openai?.configured,
            gemini: !!llm.providers?.gemini?.configured,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    loadProviders();
    void loadLlmStatus();
  }, [loadProviders, loadLlmStatus]);

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

  const saveProviderKey = async (provider: string) => {
    const api_key = (keyDrafts[provider] || "").trim();
    if (api_key.length < 8) {
      toast.error("Paste a valid API key first");
      return;
    }
    setSavingProvider(provider);
    try {
      await upsertImageProvider(provider, {
        api_key,
        default_model: defaultModels[provider],
        label: PROVIDER_META[provider]?.title || provider,
      });
      setKeyDrafts((d) => ({ ...d, [provider]: "" }));
      toast.success(`${PROVIDER_META[provider]?.title || provider} key saved (encrypted)`);
      await loadProviders();
    } catch (e: any) {
      toast.error(e.message || "Failed to save key");
    } finally {
      setSavingProvider(null);
    }
  };

  const removeProviderKey = async (provider: string) => {
    if (!confirm(`Remove stored ${provider} API key?`)) return;
    try {
      await deleteImageProvider(provider);
      toast.success("Key removed");
      await loadProviders();
    } catch (e: any) {
      toast.error(e.message || "Failed to remove key");
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
  const secretByProvider = Object.fromEntries(secrets.map((s) => [s.provider, s]));

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
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
              <Settings size={20} className="text-gray-400" />
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-100">Settings</h1>
              <p className="text-xs text-gray-500">
                LLM + image provider keys are write-only. Image keys stay encrypted in DB; LLM keys hot-patch the ProviderRouter.
              </p>
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


          <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-600/15 border border-violet-500/20 flex items-center justify-center">
                <Cpu size={16} className="text-violet-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                  <Cpu size={14} className="text-violet-400" /> LLM Providers
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Primary chat models for the agent. Failover chain:
                  {" "}
                  <span className="text-violet-300 font-mono">
                    {(llmHealth?.chain || providerPriority.split(",")).join(" → ")}
                  </span>
                  {llmHealth?.active ? (
                    <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-violet-900/40 text-violet-300 border border-violet-800/40">
                      active: {llmHealth.active}
                    </span>
                  ) : null}
                </p>
                <p className="text-[10px] text-gray-600 mt-1">
                  Keys are write-only (never returned by the API).
                  "Stored in backend settings / env for this process."
                  {" "}Ollama remains the offline fallback.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-800/60 bg-gray-950/40 p-3 space-y-2">
              <label className="text-[10px] text-gray-500 block">
                Priority order (comma-separated: claude, openai, gemini, ollama)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={providerPriority}
                  onChange={(e) => setProviderPriority(e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-violet-500"
                  placeholder="claude,openai,gemini,ollama"
                />
                <button
                  type="button"
                  onClick={savePriority}
                  disabled={savingPriority}
                  className="px-3 py-2 rounded-lg bg-violet-600 text-white text-xs hover:bg-violet-500 disabled:opacity-50 flex items-center gap-1"
                >
                  {savingPriority ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Apply
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {LLM_PROVIDERS.map((provider) => {
                const configured = !!llmKeySaved[provider.id];
                const hint = llmHealth?.providers?.[provider.id as "claude" | "openai" | "gemini"]?.key_hint;
                return (
                  <div key={provider.id} className="rounded-xl border border-gray-800/60 bg-gray-950/50 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-200">{provider.name}</p>
                        <p className="text-[10px] text-gray-500">{provider.hint}</p>
                      </div>
                      {configured ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 border border-emerald-800/40">
                          {hint || "configured"}
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-500">not set</span>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">API key</label>
                      <div className="relative">
                        <input
                          type={showLlmKeys[provider.id] ? "text" : "password"}
                          autoComplete="off"
                          value={llmKeyDrafts[provider.id] || ""}
                          onChange={(e) =>
                            setLlmKeyDrafts((d) => ({ ...d, [provider.id]: e.target.value }))
                          }
                          placeholder={configured ? "•••• paste new key to replace" : provider.placeholder}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-9 text-sm text-gray-200 focus:outline-none focus:border-violet-500"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowLlmKeys((s) => ({ ...s, [provider.id]: !s[provider.id] }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                          {showLlmKeys[provider.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveLlmKey(provider.id)}
                        disabled={!!llmSaving[provider.id]}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-violet-600 text-white text-xs hover:bg-violet-500 disabled:opacity-50"
                      >
                        {llmSaving[provider.id] ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Save size={12} />
                        )}
                        Save key
                      </button>
                      {configured && (
                        <button
                          type="button"
                          onClick={() => clearLlmKey(provider.id)}
                          disabled={!!llmSaving[provider.id]}
                          className="px-3 py-2 rounded-lg border border-red-900/40 text-red-400 text-xs hover:bg-red-950/30"
                          title="Remove key"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center">
                <ImageIcon size={16} className="text-indigo-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                  <KeyRound size={14} className="text-indigo-400" /> Image Providers
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Add OpenAI and/or Gemini keys here. In chat, the agent asks which model to use when more than one is configured.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(["openai", "gemini"] as const).map((provider) => {
                const meta = PROVIDER_META[provider];
                const existing = secretByProvider[provider];
                const modelsFor = imageModels.filter((m) => m.provider === provider);
                return (
                  <div key={provider} className="rounded-xl border border-gray-800/60 bg-gray-950/50 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-200">{meta.title}</p>
                        <p className="text-[10px] text-gray-500">{meta.hint}</p>
                      </div>
                      {existing?.configured ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 border border-emerald-800/40">
                          {existing.key_hint || "configured"}
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-500">not set</span>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">API key</label>
                      <div className="relative">
                        <input
                          type={showKeys[provider] ? "text" : "password"}
                          autoComplete="off"
                          value={keyDrafts[provider] || ""}
                          onChange={(e) => setKeyDrafts((d) => ({ ...d, [provider]: e.target.value }))}
                          placeholder={existing?.configured ? "•••• paste new key to replace" : meta.placeholder}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-9 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeys((s) => ({ ...s, [provider]: !s[provider] }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                          {showKeys[provider] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block">Default model</label>
                      <select
                        value={defaultModels[provider] || ""}
                        onChange={(e) => setDefaultModels((d) => ({ ...d, [provider]: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
                      >
                        {(modelsFor.length ? modelsFor : [
                          { id: defaultModels[provider], label: defaultModels[provider] },
                        ]).map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => saveProviderKey(provider)}
                        disabled={savingProvider === provider}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {savingProvider === provider ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Save key
                      </button>
                      {existing?.configured && (
                        <button
                          onClick={() => removeProviderKey(provider)}
                          className="px-3 py-2 rounded-lg border border-red-900/40 text-red-400 text-xs hover:bg-red-950/30"
                          title="Remove key"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    placeholder="llama3.2:3b"
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

            <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                <BookOpen size={16} className="text-emerald-400" /> Knowledge Base
              </h2>
              <div className="space-y-2 text-xs">
                <Row label="KB URL" value={config?.deploypilot_kb_url || "Not configured"} />
                <Row label="Status" value={config?.deploypilot_kb_url ? "Configured" : "Disabled"} />
              </div>
            </section>

            <section className="bg-gray-900/80 border border-gray-800/50 rounded-xl p-5 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                <Globe size={16} className="text-blue-400" /> Network
              </h2>
              <div className="space-y-2 text-xs">
                <Row label="Database" value={config?.database_url} />
              </div>
            </section>
          </div>

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
