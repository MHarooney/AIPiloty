"use client";

import AppShell from "@/components/app-shell";
import ChatMessages from "@/components/chat-messages";
import ChatInput from "@/components/chat-input";
import BackgroundVerboseStream from "@/components/background-verbose-stream";

export default function ChatPage() {
  return (
    <AppShell>
      <ChatMessages />
      <ChatInput />
      <BackgroundVerboseStream />
    </AppShell>
  );
}
