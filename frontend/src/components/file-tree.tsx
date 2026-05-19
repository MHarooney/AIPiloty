"use client";

import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileCode, FileText, File } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TreeNode {
  name: string;
  type: "file" | "directory";
  path: string;
  children?: TreeNode[];
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp"].includes(ext)) return FileCode;
  if (["md", "txt", "json", "yaml", "yml", "toml", "csv"].includes(ext)) return FileText;
  return File;
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function TreeItem({ node, depth, selectedPath, onSelect }: TreeItemProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = node.type === "directory";
  const isSelected = node.path === selectedPath;

  const toggle = useCallback(() => {
    if (isDir) setExpanded((p) => !p);
    else onSelect(node.path);
  }, [isDir, node.path, onSelect]);

  const Icon = isDir
    ? expanded ? FolderOpen : Folder
    : getFileIcon(node.name);

  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.setData("application/x-aipiloty-node-type", node.type);
    e.dataTransfer.setData("application/x-aipiloty-node-name", node.name);
  };

  return (
    <div>
      <button
        onClick={toggle}
        draggable
        onDragStart={handleDragStart}
        className={cn(
          "w-full flex items-center gap-1.5 py-1 px-2 text-xs rounded-md transition-colors",
          isSelected
            ? "bg-indigo-900/30 text-indigo-300"
            : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {isDir ? (
          expanded ? <ChevronDown size={12} className="flex-shrink-0" /> : <ChevronRight size={12} className="flex-shrink-0" />
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <Icon size={14} className={cn("flex-shrink-0", isDir ? "text-amber-400/70" : "text-gray-500")} />
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && expanded && node.children?.map((child) => (
        <TreeItem key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface FileTreeProps {
  tree: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export default function FileTree({ tree, selectedPath, onSelect }: FileTreeProps) {
  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}
