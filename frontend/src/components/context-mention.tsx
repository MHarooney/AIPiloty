"use client";

import { useState, useEffect, useRef } from "react";
import { FileCode, FolderOpen, BookOpen, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

interface ContextItem {
  id: string;
  label: string;
  type: "file" | "folder" | "doc" | "symbol";
  path?: string;
}

const BUILT_IN_CONTEXTS: ContextItem[] = [
  { id: "workspace", label: "workspace", type: "folder", path: "Entire workspace" },
  { id: "currentFile", label: "currentFile", type: "file", path: "Currently open file" },
  { id: "selection", label: "selection", type: "symbol", path: "Selected text in editor" },
  { id: "knowledge", label: "knowledge", type: "doc", path: "RAG knowledge base" },
  { id: "git-diff", label: "git-diff", type: "symbol", path: "Current git changes" },
  { id: "terminal", label: "terminal", type: "symbol", path: "Recent terminal output" },
];

const TYPE_ICON = {
  file: FileCode,
  folder: FolderOpen,
  doc: BookOpen,
  symbol: Hash,
};

const TYPE_COLOR = {
  file: "text-blue-400",
  folder: "text-amber-400",
  doc: "text-emerald-400",
  symbol: "text-purple-400",
};

interface ContextMentionProps {
  onSelect: (item: string) => void;
  onClose: () => void;
}

export default function ContextMention({ onSelect, onClose }: ContextMentionProps) {
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = BUILT_IN_CONTEXTS.filter(
    (c) => c.label.toLowerCase().includes(filter.toLowerCase()) || c.path?.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].label);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [filtered, selectedIndex, onSelect, onClose]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="w-72 rounded-xl border border-gray-200 dark:border-gray-800/60 bg-white dark:bg-gray-950 shadow-xl overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800/40">
        <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-widest">
          Context — @mention
        </p>
      </div>
      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-400">No matching context</p>
        ) : (
          filtered.map((item, i) => {
            const Icon = TYPE_ICON[item.type];
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.label)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                  i === selectedIndex
                    ? "bg-indigo-50 dark:bg-indigo-600/10"
                    : "hover:bg-gray-50 dark:hover:bg-gray-900/50"
                )}
              >
                <Icon size={14} className={TYPE_COLOR[item.type]} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200">@{item.label}</p>
                  {item.path && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-600 truncate">{item.path}</p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
