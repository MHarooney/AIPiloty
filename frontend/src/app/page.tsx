"use client";

import AppShell from "@/components/app-shell";
import ChatMessages from "@/components/chat-messages";
import ChatInput from "@/components/chat-input";
import BackgroundVerboseStream from "@/components/background-verbose-stream";
import SessionRestoreProvider from "@/components/session-restore-provider";

export default function ChatPage() {
  return (
    <AppShell>
      <SessionRestoreProvider />
      <ChatMessages />
      <ChatInput />
      <BackgroundVerboseStream />
    </AppShell>
  );
}
