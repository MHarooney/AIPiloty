"use client";

import { useEffect } from "react";
import { useMissionStore } from "@/stores/mission-store";
import MissionChip from "./mission-chip";
import OwnershipStrip from "./ownership-strip";
import ContextRunway from "./context-runway";
import ClearanceGate from "./clearance-gate";
import IncidentBanner from "./incident-banner";
import EvidencePanel from "./evidence-panel";

/**
 * Flight Deck chrome around chat — Mission scope, ownership, runway, clearance.
 * Chat remains central; this is contextual layers (Mission Control concept).
 */
export default function FlightDeckShell({ children }: { children: React.ReactNode }) {
  const loadMissions = useMissionStore((s) => s.loadMissions);
  const activeMission = useMissionStore((s) => s.activeMission);

  useEffect(() => {
    loadMissions();
  }, [loadMissions]);

  return (
    <div className="flex flex-1 min-h-0 min-w-0">
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <div className="relative z-20 px-3 pt-2 pb-1 space-y-2 border-b border-white/5 bg-[#070b14]/80 backdrop-blur-md">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <MissionChip />
            <OwnershipStrip />
          </div>
          <IncidentBanner />
          <ClearanceGate />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>

      {activeMission && (
        <aside className="hidden xl:flex w-[300px] shrink-0 flex-col border-l border-white/5 bg-[#060a12]/90 backdrop-blur-md">
          <ContextRunway />
          <EvidencePanel />
        </aside>
      )}
    </div>
  );
}
