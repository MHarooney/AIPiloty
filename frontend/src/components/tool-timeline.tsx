"use client";

import { cn } from "@/lib/utils";
import type { ToolCall, ToolResult } from "@/stores/chat-store";

interface ToolTimelineProps {
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}

type StepStatus = "done" | "error" | "running" | "pending";

function statusIcon(status: StepStatus) {
  switch (status) {
    case "done":
      return <span className="text-emerald-400">&#10003;</span>;
    case "error":
      return <span className="text-red-400">&#10007;</span>;
    case "running":
      return <span className="animate-spin text-amber-400">&#9696;</span>;
    default:
      return <span className="text-gray-500">&#9679;</span>;
  }
}

export default function ToolTimeline({ toolCalls, toolResults }: ToolTimelineProps) {
  if (toolCalls.length < 2) return null;

  const steps = toolCalls.map((tc) => {
    const result = toolResults.find((r) => r.name === tc.name);
    let status: StepStatus = "pending";
    if (result) {
      status = result.error ? "error" : "done";
    } else if (toolResults.length === toolCalls.indexOf(tc)) {
      status = "running";
    }
    return { name: tc.name, status };
  });

  // Mark the first call without a result as "running" if nothing else is
  const hasRunning = steps.some((s) => s.status === "running");
  if (!hasRunning) {
    const firstPending = steps.find((s) => s.status === "pending");
    if (firstPending && toolResults.length < toolCalls.length) {
      firstPending.status = "running";
    }
  }

  return (
    <div className="flex items-center gap-1 flex-wrap animate-fade-slide-up">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-gray-600 text-xs mx-0.5">&rarr;</span>
          )}
          <div
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono border",
              step.status === "done" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
              step.status === "error" && "border-red-500/30 bg-red-500/10 text-red-300",
              step.status === "running" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
              step.status === "pending" && "border-gray-700/30 bg-gray-800/30 text-gray-500",
            )}
          >
            {statusIcon(step.status)}
            <span>{step.name.replace(/_/g, " ")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
