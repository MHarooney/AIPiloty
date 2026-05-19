"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, GitBranch, ChevronLeft,
  ChevronRight as ChevronRightIcon, LayoutGrid, List, Search, FolderPlus,
} from "lucide-react";
import { browseFilesystem, getHomePath, createProject, type FsEntry } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  onClose: () => void;
  onProjectOpened: (project: { id: string; name: string; path: string; color: string }) => void;
}

const SIDEBAR_ITEMS = [
  { label: "Home",      icon: "🏠", path: "~home~" },
  { label: "Desktop",   icon: "🖥",  path: "~home~/Desktop" },
  { label: "Documents", icon: "📄", path: "~home~/Documents" },
  { label: "Downloads", icon: "⬇️", path: "~home~/Downloads" },
  { label: "Root",      icon: "💻", path: "/" },
];

function FolderIcon({ name, isProject }: { name: string; isProject: boolean }) {
  const lower = name.toLowerCase();
  if (isProject)        return <span className="text-xl leading-none select-none">📁</span>;
  if (lower === "desktop")    return <span className="text-xl leading-none select-none">🖥</span>;
  if (lower === "documents")  return <span className="text-xl leading-none select-none">📄</span>;
  if (lower === "downloads")  return <span className="text-xl leading-none select-none">⬇️</span>;
  if (lower === "applications") return <span className="text-xl leading-none select-none">🚀</span>;
  if (lower === "pictures" || lower === "photos") return <span className="text-xl leading-none select-none">🖼</span>;
  if (lower === "music")  return <span className="text-xl leading-none select-none">🎵</span>;
  if (lower === "movies" || lower === "videos") return <span className="text-xl leading-none select-none">🎬</span>;
  if (lower === "library") return <span className="text-xl leading-none select-none">📚</span>;
  return <span className="text-xl leading-none select-none">📁</span>;
}

export default function ProjectPickerModal({ onClose, onProjectOpened }: Props) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries]         = useState<FsEntry[]>([]);
  const [parent, setParent]           = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectName, setProjectName] = useState("");
  const [adding, setAdding]           = useState(false);
  const [viewMode, setViewMode]       = useState<"grid" | "list">("list");
  const [history, setHistory]         = useState<string[]>([]);
  const [histIdx, setHistIdx]         = useState(-1);
  const [homePath, setHomePath]       = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback(async (path: string, push = true) => {
    setLoading(true);
    setSearchQuery("");
    try {
      const data = await browseFilesystem(path);
      setCurrentPath(data.path);
      setParent(data.parent);
      setEntries(data.entries);
      setProjectName(data.name || data.path.split("/").filter(Boolean).pop() || "");
      if (push) {
        setHistory((prev) => [...prev.slice(0, histIdx + 1), data.path]);
        setHistIdx((i) => i + 1);
      }
    } catch (err: any) {
      toast.error(err.message || "Cannot browse path");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histIdx]);

  useEffect(() => {
    getHomePath().then((d) => {
      setHomePath(d.path);
      navigate(d.path, true);
    }).catch(() => navigate("/", true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goBack = () => {
    if (histIdx <= 0) return;
    const idx = histIdx - 1;
    setHistIdx(idx);
    navigate(history[idx], false);
  };
  const goForward = () => {
    if (histIdx >= history.length - 1) return;
    const idx = histIdx + 1;
    setHistIdx(idx);
    navigate(history[idx], false);
  };

  const handleAdd = async () => {
    if (!currentPath || !projectName.trim()) return;
    setAdding(true);
    try {
      const project = await createProject(projectName.trim(), currentPath);
      toast.success(`"${project.name}" opened`);
      onProjectOpened(project);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to add project");
    } finally {
      setAdding(false);
    }
  };

  const segments = currentPath.split("/").filter(Boolean);

  const displayed = (searchQuery
    ? entries.filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries
  );
  const sorted = [...displayed.filter((e) => e.is_dir), ...displayed.filter((e) => !e.is_dir)];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* ── Finder window ──────────────────────────────────────────────── */}
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: 780, height: 540,
          background: "rgba(28,28,28,0.97)",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.11)",
          boxShadow: "0 40px 80px rgba(0,0,0,0.85), 0 0 0 0.5px rgba(255,255,255,0.07)",
        }}
      >
        {/* ── Title bar ──────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 px-4 shrink-0 select-none"
          style={{
            height: 44,
            background: "rgba(40,40,40,0.98)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onClose}
              className="w-3 h-3 rounded-full flex items-center justify-center group transition-opacity"
              style={{ background: "#ff5f57" }}
            >
              <span className="opacity-0 group-hover:opacity-100 text-[8px] font-bold leading-none" style={{ color: "#8b0000" }}>✕</span>
            </button>
            <button className="w-3 h-3 rounded-full" style={{ background: "#febc2e" }} />
            <button className="w-3 h-3 rounded-full" style={{ background: "#28c840" }} />
          </div>

          {/* Back / Forward */}
          <div className="flex items-center gap-0">
            <button onClick={goBack} disabled={histIdx <= 0}
              className="p-1.5 rounded hover:bg-white/10 disabled:opacity-20 transition-colors text-gray-300">
              <ChevronLeft size={14} />
            </button>
            <button onClick={goForward} disabled={histIdx >= history.length - 1}
              className="p-1.5 rounded hover:bg-white/10 disabled:opacity-20 transition-colors text-gray-300">
              <ChevronRightIcon size={14} />
            </button>
          </div>

          {/* Window title */}
          <div className="flex-1 text-center pointer-events-none">
            <span className="text-[13px] font-semibold text-gray-300">
              {segments[segments.length - 1] || "Computer"}
            </span>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-0.5 mr-2">
            <button onClick={() => setViewMode("list")}
              className="p-1.5 rounded transition-colors"
              style={{ background: viewMode === "list" ? "rgba(255,255,255,0.15)" : "transparent", color: viewMode === "list" ? "#fff" : "#6b7280" }}>
              <List size={13} />
            </button>
            <button onClick={() => setViewMode("grid")}
              className="p-1.5 rounded transition-colors"
              style={{ background: viewMode === "grid" ? "rgba(255,255,255,0.15)" : "transparent", color: viewMode === "grid" ? "#fff" : "#6b7280" }}>
              <LayoutGrid size={13} />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="pl-6 pr-2 py-1 text-[11px] rounded text-gray-300 placeholder-gray-600 focus:outline-none transition-all w-28 focus:w-36"
              style={{
                background: "rgba(255,255,255,0.09)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            />
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar */}
          <div
            className="flex flex-col py-3 overflow-y-auto shrink-0"
            style={{
              width: 168,
              background: "rgba(22,22,22,0.9)",
              borderRight: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest"
               style={{ color: "rgba(156,163,175,0.5)" }}>
              Favourites
            </p>
            {SIDEBAR_ITEMS.map((item) => {
              const resolved = item.path.replace("~home~", homePath);
              const active = currentPath === resolved || currentPath.startsWith(resolved + "/");
              return (
                <button
                  key={item.label}
                  onClick={() => navigate(item.path.replace("~home~", homePath))}
                  className="flex items-center gap-2 mx-1.5 px-2 py-1.5 rounded-md text-xs transition-colors"
                  style={{
                    background: active ? "rgba(99,102,241,0.22)" : "transparent",
                    color: active ? "#a5b4fc" : "rgba(156,163,175,0.8)",
                  }}
                >
                  <span className="text-sm leading-none">{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* File pane */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Breadcrumb bar */}
            <div
              className="flex items-center gap-0.5 px-3 overflow-x-auto shrink-0"
              style={{
                height: 26,
                background: "rgba(26,26,26,0.7)",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <button
                onClick={() => navigate("/")}
                className="text-[10px] hover:text-gray-400 shrink-0 transition-colors"
                style={{ color: "rgba(107,114,128,0.8)" }}
              >
                /
              </button>
              {segments.map((seg, i) => (
                <span key={i} className="flex items-center gap-0.5 shrink-0">
                  <ChevronRightIcon size={9} className="text-gray-700" />
                  <button
                    onClick={() => navigate("/" + segments.slice(0, i + 1).join("/"))}
                    className="text-[10px] hover:text-gray-400 transition-colors whitespace-nowrap"
                    style={{ color: "rgba(107,114,128,0.9)" }}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>

            {/* Files area */}
            <div className="flex-1 overflow-y-auto" style={{ background: "rgba(18,18,18,0.6)" }}>
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 size={20} className="animate-spin text-gray-600" />
                </div>
              ) : sorted.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-gray-700">
                  {searchQuery ? "No matches" : "Empty folder"}
                </div>
              ) : viewMode === "list" ? (
                <div className="py-0.5">
                  {/* Header */}
                  <div
                    className="flex items-center px-4 py-1 text-[10px] border-b"
                    style={{ color: "rgba(107,114,128,0.7)", borderColor: "rgba(255,255,255,0.05)" }}
                  >
                    <span className="flex-1">Name</span>
                    <span className="w-20 text-right">Kind</span>
                  </div>

                  {sorted.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() => entry.is_dir ? navigate(entry.path) : undefined}
                      disabled={!entry.is_dir}
                      className="w-full flex items-center gap-2.5 px-4 py-1.5 transition-colors group"
                      style={{
                        cursor: entry.is_dir ? "pointer" : "default",
                        opacity: entry.is_dir ? 1 : 0.35,
                        background: "transparent",
                      }}
                      onMouseEnter={(e) => { if (entry.is_dir) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      {entry.is_dir
                        ? <FolderIcon name={entry.name} isProject={entry.is_project} />
                        : <span className="text-lg leading-none select-none">📄</span>
                      }
                      <span
                        className="flex-1 text-left text-[12px] truncate transition-colors"
                        style={{ color: "rgba(229,231,235,0.9)" }}
                      >
                        {entry.name}
                      </span>
                      {entry.is_project && (
                        <span className="flex items-center gap-1 shrink-0 text-[10px]" style={{ color: "rgba(129,140,248,0.7)" }}>
                          <GitBranch size={9} /> project
                        </span>
                      )}
                      <span className="w-20 text-right text-[10px] shrink-0" style={{ color: "rgba(75,85,99,0.9)" }}>
                        {entry.is_dir ? "Folder" : "File"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                /* Grid */
                <div className="p-4 grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(88px,1fr))" }}>
                  {sorted.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() => entry.is_dir ? navigate(entry.path) : undefined}
                      disabled={!entry.is_dir}
                      className="flex flex-col items-center gap-1 p-2 rounded-lg transition-colors"
                      style={{ cursor: entry.is_dir ? "pointer" : "default", opacity: entry.is_dir ? 1 : 0.35 }}
                      onMouseEnter={(e) => { if (entry.is_dir) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <span className="text-3xl leading-none select-none">
                        {entry.is_dir ? (entry.is_project ? "📁" : "📁") : "📄"}
                      </span>
                      <span className="text-[10px] text-center leading-tight line-clamp-2 break-all" style={{ color: "rgba(209,213,219,0.85)" }}>
                        {entry.name}
                      </span>
                      {entry.is_project && (
                        <span className="text-[9px]" style={{ color: "#818cf8" }}>● project</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom bar ─────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 px-4 shrink-0"
          style={{
            height: 52,
            background: "rgba(30,30,30,0.99)",
            borderTop: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <span className="text-[11px] shrink-0" style={{ color: "rgba(107,114,128,0.8)" }}>Folder:</span>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            className="flex-1 min-w-0 px-2 py-1 text-xs text-gray-200 rounded focus:outline-none transition-colors"
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.11)",
            }}
            placeholder="Project name"
          />
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded-md transition-colors shrink-0"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(156,163,175,0.9)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={adding || !currentPath || !projectName.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-white rounded-md transition-all disabled:opacity-40 shrink-0"
            style={{
              background: "linear-gradient(135deg,#6366f1,#4f46e5)",
              border: "1px solid rgba(99,102,241,0.5)",
              boxShadow: "0 1px 8px rgba(99,102,241,0.35)",
            }}
          >
            {adding ? <Loader2 size={11} className="animate-spin" /> : <FolderPlus size={11} />}
            Open Folder
          </button>
        </div>
      </div>
    </div>
  );
}
