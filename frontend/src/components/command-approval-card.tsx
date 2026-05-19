"use client";

import { useChatStore, type PendingApproval } from "@/stores/chat-store";
import { ShieldAlert, Check, X, Zap, Terminal, Server, HardDrive, Wifi } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import RiskBadge from "./risk-badge";

/* ── Resource icon map ── */
const RESOURCE_ICONS: Record<string, React.ElementType> = {
  VM: Server,
  network: Wifi,
  filesystem: HardDrive,
};

/* ── Risk color scheme ── */
const RISK_COLORS: Record<string, { border: string; bg: string; glow: string }> = {
  critical: { border: "border-red-500/40", bg: "bg-red-950/20", glow: "shadow-red-500/10" },
  high:     { border: "border-amber-500/40", bg: "bg-amber-950/20", glow: "shadow-amber-500/10" },
  moderate: { border: "border-yellow-500/30", bg: "bg-yellow-950/15", glow: "shadow-yellow-500/05" },
  safe:     { border: "border-emerald-500/30", bg: "bg-emerald-950/15", glow: "shadow-emerald-500/05" },
  low:      { border: "border-emerald-500/30", bg: "bg-emerald-950/15", glow: "shadow-emerald-500/05" },
};

interface CommandApprovalCardProps {
  approval: PendingApproval;
}

/**
 * Cinematic Command Intent Card for the Trust & Control Layer.
 * Renders before execution to display command details, risk analysis,
 * and action buttons (Accept / Skip / Auto-accept).
 */
export default function CommandApprovalCard({ approval }: CommandApprovalCardProps) {
  const { approveToolExecution, denyToolExecution, setApprovalSettings, approvalSettings } = useChatStore();
  const isPending = approval.status === "pending";
  const isApproved = approval.status === "approved";
  const isDenied = approval.status === "denied";
  const colors = RISK_COLORS[approval.riskLevel] || RISK_COLORS.high;

  const handleAutoApproveSession = () => {
    setApprovalSettings({ autoApproveSession: true });
    approveToolExecution();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "rounded-xl border backdrop-blur-md p-4 transition-all duration-300 shadow-lg",
        isPending && `${colors.border} ${colors.bg} ${colors.glow}`,
        isPending && "tension-pulse",
        isApproved && "border-green-500/30 bg-green-950/15",
        isDenied && "border-gray-700/30 bg-gray-900/30 opacity-50"
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isPending && "bg-gradient-to-br from-amber-900/40 to-red-900/40",
            isApproved && "bg-green-900/30",
            isDenied && "bg-gray-800/50"
          )}
        >
          {isPending && <ShieldAlert size={18} className="text-amber-400" />}
          {isApproved && <Check size={18} className="text-green-400" />}
          {isDenied && <X size={18} className="text-gray-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-200">
              {isPending ? "Command Approval" : isApproved ? "Approved" : "Skipped"}
            </span>
            <RiskBadge level={approval.riskLevel} pulse={isPending} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
            <Terminal size={10} />
            {approval.tool.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {/* ── Explanation ── */}
      {approval.explanation && isPending && (
        <p className="text-xs text-gray-400 mb-3 leading-relaxed pl-1 border-l-2 border-amber-500/30 ml-1">
          {approval.explanation}
        </p>
      )}

      {/* ── Command preview ── */}
      <div className="bg-black/40 rounded-lg p-3 mb-3 border border-gray-800/50 relative overflow-hidden">
        <pre className="text-[11px] text-gray-300 overflow-x-auto max-h-28 font-mono leading-relaxed scrollbar-thin">
          {JSON.stringify(approval.arguments, null, 2)}
        </pre>
        {/* Subtle scanline effect */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.02]"
          style={{
            background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)",
          }}
        />
      </div>

      {/* ── Affected resources ── */}
      {approval.affectedResources && approval.affectedResources.length > 0 && isPending && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[9px] uppercase tracking-widest text-gray-600 font-medium">Affects:</span>
          {approval.affectedResources.map((resource) => {
            const Icon = RESOURCE_ICONS[resource] || Server;
            return (
              <span
                key={resource}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-800/60 border border-gray-700/40 text-[10px] text-gray-400"
              >
                <Icon size={10} />
                {resource}
              </span>
            );
          })}
        </div>
      )}

      {/* ── Action buttons ── */}
      <AnimatePresence>
        {isPending && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex gap-2"
          >
            {/* Skip */}
            <button
              onClick={denyToolExecution}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg
                bg-gray-800/80 hover:bg-gray-700/80 text-gray-400 hover:text-gray-200
                text-xs font-medium transition-all border border-gray-700/50
                hover:border-gray-600/50 active:scale-[0.97]"
            >
              <X size={14} /> Skip
            </button>

            {/* Accept */}
            <button
              onClick={approveToolExecution}
              className="flex-[2] flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg
                bg-indigo-600/80 hover:bg-indigo-500/80 text-white
                text-xs font-medium transition-all border border-indigo-500/30
                shadow-lg shadow-indigo-500/10
                hover:shadow-indigo-500/20 active:scale-[0.97]"
            >
              <Check size={14} /> Accept & Run
            </button>

            {/* Auto-accept session */}
            {!approvalSettings.autoApproveSession && (
              <button
                onClick={handleAutoApproveSession}
                className="flex items-center justify-center gap-1 px-2.5 py-2.5 rounded-lg
                  bg-gray-800/60 hover:bg-gray-700/60 text-gray-500 hover:text-amber-400
                  text-[10px] font-medium transition-all border border-gray-700/40
                  hover:border-amber-500/30 active:scale-[0.97]"
                title="Auto-accept all commands this session"
              >
                <Zap size={12} />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Resolved status ── */}
      {isApproved && (
        <p className="text-xs text-green-400/70 flex items-center gap-1 mt-1">
          <Check size={12} /> Execution approved — running...
        </p>
      )}
      {isDenied && (
        <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
          <X size={12} /> Execution skipped by user
        </p>
      )}
    </motion.div>
  );
}
