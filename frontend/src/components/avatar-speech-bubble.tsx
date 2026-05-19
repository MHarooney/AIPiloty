"use client";

import { useMemo } from "react";
import { useChatStore, type AvatarPhase } from "@/stores/chat-store";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Avatar Speech Bubble — shows engaging messages from the AI avatar
 * during different phases. Appears as a small floating speech bubble
 * near the avatar, making it feel alive and communicative.
 */

const PHASE_MESSAGES: Record<AvatarPhase, string[]> = {
  idle: [],
  thinking: [
    "Hmm, let me think about this… 🤔",
    "Analyzing your request… 💭",
    "Processing… give me a moment! ⚡",
  ],
  tool_running: [
    "Running a tool for you! ⚙️",
    "Working on it… 🔧",
    "Almost there, executing now! 🚀",
  ],
  success: [
    "Done! Here's what I found ✨",
    "All good! Check the results 🎉",
    "Mission accomplished! 🏆",
  ],
  error: [
    "Oops, hit a snag 😅",
    "Something went wrong, let me explain…",
    "Error encountered, but don't worry! 🔍",
  ],
  waiting_approval: [
    "I need your approval first ⚠️",
    "Waiting for the green light! 🚦",
    "Your decision is needed 🤝",
  ],
  analyzing_risk: [
    "Checking if this is safe… 🔒",
    "Running risk analysis… 🛡️",
  ],
  explaining: [
    "Let me explain what happened… 📋",
    "Here's the breakdown! 📊",
  ],
};

interface AvatarSpeechBubbleProps {
  phase: AvatarPhase;
  className?: string;
}

export default function AvatarSpeechBubble({ phase, className }: AvatarSpeechBubbleProps) {
  const messages = PHASE_MESSAGES[phase];

  const message = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    return messages[Math.floor(Math.random() * messages.length)];
  }, [phase]);

  if (!message) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phase}
        initial={{ opacity: 0, scale: 0.85, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -4 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={cn(
          "relative px-3 py-1.5 rounded-xl text-[11px] max-w-[200px]",
          "bg-gray-800/90 backdrop-blur-sm border border-gray-700/50",
          "text-gray-300 shadow-lg shadow-black/20",
          className
        )}
      >
        {/* Speech bubble tail */}
        <div
          className="absolute -left-1.5 top-3 w-3 h-3 rotate-45 bg-gray-800/90 border-l border-b border-gray-700/50"
        />
        <span className="relative z-10">{message}</span>
      </motion.div>
    </AnimatePresence>
  );
}
