"use client";

/**
 * InlineEditWidget — Cursor-style Cmd-K inline edit panel.
 *
 * Triggered by Cmd+K when code is selected in the Monaco editor.
 * Shows a compact input at the bottom of the editor area.
 * Streams the AI edit, then sets diffProposal for review.
 *
 * Props:
 *   selectedText   — the currently selected code
 *   language       — Monaco language id (for code block formatting)
 *   filePath       — active file path (for diffProposal.filePath)
 *   originalFull   — full file content (original side of diff)
 *   onClose        — called when widget is dismissed
 *   onApply        — called with edited code when AI returns result
 */

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Sparkles, X, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { headers as apiHeaders } from "@/lib/api-headers";
import { useChatStore } from "@/stores/chat-store";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api/v1";

const MAX_PREVIEW_LINES = 6;

interface InlineEditWidgetProps {
  selectedText: string;
  language: string;
  filePath: string;
  originalFull: string;
  onClose: () => void;
  onApply: (editedCode: string) => void;
}

// Extract code block content from AI response
function extractCodeBlock(text: string, language: string): string | null {
  // Try ```lang ... ``` first
  const fenced = new RegExp(
    "```(?:" + language + "|[a-zA-Z0-9]+)?\\s*\\n([\\s\\S]*?)\\n```",
    "i"
  );
  const match = text.match(fenced);
  if (match) return match[1].trim();

  // Try bare ``` ... ```
  const bare = text.match(/```\s*\n([\s\S]*?)\n```/);
  if (bare) return bare[1].trim();

  // If the response contains just code (no fences), return it directly
  // but only if it looks like code (not prose)
  const trimmed = text.trim();
  if (!trimmed.includes("```") && !trimmed.match(/^(Here|I |The |To |This )/)) {
    return trimmed;
  }

  return null;
}

export default function InlineEditWidget({
  selectedText,
  language,
  filePath,
  originalFull,
  onClose,
  onApply,
}: InlineEditWidgetProps) {
  const [instruction, setInstruction] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionKey = useChatStore((s) => s.sessionKey);

  useEffect(() => {
    // Focus input on mount
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => abortRef.current?.abort();
  }, []);

  const previewLines = selectedText.split("\n");
  const previewShown = showPreview
    ? previewLines
    : previewLines.slice(0, MAX_PREVIEW_LINES);
  const hasMore = previewLines.length > MAX_PREVIEW_LINES;

  const handleSubmit = async () => {
    if (!instruction.trim() || streaming) return;
    setStreaming(true);
    setStreamText("");
    setError(null);

    const prompt =
      `Edit the following code. Apply ONLY this instruction: "${instruction.trim()}"\n\n` +
      `Return ONLY the edited code (no explanations). Preserve indentation and style.\n\n` +
      `File: ${filePath}\n` +
      "```" +
      language +
      "\n" +
      selectedText +
      "\n```";

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: { ...apiHeaders(), "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          session_key: sessionKey || undefined,
          auto_approve: true,
          mode: "ask",
        }),
      });

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const event = JSON.parse(raw);
            if (event.type === "token" && event.data?.token) {
              full += event.data.token;
              setStreamText(full);
            } else if (event.type === "done") {
              break;
            } else if (event.type === "error") {
              throw new Error(event.data?.message || "AI error");
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      if (!full.trim()) throw new Error("No response from AI");

      const edited = extractCodeBlock(full, language);
      if (!edited) {
        // Use raw response as code if no fences found
        onApply(full.trim());
      } else {
        // Apply: replace the selected text within the full file content
        const newFull = originalFull.replace(selectedText, edited);
        onApply(edited.includes(selectedText.split("\n")[0])
          ? edited   // return just the edited snippet
          : edited);
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Failed to get AI edit");
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="border-t border-blue-500/40 bg-zinc-950/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/60">
        <Sparkles size={12} className="text-blue-400 flex-shrink-0" />
        <span className="text-[11px] font-semibold text-blue-300">Inline Edit</span>
        <span className="text-[10px] text-zinc-500 font-mono truncate">
          {filePath.split("/").pop()} · {previewLines.length} line{previewLines.length !== 1 ? "s" : ""} selected
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setShowPreview((p) => !p)}
            className="p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
            title={showPreview ? "Collapse preview" : "Expand preview"}
          >
            {showPreview ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          <button
            onClick={() => { abortRef.current?.abort(); onClose(); }}
            className="p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Code preview */}
      {(showPreview || previewLines.length <= 3) && (
        <div className="px-3 py-1.5 max-h-32 overflow-y-auto">
          <pre className="text-[11px] text-zinc-500 font-mono whitespace-pre leading-relaxed">
            {previewShown.join("\n")}
            {hasMore && !showPreview && (
              <span className="text-zinc-600 italic"> …{previewLines.length - MAX_PREVIEW_LINES} more lines</span>
            )}
          </pre>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          placeholder="Describe the edit (e.g. add type annotations, extract function, fix bug…)"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
        />
        {streaming ? (
          <button
            onClick={() => abortRef.current?.abort()}
            className="px-2 py-1 text-[11px] rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 flex items-center gap-1"
          >
            <Loader2 size={10} className="animate-spin" />
            Cancel
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!instruction.trim()}
            className={cn(
              "px-3 py-1 text-[11px] rounded font-medium transition-colors",
              instruction.trim()
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            )}
          >
            Edit ↵
          </button>
        )}
      </div>

      {/* Streaming output */}
      {(streaming || streamText) && (
        <div className="px-3 pb-2">
          <div className="text-[10px] text-zinc-500 mb-1 font-mono">
            {streaming ? "Generating…" : "Done — diff ready for review"}
          </div>
          {streamText && (
            <pre className="text-[11px] text-emerald-400 font-mono whitespace-pre-wrap max-h-20 overflow-y-auto bg-zinc-900/50 rounded px-2 py-1">
              {streamText.slice(-800)}
            </pre>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 pb-2 text-[11px] text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
