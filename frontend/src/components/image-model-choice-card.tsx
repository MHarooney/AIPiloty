"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Image as ImageIcon,
  Sparkles,
  KeyRound,
  ExternalLink,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";

export interface ImageModelOption {
  id: string;
  provider: string;
  label: string;
  description?: string;
  available?: boolean;
}

export interface ImageChoicePayload {
  status: "needs_model_choice" | "needs_api_key" | string;
  message?: string;
  options?: ImageModelOption[];
  hint?: string;
}

interface ImageModelChoiceCardProps {
  payload: ImageChoicePayload;
  /** Original generate_image prompt from the tool call args */
  originalPrompt?: string;
}

const PROVIDER_STYLE: Record<string, { badge: string; accent: string }> = {
  openai: {
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    accent: "hover:border-emerald-500/40 hover:bg-emerald-500/[0.06]",
  },
  gemini: {
    badge: "bg-sky-500/15 text-sky-300 border-sky-500/25",
    accent: "hover:border-sky-500/40 hover:bg-sky-500/[0.06]",
  },
};

function providerLabel(p: string) {
  if (p === "openai") return "OpenAI";
  if (p === "gemini") return "Gemini";
  return p;
}

function unwrapChoiceRoot(raw: unknown): Record<string, unknown> | null {
  let cur: unknown = raw;
  // Tool SSE wraps ToolResult.to_dict(); output may be nested or double-encoded.
  for (let i = 0; i < 4; i++) {
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
      } catch {
        return null;
      }
      continue;
    }
    if (!cur || typeof cur !== "object") return null;
    const obj = cur as Record<string, unknown>;
    if (typeof obj.status === "string") return obj;
    if ("output" in obj) {
      cur = obj.output;
      continue;
    }
    return null;
  }
  return null;
}

export function parseImageChoicePayload(output?: string): ImageChoicePayload | null {
  if (!output) return null;
  try {
    const root = unwrapChoiceRoot(output);
    if (!root || typeof root.status !== "string") return null;
    if (root.status !== "needs_model_choice" && root.status !== "needs_api_key") {
      return null;
    }
    return {
      status: root.status,
      message: typeof root.message === "string" ? root.message : undefined,
      hint: typeof root.hint === "string" ? root.hint : undefined,
      options: Array.isArray(root.options)
        ? (root.options as ImageModelOption[]).filter((o) => o && typeof o.id === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export default function ImageModelChoiceCard({
  payload,
  originalPrompt,
}: ImageModelChoiceCardProps) {
  const router = useRouter();
  const sendQuickPrompt = useChatStore((s) => s.sendQuickPrompt);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (payload.status === "needs_api_key") {
    return (
      <div
        className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-4 animate-fade-slide-up"
        style={{
          boxShadow: "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
            <KeyRound size={16} className="text-amber-300" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-100">Image API key required</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                {payload.message ||
                  "Add an OpenAI or Gemini key in Settings to generate images."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/settings")}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium
                bg-amber-600/90 hover:bg-amber-500 text-white transition-colors
                border border-amber-400/20"
            >
              <ExternalLink size={13} />
              Open Image Providers
            </button>
          </div>
        </div>
      </div>
    );
  }

  const options = payload.options || [];
  const ready = options.filter((o) => o.available !== false);
  const locked = options.filter((o) => o.available === false);

  if (!options.length) {
    return (
      <div className="rounded-xl border border-gray-700/50 bg-gray-900/60 p-4 text-xs text-gray-400">
        No image models available. Add a provider key in Settings.
      </div>
    );
  }

  const handleSelect = (opt: ImageModelOption) => {
    if (opt.available === false) {
      router.push("/settings");
      return;
    }
    if (isStreaming || selectedId) return;
    setSelectedId(opt.id);
    const prompt = (originalPrompt || "").trim();
    // Imperative + explicit model id so the agent calls generate_image(model=…) immediately.
    const followUp = prompt
      ? `Generate the image now using model "${opt.id}" (do not ask again). Prompt: ${prompt}`
      : `Generate the image now using model "${opt.id}" (do not ask again).`;
    sendQuickPrompt(followUp);
  };

  return (
    <div
      className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-4 space-y-3 animate-fade-slide-up"
      style={{
        boxShadow: "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-indigo-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-100">Choose an image model</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {payload.message && !payload.message.toLowerCase().includes("unknown")
              ? payload.message
              : "Select a model to continue generation. Your choice applies to this image."}
          </p>
          {locked.length > 0 && (
            <p className="text-[11px] text-amber-400/90 mt-1.5">
              Gemini / Nano Banana need a Gemini API key in Settings (same key unlocks both).
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((opt) => {
          const style = PROVIDER_STYLE[opt.provider] || PROVIDER_STYLE.openai;
          const isLocked = opt.available === false;
          const isSelected = selectedId === opt.id;
          const isDisabled = !isLocked && (!!selectedId || isStreaming);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={isDisabled && !isSelected}
              onClick={() => handleSelect(opt)}
              className={cn(
                "text-left rounded-xl border px-3.5 py-3 transition-all duration-200",
                "bg-black/25 border-white/[0.08]",
                isLocked && "border-dashed border-amber-500/30 bg-amber-950/10 hover:border-amber-500/50",
                !isLocked && !isDisabled && style.accent,
                isSelected && "border-indigo-400/50 bg-indigo-500/15 ring-1 ring-indigo-400/30",
                isDisabled && !isSelected && "opacity-40 cursor-not-allowed",
                (!isDisabled || isLocked) && "cursor-pointer"
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  {isLocked ? (
                    <KeyRound size={14} className="text-amber-400 shrink-0" />
                  ) : (
                    <ImageIcon size={14} className="text-gray-400 shrink-0" />
                  )}
                  <span className="text-sm font-medium text-gray-100 truncate">{opt.label}</span>
                </div>
                {isSelected ? (
                  isStreaming ? (
                    <Loader2 size={14} className="text-indigo-300 animate-spin shrink-0" />
                  ) : (
                    <Check size={14} className="text-indigo-300 shrink-0" />
                  )
                ) : isLocked ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 bg-amber-500/15 text-amber-300 border-amber-500/25">
                    Add key
                  </span>
                ) : (
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full border shrink-0",
                      style.badge
                    )}
                  >
                    {providerLabel(opt.provider)}
                  </span>
                )}
              </div>
              {opt.description && (
                <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">
                  {opt.description}
                </p>
              )}
              <p className="text-[10px] text-gray-600 font-mono mt-1.5 truncate">{opt.id}</p>
            </button>
          );
        })}
      </div>

      {ready.length === 0 && (
        <button
          type="button"
          onClick={() => router.push("/settings")}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium
            bg-amber-600/90 hover:bg-amber-500 text-white transition-colors border border-amber-400/20"
        >
          <ExternalLink size={13} />
          Open Image Providers
        </button>
      )}

      {selectedId && (
        <p className="text-[11px] text-indigo-300/80 flex items-center gap-1.5">
          {isStreaming ? (
            <>
              <Loader2 size={11} className="animate-spin" /> Generating with {selectedId}…
            </>
          ) : (
            <>
              <Check size={11} /> Selected {selectedId}
            </>
          )}
        </p>
      )}
    </div>
  );
}
