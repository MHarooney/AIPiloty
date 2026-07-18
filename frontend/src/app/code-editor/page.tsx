"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import AppShell from "@/components/app-shell";
import FileTree, { type TreeNode } from "@/components/file-tree";
import IDECommandPalette from "@/components/ide-command-palette";
import { getWorkspaceTree, getWorkspaceFile, saveWorkspaceFile, searchWorkspace, listProjects, createWorkspaceFile, createWorkspaceDir, renameWorkspacePath, deleteWorkspacePath, type Project } from "@/lib/api";
import ProjectPickerModal from "@/components/project-picker-modal";
import MCPSettings from "@/components/mcp-settings";
import MCPMarketplace from "@/components/mcp-marketplace";
import IDETerminal from "@/components/ide-terminal";
import {
  Code, Loader2, X, FileCode, Save, Circle, Search, GitBranch,
  Sparkles, FolderPlus, Settings2, ChevronDown, Folder, Terminal,
  FilePlus, FolderPlus as FolderPlusIcon, Package, Plus,
  Files, LayoutPanelLeft,
} from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { useRouter } from "next/navigation";
import GitPanel from "@/components/git-panel";
import EditorAIChat from "@/components/editor-ai-chat";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => ({ default: mod.DiffEditor })),
  { ssr: false }
);

interface OpenTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  language: string;
  dirty: boolean;
  projectId?: string;
}

interface SearchResult {
  file: string;
  line: number;
  content: string;
}

export default function CodeEditorPage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"files" | "search" | "git">("files");
  const [activityTab, setActivityTab] = useState<"files" | "search" | "git" | "mcp">("files");
  const [showTerminal, setShowTerminal] = useState(false);
  const [showMCPMarketplace, setShowMCPMarketplace] = useState(false);
  const [newItemTarget, setNewItemTarget] = useState<{ dir: string; type: "file" | "dir" } | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [statusBarInfo, setStatusBarInfo] = useState({ line: 1, col: 1, language: "plaintext" });
  const [showAIChat, setShowAIChat] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [aiChatWidth, setAiChatWidth] = useState(360);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showMCPSettings, setShowMCPSettings] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  // Command palette
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"ai" | "files" | "cmd">("ai");

  const sidebarDragRef = useRef({ active: false, startX: 0, startWidth: 0 });
  const aiChatDragRef = useRef({ active: false, startX: 0, startWidth: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<any>(null);
  const consumePendingCode = useEditorStore((s) => s.consumePendingCode);
  const diffProposal = useEditorStore((s) => s.diffProposal);
  const clearDiffProposal = useEditorStore((s) => s.clearDiffProposal);
  const setExplainSelection = useEditorStore((s) => s.setExplainSelection);
  const router = useRouter();

  /* ── Panel resize drag handlers ────────────────────────────────────── */
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (sidebarDragRef.current.active) {
        const delta = e.clientX - sidebarDragRef.current.startX;
        setSidebarWidth(Math.max(160, Math.min(480, sidebarDragRef.current.startWidth + delta)));
      }
      if (aiChatDragRef.current.active) {
        const delta = aiChatDragRef.current.startX - e.clientX;
        setAiChatWidth(Math.max(240, Math.min(640, aiChatDragRef.current.startWidth + delta)));
      }
    };
    const onMouseUp = () => {
      if (sidebarDragRef.current.active || aiChatDragRef.current.active) {
        sidebarDragRef.current.active = false;
        aiChatDragRef.current.active = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Load projects on mount
  useEffect(() => {
    listProjects().then((ps) => {
      setProjects(ps);
      if (ps.length > 0 && !activeProjectId) setActiveProjectId(ps[0].id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload file tree whenever active project changes
  useEffect(() => {
    setLoading(true);
    getWorkspaceTree(undefined, undefined, activeProjectId ?? undefined)
      .then((data) => setTree(data.tree || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeProjectId]);

  // Consume code sent from chat "Apply" button
  useEffect(() => {
    const pending = consumePendingCode();
    if (!pending) return;
    const ext = pending.language === "plaintext" ? "txt" : pending.language;
    let idx = 1;
    let path = `__scratch.${ext}`;
    while (tabs.some((t) => t.path === path)) {
      path = `__scratch_${idx++}.${ext}`;
    }
    const newTab: OpenTab = {
      path,
      name: path,
      content: pending.content,
      savedContent: "",
      language: pending.language,
      dirty: true,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTab(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "s") { e.preventDefault(); handleSave(); }
      if (meta && e.shiftKey && e.key === "f") {
        e.preventDefault();
        setShowSearch((prev) => { if (!prev) setTimeout(() => searchInputRef.current?.focus(), 50); return !prev; });
      }
      if (meta && e.key === "i" && !e.shiftKey) { e.preventDefault(); setShowAIChat(p => !p); }
      // Cmd+K — AI command palette
      if (meta && e.key === "k") { e.preventDefault(); setPaletteMode("ai"); setPaletteOpen(true); }
      // Cmd+P — quick open file
      if (meta && e.key === "p" && !e.shiftKey) { e.preventDefault(); setPaletteMode("files"); setPaletteOpen(true); }
      // Cmd+Shift+P — commands
      if (meta && e.shiftKey && e.key === "p") { e.preventDefault(); setPaletteMode("cmd"); setPaletteOpen(true); }
      // Ctrl+` — toggle terminal
      if (e.ctrlKey && e.key === "`") { e.preventDefault(); setShowTerminal(p => !p); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const data = await searchWorkspace(q);
      setSearchResults(data.results || []);
    } catch {
      toast.error("Search failed");
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const openSearchResult = (result: SearchResult) => {
    openFile(result.file).then(() => {
      // Jump to line after file opens
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.revealLineInCenter(result.line);
          editorRef.current.setPosition({ lineNumber: result.line, column: 1 });
          editorRef.current.focus();
        }
      }, 100);
    });
  };

  const openFile = useCallback(async (path: string) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) { setActiveTab(path); return; }
    setFileLoading(true);
    try {
      const data = await getWorkspaceFile(path, activeProjectId ?? undefined);
      const newTab: OpenTab = {
        path,
        name: path.split("/").pop() || path,
        content: data.content || "",
        savedContent: data.content || "",
        language: data.language || "plaintext",
        dirty: false,
        projectId: activeProjectId ?? undefined,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTab(path);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ECONNREFUSED")) {
        toast.error("Cannot reach backend — is the server running?");
      } else {
        toast.error(msg || "Failed to open file");
      }
    } finally {
      setFileLoading(false);
    }
  }, [tabs, activeProjectId]);

  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tab = tabs.find((t) => t.path === path);
    if (tab?.dirty && !window.confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeTab === path) setActiveTab(next.length > 0 ? next[next.length - 1].path : null);
      return next;
    });
  };

  const handleEditorChange = (value: string | undefined) => {
    if (!activeTab || value === undefined) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.path === activeTab
          ? { ...t, content: value, dirty: value !== t.savedContent }
          : t
      )
    );
  };

  const handleSave = useCallback(async () => {
    const current = tabs.find((t) => t.path === activeTab);
    if (!current || !current.dirty) return;

    setSaving(true);
    try {
      await saveWorkspaceFile(current.path, current.content, current.projectId);
      setTabs((prev) =>
        prev.map((t) =>
          t.path === current.path
            ? { ...t, savedContent: t.content, dirty: false }
            : t
        )
      );
      toast.success(`Saved ${current.name}`);
    } catch (err: any) {
      toast.error(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [tabs, activeTab]);

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    // Track selection changes so the AI panel knows what's selected
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      const text = editor.getModel()?.getValueInRange(selection) ?? "";
      setSelectedText(text);
    });
    // Track cursor position for status bar
    editor.onDidChangeCursorPosition((e: any) => {
      setStatusBarInfo(prev => ({
        ...prev,
        line: e.position.lineNumber,
        col: e.position.column,
      }));
    });
    // Register Cmd+S inside Monaco
    editor.addCommand(
      // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS
      2048 | 49,
      () => handleSave()
    );
    // Ctrl+` to toggle terminal
    editor.addCommand(
      2048 | 90,  // CtrlCmd + backtick is tricky; use a common shortcut
      () => setShowTerminal(p => !p)
    );
    // "Explain Selection" context menu action
    editor.addAction({
      id: "explain-selection",
      label: "Explain Selection",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE],
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.5,
      run: (ed: any) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection);
        if (selectedText?.trim()) {
          setExplainSelection(selectedText);
          router.push("/");
        } else {
          toast.info("Select some code first");
        }
      },
    });
    // "Edit Selection with AI" context menu action
    editor.addAction({
      id: "edit-selection-ai",
      label: "Edit Selection with AI",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.6,
      run: (ed: any) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection);
        if (selectedText?.trim()) {
          setExplainSelection(`Please refactor and improve this code:\n\`\`\`\n${selectedText}\n\`\`\``);
          router.push("/");
        } else {
          toast.info("Select some code first");
        }
      },
    });
  };

  const acceptDiff = useCallback(() => {
    if (!diffProposal) return;
    const existing = tabs.find((t) => t.path === diffProposal.filePath);
    if (existing) {
      setTabs((prev) =>
        prev.map((t) =>
          t.path === diffProposal.filePath
            ? { ...t, content: diffProposal.modified, dirty: diffProposal.modified !== t.savedContent }
            : t
        )
      );
      setActiveTab(diffProposal.filePath);
    } else {
      const newTab: OpenTab = {
        path: diffProposal.filePath,
        name: diffProposal.filePath.split("/").pop() || diffProposal.filePath,
        content: diffProposal.modified,
        savedContent: diffProposal.original,
        language: diffProposal.language,
        dirty: true,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTab(diffProposal.filePath);
    }
    clearDiffProposal();
    toast.success("Changes applied");
  }, [diffProposal, tabs, clearDiffProposal]);

  const current = tabs.find((t) => t.path === activeTab);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <AppShell>
      <div className="flex-1 flex overflow-hidden animate-fade-in">
        {/* File tree sidebar */}
        <aside
          className="flex-shrink-0 bg-gray-950/50 flex flex-col overflow-hidden"
          style={{ width: sidebarWidth, borderRight: "1px solid rgba(31,41,55,0.5)" }}
        >
          {/* Project switcher */}
          <div className="px-3 py-2 border-b border-gray-800/50 relative">
            <button
              onClick={() => setShowProjectDropdown((v) => !v)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded bg-gray-900/50 hover:bg-gray-800/60 transition-colors text-xs"
            >
              {activeProject ? (
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: activeProject.color }} />
              ) : (
                <Folder size={11} className="text-gray-600 shrink-0" />
              )}
              <span className="flex-1 text-left truncate text-gray-300">{activeProject?.name ?? "Default workspace"}</span>
              <ChevronDown size={11} className="text-gray-600 shrink-0" />
            </button>
            {showProjectDropdown && (
              <div className="absolute left-3 right-3 top-full mt-1 bg-gray-900 border border-gray-700/60 rounded-lg shadow-xl z-20 overflow-hidden">
                <div className="py-1">
                  <button
                    onClick={() => { setActiveProjectId(null); setShowProjectDropdown(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                      activeProjectId === null ? "text-indigo-300" : "text-gray-400"
                    }`}
                  >
                    <Folder size={11} className="text-gray-600" /> Default workspace
                  </button>
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setActiveProjectId(p.id); setShowProjectDropdown(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                        activeProjectId === p.id ? "text-indigo-300" : "text-gray-400"
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="flex-1 text-left truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
                <div className="border-t border-gray-800/50 px-3 py-2 flex gap-2">
                  <button
                    onClick={() => { setShowProjectDropdown(false); setShowProjectPicker(true); }}
                    className="flex items-center gap-1.5 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    <FolderPlus size={11} /> Open folder…
                  </button>
                  <button
                    onClick={() => { setShowProjectDropdown(false); setShowMCPSettings(true); }}
                    className="ml-auto flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    <Settings2 size={11} /> MCP
                  </button>
                  <button
                    onClick={() => { setShowProjectDropdown(false); setShowMCPMarketplace(true); }}
                    className="flex items-center gap-1.5 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <Package size={11} /> Marketplace
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-b border-gray-800/50 flex items-center gap-1">
            <button
              onClick={() => setSidebarTab("files")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${sidebarTab === "files" ? "bg-gray-800 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
            >
              <Code size={12} /> Files
            </button>
            <button
              onClick={() => setSidebarTab("git")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${sidebarTab === "git" ? "bg-gray-800 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
            >
              <GitBranch size={12} /> Git
            </button>
            {sidebarTab === "files" && (
              <div className="ml-auto flex items-center gap-0.5">
                {/* New file */}
                <button
                  onClick={() => setNewItemTarget({ dir: ".", type: "file" })}
                  className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
                  title="New File"
                >
                  <FilePlus size={13} />
                </button>
                {/* New folder */}
                <button
                  onClick={() => setNewItemTarget({ dir: ".", type: "dir" })}
                  className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
                  title="New Folder"
                >
                  <FolderPlusIcon size={13} />
                </button>
                {/* Search */}
                <button
                  onClick={() => setShowSearch((prev) => {
                    if (!prev) setTimeout(() => searchInputRef.current?.focus(), 50);
                    return !prev;
                  })}
                  className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
                  title="Search Files (⇧⌘F)"
                >
                  <Search size={13} />
                </button>
              </div>
            )}
          </div>

          {/* New item inline input */}
          {newItemTarget && sidebarTab === "files" && (
            <div className="px-3 py-2 border-b border-gray-800/50">
              <div className="flex items-center gap-1.5">
                {newItemTarget.type === "file" ? <FilePlus size={11} className="text-gray-500" /> : <FolderPlusIcon size={11} className="text-gray-500" />}
                <input
                  autoFocus
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 outline-none focus:border-blue-500"
                  placeholder={newItemTarget.type === "file" ? "filename.ts" : "folder-name"}
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Escape") { setNewItemTarget(null); setNewItemName(""); }
                    if (e.key === "Enter" && newItemName.trim()) {
                      const path = newItemTarget.dir === "." ? newItemName.trim() : `${newItemTarget.dir}/${newItemName.trim()}`;
                      try {
                        if (newItemTarget.type === "file") {
                          await createWorkspaceFile(path, "", activeProjectId ?? undefined);
                          toast.success(`Created ${path}`);
                        } else {
                          await createWorkspaceDir(path, activeProjectId ?? undefined);
                          toast.success(`Created folder ${path}`);
                        }
                        // Reload tree
                        getWorkspaceTree(undefined, undefined, activeProjectId ?? undefined)
                          .then(d => setTree(d.tree || []));
                      } catch (err: any) {
                        toast.error(err.message);
                      }
                      setNewItemTarget(null);
                      setNewItemName("");
                    }
                  }}
                />
              </div>
            </div>
          )}

          {sidebarTab === "files" ? (
            <>
              {/* Search Panel */}
              {showSearch && (
            <div className="border-b border-gray-800/50 p-3 space-y-2 bg-gray-900/50">
              <div className="flex gap-1.5">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); if (e.key === "Escape") setShowSearch(false); }}
                  placeholder="Search in files…"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="px-2 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="max-h-64 overflow-y-auto space-y-0.5">
                  {searchResults.map((r, i) => (
                    <button
                      key={`${r.file}:${r.line}:${i}`}
                      onClick={() => openSearchResult(r)}
                      className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-800 transition-colors group"
                    >
                      <div className="flex items-center gap-1.5">
                        <FileCode size={10} className="text-indigo-400 shrink-0" />
                        <span className="text-gray-400 truncate">{r.file}</span>
                        <span className="text-gray-600 shrink-0">:{r.line}</span>
                      </div>
                      <div className="text-gray-500 truncate mt-0.5 pl-4 group-hover:text-gray-300">{r.content}</div>
                    </button>
                  ))}
                </div>
              )}
              {!searching && searchQuery && searchResults.length === 0 && (
                <p className="text-xs text-gray-600 px-1">No results</p>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="animate-spin text-gray-500" size={20} />
              </div>
            ) : tree.length === 0 ? (
              <p className="text-xs text-gray-600 p-4">No files found</p>
            ) : (
              <FileTree
                tree={tree}
                selectedPath={activeTab}
                onSelect={openFile}
                onNewFile={(dir) => setNewItemTarget({ dir, type: "file" })}
                onNewFolder={(dir) => setNewItemTarget({ dir, type: "dir" })}
                onRename={async (oldPath, newName) => {
                  const parts = oldPath.split("/");
                  parts[parts.length - 1] = newName;
                  const newPath = parts.join("/");
                  try {
                    await renameWorkspacePath(oldPath, newPath, activeProjectId ?? undefined);
                    toast.success("Renamed");
                    getWorkspaceTree(undefined, undefined, activeProjectId ?? undefined).then(d => setTree(d.tree || []));
                  } catch (err: any) { toast.error(err.message); }
                }}
                onDelete={async (path, isDir) => {
                  if (!confirm(`Delete ${isDir ? "folder" : "file"} "${path.split("/").pop()}"?`)) return;
                  try {
                    await deleteWorkspacePath(path, activeProjectId ?? undefined);
                    toast.success("Deleted");
                    setTabs(prev => prev.filter(t => !t.path.startsWith(path)));
                    if (activeTab?.startsWith(path)) setActiveTab(null);
                    getWorkspaceTree(undefined, undefined, activeProjectId ?? undefined).then(d => setTree(d.tree || []));
                  } catch (err: any) { toast.error(err.message); }
                }}
              />
            )}
          </div>
            </>
          ) : (
            <GitPanel />
          )}
        </aside>

        {/* Sidebar resize handle */}
        <div
          className="flex-shrink-0 cursor-col-resize z-10 transition-colors hover:bg-indigo-500/50 active:bg-indigo-500/70"
          style={{ width: 4 }}
          onMouseDown={(e) => {
            e.preventDefault();
            sidebarDragRef.current = { active: true, startX: e.clientX, startWidth: sidebarWidth };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />

        {/* Editor area — vertical column wrapping: (editor+AI) + terminal + status bar */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Horizontal: editor content + AI chat panel */}
        <div className="flex-1 flex overflow-hidden min-w-0">
          <div className="flex-1 flex flex-col min-w-0">
          {/* Tab bar */}
          {tabs.length > 0 && (
            <div className="flex items-center border-b border-gray-800/50 bg-gray-950/80 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.path}
                  onClick={() => { setActiveTab(tab.path); setStatusBarInfo(prev => ({ ...prev, language: tab.language })); }}
                  className={`flex items-center gap-2 px-4 py-2.5 text-xs border-r border-gray-800/30 transition-colors whitespace-nowrap ${
                    activeTab === tab.path
                      ? "bg-gray-900 text-gray-200 border-b-2 border-b-indigo-500"
                      : "text-gray-500 hover:text-gray-300 hover:bg-gray-900/50"
                  }`}
                >
                  <FileCode size={12} />
                  {tab.name}
                  {tab.dirty && (
                    <Circle size={8} className="fill-amber-400 text-amber-400" />
                  )}
                  <span
                    onClick={(e) => closeTab(tab.path, e)}
                    className="ml-1 p-0.5 rounded hover:bg-gray-700 transition-colors"
                  >
                    <X size={10} />
                  </span>
                </button>
              ))}

              {/* Save button */}
              {current?.dirty && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  title="Save (⌘S)"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              )}
              {/* Cmd+K AI command palette trigger */}
              <button
                onClick={() => { setPaletteMode("ai"); setPaletteOpen(true); }}
                className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-zinc-500 hover:text-purple-400 hover:bg-purple-500/5 transition-all border border-transparent hover:border-purple-500/20"
                title="AI Command Palette (⌘K)"
              >
                <Sparkles size={11} />
                <span className="hidden sm:inline">AI</span>
                <kbd className="text-zinc-700 text-[9px] ml-0.5">⌘K</kbd>
              </button>
              {/* AI Chat toggle button */}
              <button
                onClick={() => setShowAIChat((p) => !p)}
                className={`mr-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  showAIChat
                    ? "bg-indigo-600/20 border border-indigo-500/40 text-indigo-300"
                    : "text-gray-500 hover:text-indigo-400 hover:bg-indigo-500/5"
                }`}
                title="Toggle AI Chat (⌘I)"
              >
                <Sparkles size={12} />
                Chat
              </button>
            </div>
          )}

          {/* Editor / Diff / Placeholder */}
          {diffProposal ? (
            <div className="flex-1 flex flex-col">
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-900/30 border-b border-amber-700/50">
                <span className="text-xs text-amber-300">Proposed changes to <strong>{diffProposal.filePath}</strong></span>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => clearDiffProposal()}
                    className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                  >
                    Reject
                  </button>
                  <button
                    onClick={acceptDiff}
                    className="px-3 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                  >
                    Accept Changes
                  </button>
                </div>
              </div>
              <div className="flex-1">
                <MonacoDiffEditor
                  height="100%"
                  language={diffProposal.language}
                  original={diffProposal.original}
                  modified={diffProposal.modified}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    minimap: { enabled: false },
                  }}
                />
              </div>
            </div>
          ) : fileLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="animate-spin text-gray-500" size={28} />
            </div>
          ) : current ? (
            <div className="flex-1">
              <MonacoEditor
                height="100%"
                language={current.language}
                value={current.content}
                theme="vs-dark"
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                options={{
                  readOnly: false,
                  minimap: { enabled: true },
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  padding: { top: 12 },
                  tabSize: 2,
                  formatOnPaste: true,
                  renderWhitespace: "selection",
                  bracketPairColorization: { enabled: true },
                  guides: { bracketPairs: true },
                }}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600 text-sm gap-3">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
                  <Code size={28} className="text-indigo-400/60" />
                </div>
                <p className="text-gray-400 font-medium">No file open</p>
                <p className="text-xs text-gray-600 mt-1">Select a file from the explorer or use quick open</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                <button
                  onClick={() => { setPaletteMode("files"); setPaletteOpen(true); }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/50 bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-all text-xs"
                >
                  <Search size={12} />
                  Quick Open
                  <kbd className="text-zinc-600 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-700 text-[9px] ml-1">⌘P</kbd>
                </button>
                <button
                  onClick={() => { setPaletteMode("ai"); setPaletteOpen(true); }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-indigo-500/20 bg-indigo-500/5 text-indigo-400 hover:bg-indigo-500/10 transition-all text-xs"
                >
                  <Sparkles size={12} />
                  AI Command
                  <kbd className="text-indigo-700 bg-indigo-900/40 px-1.5 py-0.5 rounded border border-indigo-700/30 text-[9px] ml-1">⌘K</kbd>
                </button>
                <button
                  onClick={() => setShowAIChat(p => !p)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/50 bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-all text-xs"
                >
                  <Sparkles size={12} />
                  AI Chat
                  <kbd className="text-zinc-600 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-700 text-[9px] ml-1">⌘I</kbd>
                </button>
              </div>
            </div>
          )}          </div>

          {/* AI Chat panel — right side, resizable */}
          {showAIChat && (
            <>
              {/* AI panel resize handle */}
              <div
                className="flex-shrink-0 cursor-col-resize z-10 transition-colors hover:bg-indigo-500/50 active:bg-indigo-500/70"
                style={{ width: 4, borderLeft: "1px solid rgba(31,41,55,0.6)" }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  aiChatDragRef.current = { active: true, startX: e.clientX, startWidth: aiChatWidth };
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
              />
            <div
              className="shrink-0 flex flex-col overflow-hidden"
              style={{ width: aiChatWidth }}
            >
              <EditorAIChat
                editorRef={editorRef}
                currentFile={current ? { path: current.path, content: current.content, language: current.language } : null}
                selectedText={selectedText}
                onClose={() => setShowAIChat(false)}
                activeProject={activeProject}
                projectTree={tree}
              />
            </div>
            </>
          )}        </div>
        {/* End horizontal editor + AI area — closed above */}

        {/* ── Integrated Terminal Panel ──────────────────────────────── */}
        {showTerminal && (
          <IDETerminal
            onClose={() => setShowTerminal(false)}
          />
        )}

        {/* ── VS Code-style Status Bar ───────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-0.5 bg-blue-700/90 text-[10px] text-blue-100 font-mono select-none">
          <div className="flex items-center gap-3">
            {activeTab && (
              <>
                <span className="opacity-80">Ln {statusBarInfo.line}, Col {statusBarInfo.col}</span>
                <span className="opacity-60">|</span>
                <span className="capitalize opacity-80">{statusBarInfo.language}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowTerminal(p => !p)}
              className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity"
              title="Toggle Terminal (Ctrl+`)"
            >
              <Terminal size={10} /> Terminal
            </button>
            <button
              onClick={() => setShowMCPMarketplace(true)}
              className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity"
              title="MCP Marketplace"
            >
              <Package size={10} /> MCP
            </button>
          </div>
        </div>
        {/* End outer vertical editor column */}
        </div>
      </div>
      {showProjectPicker && (
        <ProjectPickerModal
          onClose={() => setShowProjectPicker(false)}
          onProjectOpened={(p) => {
            setProjects((prev) => {
              const exists = prev.find((x) => x.id === p.id);
              return exists ? prev : [...prev, p];
            });
            setActiveProjectId(p.id);
          }}
        />
      )}
      {showMCPSettings && (
        <MCPSettings onClose={() => setShowMCPSettings(false)} />
      )}
      {showMCPMarketplace && (
        <MCPMarketplace
          onClose={() => setShowMCPMarketplace(false)}
          onInstalled={() => toast.success("MCP server installed — reload agent to use new tools")}
        />
      )}

      {/* ── Cursor-style Command Palette ─────────────────────────────── */}
      <IDECommandPalette
        isOpen={paletteOpen}
        mode={paletteMode}
        onClose={() => setPaletteOpen(false)}
        fileTree={tree}
        currentFile={activeTab}
        onOpenFile={(path) => { openFile(path); setPaletteOpen(false); }}
        onAIAction={(prompt) => {
          // Inject into EditorAIChat
          setShowAIChat(true);
          // Give the panel a moment to mount then trigger the action
          setTimeout(() => {
            const event = new CustomEvent("aipiloty:ai-action", { detail: { prompt } });
            window.dispatchEvent(event);
          }, 100);
        }}
        extraCommands={[
          {
            id: "ai-chat", label: "Toggle AI Chat", icon: Sparkles, category: "View",
            action: () => setShowAIChat(p => !p), shortcut: "⌘I",
          },
          {
            id: "terminal", label: "Toggle Terminal", icon: Terminal, category: "View",
            action: () => setShowTerminal(p => !p), shortcut: "Ctrl+`",
          },
          {
            id: "mcp-marketplace", label: "Open MCP Marketplace", icon: Package, category: "Settings",
            action: () => setShowMCPMarketplace(true),
          },
          {
            id: "mcp-settings", label: "Manage MCP Servers", icon: Settings2, category: "Settings",
            action: () => setShowMCPSettings(true),
          },
          {
            id: "new-file", label: "New File", icon: FilePlus, category: "File",
            action: () => setNewItemTarget({ dir: ".", type: "file" }),
          },
          {
            id: "new-folder", label: "New Folder", icon: FolderPlusIcon, category: "File",
            action: () => setNewItemTarget({ dir: ".", type: "dir" }),
          },
          {
            id: "open-folder", label: "Open Project Folder", icon: Folder, category: "File",
            action: () => setShowProjectPicker(true),
          },
        ]}
      />
    </AppShell>
  );
}
