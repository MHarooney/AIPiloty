"use client";

import { useChatStore, type PendingApproval } from "@/stores/chat-store";
import { ShieldAlert, Check, X, Lock, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

const RISK_COLORS: Record<string, { border: string; bg: string; icon: string; badge: string }> = {
  critical: {
    border: "border-red-500/40",
    bg: "bg-red-950/30",
    icon: "text-red-400",
    badge: "bg-red-900/50 text-red-300",
  },
  high: {
    border: "border-amber-500/40",
    bg: "bg-amber-950/30",
    icon: "text-amber-400",
    badge: "bg-amber-900/50 text-amber-300",
  },
};

export default function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const { approveToolExecution, denyToolExecution } = useChatStore();
  const isPending = approval.status === "pending";
  const isApproved = approval.status === "approved";
  const isDenied = approval.status === "denied";
  const colors = RISK_COLORS[approval.riskLevel] || RISK_COLORS.high;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all duration-300",
        isPending && `${colors.border} ${colors.bg}`,
        isApproved && "border-green-500/30 bg-green-950/20",
        isDenied && "border-gray-700/30 bg-gray-900/30 opacity-60"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            isPending && colors.bg,
            isApproved && "bg-green-900/30",
            isDenied && "bg-gray-800/50"
          )}
        >
          {isPending && <ShieldAlert size={16} className={colors.icon} />}
          {isApproved && <Check size={16} className="text-green-400" />}
          {isDenied && <X size={16} className="text-gray-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200">
              {isPending ? "Approval Required" : isApproved ? "Approved" : "Denied"}
            </span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase", colors.badge)}>
              {approval.riskLevel}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
            <Terminal size={10} />
            {approval.tool.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {/* Arguments preview */}
      <div className="bg-black/30 rounded-lg p-2.5 mb-3 border border-gray-800/50">
        <pre className="text-[11px] text-gray-400 overflow-x-auto max-h-24 font-mono leading-relaxed">
          {JSON.stringify(approval.arguments, null, 2)}
        </pre>
      </div>

      {/* Action buttons — only if pending */}
      {isPending && (
        <div className="flex gap-2">
          <button
            onClick={denyToolExecution}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg
              bg-gray-800/80 hover:bg-gray-700/80 text-gray-400 hover:text-gray-200
              text-xs font-medium transition-all border border-gray-700/50"
          >
            <X size={14} /> Deny
          </button>
          <button
            onClick={approveToolExecution}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg
              bg-indigo-600/80 hover:bg-indigo-500/80 text-white
              text-xs font-medium transition-all border border-indigo-500/30
              shadow-lg shadow-indigo-500/10"
          >
            <Lock size={14} /> Approve & Run
          </button>
        </div>
      )}

      {/* Status messages for resolved */}
      {isApproved && (
        <p className="text-xs text-green-400/70 flex items-center gap-1">
          <Check size={12} /> Tool execution approved — running...
        </p>
      )}
      {isDenied && (
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <X size={12} /> Execution denied by user
        </p>
      )}
    </div>
  );
}
