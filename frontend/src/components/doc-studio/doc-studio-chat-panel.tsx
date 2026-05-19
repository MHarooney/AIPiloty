"use client";

import { useRef, useEffect, useState } from "react";
import { Send, Square, Tag, MessageSquare, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD_GLASS } from "@/lib/design-tokens";
import { useDocStudioStore } from "@/stores/doc-studio-store";
import { useI18n } from "@/i18n";
import MarkdownRenderer from "@/components/markdown-renderer";

const SUGGESTIONS = [
  "Summarize the key requirements",
  "List all API endpoints mentioned",
  "What are the main risks?",
  "Describe the architecture",
];

interface Props { notebookId: string }

export default function DocStudioChatPanel({ notebookId }: Props) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { messages, isStreaming, streamBuffer, streamPhase, sendChat, stopStream } = useDocStudioStore();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  const handleSend = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isStreaming) return;
    setInput("");
    sendChat(notebookId, msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-5 pr-1">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center pt-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600/30 to-purple-600/30 border border-indigo-500/20 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-300">Ask about your sources</p>
              <p className="text-xs text-gray-600 mt-1">Grounded answers with citations from your documents</p>
            </div>

            {/* Suggestions */}
            <div className="grid grid-cols-1 gap-2 w-full max-w-xs">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="flex items-center gap-2 text-left text-xs px-3 py-2 rounded-xl bg-gray-800/60 border border-gray-700/40 hover:border-indigo-500/40 hover:bg-indigo-900/20 text-gray-400 hover:text-indigo-300 transition-all"
                >
                  <Lightbulb className="w-3 h-3 flex-shrink-0 text-amber-400" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5 shadow-md shadow-indigo-500/20">
                AI
              </div>
            )}
            <div className={cn(
              "max-w-[82%] rounded-2xl px-4 py-3 text-sm",
              msg.role === "user"
                ? "bg-indigo-600/30 border border-indigo-500/30 text-indigo-100 rounded-tr-sm"
                : "bg-gray-800/60 border border-gray-700/40 text-gray-200 rounded-tl-sm"
            )}>
              {msg.role === "assistant"
                ? <MarkdownRenderer content={msg.content} />
                : <p className="leading-relaxed">{msg.content}</p>
              }
              {msg.citations && msg.citations.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2.5 pt-2.5 border-t border-gray-700/40">
                  {msg.citations.map((c, ci) => (
                    <span key={ci} className="flex items-center gap-1 text-[10px] bg-indigo-900/40 border border-indigo-500/20 text-indigo-300 rounded-full px-2 py-0.5">
                      <Tag className="w-2.5 h-2.5" /> {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-300 flex-shrink-0 mt-0.5">
                You
              </div>
            )}
          </div>
        ))}

        {/* Streaming */}
        {isStreaming && streamBuffer && (
          <div className="flex gap-3 justify-start">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5 shadow-md shadow-indigo-500/20">
              AI
            </div>
            <div className="max-w-[82%] bg-gray-800/60 border border-gray-700/40 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-200">
              <MarkdownRenderer content={streamBuffer} />
            </div>
          </div>
        )}

        {isStreaming && !streamBuffer && (
          <div className="flex gap-3 items-center">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 shadow-md shadow-indigo-500/20">
              AI
            </div>
            <div className="flex items-center gap-1 px-3 py-2 bg-gray-800/60 border border-gray-700/40 rounded-2xl rounded-tl-sm">
              {[0,1,2].map(i => (
                <span key={i} style={{ animationDelay: `${i * 200}ms` }}
                  className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" />
              ))}
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 bg-gray-800/60 rounded-xl border border-gray-700/50 focus-within:border-indigo-500/50 transition-colors">
        <div className="flex items-end gap-2 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("docStudio.chatPlaceholder")}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-gray-100 placeholder-gray-600 focus:outline-none max-h-32"
          />
          {isStreaming ? (
            <button
              onClick={stopStream}
              className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 transition-colors flex-shrink-0"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="p-2 rounded-lg bg-indigo-600/50 hover:bg-indigo-600/80 text-indigo-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
