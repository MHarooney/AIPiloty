"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check } from "lucide-react";
import type { TerminalOutput } from "@/stores/chat-store";

interface CinemaTerminalProps {
  output: TerminalOutput;
}

export default function CinemaTerminal({ output }: CinemaTerminalProps) {
  const fullText = output.stdout || output.stderr || "";
  const [visibleLen, setVisibleLen] = useState(0);
  const [typingDone, setTypingDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isError = !!output.stderr && !output.stdout;

  // Typing-reveal animation
  useEffect(() => {
    if (!fullText) {
      setTypingDone(true);
      return;
    }
    const charsPerTick = Math.max(5, Math.ceil(fullText.length / 60));
    let current = 0;
    const timer = setInterval(() => {
      current += charsPerTick;
      if (current >= fullText.length) {
        setVisibleLen(fullText.length);
        setTypingDone(true);
        clearInterval(timer);
      } else {
        setVisibleLen(current);
      }
    }, 28);
    return () => clearInterval(timer);
  }, [fullText]);

  // Auto-scroll while typing
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLen]);

  const handleCopy = () => {
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const ok = output.exit_code === 0;

  return (
    <div className="cinema-terminal-wrap animate-fade-slide-up" style={{ perspective: "1200px" }}>
      <div
        className={cn(
          "rounded-xl overflow-hidden border transition-all",
          isError ? "border-red-500/30" : "border-gray-700/40"
        )}
        style={{
          transform: "rotateX(1deg)",
          transformStyle: "preserve-3d",
          boxShadow:
            "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        {/* Title bar — macOS style */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a1b26] border-b border-gray-800/60">
          <div className="flex items-center gap-2.5">
            <div className="flex gap-1.5">
              <span className="w-[10px] h-[10px] rounded-full bg-[#ff5f57]" style={{ boxShadow: "0 0 6px #ff5f5750" }} />
              <span className="w-[10px] h-[10px] rounded-full bg-[#febc2e]" style={{ boxShadow: "0 0 6px #febc2e50" }} />
              <span className="w-[10px] h-[10px] rounded-full bg-[#28c840]" style={{ boxShadow: "0 0 6px #28c84050" }} />
            </div>
            <span className="text-[10px] text-gray-500 font-mono tracking-wide">
              {output.hostname || "terminal"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {output.duration_ms > 0 && (
              <span className="text-[9px] text-gray-600 font-mono">
                {output.duration_ms < 1000
                  ? `${output.duration_ms}ms`
                  : `${(output.duration_ms / 1000).toFixed(1)}s`}
              </span>
            )}
            <span
              className={cn(
                "text-[9px] font-mono px-1.5 py-0.5 rounded-md",
                ok
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-red-500/15 text-red-400"
              )}
              style={{
                boxShadow: ok
                  ? "0 0 8px rgba(16,185,129,0.15)"
                  : "0 0 8px rgba(244,63,94,0.15)",
              }}
            >
              exit {output.exit_code}
            </span>
            <button
              onClick={handleCopy}
              className="p-1 rounded-md hover:bg-gray-800/60 transition-colors"
              aria-label="Copy"
            >
              {copied ? (
                <Check size={11} className="text-emerald-400" />
              ) : (
                <Copy size={11} className="text-gray-500" />
              )}
            </button>
          </div>
        </div>

        {/* Screen area */}
        <div className="relative bg-[#0d1117]">
          {/* CRT scan lines (very subtle) */}
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              background:
                "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.008) 3px, rgba(255,255,255,0.008) 4px)",
            }}
          />
          {/* Moving CRT line */}
          <div
            className="absolute left-0 right-0 h-px z-10 pointer-events-none"
            style={{
              background:
                "linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.04) 50%, transparent 90%)",
              animation: "crt-scanline 6s linear infinite",
            }}
          />

          {/* Command line */}
          <div className="px-3 py-2 border-b border-gray-800/30">
            <code className="text-xs font-mono flex items-center gap-1.5">
              <span className="text-emerald-500/70">&#10095;</span>
              <span className="text-emerald-400">{output.command}</span>
            </code>
          </div>

          {/* Stdout with typing reveal */}
          <div ref={scrollRef} className="px-3 py-2.5 max-h-56 overflow-y-auto">
            {fullText ? (
              <pre
                className={cn(
                  "text-xs font-mono whitespace-pre-wrap break-all leading-relaxed",
                  isError ? "text-red-400/90" : "text-gray-300/90"
                )}
              >
                {fullText.slice(0, visibleLen)}
                {!typingDone && (
                  <span
                    className="inline-block w-[6px] h-[13px] ml-px align-middle rounded-[1px]"
                    style={{
                      background: isError ? "#f87171" : "#34d399",
                      animation: "terminal-cursor-blink 0.7s step-end infinite",
                      boxShadow: isError
                        ? "0 0 6px #f43f5e"
                        : "0 0 6px #10b981",
                    }}
                  />
                )}
              </pre>
            ) : (
              <span className="text-xs text-gray-600 font-mono italic">
                (no output)
              </span>
            )}
          </div>

          {/* Subtle inner screen glow */}
          <div
            className="absolute inset-0 pointer-events-none rounded-b-xl"
            style={{
              boxShadow: "inset 0 0 80px rgba(16,185,129,0.02)",
            }}
          />
        </div>

        {/* Truncation warning */}
        {output.truncated && (
          <div className="px-3 py-1 bg-amber-500/10 border-t border-amber-500/20 text-[10px] text-amber-400 font-mono text-center">
            Output truncated at 64 KB
          </div>
        )}
      </div>
    </div>
  );
}
