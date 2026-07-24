"use client";

import { useRouter } from "next/navigation";
import { Crosshair, ChevronDown, Radar, Plus } from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";

export default function MissionChip() {
  const router = useRouter();
  const missions = useMissionStore((s) => s.missions);
  const active = useMissionStore((s) => s.activeMission);
  const setActive = useMissionStore((s) => s.setActiveMission);
  const ensureLmsTest = useMissionStore((s) => s.ensureLmsTest);
  const probeActive = useMissionStore((s) => s.probeActive);
  const probing = useMissionStore((s) => s.probing);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const statusColor =
    active?.status === "running"
      ? "bg-emerald-400"
      : active?.status === "failed"
        ? "bg-rose-400"
        : "bg-amber-400";

  return (
    <div ref={ref} className="relative flex items-center gap-2 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-xl border text-left min-w-0",
          "bg-[#0c1220] border-cyan-500/25 hover:border-cyan-400/40 transition-colors"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={active ? `Mission: ${active.name}` : "Select a Mission"}
      >
        <Crosshair size={14} className="text-cyan-400 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusColor)} />
            <span className="text-xs font-semibold text-gray-100 truncate max-w-[200px]">
              {active?.name || "No Mission"}
            </span>
          </div>
          <p className="text-[10px] text-gray-500 truncate max-w-[220px]">
            {active
              ? `${active.environment} · ${active.vm?.host_ip || "no VM"} · ${active.public_url || "no URL"}`
              : "Attach a deployment to scope Flight Deck"}
          </p>
        </div>
        <ChevronDown size={14} className="text-gray-500 shrink-0" />
      </button>

      {active && (
        <button
          type="button"
          disabled={probing}
          onClick={async () => {
            try {
              await probeActive();
              toast.success("Read-only probe complete");
            } catch (e: any) {
              toast.error(e?.message || "Probe failed");
            }
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-50"
          title="Safe read-only health probe"
        >
          <Radar size={12} className={probing ? "animate-spin text-cyan-400" : "text-cyan-400"} />
          Probe
        </button>
      )}

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 z-50 w-[320px] rounded-xl border border-white/10 bg-[#0b1220] shadow-2xl overflow-hidden"
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/5">
            Missions
          </div>
          <div className="max-h-64 overflow-y-auto">
            {missions.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-500">No missions yet.</p>
            )}
            {missions.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={active?.id === m.id}
                onClick={() => {
                  setActive(m);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-2.5 text-xs hover:bg-white/5 border-b border-white/5",
                  active?.id === m.id && "bg-cyan-500/10"
                )}
              >
                <div className="font-medium text-gray-100">{m.name}</div>
                <div className="text-[10px] text-gray-500 truncate">
                  {m.environment} · {m.public_url || m.container_name || "—"}
                </div>
              </button>
            ))}
          </div>
          <div className="p-2 flex gap-2 border-t border-white/5">
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30"
              onClick={async () => {
                try {
                  await ensureLmsTest();
                  toast.success("LMS Test mission ready");
                  setOpen(false);
                } catch (e: any) {
                  toast.error(e?.message || "Failed to register LMS Test");
                }
              }}
            >
              <Plus size={12} /> LMS Test
            </button>
            <button
              type="button"
              className="flex-1 px-2 py-1.5 rounded-lg text-[11px] border border-white/10 text-gray-300 hover:bg-white/5"
              onClick={() => {
                setOpen(false);
                router.push("/deployments");
              }}
            >
              Mission Board
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
