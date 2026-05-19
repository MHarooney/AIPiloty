"use client";

import { useChatStore, type TimelineStep } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import { Brain, Wrench, CheckCircle2, XCircle, ShieldAlert, Loader2 } from "lucide-react";

const STEP_ICONS: Record<string, React.ElementType> = {
  thinking: Brain,
  tool_start: Wrench,
  tool_output: CheckCircle2,
  tool_error: XCircle,
  approval: ShieldAlert,
  done: CheckCircle2,
};

const STATUS_STYLES: Record<string, { dot: string; line: string; text: string }> = {
  active: {
    dot: "bg-indigo-500 shadow-lg shadow-indigo-500/40 animate-pulse",
    line: "bg-indigo-500/30",
    text: "text-gray-200",
  },
  completed: {
    dot: "bg-emerald-500/80",
    line: "bg-emerald-500/20",
    text: "text-gray-400",
  },
  error: {
    dot: "bg-red-500/80",
    line: "bg-red-500/20",
    text: "text-red-400",
  },
};

function StepItem({ step, isLast }: { step: TimelineStep; isLast: boolean }) {
  const styles = STATUS_STYLES[step.status] || STATUS_STYLES.completed;
  const Icon = STEP_ICONS[step.type] || Wrench;

  return (
    <div className="flex items-start gap-2.5 min-h-[28px]">
      {/* Vertical line + dot */}
      <div className="flex flex-col items-center">
        <div className={cn("w-2 h-2 rounded-full mt-1 shrink-0 transition-all duration-300", styles.dot)} />
        {!isLast && <div className={cn("w-px flex-1 min-h-[12px]", styles.line)} />}
      </div>

      {/* Content */}
      <div className="flex items-center gap-1.5 pb-1.5 min-w-0">
        {step.status === "active" ? (
          <Loader2 size={12} className="text-indigo-400 animate-spin shrink-0" />
        ) : (
          <Icon size={12} className={cn("shrink-0", styles.text)} />
        )}
        <span className={cn("text-[11px] font-mono truncate", styles.text)}>
          {step.label}
        </span>
      </div>
    </div>
  );
}

export default function ExecutionTimeline() {
  const timeline = useChatStore((s) => s.executionTimeline);
  const isStreaming = useChatStore((s) => s.isStreaming);

  if (timeline.length === 0 || !isStreaming) return null;

  return (
    <div className="px-1 py-2 animate-fade-slide-up">
      <div className="bg-gray-900/60 border border-gray-800/40 rounded-lg p-3 backdrop-blur-sm">
        <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-2 font-medium">
          Execution Pipeline
        </p>
        <div>
          {timeline.map((step, i) => (
            <StepItem key={step.id} step={step} isLast={i === timeline.length - 1} />
          ))}
        </div>
      </div>
    </div>
  );
}
