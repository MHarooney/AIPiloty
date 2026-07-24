"use client";

import { useMissionStore } from "@/stores/mission-store";

export default function OwnershipStrip() {
  const own = useMissionStore((s) => s.activeMission?.ownership_summary);
  if (!own) {
    return (
      <div className="text-[10px] text-gray-500 px-2 py-1 rounded-lg border border-white/5 bg-white/[0.02]">
        Ownership · attach a Mission
      </div>
    );
  }

  const lanes = [
    { key: "backend", label: "BE", color: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10", value: own.backend },
    { key: "frontend", label: "FE", color: "text-sky-300 border-sky-500/30 bg-sky-500/10", value: own.frontend },
    { key: "database", label: "DB", color: "text-amber-300 border-amber-500/30 bg-amber-500/10", value: own.database },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 justify-end">
      {lanes.map((l) => (
        <div
          key={l.key}
          title={l.value}
          className={`px-2 py-1 rounded-lg border text-[10px] max-w-[220px] truncate ${l.color}`}
        >
          <span className="font-bold mr-1">{l.label}</span>
          <span className="opacity-90">{l.value}</span>
        </div>
      ))}
    </div>
  );
}
