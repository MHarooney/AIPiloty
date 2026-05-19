"use client";

import { useChatStore, type LogEntry } from "@/stores/chat-store";
import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Activity, ChevronDown, ChevronUp, Search, Wrench, BarChart3, Cpu } from "lucide-react";

const LEVEL_COLORS: Record<string, string> = {
  info: "text-cyan-400/70",
  warn: "text-amber-400/70",
  error: "text-red-400/70",
};

const LEVEL_ICONS: Record<string, React.ElementType> = {
  info: Cpu,
  warn: Search,
  error: Activity,
};

function IntelligenceLine({ entry }: { entry: LogEntry }) {
  const Icon = LEVEL_ICONS[entry.level] || Cpu;

  return (
    <div className="flex items-start gap-2 text-[10px] font-mono leading-relaxed animate-fade-slide-up">
      <span className="text-gray-600 shrink-0 w-[52px] text-right tabular-nums">
        {typeof entry.timestamp === "number" && entry.timestamp > 1e12
          ? new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
          : `${entry.timestamp.toFixed(1)}s`}
      </span>
      <Icon size={10} className={cn("shrink-0 mt-0.5", LEVEL_COLORS[entry.level] || "text-gray-500")} />
      <span className={cn("break-all", LEVEL_COLORS[entry.level] || "text-gray-400")}>
        {entry.message}
      </span>
    </div>
  );
}

/**
 * Background Intelligence Stream — structured intelligence feed.
 * Shows AI's internal reasoning: tool selection, confidence analysis,
 * risk assessment, and processing status.
 */
export default function BackgroundVerboseStream() {
  const backgroundLogs = useChatStore((s) => s.backgroundLogs);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const systemState = useChatStore((s) => s.systemState);
  const intensityLevel = useChatStore((s) => s.intensityLevel);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [backgroundLogs]);

  // Don't render if no logs
  if (backgroundLogs.length === 0 && !isStreaming) return null;

  const stateLabel = systemState !== "idle"
    ? systemState.replace("_", " ")
    : "monitoring";

  return (
    <div
      className={cn(
        "fixed bottom-20 right-4 z-30 transition-all duration-300 ease-out",
        expanded ? "w-80" : "w-auto"
      )}
    >
      {/* Toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-[10px] font-mono",
          "bg-gray-900/90 border border-gray-800/60 border-b-0 backdrop-blur-md",
          "text-gray-500 hover:text-gray-300 transition-colors",
          isStreaming && "border-cyan-800/40",
          systemState === "waiting_approval" && "border-amber-800/40"
        )}
      >
        <Activity
          size={12}
          className={cn(
            isStreaming && "text-cyan-400 animate-pulse",
            systemState === "waiting_approval" && "text-amber-400 animate-pulse"
          )}
        />
        <span className="capitalize">{stateLabel}</span>
        <span className="text-gray-600">({backgroundLogs.length})</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>

      {/* Intelligence panel */}
      {expanded && (
        <div
          ref={scrollRef}
          className={cn(
            "bg-gray-950/95 border border-gray-800/60 rounded-b-lg rounded-tl-lg backdrop-blur-md",
            "max-h-48 overflow-y-auto p-2 space-y-0.5",
            "scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent"
          )}
          style={{
            borderColor: intensityLevel > 0.5
              ? `rgba(99,102,241,${0.1 + intensityLevel * 0.2})`
              : undefined,
          }}
        >
          {backgroundLogs.length === 0 ? (
            <p className="text-[10px] text-gray-600 font-mono text-center py-2">
              Waiting for activity...
            </p>
          ) : (
            backgroundLogs.map((entry) => <IntelligenceLine key={entry.id} entry={entry} />)
          )}
        </div>
      )}
    </div>
  );
}
