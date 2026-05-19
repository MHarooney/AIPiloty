"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { TerminalOutput } from "@/stores/chat-store";

interface TerminalCardProps {
  output: TerminalOutput;
  isRunning?: boolean;
}

export default function TerminalCard({ output, isRunning }: TerminalCardProps) {
  const [copied, setCopied] = useState(false);

  const ok = output.exit_code === 0;

  const handleCopy = () => {
    const text = output.stdout || output.stderr || "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden animate-fade-slide-up",
        isRunning
          ? "border-amber-500/40 shimmer-border"
          : ok
          ? "border-gray-700/50"
          : "border-red-500/40"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2">
          {/* Terminal dots */}
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500/70" />
            <span className="w-2 h-2 rounded-full bg-yellow-500/70" />
            <span className="w-2 h-2 rounded-full bg-green-500/70" />
          </div>
          <span className="text-[10px] text-gray-500 font-mono">{output.hostname}</span>
        </div>
        <div className="flex items-center gap-2">
          {output.duration_ms > 0 && (
            <span className="text-[10px] text-gray-500 font-mono">
              {output.duration_ms < 1000
                ? `${output.duration_ms}ms`
                : `${(output.duration_ms / 1000).toFixed(1)}s`}
            </span>
          )}
          <span
            className={cn(
              "text-[10px] font-mono px-1.5 py-0.5 rounded",
              ok ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
            )}
          >
            exit {output.exit_code}
          </span>
          <button
            onClick={handleCopy}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors font-mono"
          >
            {copied ? "copied!" : "copy"}
          </button>
        </div>
      </div>

      {/* Command */}
      <div className="px-3 py-1.5 bg-gray-950 border-b border-gray-800/50">
        <code className="text-xs text-emerald-400 font-mono">
          <span className="text-gray-500">$ </span>
          {output.command}
        </code>
      </div>

      {/* Output */}
      <div className="bg-gray-950 max-h-64 overflow-y-auto">
        {output.stdout && (
          <pre className="px-3 py-2 text-xs text-gray-300 font-mono whitespace-pre-wrap break-all">
            {output.stdout}
          </pre>
        )}
        {output.stderr && (
          <pre className="px-3 py-2 text-xs text-red-400 font-mono whitespace-pre-wrap break-all">
            {output.stderr}
          </pre>
        )}
        {!output.stdout && !output.stderr && (
          <div className="px-3 py-2 text-xs text-gray-600 font-mono italic">
            (no output)
          </div>
        )}
      </div>

      {/* Truncation warning */}
      {output.truncated && (
        <div className="px-3 py-1 bg-amber-500/10 border-t border-amber-500/20 text-[10px] text-amber-400 font-mono text-center">
          Output truncated at 64 KB
        </div>
      )}
    </div>
  );
}
