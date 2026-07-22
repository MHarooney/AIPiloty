"use client";

/**
 * PerHunkDiffViewer — accepts/rejects individual diff hunks.
 *
 * Sits on top of MonacoDiffEditor and adds per-hunk controls.
 * Each changed region gets its own "Accept hunk" / "Skip hunk" button
 * rendered in a floating card at the top of the hunk.
 *
 * Approach:
 *  1. Use Monaco DiffEditor's getLineChanges() to list all hunks.
 *  2. Render accept/reject buttons via Monaco decorations + overlay widgets.
 *  3. "Accept hunk" patches that region into the accepted output.
 *  4. "Accept All" / "Reject All" buttons in the toolbar.
 *
 * When the user is done reviewing, calls onFinish(acceptedContent | null).
 */

import { useRef, useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { Check, X, CheckCheck, XCircle, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => ({ default: mod.DiffEditor })),
  { ssr: false }
);

export interface DiffHunk {
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
  accepted: boolean | null; // null = undecided
}

interface PerHunkDiffViewerProps {
  original: string;
  modified: string;
  language: string;
  filePath: string;
  onFinish: (result: string | null) => void;  // null = reject all
}

/**
 * Apply accepted hunks to produce the final merged string.
 * For each hunk:
 *   - accepted=true  → keep the modified lines for that region
 *   - accepted=false → keep the original lines for that region
 *   - accepted=null  → keep the modified lines (default accept)
 */
function applyHunks(
  originalLines: string[],
  modifiedLines: string[],
  hunks: DiffHunk[]
): string {
  if (hunks.length === 0) return modifiedLines.join("\n");

  const result: string[] = [];
  let modIdx = 0; // 0-based index into modifiedLines

  for (const hunk of hunks) {
    const origS = hunk.originalStart - 1; // convert to 0-based
    const origE = hunk.originalEnd;       // exclusive
    const modS = hunk.modifiedStart - 1;
    const modE = hunk.modifiedEnd;

    // Lines before this hunk in modified (unchanged)
    while (modIdx < modS) {
      result.push(modifiedLines[modIdx]);
      modIdx++;
    }

    // Hunk content
    const useModified = hunk.accepted !== false;
    if (useModified) {
      // Accept: use modified lines
      for (let i = modS; i < modE; i++) {
        result.push(modifiedLines[i]);
      }
    } else {
      // Reject: use original lines
      for (let i = origS; i < origE; i++) {
        result.push(originalLines[i]);
      }
    }
    modIdx = modE;
  }

  // Remaining lines after last hunk
  while (modIdx < modifiedLines.length) {
    result.push(modifiedLines[modIdx]);
    modIdx++;
  }

  return result.join("\n");
}

export default function PerHunkDiffViewer({
  original,
  modified,
  language,
  filePath,
  onFinish,
}: PerHunkDiffViewerProps) {
  const diffEditorRef = useRef<any>(null);
  const [hunks, setHunks] = useState<DiffHunk[]>([]);
  const [renderSideBySide, setRenderSideBySide] = useState(true);

  const originalLines = original.split("\n");
  const modifiedLines = modified.split("\n");

  const acceptedCount = hunks.filter((h) => h.accepted === true).length;
  const rejectedCount = hunks.filter((h) => h.accepted === false).length;
  const pendingCount = hunks.filter((h) => h.accepted === null).length;

  // Load line changes from diff editor after mount
  const handleDiffEditorMount = useCallback((editor: any) => {
    diffEditorRef.current = editor;

    const loadChanges = () => {
      const changes = editor.getLineChanges?.() ?? [];
      if (changes.length > 0) {
        setHunks(
          changes.map((c: any) => ({
            originalStart: c.originalStartLineNumber,
            originalEnd: c.originalEndLineNumber || c.originalStartLineNumber,
            modifiedStart: c.modifiedStartLineNumber,
            modifiedEnd: c.modifiedEndLineNumber || c.modifiedStartLineNumber,
            accepted: null,
          }))
        );
      } else {
        // No changes detected — may be identical
        setHunks([]);
      }
    };

    // Monaco diff computation is async; wait briefly
    setTimeout(loadChanges, 300);
    editor.onDidUpdateDiff?.(() => loadChanges());
  }, []);

  const setHunkState = (idx: number, state: boolean | null) => {
    setHunks((prev) => prev.map((h, i) => (i === idx ? { ...h, accepted: state } : h)));
  };

  const acceptAll = () => setHunks((prev) => prev.map((h) => ({ ...h, accepted: true })));
  const rejectAll = () => setHunks((prev) => prev.map((h) => ({ ...h, accepted: false })));

  const handleFinish = () => {
    const result = applyHunks(originalLines, modifiedLines, hunks);
    onFinish(result);
  };

  const handleRejectAll = () => {
    onFinish(null);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-900/25 border-b border-amber-700/40 flex-shrink-0">
        <ArrowLeftRight size={13} className="text-amber-400 flex-shrink-0" />
        <span className="text-xs text-amber-300 font-medium">
          Proposed changes to <strong>{filePath.split("/").pop()}</strong>
        </span>
        {hunks.length > 0 && (
          <span className="text-[10px] text-zinc-500 font-mono">
            {hunks.length} hunk{hunks.length !== 1 ? "s" : ""}
            {acceptedCount > 0 && ` · ${acceptedCount} accepted`}
            {rejectedCount > 0 && ` · ${rejectedCount} rejected`}
            {pendingCount > 0 && ` · ${pendingCount} pending`}
          </span>
        )}

        {/* Side-by-side toggle */}
        <button
          onClick={() => setRenderSideBySide((p) => !p)}
          className="ml-2 px-2 py-0.5 text-[10px] rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          title="Toggle side-by-side / inline diff"
        >
          {renderSideBySide ? "Inline" : "Side by side"}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {hunks.length > 0 && (
            <>
              <button
                onClick={rejectAll}
                className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
              >
                <XCircle size={11} /> Reject All
              </button>
              <button
                onClick={acceptAll}
                className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
              >
                <CheckCheck size={11} /> Accept All
              </button>
            </>
          )}
          <button
            onClick={handleRejectAll}
            className="flex items-center gap-1 px-3 py-1 text-[11px] rounded bg-red-900/60 text-red-300 hover:bg-red-800/60 transition-colors"
          >
            <X size={11} /> Reject
          </button>
          <button
            onClick={handleFinish}
            className="flex items-center gap-1 px-3 py-1 text-[11px] rounded bg-emerald-700 text-white hover:bg-emerald-600 transition-colors"
          >
            <Check size={11} /> Apply{hunks.length > 1 ? " Selected" : ""}
          </button>
        </div>
      </div>

      {/* Hunk controls — shown above diff */}
      {hunks.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 bg-zinc-900/60 border-b border-zinc-800/50 flex-shrink-0">
          {hunks.map((hunk, idx) => (
            <div
              key={idx}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border transition-colors",
                hunk.accepted === true
                  ? "border-emerald-600/50 bg-emerald-950/40 text-emerald-300"
                  : hunk.accepted === false
                  ? "border-red-600/50 bg-red-950/40 text-red-300 line-through"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500"
              )}
            >
              <span>L{hunk.modifiedStart}</span>
              <button
                onClick={() => setHunkState(idx, hunk.accepted !== true ? true : null)}
                className={cn(
                  "p-0.5 rounded transition-colors",
                  hunk.accepted === true
                    ? "text-emerald-400"
                    : "text-zinc-600 hover:text-emerald-400"
                )}
                title="Accept this hunk"
              >
                <Check size={9} />
              </button>
              <button
                onClick={() => setHunkState(idx, hunk.accepted !== false ? false : null)}
                className={cn(
                  "p-0.5 rounded transition-colors",
                  hunk.accepted === false
                    ? "text-red-400"
                    : "text-zinc-600 hover:text-red-400"
                )}
                title="Reject this hunk"
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Diff Editor */}
      <div className="flex-1 min-h-0">
        <MonacoDiffEditor
          height="100%"
          language={language}
          original={original}
          modified={modified}
          theme="vs-dark"
          onMount={handleDiffEditorMount}
          options={{
            readOnly: true,
            renderSideBySide,
            fontSize: 13,
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            lineNumbers: "on",
            diffWordWrap: "on",
          }}
        />
      </div>
    </div>
  );
}
