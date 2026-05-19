"use client";

import { useEffect, useState } from "react";
import { useChatStore } from "@/stores/chat-store";

/**
 * Full-page subtle heartbeat background element.
 * Radial gradient pulse synced to intensityLevel.
 * Nearly invisible (opacity 0.03-0.08) but creates "alive" feeling.
 *
 * Dynamic inline `style` is applied only after mount so SSR and the first
 * client render match (avoids Next.js "Extra attributes from the server: style").
 */
export default function SystemHeartbeat() {
  const [mounted, setMounted] = useState(false);
  const intensityLevel = useChatStore((s) => s.intensityLevel);
  const systemState = useChatStore((s) => s.systemState);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isActive = systemState !== "idle";
  const opacity = isActive ? 0.03 + intensityLevel * 0.06 : 0.015;
  const speed = isActive ? `${Math.max(1.5, 4 - intensityLevel * 3)}s` : "6s";

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      {mounted ? (
        <>
          {/* Primary pulse */}
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 80% 60% at 50% 40%, rgba(99,102,241,${opacity}), transparent 70%)`,
              animation: `system-heartbeat ${speed} ease-in-out infinite`,
            }}
          />

          {/* Secondary glow during waiting_approval */}
          {systemState === "waiting_approval" && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(251,191,36,0.04), transparent 60%)",
                animation: "system-heartbeat 2s ease-in-out infinite",
              }}
            />
          )}

          {/* Energy layer during execution */}
          {systemState === "executing" && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 70% 55% at 50% 35%, rgba(52,211,153,0.03), transparent 65%)",
                animation: "system-heartbeat 1.5s ease-in-out infinite",
              }}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
