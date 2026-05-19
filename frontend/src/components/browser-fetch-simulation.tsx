"use client";

/**
 * Cinematic “browser session” simulation shown while fetch_url runs on the backend.
 * Visually mimics Chrome-style chrome + loading phases; the real HTTP work is server-side.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Lock,
  RefreshCw,
  Shield,
  FileSearch,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PHASES = [
  { label: "Resolving host & routing…", sub: "DNS lookup", icon: Globe },
  { label: "Securing connection (TLS)…", sub: "HTTPS handshake", icon: Lock },
  { label: "Downloading document…", sub: "Following redirects", icon: RefreshCw },
  { label: "Parsing HTML structure…", sub: "Building DOM snapshot", icon: FileSearch },
  { label: "Extracting readable content…", sub: "Stripping chrome & scripts", icon: Sparkles },
] as const;

function parseDisplayUrl(raw: string): { host: string; path: string; full: string } {
  try {
    const u = new URL(raw.trim());
    const path = (u.pathname + u.search) || "/";
    return { host: u.host, path: path.length > 48 ? path.slice(0, 46) + "…" : path, full: raw };
  } catch {
    const t = raw.trim();
    return { host: "target", path: "/", full: t.length > 80 ? t.slice(0, 78) + "…" : t };
  }
}

export interface BrowserFetchSimulationProps {
  url: string;
  /** queued = URL detected, agent still reasoning; active = fetch_url is running */
  stage?: "queued" | "active";
  className?: string;
}

export function extractFirstUrlFromText(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;)\]]+$/, "");
}

export default function BrowserFetchSimulation({
  url,
  stage = "active",
  className,
}: BrowserFetchSimulationProps) {
  const { host, path, full } = useMemo(() => parseDisplayUrl(url), [url]);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const start = useRef(Date.now());

  useEffect(() => {
    if (stage !== "active") return;
    const id = setInterval(() => {
      setPhaseIdx((i) => (i + 1) % PHASES.length);
      setTick((t) => t + 1);
    }, 2400);
    return () => clearInterval(id);
  }, [stage]);

  const elapsed = Math.floor((Date.now() - start.current) / 1000);
  const PhaseIcon = PHASES[phaseIdx].icon;

  if (stage === "queued") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "relative rounded-xl overflow-hidden border border-indigo-500/20 bg-gradient-to-br from-[#14142a]/95 to-[#0a0a18]/98",
          className
        )}
        style={{
          boxShadow: "0 8px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
          <div className="flex gap-1 shrink-0">
            <span className="h-2 w-2 rounded-full bg-[#ff5f57]/80" />
            <span className="h-2 w-2 rounded-full bg-[#febc2e]/80" />
            <span className="h-2 w-2 rounded-full bg-[#28c840]/80" />
          </div>
          <span className="text-[9px] uppercase tracking-widest text-indigo-400/70 font-medium">
            Browser session
          </span>
        </div>
        <div className="px-3 py-3 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-indigo-500/15 bg-black/30 px-2 py-1.5">
            <Globe size={12} className="text-indigo-400 shrink-0 animate-pulse" />
            <span className="text-[10px] font-mono text-gray-400 truncate">{full}</span>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Preparing to load this URL from the AIPiloty server — you’ll see live fetch phases once
            the agent invokes <span className="text-indigo-300 font-mono">fetch_url</span>.
          </p>
          <motion.div
            className="h-0.5 rounded-full bg-gray-800 overflow-hidden"
            initial={false}
          >
            <motion.div
              className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-600 to-violet-500"
              animate={{ x: ["-30%", "220%"] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={cn("relative rounded-xl overflow-hidden select-none", className)}
      style={{
        border: "1px solid rgba(99,102,241,0.2)",
        boxShadow:
          "0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
        background: "linear-gradient(165deg, rgba(22,22,38,0.98) 0%, rgba(12,12,24,0.99) 100%)",
      }}
    >
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[120%] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{
          background: "radial-gradient(ellipse at center, rgba(99,102,241,0.35), transparent 70%)",
        }}
      />

      {/* Window title bar — macOS-ish */}
      <div className="relative flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] bg-black/25">
        <div className="flex gap-1.5 shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/90" />
        </div>
        <div className="flex-1 flex justify-center min-w-0 px-2">
          <div className="flex items-center gap-1.5 max-w-[min(100%,420px)] rounded-md bg-black/35 border border-white/[0.07] px-2.5 py-1">
            <Globe size={11} className="text-indigo-400/80 shrink-0" />
            <span className="text-[10px] text-gray-500 truncate tabular-nums">
              Fetch preview — {host}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[9px] text-gray-600 font-mono tabular-nums shrink-0">
          {elapsed}s
        </div>
      </div>

      {/* Toolbar + URL bar */}
      <div className="relative px-3 py-2.5 space-y-2 border-b border-white/[0.05]">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
            className="text-indigo-400/70"
          >
            <RefreshCw size={14} />
          </motion.div>
          <div
            className="flex-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 min-w-0"
            style={{
              background: "linear-gradient(90deg, rgba(30,27,60,0.9), rgba(20,20,40,0.95))",
              border: "1px solid rgba(99,102,241,0.15)",
            }}
          >
            <Lock size={12} className="text-emerald-500/80 shrink-0" />
            <div className="min-w-0 flex-1 font-mono text-[11px] leading-tight">
              <span className="text-indigo-300/90">https://</span>
              <span className="text-gray-200">{host}</span>
              <span className="text-gray-500">{path}</span>
            </div>
            <motion.div
              className="h-1 w-16 rounded-full overflow-hidden bg-gray-800/80 shrink-0"
              aria-hidden
            >
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-indigo-600 via-violet-500 to-cyan-400"
                animate={{ x: ["-100%", "100%"] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                style={{ width: "45%" }}
              />
            </motion.div>
          </div>
        </div>

        {/* Phase strip */}
        <AnimatePresence mode="wait">
          <motion.div
            key={phaseIdx + tick * 0}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2 rounded-lg bg-indigo-950/40 border border-indigo-500/15 px-2.5 py-1.5"
          >
            <div className="p-1 rounded-md bg-indigo-500/15 border border-indigo-500/20">
              <PhaseIcon size={13} className="text-indigo-300" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-gray-200 leading-snug">
                {PHASES[phaseIdx].label}
              </p>
              <p className="text-[9px] text-gray-500 font-mono">{PHASES[phaseIdx].sub}</p>
            </div>
            <ArrowRight size={12} className="text-indigo-400/50 shrink-0 animate-pulse" />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Fake viewport — “page loading” */}
      <div className="relative px-3 py-3 min-h-[140px]">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-indigo-950/10 to-transparent pointer-events-none" />
        <div className="space-y-2 relative">
          {[0.92, 0.75, 0.88, 0.6, 0.82].map((w, i) => (
            <motion.div
              key={i}
              className="h-2 rounded-full bg-gradient-to-r from-gray-700/50 via-gray-600/40 to-gray-700/50"
              style={{ width: `${w * 100}%` }}
              initial={{ opacity: 0.3, scaleX: 0.96 }}
              animate={{
                opacity: [0.35, 0.65, 0.35],
                scaleX: [0.96, 1, 0.96],
              }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                delay: i * 0.15,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
        <motion.div
          className="absolute left-3 right-3 h-px bg-gradient-to-r from-transparent via-cyan-400/45 to-transparent pointer-events-none z-10"
          initial={{ top: "14%" }}
          animate={{ top: ["14%", "78%", "32%", "65%", "14%"] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="mt-3 flex items-center gap-2 text-[9px] text-gray-600">
          <Shield size={10} className="text-emerald-500/60" />
          <span>
            Server-side fetch · content will be summarized from the real response (not a recording of
            your Chrome).
          </span>
        </div>
      </div>

      {/* Footer — real URL for power users */}
      <div className="px-3 py-1.5 border-t border-white/[0.05] bg-black/20">
        <p className="text-[9px] font-mono text-gray-600 truncate" title={full}>
          {full}
        </p>
      </div>
    </motion.div>
  );
}

/** Extract target URL from the in-flight fetch_url tool call on this message. */
export function getActiveFetchUrlFromMessage(msg: {
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  toolResults?: Array<{ name: string }>;
}): string | null {
  const pending =
    msg.toolCalls?.filter((tc) => !msg.toolResults?.some((r) => r.name === tc.name)) ?? [];
  const fetch = pending.find((tc) => tc.name === "fetch_url");
  const u = fetch?.arguments?.url;
  return typeof u === "string" && u.trim().length > 0 ? u.trim() : null;
}
