"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { AvatarPhase } from "@/stores/chat-store";

export interface AIAvatarProps {
  size?: "sm" | "md" | "lg";
  phase?: AvatarPhase;
  /** @deprecated Use phase */
  isThinking?: boolean;
  className?: string;
  /** Fallback to CSS/SVG hologram (e.g. low-power devices) */
  force2D?: boolean;
}

const sizeMap = { sm: 28, md: 36, lg: 72 };

/* Holographic fallback — loading + force2D only */

const PHASE_COLORS: Record<AvatarPhase, { ring: string; glow: string; eye: string; bg: string }> = {
  idle: { ring: "#38bdf8", glow: "#0ea5e9", eye: "#e0f2fe", bg: "linear-gradient(135deg,#0c4a6e,#0369a1,#0ea5e9)" },
  thinking: { ring: "#818cf8", glow: "#6366f1", eye: "#e0e7ff", bg: "linear-gradient(135deg,#312e81,#4338ca,#6366f1)" },
  tool_running: { ring: "#fbbf24", glow: "#f59e0b", eye: "#fef3c7", bg: "linear-gradient(135deg,#451a03,#92400e,#d97706)" },
  success: { ring: "#34d399", glow: "#10b981", eye: "#d1fae5", bg: "linear-gradient(135deg,#064e3b,#059669,#10b981)" },
  error: { ring: "#fb7185", glow: "#f43f5e", eye: "#ffe4e6", bg: "linear-gradient(135deg,#881337,#be123c,#f43f5e)" },
  waiting_approval: { ring: "#fbbf24", glow: "#f59e0b", eye: "#fef9c3", bg: "linear-gradient(135deg,#451a03,#854d0e,#ca8a04)" },
  analyzing_risk: { ring: "#f87171", glow: "#ef4444", eye: "#fee2e2", bg: "linear-gradient(135deg,#7f1d1d,#b91c1c,#ef4444)" },
  explaining: { ring: "#86efac", glow: "#22c55e", eye: "#dcfce7", bg: "linear-gradient(135deg,#14532d,#15803d,#22c55e)" },
};

export function HolographicAvatar({ size, phase = "idle" }: { size: number; phase?: AvatarPhase }) {
  const c = PHASE_COLORS[phase];
  const isActive = phase === "thinking" || phase === "tool_running" || phase === "analyzing_risk";

  return (
    <div
      className="relative rounded-2xl overflow-hidden"
      style={{
        width: size,
        height: size,
        background: c.bg,
        boxShadow: `0 0 ${Math.max(8, size * 0.25)}px ${c.glow}40`,
      }}
    >
      <svg viewBox="0 0 64 64" className="w-full h-full opacity-90">
        <ellipse cx="32" cy="26" rx="18" ry="16" fill="white" fillOpacity="0.15" />
        <rect x="14" y="18" width="36" height="18" rx="8" fill="#0f172a" fillOpacity="0.85" />
        <ellipse cx="24" cy="27" rx="5" ry="7" fill={c.eye} opacity="0.95">
          {isActive && <animate attributeName="opacity" values="0.7;1;0.7" dur="1.2s" repeatCount="indefinite" />}
        </ellipse>
        <ellipse cx="40" cy="27" rx="5" ry="7" fill={c.eye} opacity="0.95">
          {isActive && <animate attributeName="opacity" values="0.7;1;0.7" dur="1.2s" begin="0.15s" repeatCount="indefinite" />}
        </ellipse>
        <circle cx="32" cy="42" r="6" fill={c.ring} fillOpacity="0.5" />
      </svg>
    </div>
  );
}

const Robot3DCanvas = dynamic(() => import("./robot-3d-canvas"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[28px] rounded-2xl bg-gradient-to-br from-sky-900/50 via-slate-900/40 to-cyan-900/40 animate-pulse border border-sky-500/10" />
  ),
});

export default function AIAvatar({
  size = "md",
  phase,
  isThinking = false,
  className,
  force2D = false,
}: AIAvatarProps) {
  const px = sizeMap[size];
  const resolvedPhase: AvatarPhase = phase ?? (isThinking ? "thinking" : "idle");

  if (force2D) {
    return (
      <div className={cn("relative flex-shrink-0", className)} style={{ width: px, height: px }}>
        <HolographicAvatar size={px} phase={resolvedPhase} />
      </div>
    );
  }

  return (
    <div className={cn("relative flex-shrink-0 rounded-2xl overflow-hidden", className)} style={{ width: px, height: px }}>
      <Robot3DCanvas size={px} phase={resolvedPhase} />
    </div>
  );
}
