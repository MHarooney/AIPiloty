"use client";

import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, FileText, Image as ImageIcon, ChevronDown } from "lucide-react";
import { useChatStore, type ChatMessage } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import AIAvatar from "./ai-avatar";
import UserAvatar from "./user-avatar";
import MarkdownRenderer from "./markdown-renderer";
import TypingIndicator from "./typing-indicator";
import CinemaTerminal from "./cinema-terminal";
import ToolTimeline from "./tool-timeline";
import ToolOutputCard from "./tool-output-card";
import ToolRunningCard from "./tool-running-card";
import CommandApprovalCard from "./command-approval-card";
import ExecutionTimeline from "./execution-timeline";
import PlanningTimeline from "./planning-timeline";
import ThinkingVisualizer from "./thinking-visualizer";
import BrowserFetchSimulation, {
  extractFirstUrlFromText,
  getActiveFetchUrlFromMessage,
} from "./browser-fetch-simulation";
import FinalReportPanel from "./final-report-panel";
import AvatarSpeechBubble from "./avatar-speech-bubble";
import { parseToolOutput, isImageFile } from "@/lib/parse-tool-result";
import DownloadButton from "./download-button";
import InlineChatImage from "./inline-chat-image";
import ImageModelChoiceCard, { parseImageChoicePayload } from "./image-model-choice-card";

const QUICK_PROMPTS = [
  { label: "Check my system", prompt: "Run a health check on my system and tell me the specs" },
  { label: "Generate a PDF", prompt: "Generate a sample PDF report" },
  { label: "What model is running?", prompt: "What LLM model is this app using?" },
  { label: "Search the web", prompt: "Fetch https://ollama.com/library and summarize the top models" },
] as const;

const PHASE_STATUS_TEXT: Record<string, string> = {
  idle: "",
  thinking: "Reading your request…",
  tool_running: "Running a tool…",
  success: "Done!",
  error: "Something went wrong",
  waiting_approval: "Awaiting your decision…",
  analyzing_risk: "Analyzing risk…",
  explaining: "Preparing response…",
};

function MessageBubble({
  msg,
  priorUserContent,
}: {
  msg: ChatMessage;
  /** Previous message content when it was the user (used to detect URL intents). */
  priorUserContent?: string;
}) {
  const isUser = msg.role === "user";
  const avatarPhase = useChatStore((s) => s.avatarPhase);
  const systemState = useChatStore((s) => s.systemState);
  const dismissMessageFinalReport = useChatStore((s) => s.dismissMessageFinalReport);
  const currentPhase = msg.isStreaming ? avatarPhase : (msg.role === "assistant" ? "success" : "idle");

  // Find tools that are still running (no result yet)
  const runningTools = msg.toolCalls?.filter(
    (tc) => !msg.toolResults?.find((r) => r.name === tc.name)
  ) || [];

  // Show processing card when:
  // - tools are explicitly running, OR
  // - avatar is in tool_running phase during streaming (tool_output came but phase hasn't changed), OR
  // - system is executing and streaming with tool calls present
  const hasActiveTools = runningTools.length > 0;
  const showProcessing = msg.isStreaming && (
    hasActiveTools ||
    avatarPhase === "tool_running" ||
    (systemState === "executing" && (msg.toolCalls?.length ?? 0) > 0 && !msg.content)
  );
  const processingToolName = hasActiveTools
    ? runningTools[0].name
    : msg.toolCalls?.[msg.toolCalls.length - 1]?.name || "processing";

  const urlIntent = priorUserContent ? extractFirstUrlFromText(priorUserContent) : null;
  const activeFetchUrl = getActiveFetchUrlFromMessage(msg);
  const fetchUrlForUi = activeFetchUrl || urlIntent || "";
  const showFetchBrowserActive =
    showProcessing && processingToolName === "fetch_url" && Boolean(fetchUrlForUi);
  const showBrowserQueued =
    !isUser &&
    msg.isStreaming &&
    Boolean(urlIntent) &&
    !activeFetchUrl &&
    !showProcessing &&
    (systemState === "thinking" ||
      systemState === "planning" ||
      avatarPhase === "thinking");

  const msgTime = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const imageChoicePayload = !isUser
    ? (msg.toolResults || [])
        .map((tr) =>
          tr.name === "generate_image" && !tr.error
            ? parseImageChoicePayload(tr.output)
            : null
        )
        .find(Boolean) || null
    : null;

  // Prefer the clickable card — hide verbose "type gpt-image-1 / dalle-3" chat text.
  const displayContent =
    imageChoicePayload && msg.content
      ? imageChoicePayload.status === "needs_api_key"
        ? "Add an image API key in Settings to continue."
        : "Choose an image model below to continue."
      : msg.content;

  return (
    <div className={cn("group flex gap-3 animate-fade-slide-up", isUser ? "justify-end" : "justify-start")}>
      {/* Avatar + Speech Bubble */}
      {!isUser && (
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          <AIAvatar
            size="md"
            phase={msg.isStreaming ? avatarPhase : "idle"}
          />
          {/* Speech bubble appears during active phases */}
          {msg.isStreaming && currentPhase !== "idle" && (
            <AvatarSpeechBubble
              phase={currentPhase}
              className="ml-8 -mt-1"
            />
          )}
        </div>
      )}

      <div className={cn("flex flex-col gap-2 min-w-0", isUser ? "max-w-[75%] md:max-w-[65%]" : "max-w-[90%] md:max-w-[86%]")}>
        {/* Tool timeline (multi-step) */}
        {msg.toolCalls && msg.toolCalls.length > 1 && (
          <ToolTimeline toolCalls={msg.toolCalls} toolResults={msg.toolResults || []} />
        )}

        {/* Processing journey — stays visible during tool execution */}
        {showProcessing && (
          <ToolRunningCard toolName={processingToolName} />
        )}

        {/* Browser-style simulation: queued while agent reasons, active during fetch_url */}
        {!isUser &&
          msg.isStreaming &&
          fetchUrlForUi &&
          (showBrowserQueued || showFetchBrowserActive) && (
            <BrowserFetchSimulation
              url={fetchUrlForUi}
              stage={showFetchBrowserActive ? "active" : "queued"}
            />
          )}

        {/* Command approval card */}
        {msg.pendingApproval && (
          <CommandApprovalCard approval={msg.pendingApproval} />
        )}

        {/* Execution timeline (shows during streaming) */}
        {msg.isStreaming && (
          <ExecutionTimeline />
        )}

        {/* Live "Processing" journey — same column as pipeline (not detached at page bottom) */}
        {!isUser && msg.isStreaming && !showProcessing && !showBrowserQueued && (
          <ThinkingVisualizer />
        )}

        {/* Terminal outputs */}
        {msg.terminalOutputs && msg.terminalOutputs.length > 0 && msg.terminalOutputs.map((to, i) => (
          <CinemaTerminal key={`term-${i}`} output={to} />
        ))}

        {/* User attachment chips / thumbnails */}
        {isUser && msg.attachments && msg.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {msg.attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 bg-indigo-700/40 border border-indigo-500/30 rounded-lg px-2 py-1 text-xs text-indigo-200"
              >
                {att.category === "image" ? (
                  att.previewUrl ? (
                    <img src={att.previewUrl} alt={att.filename} className="w-10 h-10 rounded object-cover" />
                  ) : (
                    <ImageIcon size={14} className="text-indigo-300" />
                  )
                ) : (
                  <FileText size={14} className="text-emerald-300" />
                )}
                <span className="max-w-[140px] truncate">{att.filename}</span>
              </div>
            ))}
          </div>
        )}

        {/* Message text */}
        {msg.content && (
          <div
            className={cn(
              "rounded-2xl px-4 py-3 text-sm relative overflow-hidden",
              isUser
                ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-br-md"
                : "bg-gray-800/80 text-gray-200 rounded-bl-md border border-gray-700/50",
              msg.isStreaming && "typing-cursor",
              !isUser && "energy-ripple-hover"
            )}
          >
            {isUser ? (
              <p className="break-words" style={{ overflowWrap: "anywhere" }}>{msg.content}</p>
            ) : (
              <MarkdownRenderer content={displayContent} />
            )}
          </div>
        )}

        {/* Tool results */}
        {msg.toolResults && msg.toolResults.length > 0 && (() => {
          let shownImageChoice = false;
          return msg.toolResults.map((tr, i) => {
          const file = !tr.error && tr.output ? parseToolOutput(tr.name, tr.output) : null;
          const isImage = file && isImageFile(file);
          const imageChoice =
            tr.name === "generate_image" && !tr.error
              ? parseImageChoicePayload(tr.output)
              : null;
          const showChoice = Boolean(imageChoice) && !shownImageChoice;
          if (showChoice) shownImageChoice = true;
          const originalPrompt = msg.toolCalls?.find((c) => c.name === "generate_image")
            ?.arguments?.prompt as string | undefined;
          return (
            <div key={i} className="space-y-1.5">
              {showChoice && imageChoice ? (
                <ImageModelChoiceCard
                  payload={imageChoice}
                  originalPrompt={originalPrompt}
                />
              ) : imageChoice ? null : (
                <ToolOutputCard result={tr} />
              )}
              {isImage && <InlineChatImage file={file} />}
              {file && <DownloadButton file={file} />}
            </div>
          );
        });
        })()}

        {/* Hide execution report when waiting on model/key — card is the primary CTA */}
        {!isUser && msg.finalReport && !imageChoicePayload && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <FinalReportPanel
              report={msg.finalReport}
              onDismiss={() => dismissMessageFinalReport(msg.id)}
            />
          </motion.div>
        )}
        {/* Timestamp — visible on hover */}
        {!msg.isStreaming && (
          <span className={cn(
            "text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity duration-150 select-none mt-0.5",
            isUser ? "text-right" : "text-left"
          )}>
            {msgTime}
          </span>
        )}

        {/* Retry button on errored assistant messages */}
        {!isUser && !msg.isStreaming && msg.content?.includes("**Error:**") && (
          <button
            onClick={() => useChatStore.getState().retryLastMessage()}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-400 transition-colors mt-1 group"
            aria-label="Retry this message"
          >
            <RefreshCw size={12} className="group-hover:rotate-180 transition-transform duration-300" />
            Retry
          </button>
        )}
      </div>

      {isUser && <UserAvatar size="md" />}
    </div>
  );
}

export default function ChatMessages() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const avatarPhase = useChatStore((s) => s.avatarPhase);
  const systemState = useChatStore((s) => s.systemState);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollButton(distFromBottom > 150);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-6 animate-fade-slide-up pt-10 md:pt-0">
          <AIAvatar size="lg" phase={avatarPhase} className="mx-auto" />
          {/* Micro-copy status line */}
          {avatarPhase !== "idle" && (
            <p className="text-xs text-gray-500 animate-fade-slide-up">
              {PHASE_STATUS_TEXT[avatarPhase]}
            </p>
          )}
          <div>
            <h2 className="text-2xl font-bold gradient-text mb-2">AIPiloty</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
              Describe what you want in the box below — the agent decides whether to answer directly or use tools
              (documents, SSH, diagnostics, images, etc.). No preset flows.
            </p>
          </div>

          {/* System state badge */}
          {systemState !== "idle" && (
            <div className="flex items-center justify-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full animate-pulse",
                systemState === "thinking" && "bg-purple-400",
                systemState === "planning" && "bg-indigo-400",
                systemState === "executing" && "bg-emerald-400",
                systemState === "waiting_approval" && "bg-amber-400",
              )} />
              <span className="text-[10px] text-gray-600 uppercase tracking-wider">
                {systemState.replace("_", " ")}
              </span>
            </div>
          )}

          {/* Quick-prompt chips */}
          <div className="flex flex-wrap justify-center gap-2 max-w-2xl mx-auto">
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.label}
                onClick={() => useChatStore.getState().sendQuickPrompt(qp.prompt)}
                className="px-3 py-1.5 text-xs rounded-full border border-gray-700/50 bg-gray-800/60 text-gray-400 hover:text-indigo-300 hover:border-indigo-500/30 hover:bg-indigo-500/10 transition-all duration-200"
              >
                {qp.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-10 py-6 pt-14 md:pt-6" role="log" aria-live="polite" aria-label="Chat messages">
      <div className="space-y-5 w-full">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              <MessageBubble
                msg={msg}
                priorUserContent={
                  i > 0 && messages[i - 1].role === "user"
                    ? messages[i - 1].content
                    : undefined
                }
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Planning timeline (when AI is planning) */}
        {(systemState === "planning" || systemState === "executing") && isStreaming && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <PlanningTimeline />
          </motion.div>
        )}

        {/* Typing indicator */}
        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TypingIndicator />
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>

      {/* Scroll-to-bottom button */}
      {showScrollButton && (
        <button
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
          aria-label="Scroll to bottom"
          className="absolute bottom-4 right-6 z-10 p-2 rounded-full bg-indigo-600/90 hover:bg-indigo-500 text-white shadow-lg transition-all duration-200 animate-fade-in"
        >
          <ChevronDown size={16} />
        </button>
      )}
    </div>
  );
}
