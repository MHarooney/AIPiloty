/**
 * AIPiloty Desktop IDE — VS Code Extension Entry Point
 *
 * Architecture:
 *   VS Code (Code OSS shell)
 *     └─ AIPiloty extension (this file)
 *          ├─ SidecarManager  — spawns/monitors FastAPI backend + Ollama
 *          ├─ KeychainService — VS Code SecretStorage (OS-backed)
 *          ├─ ChatViewProvider — sidebar webview (chat UI)
 *          ├─ InlineEditProvider — Cmd-K inline edit command
 *          └─ ProviderStatusBar — status bar item (active LLM + health)
 */

import * as vscode from "vscode";
import { SidecarManager } from "./sidecar";
import { KeychainService } from "./keychain";
import { ChatViewProvider } from "./agent/chatProvider";
import { registerChatParticipant } from "./agent/chatParticipant";
import { registerLanguageModelProvider } from "./agent/languageModel";
import { registerInlineEditCommand } from "./agent/inlineEdit";
import { ProviderStatusBar } from "./agent/providerStatus";
import { maybePromptForCloudKeys, syncProviderKeysToBackend } from "./agent/providerSync";
import { registerMcpSettings } from "./agent/mcpSettings";

let sidecar: SidecarManager | undefined;
let statusBar: ProviderStatusBar | undefined;

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

  const chatProvider = new ChatViewProvider(context, backendUrl, keychain);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("aipiloty.chatView", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // VS Code requires a default LM before any chat participant can run.
  registerLanguageModelProvider(context, backendUrl, keychain);
  registerChatParticipant(context, backendUrl, keychain);
  registerMcpSettings(context, backendUrl, keychain);

  context.subscriptions.push(
    vscode.commands.registerCommand("aipiloty.openChat", async () => {
      const ui = vscode.workspace
        .getConfiguration("aipiloty")
        .get<string>("preferredChatUi", "vscode");
      if (ui !== "sidebar") {
        try {
          await vscode.commands.executeCommand("workbench.action.chat.open");
          return;
        } catch {
          /* fall through to Activity Bar view */
        }
      }
      await vscode.commands.executeCommand("workbench.view.extension.aipiloty-sidebar");
      await vscode.commands.executeCommand("aipiloty.chatView.focus");
    }),

    vscode.commands.registerCommand("aipiloty.newChat", () => {
      chatProvider.newSession();
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
      const providers = ["claude (Anthropic)", "openai (OpenAI)", "gemini (Google)"];
      const pick = await vscode.window.showQuickPick(providers, {
        placeHolder: "Select provider to configure",
      });
      if (!pick) return;

      const providerId = pick.split(" ")[0] as "claude" | "openai" | "gemini";
      const keyMap: Record<string, string> = {
        claude: "anthropic_api_key",
        openai: "openai_api_key",
        gemini: "gemini_api_key",
      };
      const placeholderMap: Record<string, string> = {
        claude: "sk-ant-…",
        openai: "sk-…",
        gemini: "AIza…",
      };

      const key = await vscode.window.showInputBox({
        prompt: `Enter API key for ${providerId}`,
        placeHolder: placeholderMap[providerId],
        password: true,
        validateInput: (v) => (v.length < 8 ? "Key too short" : null),
      });
      if (!key) return;

      await keychain.set(`aipiloty.${providerId}_api_key`, key);

      try {
        await fetch(`${backendUrl}/api/v1/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": await keychain.getApiKey(),
          },
          body: JSON.stringify({ [keyMap[providerId]]: key }),
        });
        vscode.window.showInformationMessage(
          `${providerId} API key saved. ProviderRouter will use it on the next request.`
        );
        statusBar?.refresh();
      } catch {
        vscode.window.showWarningMessage(
          "Key saved locally. Could not reach backend to hot-patch — restart backend to apply."
        );
      }
    })
  );

  registerInlineEditCommand(context, backendUrl, keychain);

  context.subscriptions.push(
    vscode.commands.registerCommand("aipiloty.explainSelection", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const text = editor.document.getText(editor.selection);
      if (!text.trim()) {
        vscode.window.showInformationMessage("Select some code first");
        return;
      }
      chatProvider.sendMessage(
        `Explain this code:\n\`\`\`${editor.document.languageId}\n${text}\n\`\`\``
      );
      void vscode.commands.executeCommand("aipiloty.openChat");
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
