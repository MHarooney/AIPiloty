"use client";

import { useState, useEffect, useCallback } from "react";
import { gitStatus, gitDiff, gitLog, gitCommit } from "@/lib/api";
import {
  GitBranch, RefreshCw, Loader2, FileText, Plus, Minus,
  Circle, CheckCircle, AlertTriangle, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface GitFile {
  status: string;
  path: string;
}

interface LogEntry {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  message: string;
}

const STATUS_COLORS: Record<string, string> = {
  M: "text-amber-400",
  A: "text-emerald-400",
  D: "text-red-400",
  "??": "text-gray-400",
  R: "text-blue-400",
  U: "text-purple-400",
};

const STATUS_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  "??": "Untracked",
  R: "Renamed",
  U: "Unmerged",
};

export default function GitPanel({ onDiffView }: { onDiffView?: (diff: string, file?: string) => void }) {
  const [branch, setBranch] = useState("...");
  const [files, setFiles] = useState<GitFile[]>([]);
  const [clean, setClean] = useState(true);
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [status, logData] = await Promise.all([
        gitStatus(),
        gitLog(10),
      ]);
      setBranch(status.branch);
      setFiles(status.files);
      setClean(status.clean);
      setLog(logData);
    } catch {
      toast.error("Git not available for this workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleDiff = async (file: string) => {
    if (expandedDiff === file) {
      setExpandedDiff(null);
      return;
    }
    try {
      const data = await gitDiff(file);
      setDiffContent(data.diff);
      setExpandedDiff(file);
    } catch {
      toast.error("Failed to get diff");
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      toast.error("Commit message is required");
      return;
    }
    setCommitting(true);
    try {
      const filesToCommit = selectedFiles.size > 0 ? Array.from(selectedFiles) : undefined;
      const result = await gitCommit(commitMsg.trim(), filesToCommit);
      toast.success(`Committed ${result.hash}`);
      setCommitMsg("");
      setSelectedFiles(new Set());
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-200 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-blue-400" />
          <span className="font-medium">{branch}</span>
          {clean && <CheckCircle size={12} className="text-emerald-400" />}
        </div>
        <button onClick={refresh} className="p-1 rounded hover:bg-gray-800 transition-colors" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Changes */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-gray-500" />
          </div>
        ) : clean ? (
          <div className="text-center py-8 text-gray-500 text-xs">
            <CheckCircle size={24} className="mx-auto mb-2 text-emerald-500/50" />
            Working tree clean
          </div>
        ) : (
          <>
            <div className="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wider">
              Changes ({files.length})
            </div>
            {files.map((f) => (
              <div key={f.path}>
                <div
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800/50 cursor-pointer group"
                  onClick={() => handleDiff(f.path)}
                >
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(f.path)}
                    onChange={(e) => { e.stopPropagation(); toggleFile(f.path); }}
                    className="rounded border-gray-600 bg-gray-800"
                  />
                  <span className={cn("text-xs font-mono w-5 text-center", STATUS_COLORS[f.status] || "text-gray-400")}>
                    {f.status}
                  </span>
                  <span className="flex-1 truncate text-xs font-mono">{f.path}</span>
                  {expandedDiff === f.path ? <ChevronDown size={12} /> : <ChevronRight size={12} className="opacity-0 group-hover:opacity-100" />}
                </div>
                {expandedDiff === f.path && (
                  <pre className="mx-3 mb-2 p-2 bg-gray-900 border border-gray-800 rounded text-[10px] font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre">
                    {diffContent || "(no diff)"}
                  </pre>
                )}
              </div>
            ))}

            {/* Commit box */}
            <div className="border-t border-gray-800 p-3 space-y-2">
              <textarea
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder="Commit message..."
                rows={2}
                className="w-full bg-gray-800/80 border border-gray-700/50 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
              <button
                onClick={handleCommit}
                disabled={committing || !commitMsg.trim()}
                className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {committing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                Commit {selectedFiles.size > 0 ? `(${selectedFiles.size} files)` : "(all)"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Recent commits */}
      <div className="border-t border-gray-800">
        <button
          onClick={() => setShowLog(!showLog)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:bg-gray-800/50"
        >
          {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Recent Commits
        </button>
        {showLog && (
          <div className="max-h-40 overflow-y-auto">
            {log.map((entry) => (
              <div key={entry.hash} className="px-3 py-1.5 text-xs border-t border-gray-800/50 hover:bg-gray-800/30">
                <div className="flex items-center gap-2">
                  <span className="text-blue-400 font-mono">{entry.short_hash}</span>
                  <span className="flex-1 truncate">{entry.message}</span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {entry.author} · {new Date(entry.date).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
