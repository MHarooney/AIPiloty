"use client";

import type { FinalReport } from "@/stores/chat-store";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Search, BarChart3, Lightbulb, AlertTriangle,
  Brain, ChevronDown, ChevronUp, X, Clock, Zap, TrendingUp, Target, ArrowRight
} from "lucide-react";
import ConfidenceIndicator from "./confidence-indicator";
import { useState } from "react";

/**
 * Strips markdown code fences and tries to extract a readable
 * text from embedded JSON — frontend fallback for clean rendering.
 */
function cleanReportText(text: string): string {
  if (!text) return "";
  // Remove markdown code fences: ```json ... ``` → inner text
  const cleaned = text.replace(/```[\w]*\s*\n?([\s\S]*?)\n?\s*```/g, "$1").trim();
  // If looks like JSON, try to pull out readable field
  if (cleaned.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed === "object" && parsed !== null) {
        const readable = parsed.response || parsed.summary || parsed.message || parsed.result;
        if (typeof readable === "string" && readable.length > 0) {
          return readable.trim();
        }
      }
    } catch {
      // Not valid JSON, use as-is
    }
  }
  return cleaned;
}

const slideIn = {
  initial: { opacity: 0, y: 12, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: 0.4, ease: "easeOut" as const },
};

export interface FinalReportPanelProps {
  report: FinalReport;
  onDismiss?: () => void;
}

/**
 * Enhanced Execution Report with rich animations,
 * detailed insights, beautiful layout, and full responsiveness.
 */
export default function FinalReportPanel({ report: finalReport, onDismiss }: FinalReportPanelProps) {
  const [rawExpanded, setRawExpanded] = useState(false);

  const successSteps = finalReport.steps.filter((s) => s.success).length;
  const failedSteps = finalReport.steps.length - successSteps;
  const successRate = finalReport.steps.length > 0
    ? Math.round((successSteps / finalReport.steps.length) * 100)
    : 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(145deg, rgba(15,23,42,0.95), rgba(10,15,30,0.98))",
        border: "1px solid rgba(99,102,241,0.12)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(99,102,241,0.06), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-gray-800/30 bg-gradient-to-r from-emerald-900/10 to-transparent">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-40" />
          </div>
          <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.15em] text-gray-400 font-semibold">
            Execution Report
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800/60 border border-gray-700/30">
            <Clock size={10} className="text-gray-500" />
            <span className="text-[10px] text-gray-400 font-mono tabular-nums">
              {(finalReport.duration_ms / 1000).toFixed(1)}s
            </span>
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800/60 transition-all"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-5">
        {/* ── Summary ── */}
        <motion.section {...slideIn} transition={{ ...slideIn.transition, delay: 0.1 }}>
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0 mt-0.5">
              <CheckCircle2 size={14} className="text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold mb-1.5">Summary</h4>
              <p className="text-sm text-gray-200 leading-relaxed break-words" style={{ overflowWrap: "anywhere" }}>
                {cleanReportText(finalReport.summary)}
              </p>
            </div>
          </div>
        </motion.section>

        {/* ── What Happened — Step Timeline ── */}
        {finalReport.steps.length > 0 && (
          <motion.section {...slideIn} transition={{ ...slideIn.transition, delay: 0.2 }}>
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 shrink-0 mt-0.5">
                <Search size={14} className="text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold">What Happened</h4>
                  <span className="text-[9px] text-gray-600 font-mono">
                    {successSteps}/{finalReport.steps.length} passed
                  </span>
                </div>
                <div className="space-y-1.5">
                  {finalReport.steps.map((step, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.08, duration: 0.3 }}
                      className="flex items-center gap-2.5 group"
                    >
                      {/* Step connector line */}
                      <div className="relative flex flex-col items-center">
                        <div className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border-2 transition-colors",
                          step.success
                            ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                            : "bg-red-500/15 border-red-500/40 text-red-400"
                        )}>
                          {i + 1}
                        </div>
                        {i < finalReport.steps.length - 1 && (
                          <div className="w-px h-3 bg-gray-800/60 mt-0.5" />
                        )}
                      </div>
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        <span className={cn(
                          "text-xs font-medium truncate",
                          step.success ? "text-gray-300" : "text-red-300"
                        )}>
                          {step.tool.replace(/_/g, " ")}
                        </span>
                        <ArrowRight size={10} className="text-gray-700 shrink-0 hidden sm:block" />
                        <span className={cn(
                          "text-[9px] px-2 py-0.5 rounded-full font-mono shrink-0",
                          step.success
                            ? "bg-emerald-900/40 text-emerald-400 border border-emerald-500/20"
                            : "bg-red-900/40 text-red-400 border border-red-500/20"
                        )}>
                          {step.success ? "✓ done" : "✗ failed"}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {/* ── Key Findings ── */}
        {finalReport.findings.length > 0 && (
          <motion.section {...slideIn} transition={{ ...slideIn.transition, delay: 0.4 }}>
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 shrink-0 mt-0.5">
                <Lightbulb size={14} className="text-purple-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold mb-2">Key Findings</h4>
                <div className="space-y-2">
                  {finalReport.findings.map((finding, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 + i * 0.08 }}
                      className="rounded-lg p-3 border border-gray-700/30 bg-gradient-to-br from-gray-800/40 to-gray-900/40"
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Target size={10} className="text-purple-400/60" />
                        <span className="text-[9px] text-purple-400/70 font-mono uppercase tracking-wide">
                          {finding.tool.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed break-words" style={{ overflowWrap: "anywhere" }}>
                        {cleanReportText(finding.summary)}
                      </p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {/* ── Stats Grid + Confidence ── */}
        <motion.section {...slideIn} transition={{ ...slideIn.transition, delay: 0.6 }}>
          <div className="rounded-xl p-4 bg-gradient-to-br from-gray-800/30 to-gray-900/30 border border-gray-700/20">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              {/* Confidence gauge */}
              <div className="shrink-0">
                <ConfidenceIndicator score={finalReport.confidence} size={64} />
              </div>

              {/* Stats grid */}
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
                <div className="text-center sm:text-left p-2 rounded-lg bg-gray-800/40">
                  <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
                    <Zap size={10} className="text-amber-400/60" />
                    <p className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">Tools</p>
                  </div>
                  <p className="text-lg font-bold text-gray-200 tabular-nums">{finalReport.tools_used}</p>
                </div>
                <div className="text-center sm:text-left p-2 rounded-lg bg-gray-800/40">
                  <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
                    <TrendingUp size={10} className="text-blue-400/60" />
                    <p className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">Iterations</p>
                  </div>
                  <p className="text-lg font-bold text-gray-200 tabular-nums">{finalReport.iterations}</p>
                </div>
                <div className="text-center sm:text-left p-2 rounded-lg bg-gray-800/40">
                  <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
                    <Clock size={10} className="text-emerald-400/60" />
                    <p className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">Duration</p>
                  </div>
                  <p className="text-lg font-bold text-gray-200 tabular-nums">{(finalReport.duration_ms / 1000).toFixed(1)}s</p>
                </div>
                <div className="text-center sm:text-left p-2 rounded-lg bg-gray-800/40">
                  <div className="flex items-center justify-center sm:justify-start gap-1.5 mb-1">
                    <CheckCircle2 size={10} className="text-emerald-400/60" />
                    <p className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">Success</p>
                  </div>
                  <p className={cn(
                    "text-lg font-bold tabular-nums",
                    successRate >= 80 ? "text-emerald-400" : successRate >= 50 ? "text-amber-400" : "text-red-400"
                  )}>
                    {successRate}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* ── Raw Data (collapsible) ── */}
        <motion.section {...slideIn} transition={{ ...slideIn.transition, delay: 0.7 }}>
          <button
            onClick={() => setRawExpanded(!rawExpanded)}
            className="flex items-center gap-1.5 text-[10px] text-gray-600 hover:text-gray-400 transition-colors group"
          >
            <div className="p-0.5 rounded bg-gray-800/50 group-hover:bg-gray-800">
              {rawExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </div>
            <span className="uppercase tracking-wider font-medium">Raw Data</span>
          </button>
          <AnimatePresence>
            {rawExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <pre className="mt-2 bg-black/40 rounded-lg p-3 text-[10px] text-gray-500 font-mono overflow-x-auto max-h-48 scrollbar-thin border border-gray-800/40">
                  {JSON.stringify(finalReport, null, 2)}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      </div>
    </motion.div>
  );
}
