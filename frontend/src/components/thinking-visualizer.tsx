"use client";

import { useState, useEffect } from "react";
import { useChatStore } from "@/stores/chat-store";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Lightweight SVG + live log tail during the LLM "pre-tool" streaming phase.
 * Stays visible while tokens stream and `pendingToolInThisTurn` keeps systemState on thinking.
 */
export default function ThinkingVisualizer() {
  const systemState = useChatStore((s) => s.systemState);
  const avatarPhase = useChatStore((s) => s.avatarPhase);
  const backgroundLogs = useChatStore((s) => s.backgroundLogs);
  const llmWaitStartedAt = useChatStore((s) => s.llmWaitStartedAt);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (llmWaitStartedAt == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [llmWaitStartedAt]);

  if (systemState !== "thinking" && avatarPhase !== "thinking") return null;

  const logTail = backgroundLogs.slice(-4);
  const elapsedSec =
    llmWaitStartedAt != null
      ? Math.max(0, Math.floor((Date.now() - llmWaitStartedAt) / 1000))
      : 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      className="px-1 py-1"
    >
      <div className="bg-gray-900/40 border border-gray-800/30 rounded-lg p-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 font-medium">
            Processing
          </p>
          {llmWaitStartedAt != null && (
            <span className="text-[10px] font-mono text-indigo-400/90 tabular-nums">
              {elapsedSec}s
            </span>
          )}
        </div>
        <AnimatePresence mode="popLayout">
          {logTail.length > 0 && (
            <motion.div
              key={logTail.map((l) => l.id).join("-")}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0 }}
              className="mb-2 space-y-0.5 max-h-[4.5rem] overflow-hidden"
            >
              {logTail.map((log) => (
                <p
                  key={log.id}
                  className={cn(
                    "text-[10px] font-mono leading-tight truncate",
                    log.level === "warn" && "text-amber-500/90",
                    log.level === "error" && "text-red-400/90",
                    log.level === "info" && "text-cyan-500/75"
                  )}
                >
                  ▸ {log.message}
                </p>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <svg viewBox="0 0 200 50" className="w-full h-8 overflow-visible" fill="none">
          {/* Input node */}
          <circle cx="15" cy="25" r="4" className="fill-indigo-500/60">
            <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
          </circle>

          {/* Branch lines */}
          <path d="M19 25 Q50 10, 80 12" className="stroke-indigo-500/30" strokeWidth="1" />
          <path d="M19 25 Q50 25, 80 25" className="stroke-indigo-500/40" strokeWidth="1.2" />
          <path d="M19 25 Q50 40, 80 38" className="stroke-indigo-500/30" strokeWidth="1" />

          {/* Branch nodes */}
          <circle cx="80" cy="12" r="3" className="fill-purple-500/40">
            <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.5s" begin="0.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="80" cy="25" r="3.5" className="fill-indigo-500/60">
            <animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <circle cx="80" cy="38" r="3" className="fill-purple-500/40">
            <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.5s" begin="0.4s" repeatCount="indefinite" />
          </circle>

          {/* Merge lines */}
          <path d="M83 12 Q120 15, 145 25" className="stroke-emerald-500/25" strokeWidth="1" />
          <path d="M83.5 25 Q120 25, 145 25" className="stroke-emerald-500/40" strokeWidth="1.2" />
          <path d="M83 38 Q120 35, 145 25" className="stroke-emerald-500/25" strokeWidth="1" />

          {/* Decision node */}
          <circle cx="150" cy="25" r="4" className="fill-emerald-500/50">
            <animate attributeName="r" values="3;5;3" dur="2s" begin="0.5s" repeatCount="indefinite" />
          </circle>

          {/* Output arrow */}
          <path d="M155 25 L185 25" className="stroke-emerald-500/30" strokeWidth="1" strokeDasharray="3,3">
            <animate attributeName="stroke-dashoffset" values="6;0" dur="1s" repeatCount="indefinite" />
          </path>
          <polygon points="185,22 192,25 185,28" className="fill-emerald-500/40" />

          {/* Heat zone glow */}
          <circle cx="80" cy="25" r="15" className="fill-indigo-500/5">
            <animate attributeName="r" values="12;18;12" dur="3s" repeatCount="indefinite" />
          </circle>
          <circle cx="150" cy="25" r="12" className="fill-emerald-500/5">
            <animate attributeName="r" values="10;15;10" dur="3s" begin="0.5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
    </motion.div>
  );
}
