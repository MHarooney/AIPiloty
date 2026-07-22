/**
 * Registers AIPiloty as the default VS Code Chat participant.
 * Wires the built-in Chat UI to the FastAPI agent (not GitHub Copilot).
 */

import * as vscode from "vscode";
import type { KeychainService } from "../keychain";
import { promptAndResumeAfterApproval, shouldAutoApprove } from "./approvals";
import { streamChat, type ChatMessage, type SSEEvent } from "./streaming";

type ChatUiMode = "auto" | "ask" | "agent" | "plan" | "debug";

const PARTICIPANT_ID = "aipiloty.agent";

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  backendUrl: string,
  keychain: KeychainService
): void {
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    async (request, chatContext, stream, token) => {
      const messages = buildMessages(request, chatContext);
      const mode = resolveMode(request.command);
      const autoApprove = shouldAutoApprove(
        mode === "ask" ? "ask" : mode === "agent" ? "agent" : "auto"
      );
      let sessionKey = "";
      const abort = toAbortSignal(token);

      const handleEvent = (event: SSEEvent) => {
        if (token.isCancellationRequested) return;
        renderEvent(stream, event);
        if (event.type === "session" && event.data["session_key"]) {
          sessionKey = String(event.data["session_key"]);
        }
      };

      try {
        stream.progress(
          mode === "ask"
            ? "AIPiloty (Ask)…"
            : autoApprove
              ? "AIPiloty (Agent)…"
              : "AIPiloty (Agent) — tools may need approval…"
        );

        let pendingApproval: SSEEvent | undefined;

        await streamChat(backendUrl, keychain, {
          messages,
          mode,
          autoApprove,
          signal: abort,
          onEvent: (event) => {
            handleEvent(event);
            if (event.type === "approval_required") {
              pendingApproval = event;
            }
          },
        });

        if (pendingApproval && sessionKey && !token.isCancellationRequested) {
          stream.markdown("\n\n**Approval required** — check the dialog.\n");
          const result = await promptAndResumeAfterApproval(backendUrl, keychain, {
            sessionKey,
            messages,
            mode,
            event: pendingApproval,
            handlers: {
              signal: abort,
              onEvent: (event) => {
                handleEvent(event);
                if (event.type === "approval_required") {
                  pendingApproval = event;
                }
              },
            },
          });
          if (result === "denied") {
            stream.markdown("\n\n_Tool execution denied._\n");
          }
        }

        return {};
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "Aborted" || token.isCancellationRequested) {
          return {};
        }
        return {
          errorDetails: {
            message:
              `AIPiloty backend unreachable (${message}). ` +
              "Ensure the backend is running (`make fork` or `make dev-backend`) and try again.",
          },
        };
      }
    }
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon-sidebar.svg");
  participant.followupProvider = {
    provideFollowups: () => [
      { prompt: "Explain this file", label: "Explain file" },
      { prompt: "Suggest improvements", label: "Improve" },
      { prompt: "/agent Implement the change", label: "Agent mode" },
      { prompt: "Write tests for the selection", label: "Write tests" },
    ],
  };

  context.subscriptions.push(participant);
}

function renderEvent(
  stream: vscode.ChatResponseStream,
  event: SSEEvent
): void {
  switch (event.type) {
    case "token": {
      const t = String(event.data["token"] ?? event.data["content"] ?? "");
      if (t) stream.markdown(t);
      break;
    }
    case "thinking":
    case "progress":
      stream.progress(String(event.data["content"] ?? event.data["message"] ?? "Working…"));
      break;
    case "planning": {
      stream.progress("Planning…");
      const steps = event.data["steps"];
      if (Array.isArray(steps) && steps.length) {
        const lines = steps.map((s, i) => {
          const label =
            typeof s === "string"
              ? s
              : String((s as { title?: string; text?: string }).title
                ?? (s as { text?: string }).text
                ?? s);
          return `${i + 1}. [ ] ${label}`;
        });
        stream.markdown(`\n\n### Plan\n${lines.join("\n")}\n\n`);
      } else if (event.data["content"]) {
        stream.markdown(`\n\n### Plan\n${String(event.data["content"])}\n\n`);
      }
      break;
    }
    case "tool_start":
      stream.progress(`Running: ${String(event.data["name"] ?? event.data["tool"] ?? "tool")}…`);
      break;
    case "tool_output": {
      const out = String(event.data["output"] ?? event.data["content"] ?? "");
      if (out) stream.markdown(`\n\`\`\`\n${out.slice(0, 2000)}\n\`\`\`\n`);
      break;
    }
    case "approval_required": {
      const tool = String(event.data["tool"] ?? "tool");
      const risk = String(event.data["risk_level"] ?? "high");
      stream.markdown(`\n\n> **${risk} risk:** \`${tool}\` needs approval.\n`);
      break;
    }
    case "provider_switched":
      stream.progress(`Switched provider → ${String(event.data["active"] ?? event.data["to"] ?? "…")}`);
      break;
    case "error":
      stream.markdown(`\n\n**Error:** ${String(event.data["message"] ?? "unknown error")}`);
      break;
    default:
      break;
  }
}

function resolveMode(command: string | undefined): "auto" | "ask" | "agent" | "plan" | "debug" {
  switch (command) {
    case "explain":
      return "ask";
    case "plan":
      return "plan";
    case "debug":
      return "debug";
    case "agent":
    case "edit":
    case "tests":
      return "agent";
    default:
      return "auto";
  }
}

function buildMessages(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const turn of chatContext.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push({ role: "user", content: turn.prompt });
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .map((part) => {
          if (part instanceof vscode.ChatResponseMarkdownPart) {
            return part.value.value;
          }
          return "";
        })
        .join("");
      if (text.trim()) {
        messages.push({ role: "assistant", content: text });
      }
    }
  }

  let prompt = request.prompt;
  const editor = vscode.window.activeTextEditor;
  if (editor && !editor.selection.isEmpty) {
    const sel = editor.document.getText(editor.selection);
    const lang = editor.document.languageId;
    prompt = `${request.prompt}\n\nSelected code (${lang}):\n\`\`\`${lang}\n${sel}\n\`\`\``;
  }

  messages.push({ role: "user", content: prompt });
  return messages;
}

function toAbortSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
}
