"use client";

/**
 * ProviderStatusBadge — Shows the active LLM provider in the chat header.
 * Polls /api/v1/providers/llm/health every 10s; hides when only local Ollama is chained.
 */

import { useState, useEffect } from "react";
import { Cpu, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { headers as apiHeaders } from "@/lib/api-headers";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api/v1";

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  openai: "GPT-4",
  gemini: "Gemini",
  ollama: "Ollama (local)",
};

const PROVIDER_COLORS: Record<string, string> = {
  claude: "text-amber-400",
  openai: "text-green-400",
  gemini: "text-blue-400",
  ollama: "text-purple-400",
};

interface ProviderHealth {
  active: string;
  chain: string[];
  health: Record<string, {
    available: boolean;
    backoff_seconds: number;
    failure_count: number;
    last_error: string | null;
  }>;
}

export default function ProviderStatusBadge() {
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [prevActive, setPrevActive] = useState<string | null>(null);
  const [justSwitched, setJustSwitched] = useState(false);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch(`${API_BASE}/providers/llm/health`, {
          headers: apiHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json() as ProviderHealth;
        setHealth(data);

        // Detect provider switch
        if (prevActive && prevActive !== data.active) {
          setJustSwitched(true);
          setTimeout(() => setJustSwitched(false), 4_000);
        }
        setPrevActive(data.active);
      } catch {
        // Silently ignore — backend may be starting up
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 10_000);
    return () => clearInterval(interval);
  }, [prevActive]);

  if (!health) return null;
  // Only show the badge if we have more than one provider (otherwise it's obvious)
  if (health.chain.length <= 1 && health.active === "ollama") return null;

  const label = PROVIDER_LABELS[health.active] ?? health.active;
  const color = PROVIDER_COLORS[health.active] ?? "text-zinc-400";
  const activeHealth = health.health[health.active];
  const degraded = activeHealth && !activeHealth.available;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border",
        justSwitched
          ? "border-amber-500/40 bg-amber-950/30 animate-pulse"
          : "border-zinc-700/50 bg-zinc-900/50",
      )}
      title={`Active LLM: ${label}${activeHealth?.last_error ? ` (last error: ${activeHealth.last_error})` : ""}`}
    >
      <Cpu size={10} className={color} />
      <span className={color}>{label}</span>
      {justSwitched && (
        <span className="text-amber-400 text-[10px]">↷ switched</span>
      )}
      {degraded && (
        <AlertCircle size={9} className="text-red-400" />
      )}
      {!degraded && !justSwitched && (
        <CheckCircle2 size={9} className="text-zinc-600" />
      )}
    </div>
  );
}
