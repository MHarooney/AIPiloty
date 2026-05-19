/** Shared design tokens — single source of truth for colors, radii, and glass effects. */

export const STATUS_COLORS = {
  active: { bg: "bg-indigo-500/20", text: "text-indigo-300", dot: "bg-indigo-400" },
  completed: { bg: "bg-emerald-500/20", text: "text-emerald-300", dot: "bg-emerald-400" },
  error: { bg: "bg-red-500/20", text: "text-red-300", dot: "bg-red-400" },
  pending: { bg: "bg-gray-500/20", text: "text-gray-400", dot: "bg-gray-500" },
} as const;

export const RISK_COLORS = {
  low: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  medium: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
  high: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
  critical: { bg: "bg-red-500/15", text: "text-red-300", border: "border-red-400/40" },
} as const;

export const PHASE_COLORS = {
  thinking: "text-purple-400",
  planning: "text-indigo-400",
  executing: "text-emerald-400",
  waiting_approval: "text-amber-400",
  idle: "text-gray-500",
} as const;

export const CARD_RADIUS = "rounded-xl";
export const CARD_GLASS = "bg-gray-900/60 backdrop-blur-md border border-gray-700/40";
