/**
 * Persist AIPiloty backend chat session_key across VS Code Chat turns.
 * Web UI does this via chat-store; without it, every IDE message is a new session
 * and model-choice follow-ups fail / confuse the agent.
 */

import type * as vscode from "vscode";

const STATE_KEY = "aipiloty.backendChatSessionKey";

export function getBackendSessionKey(
  context: vscode.ExtensionContext
): string | undefined {
  const v = context.workspaceState.get<string>(STATE_KEY);
  return v && v.trim() ? v.trim() : undefined;
}

export async function setBackendSessionKey(
  context: vscode.ExtensionContext,
  sessionKey: string | undefined
): Promise<void> {
  if (!sessionKey || !sessionKey.trim()) {
    await context.workspaceState.update(STATE_KEY, undefined);
    return;
  }
  await context.workspaceState.update(STATE_KEY, sessionKey.trim());
}

export async function clearBackendSessionKey(
  context: vscode.ExtensionContext
): Promise<void> {
  await context.workspaceState.update(STATE_KEY, undefined);
}
