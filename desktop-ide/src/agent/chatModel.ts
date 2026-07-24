/**
 * Chat model picker for the stock VS Code Chat panel.
 * Extension APIs cannot embed a Cursor-style dropdown in the composer,
 * so we mirror selection via status bar + QuickPick (same pattern as chat modes).
 *
 * Default: Auto — ProviderRouter failover across configured providers.
 */

import * as vscode from "vscode";
import type { KeychainService } from "../keychain";

const STATE_KEY = "aipiloty.chatModel";

export interface LlmModelOption {
  id: string;
  label: string;
  description?: string;
  provider?: string;
  is_default?: boolean;
}

export class ChatModelService {
  private readonly bar: vscode.StatusBarItem;
  private modelId: string;
  private labelCache: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly backendUrl: string,
    private readonly keychain: KeychainService
  ) {
    this.modelId = this.readStored();
    this.labelCache = this.modelId === "auto" ? "Auto" : this.modelId;
    this.bar = vscode.window.createStatusBarItem(
      "aipiloty.chatModel",
      vscode.StatusBarAlignment.Right,
      99
    );
    this.bar.command = "aipiloty.selectChatModel";
    this.bar.tooltip = "AIPiloty LLM model (Auto = best configured provider)";
    this.refreshBar();
    this.bar.show();
    context.subscriptions.push(this.bar);
  }

  get current(): string {
    return this.modelId;
  }

  /** Value to send on /chat/stream — undefined means Auto failover. */
  get streamModel(): string | undefined {
    if (!this.modelId || this.modelId === "auto") {
      return undefined;
    }
    return this.modelId;
  }

  setModel(id: string, label?: string): void {
    this.modelId = id || "auto";
    this.labelCache = label || (this.modelId === "auto" ? "Auto" : this.modelId);
    void this.context.workspaceState.update(STATE_KEY, this.modelId);
    this.refreshBar();
    void vscode.window.setStatusBarMessage(
      `AIPiloty model: ${this.labelCache}`,
      2500
    );
  }

  refresh(): void {
    this.refreshBar();
  }

  async pick(): Promise<string | undefined> {
    const catalog = await this.fetchCatalog();
    const items: (vscode.QuickPickItem & { id?: string; action?: string })[] = [];

    for (const m of catalog) {
      items.push({
        id: m.id,
        label: m.id === "auto" ? "$(sparkle) Auto" : m.label,
        description:
          m.id === this.modelId
            ? "current"
            : m.is_default
              ? "default"
              : m.provider || "",
        detail: m.description,
      });
    }

    items.push({
      label: "$(key) Add / update API key…",
      description: "OpenRouter, Claude, OpenAI, Gemini",
      action: "keys",
    });

    const picked = await vscode.window.showQuickPick(items, {
      title: "AIPiloty model (Auto uses configured providers)",
      placeHolder: "Search models",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) {
      return undefined;
    }
    if (picked.action === "keys") {
      await vscode.commands.executeCommand("aipiloty.setProviderKey");
      return undefined;
    }
    if (!picked.id) {
      return undefined;
    }
    this.setModel(picked.id, picked.label.replace(/^\$\([^)]+\)\s*/, ""));
    return picked.id;
  }

  /** Used by the fork composer model pill. */
  async listForComposer(): Promise<LlmModelOption[]> {
    return this.fetchCatalog();
  }

  private readStored(): string {
    const fromSettings = vscode.workspace
      .getConfiguration("aipiloty")
      .get<string>("chatModel", "auto");
    const stored = this.context.workspaceState.get<string>(STATE_KEY, fromSettings || "auto");
    return stored?.trim() || "auto";
  }

  private refreshBar(): void {
    const label =
      this.modelId === "auto"
        ? "Auto"
        : this.labelCache.includes("/")
          ? this.labelCache.split("/").pop() || this.labelCache
          : this.labelCache;
    this.bar.text = `$(hubot) ${label}`;
  }

  private async fetchCatalog(): Promise<LlmModelOption[]> {
    try {
      const res = await fetch(
        `${this.backendUrl.replace(/\/$/, "")}/api/v1/config/llm-models`,
        { headers: await this.keychain.backendHeaders() }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { models?: LlmModelOption[] };
      if (Array.isArray(data.models) && data.models.length) {
        return data.models;
      }
    } catch (err) {
      console.warn("[aipiloty] llm-models fetch failed", err);
    }
    return [
      {
        id: "auto",
        label: "Auto",
        description: "Best available configured provider",
        is_default: true,
        provider: "auto",
      },
    ];
  }
}
