/**
 * Registers a default language-model vendor for VS Code Chat.
 *
 * VS Code refuses to invoke any chat participant until a default LM exists
 * (`getModelForRequest` → "Language model unavailable"). The real reply is
 * streamed by our chat participant via the AIPiloty backend; this provider
 * satisfies the host requirement and also works if something calls lm.sendRequest.
 */

import * as vscode from "vscode";
import type { KeychainService } from "../keychain";
import { streamChat, type ChatMessage } from "./streaming";

/** vscode.lm.registerChatModelProvider is a proposed API (chatProvider). */
type LmApi = {
  registerChatModelProvider: (
    id: string,
    provider: {
      provideLanguageModelResponse: (
        messages: vscode.LanguageModelChatMessage[],
        options: unknown,
        extensionId: string,
        progress: vscode.Progress<{ index: number; part: unknown }>,
        token: vscode.CancellationToken
      ) => Thenable<unknown>;
      provideTokenCount: (
        text: string | vscode.LanguageModelChatMessage,
        token: vscode.CancellationToken
      ) => Thenable<number>;
    },
    metadata: {
      vendor: string;
      name: string;
      family: string;
      version: string;
      maxInputTokens: number;
      maxOutputTokens: number;
      isDefault?: boolean;
      isUserSelectable?: boolean;
    }
  ) => vscode.Disposable;
};

export function registerLanguageModelProvider(
  context: vscode.ExtensionContext,
  backendUrl: string,
  keychain: KeychainService
): void {
  const lm = (vscode as unknown as { lm: LmApi }).lm;
  if (!lm?.registerChatModelProvider) {
    console.warn("[aipiloty] vscode.lm.registerChatModelProvider unavailable");
    return;
  }

  const disposable = lm.registerChatModelProvider(
    "aipiloty-default",
    {
      async provideLanguageModelResponse(messages, _options, _extensionId, progress, token) {
        const chatMessages = toChatMessages(messages);
        let index = 0;
        await streamChat(backendUrl, keychain, {
          messages: chatMessages,
          mode: "ask",
          signal: toAbortSignal(token),
          onEvent: (event) => {
            if (token.isCancellationRequested) return;
            if (event.type !== "token") return;
            const text = String(event.data["token"] ?? event.data["content"] ?? "");
            if (!text) return;
            // LanguageModelTextPart — construct via vscode when available
            const part =
              typeof (vscode as unknown as { LanguageModelTextPart?: new (v: string) => unknown })
                .LanguageModelTextPart === "function"
                ? new (vscode as unknown as { LanguageModelTextPart: new (v: string) => unknown })
                    .LanguageModelTextPart(text)
                : text;
            progress.report({ index: index++, part });
          },
        });
      },
      async provideTokenCount(text) {
        const raw =
          typeof text === "string"
            ? text
            : text.content.map((c) => ("value" in c ? String(c.value) : "")).join("");
        return Math.max(1, Math.ceil(raw.length / 4));
      },
    },
    {
      vendor: "aipiloty",
      name: "AIPiloty",
      family: "aipiloty",
      version: "0.1.0",
      maxInputTokens: 128_000,
      maxOutputTokens: 8_192,
      isDefault: true,
      isUserSelectable: true,
    }
  );

  context.subscriptions.push(disposable);
}

function toChatMessages(messages: vscode.LanguageModelChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    const role =
      m.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
    const content = m.content
      .map((part) => ("value" in part ? String(part.value) : ""))
      .join("");
    return { role, content };
  });
}

function toAbortSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort();
  else token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}
