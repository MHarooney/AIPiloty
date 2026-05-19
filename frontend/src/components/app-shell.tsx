"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "./sidebar";
import SystemHeartbeat from "./system-heartbeat";
import SettingsPanel from "./settings-panel";
import CommandPalette from "./command-palette";
import ActivityQueue from "./activity-queue";
import MobileTopBar from "./mobile-top-bar";
import MobileBottomNav from "./mobile-bottom-nav";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import { getStoredToken } from "@/lib/api";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const systemState = useChatStore((s) => s.systemState);
  const intensityLevel = useChatStore((s) => s.intensityLevel);

  useEffect(() => {
    if (!getStoredToken()) router.replace("/login");
  }, [router]);

  // Listen for command palette "open-settings" event
  useEffect(() => {
    const handler = () => setSettingsOpen(true);
    document.addEventListener("open-settings", handler);
    return () => document.removeEventListener("open-settings", handler);
  }, []);

  return (
    <div className="flex h-screen relative" style={{ "--intensity": intensityLevel } as React.CSSProperties}>
      {/* Skip navigation — WCAG 2.1 AA */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg focus:text-sm focus:outline-none"
      >
        Skip to main content
      </a>

      {/* System heartbeat — deep background z-0 */}
      <SystemHeartbeat />

      {/* Backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar - always visible on md+, slide-out drawer on mobile */}
      <div
        className={`
          fixed md:static inset-y-0 left-0 z-50
          transform transition-transform duration-300 ease-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        <Sidebar onNavigate={closeMobile} onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      <main id="main-content" role="main" className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
        {/* Subconscious layer — ambient background (z-10) */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-0 transition-all duration-1000",
            systemState === "waiting_approval"
              ? "bg-[radial-gradient(ellipse_90%_60%_at_50%_-30%,rgba(251,191,36,0.12),transparent_55%)]"
              : systemState === "executing"
              ? "bg-[radial-gradient(ellipse_90%_60%_at_50%_-30%,rgba(52,211,153,0.12),transparent_55%)]"
              : "bg-[radial-gradient(ellipse_90%_60%_at_50%_-30%,rgba(99,102,241,0.18),transparent_55%)]"
          )}
          aria-hidden
        />
        {/* Dark overlay — only in dark mode */}
        <div
          className="pointer-events-none absolute inset-0 z-0 hidden dark:block bg-gradient-to-b from-gray-950/40 via-gray-950/80 to-[#030712]"
          aria-hidden
        />
        {/* Light mode mesh */}
        <div
          className="pointer-events-none absolute inset-0 z-0 dark:hidden light-mesh-bg"
          aria-hidden
        />
        {/* Grid pattern */}
        <div
          className="pointer-events-none absolute inset-0 z-0 opacity-[0.04] dark:opacity-[0.04] bg-[radial-gradient(circle_at_1px_1px,rgba(99,102,241,0.5)_1px,transparent_0)] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.9)_1px,transparent_0)] bg-[length:28px_28px]"
          aria-hidden
        />

        {/* Content layer */}
        <div className={cn(
          "relative z-10 flex flex-col flex-1 min-h-0 min-w-0 transition-all duration-500 pb-16 md:pb-0",
          systemState === "waiting_approval" && "time-dilation"
        )}>
          <MobileTopBar onMenuOpen={() => setMobileOpen(true)} />
          {children}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <MobileBottomNav onMoreOpen={() => setMobileOpen(true)} />

      {/* Settings panel overlay */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Activity queue (background tasks) */}
      <ActivityQueue />

      {/* Command palette (Cmd+K) */}
      <CommandPalette />
    </div>
  );
}
