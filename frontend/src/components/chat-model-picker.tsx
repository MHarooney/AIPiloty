"use client";

/**
 * Professional LLM model picker for the web Command Pad.
 * Default: Auto (OpenRouter → Local Ollama failover).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Cpu, Search, Sparkles, HardDrive, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { listLlmModels, type LlmModelOption, type LlmModelsCatalog } from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";

const PROVIDER_META: Record<string, { label: string; icon: "auto" | "cloud" | "local" }> = {
  auto: { label: "Smart routing", icon: "auto" },
  openrouter: { label: "OpenRouter", icon: "cloud" },
  claude: { label: "Anthropic", icon: "cloud" },
  openai: { label: "OpenAI", icon: "cloud" },
  gemini: { label: "Google", icon: "cloud" },
  ollama: { label: "Local Ollama", icon: "local" },
};

function ProviderIcon({ kind }: { kind: "auto" | "cloud" | "local" }) {
  if (kind === "auto") return <Sparkles size={12} className="text-teal-400" />;
  if (kind === "local") return <HardDrive size={12} className="text-violet-400" />;
  return <Cloud size={12} className="text-sky-400" />;
}

export default function ChatModelPicker() {
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedModelLabel = useChatStore((s) => s.selectedModelLabel);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<LlmModelsCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listLlmModels();
      setCatalog(data);
      const ids = new Set(data.models.map((m) => m.id));
      const current = useChatStore.getState().selectedModel;
      if (!ids.has(current)) {
        const def = data.models.find((m) => m.is_default) || data.models[0];
        if (def) setSelectedModel(def.id, def.label);
      } else if (current === "auto") {
        const def = data.models.find((m) => m.id === "auto");
        if (def) setSelectedModel(def.id, def.label);
      }
    } catch {
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  }, [setSelectedModel]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const models = catalog?.models || [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? models.filter(
          (m) =>
            m.label.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            (m.description || "").toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q),
        )
      : models;
    const order = ["auto", "openrouter", "claude", "openai", "gemini", "ollama"];
    const map = new Map<string, LlmModelOption[]>();
    for (const m of filtered) {
      const list = map.get(m.provider) || [];
      list.push(m);
      map.set(m.provider, list);
    }
    return order
      .filter((p) => map.has(p))
      .map((p) => ({ provider: p, models: map.get(p)! }));
  }, [catalog, query]);

  const triggerLabel = selectedModelLabel || "Auto";
  const openrouterReady = catalog?.configured_providers?.includes("openrouter");
  const hint = catalog?.priority_hint || "openrouter → ollama";

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
          "border-teal-800/40 bg-teal-950/30 text-teal-200 hover:border-teal-600/50 hover:bg-teal-950/50",
        )}
        title={`Model: ${triggerLabel}\nRouting: ${hint}`}
      >
        <Cpu size={12} className="text-teal-400" />
        <span className="max-w-[160px] truncate">{triggerLabel}</span>
        <ChevronDown size={11} className={cn("opacity-70 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select chat model"
          className="absolute bottom-full right-0 mb-2 z-[70] w-[320px] overflow-hidden rounded-xl border border-gray-700/80 bg-gray-950 shadow-2xl shadow-black/50"
        >
          <div className="border-b border-gray-800 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-gray-200">Chat model</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              {openrouterReady
                ? "Default Auto uses OpenRouter first, then local Ollama if it fails."
                : "Add an OpenRouter key in Settings for cloud Auto routing."}
            </p>
            <div className="relative mt-2">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="w-full rounded-lg border border-gray-800 bg-gray-900 py-1.5 pl-7 pr-2 text-xs text-gray-200 placeholder:text-gray-600 focus:border-teal-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-[320px] overflow-y-auto py-1">
            {loading && (
              <p className="px-3 py-4 text-center text-[11px] text-gray-500">Loading models…</p>
            )}
            {!loading && groups.length === 0 && (
              <p className="px-3 py-4 text-center text-[11px] text-gray-500">No models match.</p>
            )}
            {groups.map((group) => {
              const meta = PROVIDER_META[group.provider] || {
                label: group.provider,
                icon: "cloud" as const,
              };
              return (
                <div key={group.provider} className="py-1">
                  <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    <ProviderIcon kind={meta.icon} />
                    {meta.label}
                  </div>
                  {group.models.map((m) => {
                    const active = m.id === selectedModel;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setSelectedModel(m.id, m.label);
                          setOpen(false);
                          setQuery("");
                        }}
                        className={cn(
                          "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors",
                          active ? "bg-teal-950/40" : "hover:bg-gray-900",
                        )}
                      >
                        <span className={cn("text-xs font-medium", active ? "text-teal-300" : "text-gray-200")}>
                          {m.label}
                          {m.is_default ? (
                            <span className="ml-1.5 rounded bg-teal-900/50 px-1 py-px text-[9px] text-teal-400">
                              default
                            </span>
                          ) : null}
                        </span>
                        {m.description ? (
                          <span className="text-[10px] text-gray-500 line-clamp-2">{m.description}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="border-t border-gray-800 px-3 py-2 text-[10px] text-gray-500">
            Fallback: <span className="text-gray-400">{catalog?.fallback || "ollama"}</span>
            {catalog?.priority_hint ? (
              <span className="ml-2 text-gray-600">· {catalog.priority_hint}</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
