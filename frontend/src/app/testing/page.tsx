"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { TestTube2, Sparkles, Globe, Camera } from "lucide-react";
import AppShell from "@/components/app-shell";
import TestingTargetBar from "@/components/testing/testing-target-bar";
import { useTestingStore } from "@/stores/testing-store";
import { cn } from "@/lib/utils";

type RightTab = "results" | "browser";

function PanelSkeleton({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-gray-600 animate-pulse">
      Loading {label}…
    </div>
  );
}

const TestingChatPanel = dynamic(
  () => import("@/components/testing/testing-chat-panel"),
  { ssr: false, loading: () => <PanelSkeleton label="chat" /> },
);
const TestingDashboard = dynamic(
  () => import("@/components/testing/testing-dashboard"),
  { ssr: false, loading: () => <PanelSkeleton label="results" /> },
);
const TestingBrowserMirror = dynamic(
  () =>
    import("@/components/testing/testing-browser-mirror").then((m) => ({
      default: m.TestingBrowserMirror,
    })),
  { ssr: false, loading: () => <PanelSkeleton label="browser" /> },
);

export default function TestingPage() {
  const isStreaming = useTestingStore((s) => s.isStreaming);
  const systemState = useTestingStore((s) => s.systemState);
  const currentTool = useTestingStore((s) => s.currentToolCall);
  const screenshots = useTestingStore((s) => s.screenshots);
  const browserSessionActive = useTestingStore((s) => s.browserSessionActive);

  const [activeTab, setActiveTab] = useState<RightTab>("results");

  // Auto-switch to browser tab when first screenshot arrives
  useEffect(() => {
    if (screenshots.length > 0 && activeTab === "results") {
      setActiveTab("browser");
    }
  }, [screenshots.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell>
      <div className="flex flex-col h-full bg-gradient-to-br from-gray-950 via-gray-950 to-emerald-950/10 overflow-hidden">

        {/* ── Page header ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/50 bg-gray-950/70 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center shadow-md shadow-emerald-900/40">
              <TestTube2 className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-sm font-semibold text-gray-200 tracking-tight">AI Testing Agent</h1>
            {screenshots.length > 0 && (
              <span className="flex items-center gap-1 ml-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-700/40 text-emerald-400 font-medium">
                <Camera className="w-3 h-3" />
                {screenshots.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {isStreaming ? (
              <span
                className={cn(
                  "flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium",
                  systemState === "tool_running"
                    ? "text-amber-400 bg-amber-900/30 border-amber-800/30"
                    : "text-emerald-400 bg-emerald-900/30 border-emerald-800/30 animate-pulse"
                )}
              >
                <Sparkles className="w-3 h-3" />
                {systemState === "tool_running" && currentTool
                  ? `Running ${currentTool}`
                  : "Agent thinking…"}
              </span>
            ) : systemState === "error" ? (
              <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium text-red-400 bg-red-900/30 border-red-800/30">
                Agent error
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium text-gray-600 bg-gray-900/40 border-gray-800/30">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" />
                Ready
              </span>
            )}
          </div>
        </div>

        <div className="flex-shrink-0">
          <TestingTargetBar />
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          <div className="flex-1 md:flex-[3] min-w-0 border-b md:border-b-0 border-r-0 md:border-r border-gray-800/50 overflow-hidden flex flex-col">
            <TestingChatPanel />
          </div>

          <div className="flex-1 md:flex-[2] min-w-0 overflow-hidden flex flex-col">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800/50 flex-shrink-0 bg-gray-950/40">
              <button
                onClick={() => setActiveTab("results")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  activeTab === "results"
                    ? "bg-gray-800 text-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/40"
                )}
              >
                Results
              </button>
              <button
                onClick={() => setActiveTab("browser")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  activeTab === "browser"
                    ? "bg-gray-800 text-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/40"
                )}
              >
                <Globe className="w-3.5 h-3.5" />
                Browser
                {browserSessionActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
                {screenshots.length > 0 && (
                  <span className="bg-emerald-900/60 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-700/40 min-w-[18px] text-center">
                    {screenshots.length}
                  </span>
                )}
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {activeTab === "results" ? (
                <TestingDashboard />
              ) : (
                <TestingBrowserMirror />
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
