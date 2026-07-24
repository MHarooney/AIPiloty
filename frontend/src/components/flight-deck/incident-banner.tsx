"use client";

import { AlertTriangle, X } from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";

export default function IncidentBanner() {
  const incident = useMissionStore((s) => s.incident);
  const setIncident = useMissionStore((s) => s.setIncident);
  const mission = useMissionStore((s) => s.activeMission);

  if (!incident.active) return null;

  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 flex items-start gap-2">
      <AlertTriangle size={14} className="text-rose-300 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-rose-100">Incident Mode · {incident.title}</div>
        <p className="text-[11px] text-rose-200/70 mt-0.5">
          {mission ? `Matched mission: ${mission.name}` : "No mission attached — select one"}
          {incident.path ? ` · Path: ${incident.path === "local_fix" ? "Local fix → push → ship" : "Server-only ops"}` : ""}
          {incident.confidence != null ? ` · Confidence ${(incident.confidence * 100).toFixed(0)}%` : ""}
        </p>
      </div>
      <button
        type="button"
        className="text-rose-300/70 hover:text-rose-200"
        onClick={() => setIncident(null)}
        aria-label="Dismiss incident"
      >
        <X size={14} />
      </button>
    </div>
  );
}
