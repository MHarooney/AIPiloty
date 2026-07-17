"use client";

/**
 * IDETerminal — Integrated terminal panel for the Code Editor.
 *
 * Sends commands to the AIPiloty backend `run_terminal_command` tool via
 * the workspace terminal API and streams output.  Looks and feels like the
 * VS Code / Cursor bottom terminal panel.
 *
 * Features:
 *  • Command history (↑/↓)
 *  • Coloured ANSI-stripped output
 *  • Working directory tracking
 *  • Clear button
 *  • Resizable height (drag handle)
 */

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Terminal, X, ChevronDown, ChevronUp, Trash2, Copy, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { headers as apiHeaders } from "@/lib/api-headers";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api/v1";

// Strip ANSI escape codes for display
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\x1B\][^\x07]*\x07/g, "");
}

// Colour-code output lines
function lineClass(line: string): string {
  const l = line.toLowerCase();
  if (l.includes("error") || l.includes("failed") || l.includes("fatal")) return "text-red-400";
  if (l.includes("warn")) return "text-amber-400";
  if (l.startsWith("$") || l.startsWith(">")) return "text-zinc-400";
  if (l.includes("success") || l.includes("✓") || l.includes("done")) return "text-green-400";
  return "text-zinc-300";
}

interface TerminalLine {
  id: number;
  type: "command" | "output" | "error" | "info";
  text: string;
  exit_code?: number;
}

interface IDETerminalProps {
  workspacePath?: string;
  onClose?: () => void;
}

let _lineId = 0;
const mkLine = (type: TerminalLine["type"], text: string, exit_code?: number): TerminalLine =>
  ({ id: ++_lineId, type, text, exit_code });

export default function IDETerminal({ workspacePath, onClose }: IDETerminalProps) {
  const [lines, setLines] = useState<TerminalLine[]>([
    mkLine("info", `AIPiloty Terminal — ${workspacePath || "workspace"}`),
    mkLine("info", "Type a command and press Enter"),
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [height, setHeight] = useState(220);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef({ active: false, startY: 0, startH: 0 });

  // Auto-scroll to bottom
  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  // Drag-to-resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const delta = dragRef.current.startY - e.clientY;
      setHeight(Math.max(120, Math.min(600, dragRef.current.startH + delta)));
    };
    const onUp = () => { dragRef.current.active = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const addLine = (type: TerminalLine["type"], text: string, exit_code?: number) =>
    setLines(prev => [...prev, mkLine(type, text, exit_code)]);

  const runCommand = async () => {
    const cmd = input.trim();
    if (!cmd || running) return;

    addLine("command", `$ ${cmd}`);
    setInput("");
    setHistoryIdx(-1);
    setHistory(prev => [cmd, ...prev.slice(0, 49)]);
    setRunning(true);

    try {
      const res = await fetch(`${API_BASE}/workspace/terminal`, {
        method: "POST",
        headers: { ...apiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, working_dir: workspacePath || "." }),
      });

      if (!res.ok) {
        addLine("error", `Error: ${res.status} ${res.statusText}`);
        return;
      }

      const data = await res.json();
      const stdout = stripAnsi(data.stdout || "");
      const stderr = stripAnsi(data.stderr || "");
      const exit_code = data.exit_code ?? 0;

      if (stdout) {
        stdout.split("\n").filter(Boolean).forEach(l => addLine("output", l));
      }
      if (stderr) {
        stderr.split("\n").filter(Boolean).forEach(l => addLine("error", l));
      }
      if (!stdout && !stderr) {
        addLine("info", exit_code === 0 ? "✓ Done" : `✗ Exited with code ${exit_code}`);
      }
      if (exit_code !== 0 && !stderr) {
        addLine("error", `Process exited with code ${exit_code}`);
      }
    } catch (err: any) {
      addLine("error", `Network error: ${err.message}`);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      runCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      setInput(history[nextIdx] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(nextIdx);
      setInput(nextIdx === -1 ? "" : history[nextIdx] ?? "");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([mkLine("info", `Cleared — ${workspacePath || "workspace"}`)]);
    }
  };

  const copyAll = () => {
    const text = lines.map(l => l.text).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="flex flex-col border-t border-zinc-800 bg-zinc-950 select-none"
      style={{ height }}
    >
      {/* Drag handle */}
      <div
        className="h-1 cursor-row-resize bg-zinc-800 hover:bg-blue-600 transition-colors flex-shrink-0"
        onMouseDown={(e) => {
          dragRef.current = { active: true, startY: e.clientY, startH: height };
        }}
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/80 flex-shrink-0">
        <Terminal size={13} className="text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400">Terminal</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={copyAll}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Copy all output"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
          <button
            onClick={() => setLines([mkLine("info", "Cleared")])}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Clear terminal (Ctrl+L)"
          >
            <Trash2 size={12} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Close terminal"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        onClick={() => inputRef.current?.focus()}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed cursor-text"
        style={{ minHeight: 0 }}
      >
        {lines.map((line) => (
          <div
            key={line.id}
            className={cn(
              "whitespace-pre-wrap break-all",
              line.type === "command" ? "text-blue-400 font-semibold" :
              line.type === "error" ? "text-red-400" :
              line.type === "info" ? "text-zinc-500 italic text-[11px]" :
              lineClass(line.text),
            )}
          >
            {line.text}
          </div>
        ))}
        {running && (
          <div className="flex items-center gap-1.5 text-zinc-500 text-[11px]">
            <Loader2 size={10} className="animate-spin" />
            running…
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-zinc-800 bg-zinc-900/50 flex-shrink-0">
        <span className="text-blue-400 font-mono text-[12px] select-none">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder={running ? "running…" : "enter command…"}
          className="flex-1 bg-transparent font-mono text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 disabled:opacity-50"
          autoFocus
        />
        {running && <Loader2 size={12} className="text-zinc-500 animate-spin flex-shrink-0" />}
      </div>
    </div>
  );
}
