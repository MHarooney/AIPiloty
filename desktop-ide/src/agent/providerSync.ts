/**
 * Push locally stored LLM keys into the FastAPI backend on activate.
 */

import * as vscode from "vscode";
import type { KeychainService } from "../keychain";

export async function syncProviderKeysToBackend(
  backendUrl: string,
  keychain: KeychainService
): Promise<void> {
  const payload: Record<string, string> = {};

  const claude = await keychain.getAnthropicKey();
  const openai = await keychain.getOpenAIKey();
  const gemini = await keychain.getGeminiKey();

  if (claude) payload.anthropic_api_key = claude;
  if (openai) payload.openai_api_key = openai;
  if (gemini) payload.gemini_api_key = gemini;

  if (!Object.keys(payload).length) return;

  try {
    const res = await fetch(`${backendUrl}/api/v1/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": await keychain.getApiKey(),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`[aipiloty] provider sync HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn("[aipiloty] provider sync failed", err);
  }
}

/** One-time tip when only Ollama is available. */
export async function maybePromptForCloudKeys(
  backendUrl: string,
  keychain: KeychainService,
  context: vscode.ExtensionContext
): Promise<void> {
  const seen = context.globalState.get<boolean>("aipiloty.cloudKeyTipShown");
  if (seen) return;

  try {
    const res = await fetch(`${backendUrl}/api/v1/providers/llm/health`, {
      headers: { "X-API-Key": await keychain.getApiKey() },
    });
    if (!res.ok) return;
    const health = (await res.json()) as { chain?: string[] };
    const chain = Array.isArray(health.chain) ? health.chain : [];
    if (chain.length === 1 && chain[0] === "ollama") {
      const pick = await vscode.window.showInformationMessage(
        "AIPiloty is on Ollama only. Add Claude / OpenAI / Gemini for stronger Agent mode.",
        "Configure Keys",
        "Later"
      );
      await context.globalState.update("aipiloty.cloudKeyTipShown", true);
      if (pick === "Configure Keys") {
        await vscode.commands.executeCommand("aipiloty.setProviderKey");
      }
    }
  } catch {
    // backend not ready yet
  }
}
