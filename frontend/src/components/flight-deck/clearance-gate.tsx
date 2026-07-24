"use client";

import { ShieldAlert } from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";
import { useChatStore } from "@/stores/chat-store";
import { toast } from "sonner";

export default function ClearanceGate() {
  const clearance = useMissionStore((s) => s.clearance);
  const clearClearance = useMissionStore((s) => s.clearClearance);
  const sendQuickPrompt = useChatStore((s) => s.sendQuickPrompt);
  const chatMode = useChatStore((s) => s.chatMode);

  if (!clearance) return null;

  const riskColor =
    clearance.risk === "high"
      ? "border-rose-500/40 bg-rose-500/10"
      : clearance.risk === "medium"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-emerald-500/40 bg-emerald-500/10";

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${riskColor}`}>
      <div className="flex items-start gap-2">
        <ShieldAlert size={16} className="text-amber-300 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-gray-100">
            Clearance required · {clearance.action}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">{clearance.why}</p>
          <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-gray-500">
            <span>Risk: {clearance.risk}</span>
            {clearance.impact && <span>Impact: {clearance.impact}</span>}
            {clearance.lane && <span>Lane: {clearance.lane}</span>}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => {
                const action = clearance.action;
                clearClearance();
                toast.warning("Clearance granted — executing on active Mission only");
                sendQuickPrompt(
                  `CLEARANCE GRANTED for: ${action}. Proceed only on the active Mission (do not touch sibling containers). Mode=${chatMode}.`
                );
              }}
            >
              Approve
            </button>
            <button
              type="button"
              className="px-2.5 py-1 rounded-lg text-[11px] border border-white/15 text-gray-300 hover:bg-white/5"
              onClick={clearClearance}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
