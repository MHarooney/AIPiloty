"use client";

import { useChatStore } from "@/stores/chat-store";
import { ShieldAlert, Check, X } from "lucide-react";
import { streamChat } from "@/lib/api";

export default function ApprovalModal() {
  const { pendingApproval, setPendingApproval, sessionKey, handleSSEEvent, chatMode, lastUserMessage } = useChatStore();

  if (!pendingApproval) return null;

  const handleApprove = () => {
    setPendingApproval(null);
    // Re-send with auto_approve (clears backend pending + runs agent)
    streamChat(
      lastUserMessage || `Approved: execute ${pendingApproval.name}`,
      sessionKey,
      handleSSEEvent,
      undefined,
      true,
      undefined,
      undefined,
      chatMode
    );
  };

  const handleDeny = () => {
    setPendingApproval(null);
    streamChat("no", sessionKey, handleSSEEvent, undefined, false, undefined, undefined, chatMode);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl animate-slide-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-900/30 flex items-center justify-center">
            <ShieldAlert size={20} className="text-amber-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-100">Approval Required</h3>
            <p className="text-xs text-gray-500">High-risk operation detected</p>
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-xl p-3 mb-4 border border-gray-700/50">
          <p className="text-sm text-gray-300 mb-1 font-medium">{pendingApproval.name.replace(/_/g, " ")}</p>
          <pre className="text-xs text-gray-500 overflow-x-auto max-h-32 font-mono">
            {JSON.stringify(pendingApproval.arguments, null, 2)}
          </pre>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleDeny}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
          >
            <X size={16} /> Deny
          </button>
          <button
            onClick={handleApprove}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm transition-colors"
          >
            <Check size={16} /> Approve
          </button>
        </div>
      </div>
    </div>
  );
}
