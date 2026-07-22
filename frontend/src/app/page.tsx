"use client";

import AppShell from "@/components/app-shell";
import ChatMessages from "@/components/chat-messages";
import ChatInput from "@/components/chat-input";
import BackgroundVerboseStream from "@/components/background-verbose-stream";
import SessionRestoreProvider from "@/components/session-restore-provider";
import ProviderStatusBadge from "@/components/provider-status-badge";

export default function ChatPage() {
  return (
    <AppShell>
      <SessionRestoreProvider />
      {/* Provider status badge — only visible when multiple providers are configured */}
      <div className="relative z-10 flex justify-end px-4 pt-2 pb-0 pointer-events-none">
        <div className="pointer-events-auto">
          <ProviderStatusBadge />
        </div>
      </div>
      <ChatMessages />
      <ChatInput />
      <BackgroundVerboseStream />
    </AppShell>
  );
}
