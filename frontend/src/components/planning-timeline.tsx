"use client";

import { useChatStore, type PlanStep } from "@/stores/chat-store";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Brain, Wrench, Settings2, Play, BarChart3, CheckCircle2, Loader2, Circle } from "lucide-react";

const STEP_ICONS: Record<string, React.ElementType> = {
  "Analyze request": Brain,
  "Prepare arguments": Settings2,
  "Execute": Play,
  "Parse result": BarChart3,
};

function getStepIcon(label: string): React.ElementType {
  for (const [key, icon] of Object.entries(STEP_ICONS)) {
    if (label.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  if (label.toLowerCase().includes("select tool")) return Wrench;
  return Circle;
}

const STATUS_STYLES: Record<string, { dot: string; line: string; text: string; icon: string }> = {
  pending: {
    dot: "bg-gray-700",
    line: "bg-gray-800",
    text: "text-gray-600",
    icon: "text-gray-600",
  },
  active: {
    dot: "bg-indigo-500 shadow-lg shadow-indigo-500/50",
    line: "bg-indigo-500/30",
    text: "text-gray-200",
    icon: "text-indigo-400",
  },
  completed: {
    dot: "bg-emerald-500/80",
    line: "bg-emerald-500/30",
    text: "text-gray-400",
    icon: "text-emerald-400",
  },
};

function PlanStepItem({ step, index, isLast }: { step: PlanStep; index: number; isLast: boolean }) {
  const styles = STATUS_STYLES[step.status];
  const Icon = getStepIcon(step.label);

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, duration: 0.3 }}
      className="flex items-start gap-2.5"
    >
      {/* Dot + connecting line */}
      <div className="flex flex-col items-center">
        <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0 transition-all duration-500", styles.dot)} />
        {!isLast && <div className={cn("w-px flex-1 min-h-[16px] transition-all duration-500", styles.line)} />}
      </div>

      {/* Content */}
      <div className="flex items-center gap-2 pb-2 min-w-0">
        {step.status === "active" ? (
          <Loader2 size={12} className="text-indigo-400 animate-spin shrink-0" />
        ) : step.status === "completed" ? (
          <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
        ) : (
          <Icon size={12} className={cn("shrink-0", styles.icon)} />
        )}
        <span className={cn("text-[11px] font-mono transition-colors duration-300", styles.text)}>
          {step.label}
        </span>
      </div>
    </motion.div>
  );
}

/**
 * Planning timeline visualization — shows AI's step plan before execution.
 * Animated step-by-step with connecting lines and status indicators.
 */
export default function PlanningTimeline() {
  const executionPlan = useChatStore((s) => s.executionPlan);
  const systemState = useChatStore((s) => s.systemState);

  if (executionPlan.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.4 }}
      className="px-1 py-2"
    >
      <div className="bg-gray-900/60 border border-gray-800/40 rounded-xl p-3.5 backdrop-blur-sm relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <div className={cn(
            "w-1.5 h-1.5 rounded-full",
            systemState === "planning" ? "bg-indigo-400 animate-pulse" : "bg-emerald-400"
          )} />
          <p className="text-[9px] uppercase tracking-widest text-gray-500 font-medium">
            {systemState === "planning" ? "Planning Execution" : "Execution Plan"}
          </p>
        </div>

        {/* Steps */}
        <div>
          <AnimatePresence>
            {executionPlan.map((step, i) => (
              <PlanStepItem
                key={`${step.label}-${i}`}
                step={step}
                index={i}
                isLast={i === executionPlan.length - 1}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* Subtle energy overlay */}
        {systemState === "planning" && (
          <div className="absolute inset-0 pointer-events-none holo-shimmer rounded-xl" />
        )}
      </div>
    </motion.div>
  );
}
