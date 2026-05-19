"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, ExternalLink, Loader2, ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTestingStore, Screenshot } from "@/stores/testing-store";

// ── Filmstrip thumbnail ────────────────────────────────────────────────────────

function Thumbnail({
  shot,
  isActive,
  isNewest,
  isLive,
  onClick,
}: {
  shot: Screenshot;
  isActive: boolean;
  isNewest: boolean;
  isLive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "relative flex-shrink-0 w-20 h-14 rounded-md overflow-hidden border-2 transition-all duration-200 focus:outline-none",
        isActive
          ? "border-emerald-400 ring-2 ring-emerald-400/30 scale-105 z-10"
          : "border-zinc-700 hover:border-zinc-500",
      ].join(" ")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:image/jpeg;base64,${shot.image_b64}`}
        alt={shot.caption}
        className="w-full h-full object-cover object-top"
      />
      <span className="absolute bottom-0.5 left-0.5 text-[9px] font-mono bg-zinc-900/80 text-zinc-300 px-1 rounded">
        {shot.step}
      </span>
      {isNewest && isLive && (
        <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
      )}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TestingBrowserMirror() {
  const screenshots          = useTestingStore((s) => s.screenshots);
  const browserSessionActive = useTestingStore((s) => s.browserSessionActive);
  const isStreaming           = useTestingStore((s) => s.isStreaming);
  const currentTool          = useTestingStore((s) => s.currentToolCall);

  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const filmstripRef = useRef<HTMLDivElement>(null);

  // Auto-advance to newest frame while streaming, or on first screenshot
  useEffect(() => {
    if (isStreaming || activeIdx === -1) {
      setActiveIdx(screenshots.length - 1);
    }
  }, [screenshots.length, isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll filmstrip to keep active thumb visible
  useEffect(() => {
    if (filmstripRef.current && activeIdx >= 0) {
      const thumbs = filmstripRef.current.querySelectorAll("button");
      const thumb = thumbs[activeIdx] as HTMLButtonElement | undefined;
      thumb?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [activeIdx]);

  const activeShot = screenshots[activeIdx] ?? null;
  const isNewest   = activeIdx === screenshots.length - 1;

  function prev() { setActiveIdx((i) => Math.max(0, i - 1)); }
  function next() { setActiveIdx((i) => Math.min(screenshots.length - 1, i + 1)); }

  // ── Empty / waiting state ─────────────────────────────────────────────────
  if (screenshots.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-700/60 flex-shrink-0">
          <Globe className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-200">Browser Mirror</span>
          {isStreaming && (
            <span className="flex items-center gap-1.5 ml-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
              <span className="text-xs text-red-400 font-semibold tracking-wide">REC</span>
            </span>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center">
            {isStreaming
              ? <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
              : <Globe className="w-7 h-7 text-zinc-600" />}
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-400 mb-1">
              {isStreaming ? "Agent is working…" : "Browser Mirror"}
            </p>
            <p className="text-xs text-zinc-600 max-w-[220px] leading-relaxed">
              {isStreaming
                ? "Live screenshot appears on each browser action."
                : "Screenshots from the AI browser session stream here in real time."}
            </p>
          </div>
          {isStreaming && currentTool && (
            <div className="px-3 py-1.5 rounded-lg bg-amber-950/40 border border-amber-800/30 text-xs text-amber-300 font-mono">
              {currentTool.replace(/_/g, " ")}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Live-video layout ─────────────────────────────────────────────────────
  return (
    <div className={[
      "flex flex-col overflow-hidden",
      isFullscreen
        ? "fixed inset-0 z-50 bg-zinc-950"
        : "h-full",
    ].join(" ")}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-zinc-700/60 flex-shrink-0 bg-zinc-900/80">
        <Globe className="w-4 h-4 text-zinc-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-zinc-200 flex-shrink-0">Browser Mirror</span>

        {isStreaming ? (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
            <span className="text-xs text-red-400 font-semibold tracking-wide">REC</span>
          </span>
        ) : browserSessionActive ? (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            <span className="text-xs text-emerald-400">Active</span>
          </span>
        ) : null}

        {isStreaming && currentTool && (
          <span className="ml-1 px-2 py-0.5 rounded-md bg-amber-900/40 border border-amber-700/40 text-[10px] text-amber-300 font-mono truncate max-w-[150px]">
            {currentTool.replace(/_/g, " ")}
          </span>
        )}

        <span className="ml-auto text-xs text-zinc-500 font-mono flex-shrink-0">
          {activeIdx + 1} / {screenshots.length}
        </span>

        <button
          onClick={() => setIsFullscreen((f) => !f)}
          className="ml-2 flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/60 transition-all"
          title={isFullscreen ? "Exit fullscreen" : "Expand to fullscreen"}
        >
          {isFullscreen
            ? <Minimize2 className="w-3.5 h-3.5" />
            : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Main viewport */}
      <div className="flex-1 relative bg-zinc-950 overflow-hidden min-h-0">
        <AnimatePresence mode="wait">
          {activeShot && (
            <motion.div
              key={`frame-${activeIdx}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 flex flex-col"
            >
              {/* Screenshot image */}
              <div className="flex-1 overflow-hidden relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/jpeg;base64,${activeShot.image_b64}`}
                  alt={activeShot.caption}
                  className="w-full h-full object-cover object-top"
                  draggable={false}
                />

                {/* Scan-line sweep when streaming the newest frame */}
                {isStreaming && isNewest && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <motion.div
                      className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent"
                      animate={{ top: ["0%", "100%"] }}
                      transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
                    />
                  </div>
                )}

                {/* Prev / Next arrows */}
                {screenshots.length > 1 && (
                  <>
                    <button
                      onClick={prev}
                      disabled={activeIdx === 0}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-zinc-900/70 border border-zinc-700/60 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 disabled:opacity-20 disabled:cursor-not-allowed transition-all backdrop-blur-sm"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={next}
                      disabled={activeIdx === screenshots.length - 1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-zinc-900/70 border border-zinc-700/60 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 disabled:opacity-20 disabled:cursor-not-allowed transition-all backdrop-blur-sm"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>

              {/* Caption bar */}
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/95 border-t border-zinc-700/50 flex-shrink-0">
                <span className="text-[10px] font-mono text-zinc-500 flex-shrink-0 bg-zinc-800 px-1.5 py-0.5 rounded">
                  Step {activeShot.step}
                </span>
                <span className="text-xs text-zinc-300 truncate flex-1 font-medium">
                  {activeShot.caption}
                </span>
                {activeShot.url && (
                  <a
                    href={activeShot.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 text-zinc-600 hover:text-zinc-400 transition-colors"
                    title={activeShot.url}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* LIVE badge overlay */}
        {isStreaming && isNewest && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-zinc-900/80 backdrop-blur-sm border border-red-700/40 px-2 py-0.5 rounded-md pointer-events-none z-10">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] text-red-400 font-semibold tracking-widest">LIVE</span>
          </div>
        )}
      </div>

      {/* Filmstrip */}
      {screenshots.length > 1 && (
        <div className="flex-shrink-0 border-t border-zinc-700/60 bg-zinc-900/80 px-3 py-2">
          <div
            ref={filmstripRef}
            className="flex gap-2 overflow-x-auto pb-1"
            style={{ scrollbarWidth: "thin" }}
          >
            {screenshots.map((shot, idx) => (
              <Thumbnail
                key={`${shot.step}-${shot.timestamp}`}
                shot={shot}
                isActive={idx === activeIdx}
                isNewest={idx === screenshots.length - 1}
                isLive={isStreaming}
                onClick={() => setActiveIdx(idx)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
