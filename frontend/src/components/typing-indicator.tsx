"use client";

import AIAvatar from "./ai-avatar";

export default function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <AIAvatar size="md" phase="thinking" />
      <div className="flex items-center gap-1.5 px-4 py-3 bg-gray-800/80 rounded-xl">
        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce-dot" style={{ animationDelay: "0s" }} />
        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce-dot" style={{ animationDelay: "0.2s" }} />
        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce-dot" style={{ animationDelay: "0.4s" }} />
      </div>
    </div>
  );
}
