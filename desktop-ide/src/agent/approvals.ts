/**
 * Tool approval UX for high/critical risk tools.
 * Backend emits `approval_required` then waits; we re-submit with auto_approve.
 */

import * as vscode from "vscode";
import type { KeychainService } from "../keychain";
import { streamChat, type ChatMessage, type SSEEvent, type StreamOptions } from "./streaming";

export interface ApprovalHandlers {
  onEvent: (event: SSEEvent) => void;
  signal?: AbortSignal;
}

/**
 * Prompt the user to approve a pending tool, then continue the session.
 */
export async function promptAndResumeAfterApproval(
  backendUrl: string,
  keychain: KeychainService,
  opts: {
    sessionKey: string;
    messages: ChatMessage[];
    mode: "auto" | "ask" | "agent" | "plan" | "debug";
    event: SSEEvent;
    handlers: ApprovalHandlers;
  }
): Promise<"approved" | "denied" | "skipped"> {
  const d = opts.event.data;
  const tool = String(d["tool"] ?? "tool");
  const risk = String(d["risk_level"] ?? "high");
  const explanation = String(d["explanation"] ?? `Run ${tool}`);
  const argsPreview = JSON.stringify(d["arguments"] ?? {}, null, 2).slice(0, 800);

  const choice = await vscode.window.showWarningMessage(
    `AIPiloty wants to run ${tool} (${risk} risk)\n${explanation}`,
    { modal: true, detail: argsPreview },
    "Approve",
    "Deny"
  );

  if (choice !== "Approve") {
    return "denied";
  }

  const resumeMessages: ChatMessage[] = [
    ...opts.messages,
    {
      role: "user",
      content: `yes — approve running tool "${tool}"`,
    },
  ];

  await streamChat(backendUrl, keychain, {
    messages: resumeMessages,
    sessionKey: opts.sessionKey,
    mode: opts.mode === "ask" ? "ask" : opts.mode === "plan" || opts.mode === "debug" ? opts.mode : "agent",
    autoApprove: true,
    signal: opts.handlers.signal,
    onEvent: opts.handlers.onEvent,
  } satisfies StreamOptions);

  return "approved";
}

/**
 * ask → never auto-approve
 * auto → respect aipiloty.autoApproveTools (default false)
 * agent → aipiloty.autoApproveAgentTools (default false — show Approvals like Cursor)
 */
export function shouldAutoApprove(mode: "auto" | "ask" | "agent" | "plan" | "debug"): boolean {
  if (mode === "ask") return false;
  const cfg = vscode.workspace.getConfiguration("aipiloty");
  if (cfg.get<boolean>("autoApproveTools", false)) return true;
  if (mode === "agent") {
    return cfg.get<boolean>("autoApproveAgentTools", false);
  }
  return false;
}
