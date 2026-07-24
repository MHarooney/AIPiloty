"use client";

import { useMissionStore } from "@/stores/mission-store";

export default function EvidencePanel() {
  const evidence = useMissionStore((s) => s.evidence);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-2">Evidence</div>
      {evidence.length === 0 ? (
        <p className="text-[11px] text-gray-600">
          Run Probe or ask the agent — structured proof appears here (not a raw terminal dump).
        </p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((ev, i) => (
            <li
              key={`${ev.step}-${i}`}
              className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-gray-200">{ev.step}</span>
                <span
                  className={
                    ev.status === "success"
                      ? "text-[10px] text-emerald-400"
                      : ev.status === "failed"
                        ? "text-[10px] text-rose-400"
                        : "text-[10px] text-amber-400"
                  }
                >
                  {ev.status}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">{ev.summary}</p>
              {ev.snippet && (
                <pre className="mt-1 text-[9px] text-gray-500 whitespace-pre-wrap max-h-24 overflow-y-auto font-mono">
                  {ev.snippet.slice(0, 400)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
