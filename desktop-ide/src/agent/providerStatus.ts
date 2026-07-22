/**
 * ProviderStatusBar — VS Code status bar item showing active LLM provider.
 *
 * Shows: "$(cpu) claude" or "$(warning) ollama (fallback)"
 * Clicks → runs aipiloty.showProviderHealth command
 * Polls /api/v1/providers/llm/health every 15 s
 */

import * as vscode from "vscode";
import { getProviderHealth } from "./streaming";
import type { KeychainService } from "../keychain";

const POLL_INTERVAL_MS = 15_000;

const PROVIDER_ICONS: Record<string, string> = {
  claude: "$(anthropic)$(sparkle)",
  openai: "$(openai)",
  gemini: "$(google)",
  ollama: "$(cpu)",
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  openai: "GPT-4",
  gemini: "Gemini",
  ollama: "Ollama (local)",
};

export class ProviderStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly backendUrl: string,
    private readonly keychain: KeychainService,
  ) {
    this.item = vscode.window.createStatusBarItem(
      "aipiloty.providerStatus",
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "aipiloty.showProviderHealth";
    this.item.tooltip = "AIPiloty: LLM provider status — click for details";
    this.item.text = "$(loading~spin) AIPiloty";
    this.item.show();

    // Initial poll + schedule recurring
    this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_INTERVAL_MS);
  }

  async refresh(): Promise<void> {
    const health = await getProviderHealth(this.backendUrl, this.keychain);

    if (!health) {
      this.item.text = "$(debug-disconnect) AIPiloty";
      this.item.tooltip = "AIPiloty backend not reachable. Click to restart.";
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      return;
    }

    const active = (health.active as string) || "unknown";
    const chainList = Array.isArray(health.chain) ? (health.chain as string[]) : [];
    const chain = chainList.length ? chainList.join(" → ") : active;
    const icon = PROVIDER_ICONS[active] ?? "$(cpu)";
    const label = PROVIDER_LABELS[active] ?? active;

    const healthMap = (health.health ?? {}) as Record<string, { available: boolean; failure_count: number }>;
    const activeHealth = healthMap[active];
    const degraded = Boolean(activeHealth && !activeHealth.available);

    this.item.text = `${icon} ${label}`;
    this.item.tooltip = [
      `AIPiloty — Active: ${label}`,
      `Chain: ${chain}`,
      degraded ? "⚠ Provider degraded" : "",
    ].filter(Boolean).join("\n");

    this.item.backgroundColor = degraded
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
