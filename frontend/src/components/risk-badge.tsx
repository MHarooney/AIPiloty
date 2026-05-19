"use client";

import { cn } from "@/lib/utils";

export type RiskLevel = "safe" | "low" | "moderate" | "high" | "critical";

interface RiskBadgeProps {
  level: RiskLevel | string;
  pulse?: boolean;
  className?: string;
}

const RISK_CONFIG: Record<string, { emoji: string; bg: string; text: string; border: string }> = {
  safe:     { emoji: "🟢", bg: "bg-emerald-900/40", text: "text-emerald-300", border: "border-emerald-500/30" },
  low:      { emoji: "🟢", bg: "bg-emerald-900/40", text: "text-emerald-300", border: "border-emerald-500/30" },
  moderate: { emoji: "🟡", bg: "bg-amber-900/40",   text: "text-amber-300",   border: "border-amber-500/30" },
  high:     { emoji: "🔴", bg: "bg-red-900/40",     text: "text-red-300",     border: "border-red-500/30" },
  critical: { emoji: "🔴", bg: "bg-red-900/50",     text: "text-red-200",     border: "border-red-500/50" },
};

/**
 * Reusable risk level badge with emoji, color coding, and optional pulse animation.
 */
export default function RiskBadge({ level, pulse = false, className }: RiskBadgeProps) {
  const normalized = level.toLowerCase();
  const config = RISK_CONFIG[normalized] || RISK_CONFIG.moderate;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border",
        config.bg,
        config.text,
        config.border,
        pulse && normalized === "critical" && "animate-pulse",
        className
      )}
    >
      <span>{config.emoji}</span>
      <span>{level}</span>
    </span>
  );
}
