/**
 * AIPiloty Desktop IDE — VS Code Extension Entry Point
 *
 * Primary AI agent UI = stock VS Code Chat (right panel) via chat participant.
 * Left activity bar = MCP settings only.
 * Modes = status bar + ⇧Tab + /agent /ask /plan /debug (Chat composer has no extension API for a Cursor dropdown).
 */

import * as vscode from "vscode";
import { SidecarManager } from "./sidecar";
import { KeychainService } from "./keychain";
import { registerChatParticipant } from "./agent/chatParticipant";
import { ChatModeService } from "./agent/chatMode";
import { ChatModelService } from "./agent/chatModel";
import { registerLanguageModelProvider } from "./agent/languageModel";
import { registerInlineEditCommand } from "./agent/inlineEdit";
import { ProviderStatusBar } from "./agent/providerStatus";
import { maybePromptForCloudKeys, syncProviderKeysToBackend } from "./agent/providerSync";
import { registerMcpSettings } from "./agent/mcpSettings";

let sidecar: SidecarManager | undefined;
let statusBar: ProviderStatusBar | undefined;
let modelService: ChatModelService | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("aipiloty");
  const backendUrl = config.get<string>("backendUrl", "http://localhost:8100");
  const autoStart = config.get<boolean>("autoStartBackend", true);

  const keychain = new KeychainService(context);

  sidecar = new SidecarManager(context, backendUrl);

  if (autoStart) {
    sidecar
      .start()
      .then(async () => {
        await syncProviderKeysToBackend(backendUrl, keychain);
        statusBar?.refresh();
        await maybePromptForCloudKeys(backendUrl, keychain, context);
      })
      .catch((err: Error) => {
        vscode.window.showWarningMessage(
          `AIPiloty backend failed to start: ${err.message}. ` +
            "Run the backend manually with `make dev-backend`."
        );
      });
  } else {
    void syncProviderKeysToBackend(backendUrl, keychain).then(() => statusBar?.refresh());
  }

  statusBar = new ProviderStatusBar(backendUrl, keychain);
  context.subscriptions.push(statusBar);

  const chatMode = new ChatModeService(context);
  const cfgMode = config.get<string>("chatMode", "agent");
  if (cfgMode === "ask" || cfgMode === "plan" || cfgMode === "debug" || cfgMode === "agent") {
    chatMode.setMode(cfgMode);
  }

  modelService = new ChatModelService(context, backendUrl, keychain);

  registerLanguageModelProvider(context, backendUrl, keychain);
  registerChatParticipant(context, backendUrl, keychain, chatMode, modelService);
  registerMcpSettings(context, backendUrl, keychain);

  // Open the right-side Chat as the primary agent surface
  void (async () => {
    const ui = vscode.workspace
      .getConfiguration("aipiloty")
      .get<string>("preferredChatUi", "vscode");
    if (ui === "vscode") {
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open");
      } catch {
        /* ignore on older builds */
      }
    }
  })();

  context.subscriptions.push(
    vscode.commands.registerCommand("aipiloty.selectChatMode", async () => {
      await chatMode.pick();
    }),
    vscode.commands.registerCommand("aipiloty.selectChatModel", async () => {
      await modelService?.pick();
    }),
    vscode.commands.registerCommand(
      "aipiloty.setChatModel",
      async (id?: string, label?: string) => {
        if (typeof id === "string" && id.trim() && modelService) {
          modelService.setModel(id.trim(), typeof label === "string" ? label : undefined);
        }
      }
    ),
    vscode.commands.registerCommand("aipiloty.listChatModels", async () => {
      return modelService ? modelService.listForComposer() : [{ id: "auto", label: "Auto", is_default: true }];
    }),

    vscode.commands.registerCommand("aipiloty.cycleChatMode", () => {
      const next = chatMode.cycle();
      vscode.window.setStatusBarMessage(`AIPiloty mode → ${next}`, 2000);
    }),

    vscode.commands.registerCommand("aipiloty.setMode.agent", () => {
      chatMode.setMode("agent");
    }),
    vscode.commands.registerCommand("aipiloty.setMode.ask", () => {
      chatMode.setMode("ask");
    }),
    vscode.commands.registerCommand("aipiloty.setMode.plan", () => {
      chatMode.setMode("plan");
    }),
    vscode.commands.registerCommand("aipiloty.setMode.debug", () => {
      chatMode.setMode("debug");
    }),

    vscode.commands.registerCommand("aipiloty.openChat", async () => {
      const ui = vscode.workspace
        .getConfiguration("aipiloty")
        .get<string>("preferredChatUi", "vscode");
      if (ui === "sidebar") {
        try {
          await vscode.commands.executeCommand("workbench.view.extension.aipiloty-sidebar");
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open");
      } catch {
        vscode.window.showInformationMessage(
          "Open Chat from the Activity Bar (speech bubble) or View → Chat."
        );
      }
    }),

    vscode.commands.registerCommand("aipiloty.newChat", async () => {
      try {
        await vscode.commands.executeCommand("aipiloty.clearBackendChatSession");
      } catch {
        /* registered with chat participant */
      }
      try {
        await vscode.commands.executeCommand("workbench.action.chat.newChat");
      } catch {
        await vscode.commands.executeCommand("workbench.action.chat.open");
      }
    }),

    vscode.commands.registerCommand("aipiloty.restartBackend", async () => {
      await sidecar?.stop();
      await sidecar?.start();
      await syncProviderKeysToBackend(backendUrl, keychain);
      statusBar?.refresh();
      vscode.window.showInformationMessage("AIPiloty backend restarted");
    }),

    vscode.commands.registerCommand("aipiloty.showProviderHealth", async () => {
      const health = await fetchProviderHealth(backendUrl, keychain);
      if (!health) {
        vscode.window.showWarningMessage("Could not reach AIPiloty backend");
        return;
      }
      const chainList = Array.isArray(health.chain) ? (health.chain as string[]) : [];
      const chain = chainList.length ? chainList.join(" → ") : String(health.active ?? "?");
      const active = String(health.active ?? "unknown");
      const choice = await vscode.window.showInformationMessage(
        `Active: ${active} | Chain: ${chain}`,
        "Configure Keys"
      );
      if (choice === "Configure Keys") {
        await vscode.commands.executeCommand("aipiloty.setProviderKey");
      }
    }),

    vscode.commands.registerCommand("aipiloty.setProviderKey", async () => {
      const providers = [
        {
          id: "openrouter",
          label: "OpenRouter (multi-model gateway)",
          configKey: "openrouter_api_key",
          secretKey: "aipiloty.openrouter_api_key",
          placeholder: "sk-or-v1-…",
        },
        {
          id: "claude",
          label: "Claude (Anthropic)",
          configKey: "anthropic_api_key",
          secretKey: "aipiloty.claude_api_key",
          placeholder: "sk-ant-…",
        },
        {
          id: "openai",
          label: "OpenAI",
          configKey: "openai_api_key",
          secretKey: "aipiloty.openai_api_key",
          placeholder: "sk-…",
        },
        {
          id: "gemini",
          label: "Gemini (Google)",
          configKey: "gemini_api_key",
          secretKey: "aipiloty.gemini_api_key",
          placeholder: "AIza…",
        },
      ];
      const pick = await vscode.window.showQuickPick(
        providers.map((p) => ({
          label: p.label,
          description: p.id,
          p,
        })),
        { placeHolder: "Select provider to configure" }
      );
      if (!pick) return;

      const { id, configKey, secretKey, placeholder } = pick.p;
      const key = await vscode.window.showInputBox({
        prompt: `Enter API key for ${id}`,
        placeHolder: placeholder,
        password: true,
        validateInput: (v) => (v.length < 8 ? "Key too short" : null),
      });
      if (!key) return;

      await keychain.set(secretKey, key);

      try {
        const res = await fetch(`${backendUrl}/api/v1/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": await keychain.getApiKey(),
          },
          body: JSON.stringify({ [configKey]: key }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        vscode.window.showInformationMessage(
          `${id} API key saved. Model picker will refresh on next open.`
        );
        statusBar?.refresh();
        modelService?.refresh();
      } catch {
        vscode.window.showWarningMessage(
          "Key saved locally. Could not reach backend to hot-patch — restart backend to apply."
        );
      }
    })
  );

  registerInlineEditCommand(context, backendUrl, keychain);

  context.subscriptions.push(
    vscode.commands.registerCommand("aipiloty.explainSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const text = editor.document.getText(editor.selection);
      if (!text.trim()) {
        vscode.window.showInformationMessage("Select some code first");
        return;
      }
      chatMode.setMode("ask");
      await vscode.commands.executeCommand("aipiloty.openChat");
      // Prefill via chat open with query when supported
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: `@aipiloty /ask Explain this code:\n\`\`\`${editor.document.languageId}\n${text}\n\`\`\``,
          isPartialQuery: false,
        });
      } catch {
        vscode.window.showInformationMessage(
          "Chat opened in Ask mode — paste your selection or use /ask"
        );
      }
    })
  );
}

export async function deactivate(): Promise<void> {
  statusBar?.dispose();
  await sidecar?.stop();
}

async function fetchProviderHealth(
  backendUrl: string,
  keychain: KeychainService
): Promise<Record<string, unknown> | null> {
  try {
    const apiKey = await keychain.getApiKey();
    const res = await fetch(`${backendUrl}/api/v1/providers/llm/health`, {
      headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
