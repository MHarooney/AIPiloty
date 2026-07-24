"use client";

import { useMissionStore } from "@/stores/mission-store";
import { cn } from "@/lib/utils";

export default function ContextRunway() {
  const mission = useMissionStore((s) => s.activeMission);
  const runway = useMissionStore((s) => s.runway);

  if (!mission) return null;

  return (
    <div className="p-3 border-b border-white/5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-500/80 mb-2">
        Context Runway
      </div>
      <div className="space-y-1 text-[11px] text-gray-400 mb-3">
        <div><span className="text-gray-500">Tenant</span> · {mission.project_name}</div>
        <div><span className="text-gray-500">Env</span> · {mission.environment}</div>
        <div><span className="text-gray-500">Branch</span> · {mission.branch || "—"}</div>
        <div className="truncate"><span className="text-gray-500">VM</span> · {mission.vm?.host_ip || "—"}</div>
        <div className="truncate"><span className="text-gray-500">FE</span> · {mission.container_name || "—"}</div>
        <div className="truncate"><span className="text-gray-500">BE</span> · {mission.backend_container || "—"}</div>
      </div>

      <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-2">Runway</div>
      <ol className="space-y-2">
        {runway.map((step, i) => (
          <li key={step.id} className="flex items-start gap-2 text-[11px]">
            <span
              className={cn(
                "mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 border",
                step.status === "success" && "bg-emerald-500/20 border-emerald-400/40 text-emerald-300",
                step.status === "failed" && "bg-rose-500/20 border-rose-400/40 text-rose-300",
                step.status === "running" && "bg-cyan-500/20 border-cyan-400/40 text-cyan-300 animate-pulse",
                step.status === "pending" && "bg-white/5 border-white/10 text-gray-500"
              )}
            >
              {step.status === "success" ? "✓" : step.status === "failed" ? "!" : i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-gray-200">{step.label}</div>
              {step.summary && <div className="text-[10px] text-gray-500 truncate">{step.summary}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
