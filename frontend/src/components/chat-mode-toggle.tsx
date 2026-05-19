"use client";

import { Bot, MessageCircleQuestion, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore, type ChatMode } from "@/stores/chat-store";
import { useI18n } from "@/i18n";

const MODES: { key: ChatMode; Icon: typeof Bot; tKey: string; descKey: string; color: string }[] = [
  { key: "agent", Icon: Bot, tKey: "chat.modeAgent", descKey: "chat.modeAgentDesc", color: "indigo" },
  { key: "ask", Icon: MessageCircleQuestion, tKey: "chat.modeAsk", descKey: "chat.modeAskDesc", color: "emerald" },
  { key: "auto", Icon: Sparkles, tKey: "chat.modeAuto", descKey: "chat.modeAutoDesc", color: "amber" },
];

export default function ChatModeToggle() {
  const chatMode = useChatStore((s) => s.chatMode);
  const setChatMode = useChatStore((s) => s.setChatMode);
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-900/50 p-0.5 rounded-lg border border-gray-200 dark:border-gray-800/40">
      {MODES.map(({ key, Icon, tKey, descKey, color }) => (
        <button
          key={key}
          onClick={() => setChatMode(key)}
          title={t(descKey)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all",
            chatMode === key
              ? cn(
                  "shadow-sm",
                  color === "indigo" && "bg-indigo-100 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/40",
                  color === "emerald" && "bg-emerald-100 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/40",
                  color === "amber" && "bg-amber-100 dark:bg-amber-600/20 text-amber-600 dark:text-amber-300 border border-amber-200 dark:border-amber-500/40"
                )
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 border border-transparent"
          )}
        >
          <Icon size={12} />
          <span>{t(tKey)}</span>
        </button>
      ))}
    </div>
  );
}
