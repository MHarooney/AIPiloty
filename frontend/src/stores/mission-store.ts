"use client";

import { create } from "zustand";
import {
  ensureLmsTestMission,
  getMissions,
  probeMission,
  type Mission,
  type MissionEvidence,
  type MissionsSummary,
} from "@/lib/api";

const MISSION_STORAGE_KEY = "aipiloty_active_mission_id";

export type RunwayStepState = "pending" | "running" | "success" | "failed" | "skipped";

export interface RunwayStep {
  id: string;
  label: string;
  status: RunwayStepState;
  summary?: string;
  at?: number;
}

export interface ClearanceRequest {
  id: string;
  action: string;
  why: string;
  risk: "low" | "medium" | "high";
  impact?: string;
  lane?: string;
}

export interface IncidentState {
  active: boolean;
  title: string;
  confidence?: number;
  likelyCause?: string;
  path?: "server_only" | "local_fix" | "unknown";
}

interface MissionState {
  missions: Mission[];
  summary: MissionsSummary | null;
  activeMission: Mission | null;
  loading: boolean;
  runway: RunwayStep[];
  evidence: MissionEvidence[];
  clearance: ClearanceRequest | null;
  incident: IncidentState;
  probing: boolean;

  loadMissions: () => Promise<void>;
  setActiveMission: (mission: Mission | null) => void;
  selectMissionById: (id: number) => void;
  ensureLmsTest: () => Promise<Mission | null>;
  probeActive: () => Promise<void>;
  setRunwayFromMission: (mission: Mission | null) => void;
  updateRunwayStep: (id: string, patch: Partial<RunwayStep>) => void;
  pushEvidence: (ev: MissionEvidence) => void;
  requestClearance: (req: Omit<ClearanceRequest, "id">) => void;
  clearClearance: () => void;
  setIncident: (inc: Partial<IncidentState> | null) => void;
  detectIncidentFromText: (text: string) => void;
}

function loadStoredMissionId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MISSION_STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function saveStoredMissionId(id: number | null) {
  if (typeof window === "undefined") return;
  try {
    if (id == null) localStorage.removeItem(MISSION_STORAGE_KEY);
    else localStorage.setItem(MISSION_STORAGE_KEY, String(id));
  } catch {
    /* ignore */
  }
}

const INCIDENT_PATTERNS: { re: RegExp; title: string; path: IncidentState["path"] }[] = [
  { re: /disk\s*(full|space)|no space left/i, title: "Disk pressure detected", path: "server_only" },
  { re: /502|503|504|gateway/i, title: "Gateway / upstream error", path: "server_only" },
  { re: /SQLSTATE|QueryException|migration/i, title: "Database / SQL error", path: "local_fix" },
  { re: /TypeError|ReferenceError|Cannot read propert/i, title: "Frontend runtime error", path: "local_fix" },
  { re: /OOM|out of memory|memory leak/i, title: "Memory pressure", path: "server_only" },
  { re: /container.*(unhealthy|exited|restart)/i, title: "Container health issue", path: "server_only" },
];

export const useMissionStore = create<MissionState>((set, get) => ({
  missions: [],
  summary: null,
  activeMission: null,
  loading: false,
  runway: [],
  evidence: [],
  clearance: null,
  incident: { active: false, title: "" },
  probing: false,

  loadMissions: async () => {
    set({ loading: true });
    try {
      const data = await getMissions();
      const stored = loadStoredMissionId();
      const active =
        (stored && data.missions.find((m) => m.id === stored)) ||
        data.missions.find((m) => (m.public_url || "").includes("lms-test")) ||
        data.missions[0] ||
        null;
      set({ missions: data.missions, summary: data.summary, activeMission: active });
      if (active) {
        saveStoredMissionId(active.id);
        get().setRunwayFromMission(active);
      }
    } catch {
      set({ missions: [], summary: null });
    } finally {
      set({ loading: false });
    }
  },

  setActiveMission: (mission) => {
    saveStoredMissionId(mission?.id ?? null);
    set({ activeMission: mission, evidence: [], clearance: null });
    get().setRunwayFromMission(mission);
  },

  selectMissionById: (id) => {
    const m = get().missions.find((x) => x.id === id) || null;
    get().setActiveMission(m);
  },

  ensureLmsTest: async () => {
    const res = await ensureLmsTestMission();
    await get().loadMissions();
    const m = res.mission;
    get().setActiveMission(m);
    return m;
  },

  probeActive: async () => {
    const m = get().activeMission;
    if (!m) return;
    set({ probing: true });
    try {
      const res = await probeMission(m.id);
      const STEP_ALIASES: Record<string, string[]> = {
        health_check: ["health_check", "public_url", "api_url"],
        docker_inspect: ["docker_inspect", "docker_ps"],
        disk_check: ["disk_check", "disk"],
      };
      const pick = (stepId: string) => {
        const aliases = STEP_ALIASES[stepId] || [stepId];
        for (const a of aliases) {
          const hit = res.evidence.find((e) => e.step === a);
          if (hit) return hit;
        }
        return res.evidence.find((e) => e.step?.includes(stepId));
      };
      const runway = (m.pipeline_steps || []).map((s) => {
        const hit = pick(s.id);
        const st =
          hit?.status === "success"
            ? "success"
            : hit?.status === "failed"
              ? "failed"
              : hit?.status === "warning"
                ? "failed"
                : "pending";
        return {
          id: s.id,
          label: s.label,
          status: st as RunwayStepState,
          summary: hit?.summary,
          at: Date.now(),
        };
      });
      // Compose incident signals from probe evidence (dynamic)
      const signals: string[] = [];
      let likely = "";
      const diskEv = res.evidence.find((e) => e.step === "disk");
      if (diskEv?.snippet && /(\d{2,3})%/.test(diskEv.snippet)) {
        const pct = Number((diskEv.snippet.match(/(\d{2,3})%/) || [])[1] || 0);
        if (pct >= 90) {
          signals.push(`Disk ${pct}%`);
          likely = diskEv.snippet.slice(0, 160);
        }
      }
      const dockerEv = res.evidence.find((e) => e.step === "docker_ps");
      if (dockerEv?.snippet && /unhealthy/i.test(dockerEv.snippet)) {
        signals.push("Unhealthy container");
        likely =
          dockerEv.snippet.split("\n").find((l) => /unhealthy/i.test(l)) ||
          dockerEv.summary ||
          likely;
      }
      if (signals.length) {
        get().setIncident({
          title: signals.join(" · "),
          confidence: 0.9,
          path: "server_only",
          likelyCause: likely,
        });
      }
      set({ evidence: res.evidence, runway });
    } finally {
      set({ probing: false });
    }
  },

  setRunwayFromMission: (mission) => {
    if (!mission) {
      set({ runway: [] });
      return;
    }
    set({
      runway: (mission.pipeline_steps || []).map((s) => ({
        id: s.id,
        label: s.label,
        status: "pending" as RunwayStepState,
      })),
    });
  },

  updateRunwayStep: (id, patch) =>
    set((s) => ({
      runway: s.runway.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  pushEvidence: (ev) => set((s) => ({ evidence: [...s.evidence.slice(-39), ev] })),

  requestClearance: (req) =>
    set({
      clearance: { ...req, id: `clr_${Date.now()}` },
    }),

  clearClearance: () => set({ clearance: null }),

  setIncident: (inc) => {
    if (!inc) set({ incident: { active: false, title: "" } });
    else set((s) => ({ incident: { ...s.incident, active: true, ...inc } }));
  },

  detectIncidentFromText: (text) => {
    for (const p of INCIDENT_PATTERNS) {
      if (p.re.test(text)) {
        set({
          incident: {
            active: true,
            title: p.title,
            confidence: 0.82,
            path: p.path,
            likelyCause: text.slice(0, 160),
          },
        });
        return;
      }
    }
  },
}));
