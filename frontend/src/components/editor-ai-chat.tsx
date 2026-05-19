"use client";

/**
 * EditorAIChat — Cursor / VS Code Copilot-style inline AI chat panel for the Code Editor.
 *
 * Features:
 *  • Streams responses token-by-token via the existing /api/v1/chat/stream SSE endpoint
 *  • Injects current file or selected text as context with one click
 *  • Code blocks have "Copy" and "Insert at cursor" actions that write directly into Monaco
 *  • Quick-action chips for common coding tasks (explain, find bugs, refactor, add comments)
 *  • Isolated session key so history never pollutes the main chat page
 *  • Fully keyboard-accessible (Enter to send, Shift+Enter for newline, Escape to close)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  X,
  Send,
  Square,
  Copy,
  Check,
  FileCode,
  Sparkles,
  Trash2,
  Bug,
  MessageSquareCode,
  Wand2,
  BookOpen,
  TextCursorInput as CursorText,
  ChevronDown,
  FolderOpen,
  Paperclip,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { streamChat, getWorkspaceFile } from "@/lib/api";
import { stripModelControlTokens } from "@/lib/sanitize-model-output";

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface AIChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface DroppedFile {
  path: string;
  name: string;
  type: "file" | "directory";
  content?: string;   // loaded for files; undefined for dirs (use tree)
  language?: string;
  loading?: boolean;
}

interface EditorAIChatProps {
  /** Monaco editor instance ref (from onMount). */
  editorRef: React.MutableRefObject<any>;
  /** Currently active file (null when no file is open). */
  currentFile: { path: string; content: string; language: string } | null;
  /** Text the user has selected inside Monaco (empty string when nothing selected). */
  selectedText: string;
  /** Called when the user clicks the ✕ close button. */
  onClose: () => void;
  /** The currently active project (null = default workspace). */
  activeProject?: { id: string; name: string; path: string; color: string } | null;
  /** File tree of the active project for @workspace context. */
  projectTree?: any[];
}

/* ─── Quick-action chip definitions ─────────────────────────────────────── */

const QUICK_ACTIONS = [
  {
    label: "Explain",
    icon: BookOpen,
    prompt: (file: string | null) =>
      file ? `Explain what this file does: \`${file}\`` : "Explain what this code does.",
  },
  {
    label: "Find Bugs",
    icon: Bug,
    prompt: (file: string | null) =>
      file ? `Find bugs and issues in \`${file}\`; explain each one clearly.` : "Find bugs in this code.",
  },
  {
    label: "Refactor",
    icon: Wand2,
    prompt: (file: string | null) =>
      file
        ? `Refactor \`${file}\` for clarity, performance, and best practices. Show the improved code.`
        : "Refactor this code for clarity and best practices.",
  },
  {
    label: "Add Comments",
    icon: MessageSquareCode,
    prompt: (file: string | null) =>
      file ? `Add clear, concise docstrings and inline comments to \`${file}\`.` : "Add comments to this code.",
  },
] as const;

/* ─── Inline code block with "Copy" + "Insert at cursor" ────────────────── */

function EditorCodeBlock({
  language,
  children,
  onInsert,
}: {
  language: string;
  children: string;
  onInsert: (code: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-2 rounded-lg overflow-hidden border border-gray-700/60">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1e2535] border-b border-gray-700/50">
        <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
          {language || "code"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onInsert(children)}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-indigo-400 transition-colors"
            title="Insert at cursor position in editor"
          >
            <CursorText size={11} />
            Insert
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            {copied ? (
              <Check size={11} className="text-emerald-400" />
            ) : (
              <Copy size={11} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: "0.75rem",
          background: "#0d1117",
          padding: "12px 14px",
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export default function EditorAIChat({
  editorRef,
  currentFile,
  selectedText,
  onClose,
  activeProject = null,
  projectTree = [],
}: EditorAIChatProps) {
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionKey] = useState(() => `editor-ai-${Date.now()}`);
  const [contextAdded, setContextAdded] = useState<"none" | "file" | "selection" | "workspace">("none");
  const [droppedFiles, setDroppedFiles] = useState<DroppedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* Auto-scroll to bottom when messages change */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* Insert code directly into Monaco at the current cursor position */
  const insertAtCursor = useCallback(
    (code: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      const pos = editor.getPosition();
      if (!model || !pos) return;
      model.applyEdits([
        {
          range: {
            startLineNumber: pos.lineNumber,
            startColumn: pos.column,
            endLineNumber: pos.lineNumber,
            endColumn: pos.column,
          },
          text: "\n" + code + "\n",
        },
      ]);
      editor.focus();
    },
    [editorRef]
  );

  /* Flatten the project tree to a simple path list for @workspace context */
  const flattenTree = useCallback((nodes: any[], prefix = ""): string[] => {
    const paths: string[] = [];
    for (const node of nodes ?? []) {
      const p = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.type === "file") paths.push(p);
      if (node.children?.length) paths.push(...flattenTree(node.children, p));
    }
    return paths;
  }, []);

  /* Build a context prefix string for the user message */
  const buildContextPrefix = useCallback((): string => {
    let prefix = "";

    // Dropped files / folders first
    if (droppedFiles.length > 0) {
      for (const df of droppedFiles) {
        if (df.type === "file" && df.content !== undefined) {
          prefix += `File \`${df.path}\` (${df.language ?? "text"}):\n\`\`\`${df.language ?? "text"}\n${df.content.slice(0, 8000)}${df.content.length > 8000 ? "\n… (truncated)" : ""}\n\`\`\`\n\n`;
        } else if (df.type === "directory") {
          prefix += `Folder \`${df.path}\` has been attached for reference.\n\n`;
        }
      }
    }

    if (contextAdded === "workspace" && activeProject) {
      const paths = flattenTree(projectTree);
      const tree = paths.slice(0, 200).join("\n");
      prefix += `Project: ${activeProject.name} (${activeProject.path})\n\nFile structure:\n${tree}${paths.length > 200 ? `\n… and ${paths.length - 200} more files` : ""}\n\n`;
    }
    if (contextAdded === "file" && currentFile) {
      prefix += `Current file \`${currentFile.path}\` (${currentFile.language}):\n\`\`\`${currentFile.language}\n${currentFile.content.slice(0, 8000)}${currentFile.content.length > 8000 ? "\n… (truncated)" : ""}\n\`\`\`\n\n`;
    }
    if (contextAdded === "selection" && selectedText) {
      prefix += `Selected code:\n\`\`\`${currentFile?.language ?? "text"}\n${selectedText}\n\`\`\`\n\n`;
    }
    return prefix;
  }, [contextAdded, currentFile, selectedText, activeProject, projectTree, flattenTree, droppedFiles]);

  /* Send message */
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const prefix = buildContextPrefix();
    const fullMessage = prefix + text;

    const ctxLabel: Record<string, string> = { file: "file", selection: "selection", workspace: "workspace" };
    const userMsg: AIChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      // Show the user only the visible part (no duplicated file dump)
      content: droppedFiles.length > 0
        ? `*(with ${droppedFiles.map(d => d.name).join(", ")})*\n${text}`
        : contextAdded !== "none" ? `*(with ${ctxLabel[contextAdded]} context)*\n${text}` : text,
    };
    const assistantMsg: AIChatMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: "",
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setContextAdded("none");
    setDroppedFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    streamChat(
      fullMessage,
      sessionKey,
      (event) => {
        if (event.type === "token" && typeof event.data?.token === "string") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: m.content + event.data.token }
                : m
            )
          );
        }
        if (event.type === "done" || event.type === "error") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, streaming: false } : m
            )
          );
          setIsStreaming(false);
        }
      },
      abort.signal,
      true, // auto_approve — editor AI always runs in safe read-only mode
      null
    );
  }, [input, isStreaming, sessionKey, buildContextPrefix, contextAdded]);

  const handleStop = () => {
    abortRef.current?.abort();
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
    setIsStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") onClose();
  };

  /* ── Drag-and-drop handlers ── */
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes("text/plain") || e.dataTransfer.types.includes("application/x-aipiloty-node-type")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the panel entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const path = e.dataTransfer.getData("text/plain");
    const nodeType = e.dataTransfer.getData("application/x-aipiloty-node-type") as "file" | "directory" || "file";
    const name = e.dataTransfer.getData("application/x-aipiloty-node-name") || path.split("/").pop() || path;
    if (!path) return;

    // Avoid duplicates
    if (droppedFiles.find(d => d.path === path)) return;

    if (nodeType === "directory") {
      setDroppedFiles(prev => [...prev, { path, name, type: "directory" }]);
      return;
    }

    // File — load content
    const placeholder: DroppedFile = { path, name, type: "file", loading: true };
    setDroppedFiles(prev => [...prev, placeholder]);

    try {
      const data = await getWorkspaceFile(path, activeProject?.id);
      setDroppedFiles(prev =>
        prev.map(d => d.path === path
          ? { ...d, content: data.content, language: data.language, loading: false }
          : d
        )
      );
    } catch {
      setDroppedFiles(prev => prev.filter(d => d.path !== path));
    }
  };

  const handleQuickAction = (promptFn: (file: string | null) => string) => {
    const prompt = promptFn(currentFile?.path ?? null);
    setInput(prompt);
    // Auto-include file context for quick actions
    if (currentFile && contextAdded === "none") setContextAdded("file");
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
    setInput(e.target.value);
  };

  /* ── Markdown components for assistant messages ── */
  const markdownComponents: Record<string, any> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code({ inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || "");
      const lang = match ? match[1] : "";
      const content = String(children).replace(/\n$/, "");
      if (!inline) {
        return (
          <EditorCodeBlock language={lang} onInsert={insertAtCursor}>
            {content}
          </EditorCodeBlock>
        );
      }
      return (
        <code
          className="px-1 py-0.5 rounded text-[11px] font-mono bg-gray-800 text-indigo-300"
          {...props}
        >
          {children}
        </code>
      );
    },
    p({ children }: any) {
      return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
    },
    ul({ children }: any) {
      return <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>;
    },
    ol({ children }: any) {
      return <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>;
    },
    li({ children }: any) {
      return <li className="text-gray-300">{children}</li>;
    },
    strong({ children }: any) {
      return <strong className="text-gray-100 font-semibold">{children}</strong>;
    },
    h1({ children }: any) {
      return <h1 className="text-sm font-bold text-gray-100 mb-1.5 mt-3">{children}</h1>;
    },
    h2({ children }: any) {
      return <h2 className="text-xs font-bold text-gray-200 mb-1 mt-2.5">{children}</h2>;
    },
    h3({ children }: any) {
      return <h3 className="text-xs font-semibold text-gray-300 mb-1 mt-2">{children}</h3>;
    },
    blockquote({ children }: any) {
      return (
        <blockquote className="border-l-2 border-indigo-500/50 pl-3 italic text-gray-400 my-2">
          {children}
        </blockquote>
      );
    },
  };

  const hasSelection = selectedText.trim().length > 0;
  const isEmpty = messages.length === 0;

  return (
    <div
      className="flex flex-col h-full bg-[#0d1117] border-l border-gray-800/60 relative"
      role="complementary"
      aria-label="AI Assistant"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── Drag-over overlay ──────────────────────────────────────────────── */}
      {isDragOver && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 pointer-events-none"
          style={{ background: "rgba(99,102,241,0.12)", border: "2px dashed rgba(99,102,241,0.5)", borderRadius: 0 }}>
          <Paperclip size={28} className="text-indigo-400 animate-bounce" />
          <p className="text-sm font-semibold text-indigo-300">Drop to attach</p>
          <p className="text-xs text-indigo-500">File content will be sent as context</p>
        </div>
      )}
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800/60 bg-[#0d1117] shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Sparkles size={11} className="text-white" />
          </div>
          <span className="text-xs font-semibold text-gray-200 tracking-tight">AI Assistant</span>
          {activeProject && (
            <span className="flex items-center gap-1 text-[10px] text-gray-600 ml-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: activeProject.color }} />
              {activeProject.name}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-gray-400 transition-colors"
              title="Clear chat"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-gray-400 transition-colors"
            title="Close AI panel (⌘I)"
            aria-label="Close AI panel"
          >
            <ChevronDown size={15} />
          </button>
        </div>
      </div>

      {/* ── Messages area ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-800">
        {isEmpty ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-5 py-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-600/20 border border-indigo-500/20 flex items-center justify-center">
              <Sparkles size={22} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-300">Ask AI anything</p>
              <p className="text-xs text-gray-600 mt-1">
                About your code, bugs, refactoring…
              </p>
            </div>

            {/* Quick-action chips */}
            <div className="w-full grid grid-cols-2 gap-1.5 px-1">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    onClick={() => handleQuickAction(action.prompt)}
                    className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-gray-800 bg-gray-900/50 text-xs text-gray-400 hover:text-indigo-300 hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-all text-left"
                  >
                    <Icon size={12} className="shrink-0" />
                    {action.label}
                  </button>
                );
              })}
            </div>

            {currentFile && (
              <p className="text-[10px] text-gray-700">
                Active:{" "}
                <span className="text-gray-600 font-mono">
                  {currentFile.path.split("/").pop()}
                </span>
              </p>
            )}
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === "user";
            const safeContent = stripModelControlTokens(msg.content);

            return (
              <div
                key={msg.id}
                className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}
              >
                {!isUser && (
                  <div className="mt-0.5 shrink-0 w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                    <Sparkles size={10} className="text-white" />
                  </div>
                )}

                <div
                  className={cn(
                    "max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed",
                    isUser
                      ? "bg-indigo-600/20 border border-indigo-500/25 text-indigo-100 rounded-br-sm"
                      : "bg-[#161b27] border border-gray-800/60 text-gray-300 rounded-bl-sm"
                  )}
                >
                  {isUser ? (
                    <p
                      className="whitespace-pre-wrap break-words"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {msg.content}
                    </p>
                  ) : (
                    <div className="prose-editor">
                      {safeContent ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {safeContent}
                        </ReactMarkdown>
                      ) : msg.streaming ? (
                        <span className="inline-flex gap-1 items-center text-gray-600">
                          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:300ms]" />
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Context bar ────────────────────────────────────────────────────── */}
      <div className="px-3 py-1.5 flex items-center gap-1.5 border-t border-gray-800/40 bg-[#0d1117] shrink-0">
        <span className="text-[10px] text-gray-700 mr-0.5">Context:</span>

        {activeProject && (
          <button
            onClick={() =>
              setContextAdded((prev) => (prev === "workspace" ? "none" : "workspace"))
            }
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
              contextAdded === "workspace"
                ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300"
                : "border-gray-800 text-gray-600 hover:text-gray-400 hover:border-gray-700"
            )}
            title={`Include project structure of ${activeProject.name}`}
          >
            <FolderOpen size={10} />
            @workspace
          </button>
        )}

        <button
          disabled={!currentFile}
          onClick={() =>
            setContextAdded((prev) => (prev === "file" ? "none" : "file"))
          }
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
            contextAdded === "file"
              ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
              : "border-gray-800 text-gray-600 hover:text-gray-400 hover:border-gray-700",
            !currentFile && "opacity-30 cursor-not-allowed"
          )}
          title={currentFile ? `Include ${currentFile.path}` : "No file open"}
        >
          <FileCode size={10} />
          {currentFile ? currentFile.path.split("/").pop() : "@file"}
        </button>

        {hasSelection && (
          <button
            onClick={() =>
              setContextAdded((prev) => (prev === "selection" ? "none" : "selection"))
            }
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
              contextAdded === "selection"
                ? "bg-amber-600/20 border-amber-500/40 text-amber-300"
                : "border-gray-800 text-gray-600 hover:text-gray-400 hover:border-gray-700"
            )}
            title="Include selected text"
          >
            <CursorText size={10} />
            @selection
          </button>
        )}
      </div>

      {/* ── Input area ─────────────────────────────────────────────────────── */}
      <div className="px-3 pb-3 pt-2 shrink-0 bg-[#0d1117]">

        {/* Dropped file pills */}
        {droppedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {droppedFiles.map((df) => (
              <div
                key={df.path}
                className="flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md text-[10px] border"
                style={{
                  background: df.type === "directory" ? "rgba(251,191,36,0.08)" : "rgba(99,102,241,0.1)",
                  borderColor: df.type === "directory" ? "rgba(251,191,36,0.25)" : "rgba(99,102,241,0.25)",
                  color: df.type === "directory" ? "#fbbf24" : "#a5b4fc",
                }}
              >
                {df.loading ? (
                  <span className="w-2.5 h-2.5 border border-indigo-400 border-t-transparent rounded-full animate-spin" />
                ) : df.type === "directory" ? (
                  <Folder size={10} />
                ) : (
                  <FileCode size={10} />
                )}
                <span className="max-w-[140px] truncate">{df.name}</span>
                <button
                  onClick={() => setDroppedFiles(prev => prev.filter(d => d.path !== df.path))}
                  className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className={cn(
            "flex flex-col rounded-xl border transition-all duration-200",
            isStreaming
              ? "border-indigo-500/40 bg-[#111827]"
              : "border-gray-700/50 bg-[#111827] focus-within:border-indigo-500/50"
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={autoResize}
            onKeyDown={handleKeyDown}
            placeholder={
              droppedFiles.length > 0
                ? `Ask about the attached file${droppedFiles.length > 1 ? "s" : ""}… (↵ send)`
                : contextAdded !== "none"
                ? `Ask about ${contextAdded === "file" ? "the file" : "selection"}… (↵ send)`
                : "Ask about your code… (↵ send, ⇧↵ newline)"
            }
            rows={2}
            disabled={isStreaming}
            className="w-full bg-transparent text-xs text-gray-200 placeholder-gray-700 resize-none outline-none px-3 pt-2.5 pb-0 min-h-[42px] max-h-[160px]"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />

          <div className="flex items-center justify-between px-2 pb-2 pt-1.5">
            <div className="flex items-center gap-1">
              {/* Quick-action mini chips (visible in non-empty state) */}
              {!isEmpty &&
                QUICK_ACTIONS.slice(0, 2).map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.label}
                      onClick={() => handleQuickAction(a.prompt)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-gray-800 text-gray-700 hover:text-indigo-400 hover:border-indigo-700/40 transition-all"
                    >
                      <Icon size={9} />
                      {a.label}
                    </button>
                  );
                })}
            </div>

            {isStreaming ? (
              <button
                onClick={handleStop}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-all"
              >
                <Square size={10} className="fill-current" />
                Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all",
                  input.trim()
                    ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-900/50"
                    : "bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700"
                )}
              >
                <Send size={10} />
                Send
              </button>
            )}
          </div>
        </div>

        <p className="text-[9px] text-gray-800 text-center mt-1.5">
          ↵ send · ⇧↵ newline · drag files here · Esc close
        </p>
      </div>
    </div>
  );
}
