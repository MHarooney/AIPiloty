"use client";

/**
 * IDECommandPalette — Cursor / VS Code-style command palette.
 *
 * Triggered by Cmd+K (AI) or Cmd+P (files).
 * Modes:
 *  • "ai"    — AI quick actions (explain, refactor, test, document)
 *  • "files" — Quick open file by name fuzzy search
 *  • "cmd"   — Run IDE commands (new file, open terminal, settings, etc.)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search, Sparkles, FileCode, Terminal, Package, Settings,
  BookOpen, Bug, Wand2, TestTube2, MessageSquare, FilePlus,
  FolderPlus, GitBranch, Zap, Command, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeNode } from "./file-tree";

import type { LucideIcon } from "lucide-react";

// ── Command definitions ───────────────────────────────────────────────────

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  category: string;
  action: () => void;
  shortcut?: string;
}

// ── File item in quick-open mode ─────────────────────────────────────────

function flattenTree(tree: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  function walk(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (n.type === "file") out.push(n);
      if (n.children) walk(n.children);
    }
  }
  walk(tree);
  return out;
}

function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const result: React.ReactNode[] = [];
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let lastEnd = 0;

  let ti = 0;
  const matchIndices: number[] = [];
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return text;
    matchIndices.push(idx);
    ti = idx + 1;
  }

  for (const idx of matchIndices) {
    if (idx > lastEnd) {
      result.push(<span key={lastEnd}>{text.slice(lastEnd, idx)}</span>);
    }
    result.push(
      <span key={`h${idx}`} className="text-blue-400 font-semibold">
        {text[idx]}
      </span>
    );
    lastEnd = idx + 1;
  }
  if (lastEnd < text.length) result.push(<span key="tail">{text.slice(lastEnd)}</span>);
  return result;
}

// ── Props ─────────────────────────────────────────────────────────────────

interface IDECommandPaletteProps {
  isOpen: boolean;
  mode: "ai" | "files" | "cmd";
  onClose: () => void;
  fileTree?: TreeNode[];
  onOpenFile?: (path: string) => void;
  onAIAction?: (prompt: string) => void;
  currentFile?: string | null;
  extraCommands?: PaletteCommand[];
}

// ── AI action chips (inline like Cursor's /commands) ─────────────────────

const AI_ACTIONS: Array<{ id: string; label: string; icon: LucideIcon; prompt: string }> = [
  { id: "explain",  label: "Explain this code",   icon: BookOpen,     prompt: "Explain what this code does in detail." },
  { id: "bugs",     label: "Find bugs",            icon: Bug,          prompt: "Find any bugs, issues, or edge cases in this code." },
  { id: "refactor", label: "Refactor",             icon: Wand2,        prompt: "Refactor this code for clarity and best practices." },
  { id: "tests",    label: "Generate tests",       icon: TestTube2,    prompt: "Write comprehensive unit tests for this code." },
  { id: "docs",     label: "Add docs",             icon: FileCode,     prompt: "Add JSDoc/docstring documentation to this code." },
  { id: "review",   label: "Code review",          icon: MessageSquare, prompt: "Do a thorough code review and suggest improvements." },
  { id: "optimize", label: "Optimize",             icon: Zap,          prompt: "Optimize this code for performance." },
];

// ── Main component ────────────────────────────────────────────────────────

export default function IDECommandPalette({
  isOpen, mode, onClose, fileTree = [], onOpenFile, onAIAction, currentFile, extraCommands = [],
}: IDECommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // ── Build result list ──────────────────────────────────────────────────

  const allFiles = flattenTree(fileTree);
  const filteredFiles = allFiles.filter(f => fuzzyMatch(f.name, query)).slice(0, 12);

  const allCommands: PaletteCommand[] = [
    { id: "terminal",  label: "Toggle Terminal",       icon: Terminal as LucideIcon, category: "View",     action: () => {}, shortcut: "Ctrl+`" },
    { id: "newfile",   label: "New File",              icon: FilePlus as LucideIcon, category: "File",     action: () => {} },
    { id: "newfolder", label: "New Folder",            icon: FolderPlus as LucideIcon, category: "File",  action: () => {} },
    { id: "mcp",       label: "Open MCP Marketplace", icon: Package as LucideIcon,  category: "Settings", action: () => {} },
    { id: "settings",  label: "Open Settings",        icon: Settings as LucideIcon, category: "Settings", action: () => {} },
    { id: "git",       label: "Toggle Git Panel",     icon: GitBranch as LucideIcon, category: "View",    action: () => {} },
    ...extraCommands,
  ];
  const filteredCmds = allCommands.filter(c =>
    fuzzyMatch(c.label, query) || fuzzyMatch(c.category, query)
  ).slice(0, 8);

  const filteredAI = AI_ACTIONS.filter(a => fuzzyMatch(a.label, query) || !query);

  // Total item count for keyboard nav
  const totalItems = mode === "files" ? filteredFiles.length
    : mode === "cmd" ? filteredCmds.length
    : filteredAI.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "files" && filteredFiles[selectedIdx]) {
        onOpenFile?.(filteredFiles[selectedIdx].path);
        onClose();
      } else if (mode === "cmd" && filteredCmds[selectedIdx]) {
        filteredCmds[selectedIdx].action();
        onClose();
      } else if (mode === "ai" && filteredAI[selectedIdx]) {
        onAIAction?.(filteredAI[selectedIdx].prompt);
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  const placeholder = mode === "files"
    ? "Search files…"
    : mode === "cmd"
    ? "Type a command…"
    : "Ask AI or choose an action…";

  const modeIcon = mode === "files" ? Search : mode === "cmd" ? Command : Sparkles;
  const ModeIcon = modeIcon;

  return (
    <div
      className="fixed inset-0 z-[998] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] mx-4 bg-[#1e1e2e] border border-zinc-700/70 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-700/50">
          <ModeIcon
            size={16}
            className={cn(
              mode === "ai" ? "text-purple-400" :
              mode === "files" ? "text-blue-400" :
              "text-zinc-400"
            )}
          />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
          />
          {currentFile && mode === "ai" && (
            <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-md truncate max-w-[160px]">
              {currentFile.split("/").pop()}
            </span>
          )}
          <kbd className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto">
          {mode === "files" && (
            <>
              {filteredFiles.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-zinc-500">No files match</div>
              ) : (
                <div className="py-1">
                  {filteredFiles.map((file, i) => (
                    <button
                      key={file.path}
                      onClick={() => { onOpenFile?.(file.path); onClose(); }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left",
                        i === selectedIdx ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5"
                      )}
                    >
                      <FileCode size={14} className="text-blue-400 flex-shrink-0" />
                      <span className="flex-1">{highlightMatch(file.name, query)}</span>
                      <span className="text-[11px] text-zinc-500 truncate max-w-[200px]">
                        {file.path.split("/").slice(0, -1).join("/")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === "ai" && (
            <div className="py-2">
              {query ? (
                <button
                  onClick={() => { onAIAction?.(query); onClose(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-purple-300 hover:bg-purple-900/20 transition-colors border-b border-zinc-800/50"
                >
                  <Sparkles size={14} className="text-purple-400 flex-shrink-0" />
                  <span className="flex-1 text-left">{query}</span>
                  <ArrowRight size={12} className="text-zinc-500" />
                </button>
              ) : null}
              <div className="px-3 pt-2 pb-1">
                <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider px-1 mb-1.5">
                  Quick actions {currentFile ? `on ${currentFile.split("/").pop()}` : ""}
                </p>
              </div>
              {filteredAI.map((action, i) => {
                const Icon = action.icon;
                const selected = i === (query ? selectedIdx - 1 : selectedIdx);
                return (
                  <button
                    key={action.id}
                    onClick={() => { onAIAction?.(action.prompt); onClose(); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left",
                      selected ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5"
                    )}
                  >
                    <Icon size={14} className="text-purple-400 flex-shrink-0" />
                    <span className="flex-1">{action.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {mode === "cmd" && (
            <div className="py-1">
              {filteredCmds.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-zinc-500">No commands match</div>
              ) : (
                filteredCmds.map((cmd, i) => {
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      onClick={() => { cmd.action(); onClose(); }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left",
                        i === selectedIdx ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5"
                      )}
                    >
                      <Icon size={14} className="text-zinc-400 flex-shrink-0" />
                      <span className="flex-1">{cmd.label}</span>
                      <span className="text-[10px] text-zinc-500">{cmd.category}</span>
                      {cmd.shortcut && (
                        <kbd className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700 ml-1">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-zinc-800/60 flex items-center gap-4 text-[10px] text-zinc-600">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
          {mode !== "files" && <span className="ml-auto">Cmd+P for files</span>}
          {mode !== "ai" && <span className="ml-auto">Cmd+K for AI</span>}
        </div>
      </div>
    </div>
  );
}
