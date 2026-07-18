"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle, AlertCircle, ChevronDown, Copy, Check, Folder, FileText } from "lucide-react";
import type { ToolResult } from "@/stores/chat-store";

interface ToolOutputCardProps {
  result: ToolResult;
}

function tryParseJSON(str: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed !== "object" || parsed === null) return null;
    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] === "string" && (parsed[key].startsWith("{") || parsed[key].startsWith("["))) {
        const nested = tryParseJSON(parsed[key]);
        if (nested) parsed[key] = nested;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

/* ─── File List Detection & View ─────────────────────────── */

function isFileList(data: Record<string, any>): boolean {
  return (
    Array.isArray(data.entries) &&
    data.entries.length > 0 &&
    typeof data.entries[0]?.name === "string"
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function FileListView({
  entries,
  path,
}: {
  entries: Array<{ name: string; is_dir: boolean; size: number }>;
  path?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const visible = showAll ? sorted : sorted.slice(0, 25);

  return (
    <div className="space-y-px">
      {path && (
        <div className="text-[10px] text-gray-500 font-mono mb-2 flex items-center gap-1.5">
          <Folder size={10} className="text-indigo-400" />
          <span className="truncate">{path}</span>
          <span className="text-gray-600 shrink-0">({entries.length} items)</span>
        </div>
      )}
      {visible.map((entry, i) => (
        <div
          key={entry.name}
          className="flex items-center gap-2 py-[3px] text-xs animate-data-row-in rounded-md px-1.5 hover:bg-white/[0.02] transition-colors"
          style={{ animationDelay: `${Math.min(i, 30) * 25}ms` }}
        >
          {entry.is_dir ? (
            <Folder size={13} className="text-indigo-400/80 shrink-0" />
          ) : (
            <FileText size={13} className="text-gray-500/60 shrink-0" />
          )}
          <span
            className={cn(
              "truncate min-w-0",
              entry.is_dir ? "text-indigo-300" : "text-gray-300"
            )}
          >
            {entry.name}
          </span>
          {!entry.is_dir && entry.size !== undefined && (
            <span className="text-[10px] text-gray-600 font-mono shrink-0 ml-auto tabular-nums">
              {humanSize(entry.size)}
            </span>
          )}
        </div>
      ))}
      {!showAll && sorted.length > 25 && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-1.5 font-mono transition-colors"
        >
          Show all {sorted.length} items...
        </button>
      )}
    </div>
  );
}

/* ─── Glass Key-Value Rows ───────────────────────────────── */

const MAX_DEPTH = 5;

function GlassKeyValueRow({
  k,
  v,
  depth = 0,
  index = 0,
}: {
  k: string;
  v: any;
  depth?: number;
  index?: number;
}) {
  const isObject = typeof v === "object" && v !== null && !Array.isArray(v);
  const isArray = Array.isArray(v);
  const [open, setOpen] = useState(depth < 1);

  // Depth guard — prevents stack overflow on deeply nested JSON
  if ((isObject || isArray) && depth >= MAX_DEPTH) {
    return (
      <div className="flex items-center gap-1.5 text-xs py-0.5">
        <span className="text-indigo-400 font-medium">{k}</span>
        <span className="text-gray-600 font-mono text-[10px]">
          {isArray ? `[${v.length} items — nested]` : `{…nested}`}
        </span>
      </div>
    );
  }

  if (isObject || isArray) {
    const entries: [string, any][] = isArray
      ? v.map((item: any, i: number) => [String(i), item] as [string, any])
      : Object.entries(v);

    // Detect file-like arrays at any nesting level
    const isFileArray =
      isArray &&
      v.length > 0 &&
      typeof v[0] === "object" &&
      v[0] !== null &&
      typeof v[0].name === "string";

    return (
      <div className="space-y-0.5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(!open);
            }
          }}
          className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white transition-colors cursor-pointer"
        >
          <ChevronDown
            size={11}
            className={cn(
              "transition-transform duration-200 text-gray-600",
              !open && "-rotate-90"
            )}
          />
          <span className="text-indigo-400 font-medium">{k}</span>
          <span className="text-gray-600 text-[10px] font-mono">
            {isArray ? `[${v.length}]` : `{${Object.keys(v).length}}`}
          </span>
        </div>
        {open && (
          <div className="ml-3 pl-2.5 border-l border-indigo-500/10 space-y-0.5">
            {isFileArray ? (
              <FileListView entries={v} />
            ) : (
              entries.map(([ek, ev], i) => (
                <GlassKeyValueRow
                  key={ek}
                  k={ek}
                  v={ev}
                  depth={depth + 1}
                  index={i}
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  const display =
    v === null ? "null" : v === undefined ? "undefined" : String(v);

  return (
    <div
      className="flex gap-2 text-xs py-[2px] min-w-0 animate-data-row-in"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <span className="text-indigo-400/80 font-medium shrink-0">{k}</span>
      <span className="text-gray-600 shrink-0">&middot;</span>
      <span
        className={cn(
          "min-w-0 truncate",
          typeof v === "number" && "text-amber-300 font-mono",
          typeof v === "boolean" && (v ? "text-emerald-400" : "text-red-400"),
          v === null && "text-gray-600 italic",
          typeof v === "string" && "text-gray-300"
        )}
      >
        {display}
      </span>
    </div>
  );
}

/* ─── Glass Morphism Result Card ─────────────────────────── */

export default function ToolOutputCard({ result }: ToolOutputCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const raw = result.error || result.output || "";
  const parsed = useMemo(() => tryParseJSON(raw), [raw]);
  const nestedFailed =
    !!parsed &&
    typeof parsed === "object" &&
    ((parsed as Record<string, unknown>).success === false ||
      typeof (parsed as Record<string, unknown>).error === "string" ||
      (typeof (parsed as Record<string, unknown>).output === "object" &&
        (parsed as Record<string, unknown>).output !== null &&
        ((parsed as { output: Record<string, unknown> }).output.success === false ||
          typeof (parsed as { output: Record<string, unknown> }).output.error === "string")));
  const isError = !!result.error || nestedFailed;
  const accentColor = isError ? "#f43f5e" : "#10b981";

  const handleCopy = () => {
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden animate-fade-slide-up"
      style={{
        background: "rgba(255,255,255,0.02)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: `1px solid ${isError ? "rgba(244,63,94,0.15)" : "rgba(255,255,255,0.06)"}`,
        boxShadow:
          "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[2px] rounded-l-xl"
        style={{ background: accentColor, opacity: 0.6 }}
      />

      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        className="relative flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.015] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Status icon with glow */}
          <div className="relative">
            {isError ? (
              <AlertCircle size={15} className="text-red-400" />
            ) : (
              <CheckCircle size={15} className="text-emerald-400" />
            )}
            <div
              className="absolute inset-0 rounded-full blur-sm"
              style={{ background: accentColor, opacity: 0.25 }}
            />
          </div>
          <span className="text-xs font-medium text-gray-200 truncate">
            {result.name.replace(/_/g, " ")}
          </span>
          <span
            className={cn(
              "text-[9px] px-2 py-0.5 rounded-full font-mono uppercase tracking-wider",
              isError
                ? "bg-red-500/10 text-red-400 border border-red-500/15"
                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/10"
            )}
          >
            {isError ? "error" : "success"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className="p-1 rounded-md hover:bg-white/[0.05] transition-colors"
            aria-label="Copy output"
          >
            {copied ? (
              <Check size={12} className="text-emerald-400" />
            ) : (
              <Copy size={12} className="text-gray-500" />
            )}
          </button>
          <ChevronDown
            size={14}
            className={cn(
              "text-gray-500 transition-transform duration-200",
              !expanded && "-rotate-90"
            )}
          />
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-white/[0.04] px-4 py-3 max-h-80 overflow-y-auto">
          {parsed && isFileList(parsed) ? (
            <FileListView entries={parsed.entries} path={parsed.path} />
          ) : parsed ? (
            <div className="space-y-0.5">
              {Object.entries(parsed).map(([k, v], i) => (
                <GlassKeyValueRow key={k} k={k} v={v} index={i} />
              ))}
            </div>
          ) : (
            <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap break-all">
              {raw}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
