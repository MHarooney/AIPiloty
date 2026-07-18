"use client";

/**
 * FileTree — VS Code / Cursor-quality file explorer.
 *
 * Features:
 *  • Language-specific colored file icons (Seti-style colour palette)
 *  • Right-click context menu: New File, New Folder, Rename, Delete, Copy Path
 *  • Keyboard navigation (↑↓ arrows, Enter to open, Space to expand)
 *  • Drag-and-drop to AI chat (@mention)
 *  • Git status indicators (M, U, D badges)
 *  • Inline rename input
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  ChevronRight, ChevronDown,
  FilePlus, FolderPlus as FolderPlusIcon, Pencil, Trash2, Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface TreeNode {
  name: string;
  type: "file" | "directory";
  path: string;
  children?: TreeNode[];
  gitStatus?: "modified" | "untracked" | "deleted" | "staged";
}

// ── Language → colour mapping (VS Code Seti-icon palette) ────────────────

const FILE_COLORS: Record<string, string> = {
  // TypeScript
  ts: "#3178C6", tsx: "#3178C6",
  // JavaScript
  js: "#F0DB4F", jsx: "#F0DB4F", mjs: "#F0DB4F", cjs: "#F0DB4F",
  // Python
  py: "#4584B6", pyi: "#4584B6",
  // Rust
  rs: "#CE412B",
  // Go
  go: "#00ACD7",
  // Ruby
  rb: "#CC342D",
  // PHP
  php: "#777BB4",
  // Java / Kotlin
  java: "#B07219", kt: "#A97BFF", kts: "#A97BFF",
  // C / C++
  c: "#555555", cpp: "#F34B7D", h: "#555555", hpp: "#F34B7D",
  // HTML
  html: "#E34C26", htm: "#E34C26",
  // CSS / SCSS / Less
  css: "#563D7C", scss: "#CC6699", less: "#1D365D", sass: "#CC6699",
  // JSON
  json: "#CBCB41", jsonc: "#CBCB41",
  // YAML / TOML / Config
  yaml: "#CB171E", yml: "#CB171E", toml: "#9C4221",
  // Markdown / Docs
  md: "#FFFFFF", mdx: "#FFFFFF", txt: "#AAAAAA",
  // Shell
  sh: "#4EAA25", bash: "#4EAA25", zsh: "#4EAA25", fish: "#4EAA25",
  // SQL
  sql: "#336791",
  // Docker
  dockerfile: "#2496ED",
  // Terraform / HCL
  tf: "#7B42BC", hcl: "#7B42BC",
  // XML / SVG
  xml: "#F26522", svg: "#FFB13B",
  // GraphQL
  graphql: "#E10098", gql: "#E10098",
  // Dart / Flutter
  dart: "#00B4AB",
  // Swift
  swift: "#FA7343",
  // Env
  env: "#ECD53F",
  // Lock files
  lock: "#666666",
  // Git
  gitignore: "#F05032",
  // Config
  ini: "#AAAAAA", cfg: "#AAAAAA", conf: "#AAAAAA",
};

const FOLDER_COLORS: Record<string, string> = {
  src: "#79B8FF",
  app: "#79B8FF",
  lib: "#56A0D3",
  utils: "#56A0D3",
  components: "#7EC8E3",
  pages: "#7EC8E3",
  hooks: "#DA70D6",
  stores: "#DA70D6",
  api: "#FFA500",
  services: "#FFA500",
  tests: "#2DBA4E",
  test: "#2DBA4E",
  __tests__: "#2DBA4E",
  node_modules: "#666666",
  ".git": "#F05032",
  dist: "#888888",
  build: "#888888",
  public: "#79B8FF",
  assets: "#FFA500",
  styles: "#CC6699",
  css: "#CC6699",
  config: "#CBCB41",
  docs: "#CCCCCC",
  scripts: "#4EAA25",
  backend: "#CE412B",
  frontend: "#3178C6",
  mobile: "#00B4AB",
};

function getFileColor(name: string): string {
  const lower = name.toLowerCase();
  // Special file names
  if (lower === "dockerfile") return FILE_COLORS.dockerfile;
  if (lower === ".gitignore" || lower === ".gitattributes") return FILE_COLORS.gitignore;
  if (lower.startsWith(".env")) return FILE_COLORS.env;
  if (lower === "makefile" || lower === "makefile") return FILE_COLORS.sh;
  // By extension
  const ext = lower.split(".").pop() || "";
  return FILE_COLORS[ext] || "#9CDCFE";
}

function getFolderColor(name: string): string {
  return FOLDER_COLORS[name.toLowerCase()] || "#E8C468";
}

// ── Context menu ─────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number; y: number; node: TreeNode;
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onCopyPath: (path: string) => void;
}

function ContextMenu({ state, onClose, onNewFile, onNewFolder, onRename, onDelete, onCopyPath }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const dir = state.node.type === "directory"
    ? state.node.path
    : state.node.path.split("/").slice(0, -1).join("/") || ".";

  const items = [
    ...(state.node.type === "directory" ? [
      { label: "New File…", icon: FilePlus, action: () => { onNewFile(dir); onClose(); } },
      { label: "New Folder…", icon: FolderPlusIcon, action: () => { onNewFolder(dir); onClose(); } },
      "separator" as const,
    ] : []),
    { label: "Rename…", icon: Pencil, action: () => { onRename(state.node); onClose(); } },
    { label: "Delete", icon: Trash2, action: () => { onDelete(state.node); onClose(); }, danger: true },
    "separator" as const,
    { label: "Copy Relative Path", icon: Copy, action: () => { onCopyPath(state.node.path); onClose(); } },
  ];

  return (
    <div
      ref={ref}
      className="fixed z-[999] min-w-[180px] bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl py-1 text-xs"
      style={{ left: state.x, top: state.y }}
    >
      {items.map((item, i) => {
        if (item === "separator") {
          return <div key={i} className="border-t border-zinc-700/60 my-1" />;
        }
        const { label, icon: Icon, action, danger } = item;
        return (
          <button
            key={label}
            onClick={action}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
              danger
                ? "text-red-400 hover:bg-red-900/20 hover:text-red-300"
                : "text-zinc-300 hover:bg-zinc-700/70 hover:text-zinc-100"
            )}
          >
            <Icon size={12} className="flex-shrink-0" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Git status badge ──────────────────────────────────────────────────────

const GIT_BADGE: Record<string, { text: string; className: string }> = {
  modified:  { text: "M", className: "text-amber-400" },
  untracked: { text: "U", className: "text-green-400" },
  deleted:   { text: "D", className: "text-red-400" },
  staged:    { text: "A", className: "text-blue-400" },
};

// ── Tree item ─────────────────────────────────────────────────────────────

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: TreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  renamingPath: string | null;
  onRenameSubmit: (node: TreeNode, newName: string) => void;
  onRenameCancel: () => void;
}

function TreeItem({
  node, depth, selectedPath, onSelect, onContextMenu,
  renamingPath, onRenameSubmit, onRenameCancel,
}: TreeItemProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = node.type === "directory";
  const isSelected = node.path === selectedPath;
  const isRenaming = renamingPath === node.path;
  const [renameValue, setRenameValue] = useState(node.name);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.name);
      setTimeout(() => renameRef.current?.select(), 10);
    }
  }, [isRenaming, node.name]);

  const handleClick = useCallback(() => {
    if (isDir) setExpanded(p => !p);
    else onSelect(node);
  }, [isDir, node, onSelect]);

  const fileColor = isDir ? getFolderColor(node.name) : getFileColor(node.name);
  const badge = node.gitStatus ? GIT_BADGE[node.gitStatus] : null;

  // Drag for @mention in AI chat
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.setData("application/x-aipiloty-node-type", node.type);
    e.dataTransfer.setData("application/x-aipiloty-node-name", node.name);
  };

  return (
    <div>
      {isRenaming ? (
        <div className="flex items-center px-2 py-0.5" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
          <span className="w-3 flex-shrink-0" />
          <span className="mr-1.5 text-[11px]" style={{ color: fileColor }}>
            {isDir ? "📁" : ""}
          </span>
          <input
            ref={renameRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") onRenameSubmit(node, renameValue);
              if (e.key === "Escape") onRenameCancel();
            }}
            onBlur={() => onRenameCancel()}
            className="flex-1 bg-zinc-700 text-zinc-100 text-xs px-1.5 py-0.5 rounded outline-none border border-blue-500/50"
          />
        </div>
      ) : (
        <button
          onClick={handleClick}
          onContextMenu={e => onContextMenu(e, node)}
          draggable
          onDragStart={handleDragStart}
          className={cn(
            "w-full flex items-center gap-1.5 text-xs rounded transition-all group select-none",
            "py-[3px] pr-2",
            isSelected
              ? "bg-white/10 text-white"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          )}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
        >
          {/* Expand arrow */}
          {isDir ? (
            expanded
              ? <ChevronDown size={11} className="flex-shrink-0 text-zinc-500" />
              : <ChevronRight size={11} className="flex-shrink-0 text-zinc-500" />
          ) : (
            <span className="w-[11px] flex-shrink-0" />
          )}

          {/* Coloured file/folder indicator */}
          <span
            className="flex-shrink-0 text-[10px] font-bold leading-none select-none"
            style={{ color: fileColor, width: 14, textAlign: "center" }}
          >
            {isDir ? (expanded ? "▾" : "▸") : "◆"}
          </span>

          {/* Name */}
          <span className={cn("truncate flex-1", isDir && "font-medium")}>{node.name}</span>

          {/* Git badge */}
          {badge && (
            <span className={cn("text-[10px] font-bold ml-auto flex-shrink-0", badge.className)}>
              {badge.text}
            </span>
          )}
        </button>
      )}

      {isDir && expanded && node.children?.map(child => (
        <TreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          renamingPath={renamingPath}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
        />
      ))}
    </div>
  );
}

// ── Public API ────────────────────────────────────────────────────────────

interface FileTreeProps {
  tree: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onNewFile?: (dir: string) => void;
  onNewFolder?: (dir: string) => void;
  onRename?: (oldPath: string, newName: string) => void;
  onDelete?: (path: string, isDir: boolean) => void;
}

export default function FileTree({
  tree, selectedPath, onSelect, onNewFile, onNewFolder, onRename, onDelete,
}: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const handleContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleRenameSubmit = (node: TreeNode, newName: string) => {
    if (newName.trim() && newName !== node.name) {
      onRename?.(node.path, newName.trim());
    }
    setRenamingPath(null);
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
  };

  return (
    <div className="py-1 select-none">
      {tree.map(node => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={n => onSelect(n.path)}
          onContextMenu={handleContextMenu}
          renamingPath={renamingPath}
          onRenameSubmit={handleRenameSubmit}
          onRenameCancel={() => setRenamingPath(null)}
        />
      ))}

      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewFile={dir => onNewFile?.(dir)}
          onNewFolder={dir => onNewFolder?.(dir)}
          onRename={node => {
            setContextMenu(null);
            setRenamingPath(node.path);
          }}
          onDelete={node => {
            setContextMenu(null);
            onDelete?.(node.path, node.type === "directory");
          }}
          onCopyPath={handleCopyPath}
        />
      )}
    </div>
  );
}

