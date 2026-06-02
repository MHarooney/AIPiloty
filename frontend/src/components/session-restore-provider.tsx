"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useChatStore } from "@/stores/chat-store";
import { fetchSessionMessages } from "@/lib/api";

/**
 * Mounts once in AppShell. On first render it checks localStorage for the
 * last-active session key and re-hydrates the chat store silently.
 */
export default function SessionRestoreProvider() {
  const restoreLastSession = useChatStore((s) => s.restoreLastSession);
  const loadSession = useChatStore((s) => s.loadSession);
  const messages = useChatStore((s) => s.messages);
  const sessionKey = useChatStore((s) => s.sessionKey);

  useEffect(() => {
    // Only attempt restore when chat is truly empty and not already loaded
    if (messages.length > 0 || sessionKey) return;

    const savedKey = restoreLastSession();
    if (!savedKey) return;

    fetchSessionMessages(savedKey)
      .then((data) => {
        if (data.messages.length === 0) return;
        loadSession(data.session_key, data.messages);
        toast.info("Resumed last session", { duration: 3000 });
      })
      .catch(() => {
        // Session no longer exists on server — clear stale key silently
        try { localStorage.removeItem("aipiloty_last_session"); } catch { /* ignore */ }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
