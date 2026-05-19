"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Image,
  Rocket,
  Server,
  LayoutDashboard,
  BookOpen,
  Database,
  Code,
  Activity,
  Settings,
  Search,
  LogOut,
  FileText,
  Command,
} from "lucide-react";
import { logout } from "@/lib/api";

interface PaletteCommand {
  id: string;
  label: string;
  category: "navigation" | "action" | "settings";
  icon: React.ElementType;
  keywords?: string[];
  shortcut?: string;
  action: () => void;
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands: PaletteCommand[] = useMemo(
    () => [
      // Navigation
      { id: "nav-chat", label: "Go to Chat", category: "navigation", icon: MessageSquare, keywords: ["message", "conversation", "ai"], action: () => router.push("/") },
      { id: "nav-images", label: "Go to Images", category: "navigation", icon: Image, keywords: ["generate", "gallery", "picture"], action: () => router.push("/images") },
      { id: "nav-deployments", label: "Go to Deployments", category: "navigation", icon: Rocket, keywords: ["deploy", "release"], action: () => router.push("/deployments") },
      { id: "nav-vms", label: "Go to VMs", category: "navigation", icon: Server, keywords: ["virtual", "machine", "ssh"], action: () => router.push("/vms") },
      { id: "nav-dashboard", label: "Go to Dashboard", category: "navigation", icon: LayoutDashboard, keywords: ["health", "status", "overview"], action: () => router.push("/dashboard") },
      { id: "nav-knowledge", label: "Go to Knowledge Base", category: "navigation", icon: BookOpen, keywords: ["rag", "documents", "kb"], action: () => router.push("/knowledge") },
      { id: "nav-database", label: "Go to Database", category: "navigation", icon: Database, keywords: ["sql", "tables", "browse"], action: () => router.push("/database") },
      { id: "nav-editor", label: "Go to Code Editor", category: "navigation", icon: Code, keywords: ["file", "edit", "monaco"], action: () => router.push("/code-editor") },
      { id: "nav-observability", label: "Go to Observability", category: "navigation", icon: Activity, keywords: ["metrics", "logs", "latency"], action: () => router.push("/observability") },
      // Actions
      { id: "act-new-chat", label: "New Chat Session", category: "action", icon: MessageSquare, keywords: ["start", "fresh"], action: () => { router.push("/"); } },
      { id: "act-generate-image", label: "Generate Image", category: "action", icon: Image, keywords: ["create", "sdxl"], action: () => router.push("/images") },
      { id: "act-search-files", label: "Search Files", category: "action", icon: Search, keywords: ["find", "workspace"], action: () => router.push("/code-editor") },
      { id: "act-docs", label: "View API Documentation", category: "action", icon: FileText, keywords: ["swagger", "openapi", "endpoints"], action: () => window.open("/api/docs", "_blank") },
      // Settings
      { id: "set-settings", label: "Open Settings", category: "settings", icon: Settings, keywords: ["config", "preferences"], action: () => { document.dispatchEvent(new CustomEvent("open-settings")); } },
      { id: "set-logout", label: "Sign Out", category: "settings", icon: LogOut, keywords: ["logout", "exit"], action: () => { logout(); router.push("/login"); } },
    ],
    [router]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.category.includes(q) ||
        cmd.keywords?.some((k) => k.includes(q))
    );
  }, [query, commands]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-command-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeCommand = useCallback(
    (cmd: PaletteCommand) => {
      setOpen(false);
      setQuery("");
      cmd.action();
    },
    []
  );

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      executeCommand(filtered[selectedIndex]);
    }
  };

  if (!open) return null;

  // Group commands by category
  const grouped = filtered.reduce<Record<string, PaletteCommand[]>>((acc, cmd) => {
    (acc[cmd.category] ??= []).push(cmd);
    return acc;
  }, {});

  const categoryLabels: Record<string, string> = {
    navigation: "Navigation",
    action: "Actions",
    settings: "Settings",
  };

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => { setOpen(false); setQuery(""); }}
      />

      {/* Palette */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl overflow-hidden animate-fade-in"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/60">
          <Command size={16} className="text-gray-500 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={filtered[selectedIndex] ? `cmd-${filtered[selectedIndex].id}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-gray-500 bg-gray-800 border border-gray-700/50 rounded">
            ESC
          </kbd>
        </div>

        {/* Live result count for screen readers */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {filtered.length} command{filtered.length !== 1 ? "s" : ""} available
        </div>

        {/* Results */}
        <div ref={listRef} id="command-list" role="listbox" className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-600">
              No commands found
            </div>
          ) : (
            Object.entries(grouped).map(([category, cmds]) => (
              <div key={category}>
                <div className="px-4 pt-2 pb-1">
                  <span className="text-[10px] font-medium text-gray-600 uppercase tracking-wider">
                    {categoryLabels[category] || category}
                  </span>
                </div>
                {cmds.map((cmd) => {
                  flatIndex++;
                  const idx = flatIndex;
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      id={`cmd-${cmd.id}`}
                      role="option"
                      aria-selected={selectedIndex === idx}
                      data-command-item
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                        selectedIndex === idx
                          ? "bg-indigo-600/20 text-gray-100"
                          : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                      }`}
                    >
                      <Icon size={15} className="shrink-0 opacity-60" />
                      <span className="flex-1 text-left truncate">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700/50">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-800/60 flex items-center gap-4 text-[10px] text-gray-600">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>ESC Close</span>
        </div>
      </div>
    </div>
  );
}
