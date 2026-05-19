"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import React from "react";
import {
  Send, Square, Bot, Wrench, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Zap, Link, Trash2,
} from "lucide-react";
import { useTestingStore, TestingMessage, ToolCall, ToolResult } from "@/stores/testing-store";
import { cn } from "@/lib/utils";

// ── Streaming cursor ──────────────────────────────────────────────────────────
function StreamingCursor() {
  return (
    <span className="inline-block w-[2px] h-[1em] bg-emerald-400 ml-0.5 align-text-bottom animate-[blink_1s_step-start_infinite]" />
  );
}

// ── Tool call accordion ───────────────────────────────────────────────────────
function ToolCallCard({ tc, result }: { tc: ToolCall; result?: ToolResult }) {
  const [open, setOpen] = useState(false);
  const hasArgs = Object.keys(tc.arguments).length > 0;

  return (
    <div
      className={cn(
        "rounded-xl border text-xs font-mono overflow-hidden transition-all duration-200",
        result
          ? result.success
            ? "bg-emerald-950/40 border-emerald-800/30"
            : "bg-red-950/40 border-red-800/30"
          : "bg-amber-950/30 border-amber-800/30 animate-pulse"
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <Wrench
          className={cn(
            "w-3 h-3 shrink-0",
            result
              ? result.success ? "text-emerald-400" : "text-red-400"
              : "text-amber-400 animate-spin"
          )}
        />
        <span className={cn("font-semibold", result?.success === false ? "text-red-300" : "text-amber-300")}>
          {tc.tool}
        </span>
        {result && (
          <span className={cn("ml-auto", result.success ? "text-emerald-500" : "text-red-500")}>
            {result.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          </span>
        )}
        {(hasArgs || result) && (
          <span className="text-gray-600 ml-auto">
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-white/5 px-3 py-2 space-y-2">
          {hasArgs && (
            <div>
              <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">Arguments</p>
              <pre className="text-gray-400 text-[11px] whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(tc.arguments, null, 2)}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">Result</p>
              <pre
                className={cn(
                  "text-[11px] whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto",
                  result.success ? "text-emerald-300/90" : "text-red-300/90"
                )}
              >
                {result.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Auto-detected URL banner ──────────────────────────────────────────────────
function UrlDetectedBanner({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-emerald-400/80 bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-1.5 animate-fade-in">
      <Link className="w-3 h-3 shrink-0" />
      <span>Auto-detected target: <span className="font-mono text-emerald-300">{url}</span></span>
    </div>
  );
}

// ── Markdown-lite renderer for assistant messages ─────────────────────────────

function renderContent(text: string) {
  if (!text) return null;

  const renderInline = (str: string, key: string) => {
    const nodes: React.ReactNode[] = [];
    let rem = str;
    let k = 0;
    while (rem.length > 0) {
      const codeM = rem.match(/^([\s\S]*?)`([^`\n]+)`([\s\S]*)$/);
      const boldM = rem.match(/^([\s\S]*?)\*\*([\s\S]+?)\*\*([\s\S]*)$/);
      if (codeM && (!boldM || codeM[1].length <= boldM[1].length)) {
        if (codeM[1]) nodes.push(<span key={`${key}-t${k++}`}>{codeM[1]}</span>);
        nodes.push(
          <code key={`${key}-c${k++}`} className="bg-gray-700/70 text-emerald-300 px-1 py-0.5 rounded text-[11px] font-mono">
            {codeM[2]}
          </code>
        );
        rem = codeM[3];
      } else if (boldM) {
        if (boldM[1]) nodes.push(<span key={`${key}-t${k++}`}>{boldM[1]}</span>);
        nodes.push(<strong key={`${key}-b${k++}`} className="font-semibold text-white">{boldM[2]}</strong>);
        rem = boldM[3];
      } else {
        nodes.push(<span key={`${key}-t${k++}`}>{rem}</span>);
        break;
      }
    }
    return nodes;
  };

  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      if (inCode) {
        nodes.push(
          <pre key={`cb-${i}`} className="my-2 bg-gray-900/90 border border-gray-700/40 rounded-lg p-3 overflow-x-auto">
            <code className="text-[11px] font-mono text-emerald-300 leading-relaxed">
              {codeLines.join("\n")}
            </code>
          </pre>
        );
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      return;
    }
    if (inCode) { codeLines.push(line); return; }

    if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
      const lvl = line.match(/^(#+)\s/)![1].length;
      const txt = line.replace(/^#+\s/, "");
      nodes.push(
        <p key={i} className={cn(
          "font-bold mt-2 mb-0.5",
          lvl === 1 ? "text-sm text-white border-b border-gray-700/40 pb-1" : "text-xs text-gray-200"
        )}>
          {txt}
        </p>
      );
    } else if (/^[-*]\s/.test(line)) {
      nodes.push(
        <div key={i} className="flex items-start gap-2 my-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 mt-[6px] shrink-0" />
          <span className="text-sm leading-relaxed">{renderInline(line.slice(2), `li-${i}`)}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\.\s/)![1];
      nodes.push(
        <div key={i} className="flex items-start gap-2 my-0.5">
          <span className="text-[10px] font-mono text-emerald-500/80 mt-0.5 w-4 shrink-0 text-right">{num}.</span>
          <span className="text-sm leading-relaxed">{renderInline(line.replace(/^\d+\.\s/, ""), `ol-${i}`)}</span>
        </div>
      );
    } else if (line === "") {
      nodes.push(<div key={i} className="h-2" />);
    } else {
      nodes.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line, `p-${i}`)}</p>);
    }
  });

  return <div className="space-y-0.5">{nodes}</div>;
}

// ── Single message bubble ─────────────────────────────────────────────────────
function MessageBubble({ msg, prevUrl }: { msg: TestingMessage; prevUrl?: string }) {
  const isUser = msg.role === "user";

  // Build tool result map for quick lookup
  const resultMap = new Map<number, ToolResult>();
  (msg.toolResults ?? []).forEach((r, i) => resultMap.set(i, r));

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 animate-[fadeSlideIn_0.2s_ease-out]",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ring-2",
          isUser
            ? "bg-indigo-600 text-white ring-indigo-900"
            : msg.isError
            ? "bg-red-800 ring-red-900"
            : msg.isStreaming
            ? "bg-gradient-to-br from-emerald-500 to-teal-600 ring-emerald-900 animate-pulse"
            : "bg-gradient-to-br from-emerald-600 to-teal-700 ring-emerald-900/50"
        )}
      >
        {isUser ? "U" : <Bot className="w-4 h-4 text-white" />}
      </div>

      <div className={cn("flex flex-col gap-2 max-w-[88%]", isUser && "items-end")}>
        {/* URL auto-detect banner (appears below user message that triggered it) */}
        {isUser && prevUrl && <UrlDetectedBanner url={prevUrl} />}

        {/* Text content */}
        {(msg.content || msg.isStreaming) && (
          <div
            className={cn(
              "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
              isUser
                ? "bg-indigo-600/90 text-white rounded-tr-sm whitespace-pre-wrap"
                : msg.isError
                ? "bg-red-950/60 text-red-200 border border-red-800/30 rounded-tl-sm"
                : "bg-gray-800/70 text-gray-100 border border-gray-700/30 rounded-tl-sm"
            )}
          >
            {isUser ? (
              msg.content
            ) : (
              <>
                {renderContent(msg.content)}
                {msg.isStreaming && <StreamingCursor />}
              </>
            )}
          </div>
        )}

        {/* Tool calls + results */}
        {(msg.toolCalls ?? []).length > 0 && (
          <div className="flex flex-col gap-1.5 w-full">
            {(msg.toolCalls ?? []).map((tc, i) => (
              <ToolCallCard key={i} tc={tc} result={resultMap.get(i)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Thinking indicator ────────────────────────────────────────────────────────
function ThinkingIndicator({ tool, steps }: { tool: string | null; steps: string[] }) {
  return (
    <div className="flex gap-3 px-4 py-2 animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center ring-2 ring-emerald-900 animate-pulse">
        <Bot className="w-4 h-4 text-white" />
      </div>
      <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700/30 rounded-2xl rounded-tl-sm px-4 py-2.5">
        {tool ? (
          <span className="text-xs text-amber-400 font-mono flex items-center gap-2">
            <Wrench className="w-3 h-3 animate-spin" />
            Running <span className="font-semibold">{tool}</span>…
          </span>
        ) : (
          <span className="flex items-center gap-2 text-xs text-emerald-400/80">
            <span className="flex gap-0.5">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </span>
            {steps.length > 0 ? steps[steps.length - 1] : "Thinking…"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Suggestion chips ──────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: Zap, text: "Probe the API — check if it's reachable and latency" },
  { icon: CheckCircle2, text: "Run a full health check on all endpoints" },
  { icon: Wrench, text: "Test the authentication flow and token handling" },
  { icon: Link, text: "Validate CORS headers and redirect behaviour" },
];

// ── Main panel ────────────────────────────────────────────────────────────────
export default function TestingChatPanel() {
  const messages       = useTestingStore((s) => s.messages);
  const isStreaming    = useTestingStore((s) => s.isStreaming);
  const systemState    = useTestingStore((s) => s.systemState);
  const currentTool    = useTestingStore((s) => s.currentToolCall);
  const planningSteps  = useTestingStore((s) => s.planningSteps);
  const sendMessage    = useTestingStore((s) => s.sendMessage);
  const clearMessages  = useTestingStore((s) => s.clearMessages);
  const cancelStream   = useTestingStore((s) => s.cancelStream);
  const targetUrl      = useTestingStore((s) => s.targetUrl);

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isStreaming]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    sendMessage(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full bg-gray-950/30">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto scroll-smooth">
        {isEmpty ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center h-full px-6 py-8 text-center gap-5">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-900/40">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-gray-950 flex items-center justify-center">
                <Zap className="w-2.5 h-2.5 text-white" />
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-200 text-base">AI Testing Agent</p>
              <p className="text-xs text-gray-500 mt-1.5 max-w-xs leading-relaxed">
                {targetUrl
                  ? <>Ready to test <span className="text-emerald-400 font-mono">{targetUrl}</span></>
                  : "Type a URL or paste it in the bar above. I'll test any API, login flow, or endpoint you describe."}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-1.5 w-full max-w-sm">
              {SUGGESTIONS.map(({ icon: Icon, text }) => (
                <button
                  key={text}
                  onClick={() => !isStreaming && sendMessage(text)}
                  className="flex items-center gap-2.5 text-xs text-left px-3.5 py-2.5 rounded-xl bg-gray-900/60 border border-gray-800/50 text-gray-400 hover:text-gray-200 hover:border-emerald-800/50 hover:bg-gray-900 transition-all group"
                >
                  <Icon className="w-3.5 h-3.5 text-gray-600 group-hover:text-emerald-500 transition-colors shrink-0" />
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Clear button */}
            {!isStreaming && messages.length > 0 && (
              <div className="flex justify-end px-4 pt-2">
                <button
                  onClick={clearMessages}
                  className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              </div>
            )}

            {messages.map((msg, i) => {
              // Check if the next user message triggered URL detection
              const prevUserMsg = messages[i - 1];
              const autoDetectedUrl =
                msg.role === "user" &&
                !prevUserMsg &&
                targetUrl &&
                msg.content.includes(targetUrl)
                  ? targetUrl
                  : undefined;
              return <MessageBubble key={i} msg={msg} prevUrl={autoDetectedUrl} />;
            })}

            {/* Thinking indicator — only show if last message is a streaming assistant bubble with no content yet */}
            {isStreaming && (systemState === "thinking" || systemState === "tool_running") && (
              (() => {
                const last = messages[messages.length - 1];
                if (last?.role === "assistant" && !last.content && !(last.toolCalls?.length)) {
                  return <ThinkingIndicator tool={currentTool} steps={planningSteps} />;
                }
                return null;
              })()
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-800/50 p-3 bg-gray-950/50">
        <div
          className={cn(
            "flex gap-2 items-end rounded-2xl border px-3.5 py-2.5 transition-all duration-200",
            isStreaming
              ? "bg-gray-900/40 border-gray-700/40"
              : "bg-gray-900/70 border-gray-700/50 focus-within:border-emerald-600/60 focus-within:bg-gray-900"
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "Agent is running…"
                : "Describe what to test, or paste a URL…  (Shift+Enter for newline)"
            }
            disabled={isStreaming}
            rows={1}
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 focus:outline-none resize-none leading-relaxed overflow-y-auto"
            style={{ maxHeight: "128px" }}
          />
          {isStreaming ? (
            <button
              onClick={cancelStream}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-red-600/80 hover:bg-red-500 text-white transition-colors"
              title="Cancel"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors"
              title="Send (Enter)"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-gray-700 mt-1.5 text-center">
          Auth credentials are kept in memory only and never stored.
        </p>
      </div>
    </div>
  );
}
