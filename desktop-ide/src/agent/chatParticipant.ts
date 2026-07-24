/**
 * Registers AIPiloty as the default VS Code Chat participant (right-side Chat panel).
 * Modes: slash commands (/agent /ask /plan /debug) or status-bar / ⇧Tab selection.
 *
 * Image generation: when the backend returns needs_model_choice (like the web UI),
 * we prompt with QuickPick + trusted markdown links + chat followups (stream.button
 * args are unreliable across the CommandsConverter cache).
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { KeychainService } from "../keychain";
import { promptAndResumeAfterApproval, shouldAutoApprove } from "./approvals";
import {
  ChatModeService,
  resolveModeFromCommand,
  type AgentMode,
} from "./chatMode";
import type { ChatModelService } from "./chatModel";
import {
  clearBackendSessionKey,
  getBackendSessionKey,
  setBackendSessionKey,
} from "./backendSession";
import {
  bindImageChoiceStorage,
  buildImageModelFollowUp,
  CHOOSE_IMAGE_MODEL_CMD,
  FALLBACK_IMAGE_MODELS,
  getPendingImageChoice,
  OPEN_IMAGE_SETTINGS_CMD,
  parseGeneratedImagePayload,
  parseImageChoicePayload,
  PICK_IMAGE_MODEL_CMD,
  setPendingImageChoice,
  type ImageChoicePayload,
  type ImageModelOption,
} from "./imageModelChoice";
import { streamChat, type ChatMessage, type SSEEvent } from "./streaming";

const PARTICIPANT_ID = "aipiloty.agent";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** VS Code may pass markdown command args as (id, prompt), [id, prompt], or {id,prompt}. */
function parseChooseImageArgs(rawArgs: unknown[]): {
  modelId?: string;
  prompt: string;
} {
  const pending = getPendingImageChoice();
  let modelId: string | undefined;
  let prompt = pending?.prompt || "";

  const first = rawArgs[0];
  if (typeof first === "string" && first.trim()) {
    modelId = first.trim();
    if (typeof rawArgs[1] === "string" && rawArgs[1].trim()) {
      prompt = rawArgs[1].trim();
    }
  } else if (Array.isArray(first)) {
    if (typeof first[0] === "string") {
      modelId = first[0];
    }
    if (typeof first[1] === "string" && first[1].trim()) {
      prompt = first[1].trim();
    }
  } else if (first && typeof first === "object") {
    const o = first as Record<string, unknown>;
    if (typeof o.modelId === "string") {
      modelId = o.modelId;
    } else if (typeof o.id === "string") {
      modelId = o.id;
    }
    if (typeof o.prompt === "string" && o.prompt.trim()) {
      prompt = o.prompt.trim();
    } else if (typeof o.originalPrompt === "string" && o.originalPrompt.trim()) {
      prompt = o.originalPrompt.trim();
    }
  }

  return { modelId, prompt };
}

/** Match web sendQuickPrompt: continue same backend session with only the latest user turn. */
function messagesForBackend(
  all: ChatMessage[],
  existingSession: string | undefined
): ChatMessage[] {
  if (!all.length) {
    return all;
  }
  if (existingSession) {
    const last = all[all.length - 1]!;
    const prev = all[all.length - 2];
    // Keep a scope system message that belongs to this turn (attachments).
    if (prev?.role === "system") {
      return [prev, last];
    }
    return [last];
  }
  return all;
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  backendUrl: string,
  keychain: KeychainService,
  chatMode: ChatModeService,
  chatModel?: ChatModelService
): void {
  bindImageChoiceStorage(context.workspaceState);

  context.subscriptions.push(
    vscode.commands.registerCommand(CHOOSE_IMAGE_MODEL_CMD, async (...rawArgs: unknown[]) => {
      const { modelId, prompt } = parseChooseImageArgs(rawArgs);
      if (!modelId) {
        await pickAndSubmitImageModel();
        return;
      }
      await submitImageModelChoice(modelId, prompt);
    }),
    vscode.commands.registerCommand(PICK_IMAGE_MODEL_CMD, async () => {
      await pickAndSubmitImageModel();
    }),
    vscode.commands.registerCommand(OPEN_IMAGE_SETTINGS_CMD, async () => {
      try {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "aipiloty"
        );
      } catch {
        void vscode.window.showInformationMessage(
          "Add an OpenAI or Gemini image API key in AIPiloty Settings."
        );
      }
      try {
        await vscode.commands.executeCommand("aipiloty.setProviderKey");
      } catch {
        /* optional */
      }
    }),
    vscode.commands.registerCommand("aipiloty.clearBackendChatSession", async () => {
      await clearBackendSessionKey(context);
    })
  );

  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    async (request, chatContext, stream, token) => {
      const allMessages = await buildMessages(request, chatContext);
      const storedSession = getBackendSessionKey(context);
      const messages = messagesForBackend(allMessages, storedSession);
      const mode: AgentMode = resolveModeFromCommand(
        request.command,
        chatMode.current
      );
      if (request.command) {
        chatMode.setMode(mode);
      }

      // Image generation must run without blocking on Approvals (matches web)
      const isImageFollowUp = /using model\s+[\"']?[a-z0-9._-]+/i.test(
        request.prompt
      );
      if (isImageFollowUp) {
        // Clear only once the follow-up actually reaches the agent
        setPendingImageChoice(null);
      }
      const autoApprove =
        shouldAutoApprove(mode) ||
        isImageFollowUp ||
        /generate.*(image|cover|illustration)/i.test(request.prompt);

      let sessionKey = storedSession || "";
      let lastImagePrompt = "";
      const imageChoiceState: { value: ImageChoicePayload | null } = { value: null };
      const abort = toAbortSignal(token);
      const pendingRenders: Promise<void>[] = [];

      const handleEvent = (event: SSEEvent) => {
        if (token.isCancellationRequested) return;
        if (event.type === "tool_start") {
          const tool = String(event.data["tool"] ?? event.data["name"] ?? "");
          const args = event.data["arguments"];
          if (tool === "generate_image" && args && typeof args === "object") {
            const prompt = (args as { prompt?: unknown }).prompt;
            if (typeof prompt === "string" && prompt.trim()) {
              lastImagePrompt = prompt.trim();
            }
          }
        }
        if (event.type === "tool_output") {
          const tool = String(event.data["tool"] ?? event.data["name"] ?? "");
          const out = String(event.data["output"] ?? event.data["content"] ?? "");
          if (tool === "generate_image") {
            const choice = parseImageChoicePayload(out);
            if (choice) {
              imageChoiceState.value = choice;
              setPendingImageChoice({
                prompt: lastImagePrompt,
                options: choice.options || [],
                status: choice.status,
                message: choice.message,
              });
            } else if (parseGeneratedImagePayload(out)) {
              setPendingImageChoice(null);
            }
          }
        }
        const maybe = renderEvent(stream, event, {
          backendUrl,
          keychain,
          lastImagePrompt,
        });
        if (maybe) {
          pendingRenders.push(maybe);
        }
        if (event.type === "session" && event.data["session_key"]) {
          sessionKey = String(event.data["session_key"]);
          void setBackendSessionKey(context, sessionKey);
        }
      };

      try {
        const modeLabel =
          mode === "ask"
            ? "Ask"
            : mode === "plan"
              ? "Plan"
              : mode === "debug"
                ? "Debug"
                : "Agent";
        stream.progress(`AIPiloty · ${modeLabel}…`);
        const modelLabel =
          !chatModel || chatModel.current === "auto"
            ? "Auto"
            : chatModel.current;
        stream.markdown(`_Mode: **${modeLabel}** · Model: **${modelLabel}**_\n\n`);

        let pendingApproval: SSEEvent | undefined;

        await streamChat(backendUrl, keychain, {
          messages,
          sessionKey: sessionKey || undefined,
          model: chatModel?.streamModel,
          mode,
          autoApprove,
          signal: abort,
          onEvent: (event) => {
            handleEvent(event);
            if (event.type === "approval_required") {
              pendingApproval = event;
            }
            if (event.type === "provider_switched") {
              const to = String(event.data["to"] ?? "");
              if (to) {
                stream.markdown(`\n_Switched provider → **${to}**_\n`);
              }
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

        await Promise.allSettled(pendingRenders);

        // Do not auto-open QuickPick — it raced with chat.acceptInput (requestInProgress)
        // and cleared pending before the follow-up could run. User picks via links/button.
        const imageChoice = imageChoiceState.value;

        return {
          metadata: {
            imageChoice: imageChoice
              ? {
                  status: imageChoice.status,
                  message: imageChoice.message,
                  options: imageChoice.options || [],
                  prompt: lastImagePrompt,
                }
              : undefined,
            sessionKey: sessionKey || undefined,
          },
        };
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
    provideFollowups: (result) => {
      const meta = result?.metadata?.imageChoice as
        | {
            status?: string;
            message?: string;
            options?: ImageChoicePayload["options"];
            prompt?: string;
          }
        | undefined;
      if (meta?.status === "needs_model_choice") {
        return buildImageChoiceFollowups(
          {
            status: meta.status,
            options: meta.options || [],
            message: meta.message,
          },
          meta.prompt || ""
        );
      }
      const pending = getPendingImageChoice();
      if (pending?.status === "needs_model_choice" && pending.options.length) {
        return buildImageChoiceFollowups(
          { status: pending.status, options: pending.options, message: pending.message },
          pending.prompt
        );
      }
      const cur = chatMode.current;
      const followups: vscode.ChatFollowup[] = [
        { prompt: "/agent Continue in Agent mode", label: "∞ Agent", participant: PARTICIPANT_ID, command: "agent" },
        { prompt: "/ask Answer in Ask mode (read-only)", label: "Ask", participant: PARTICIPANT_ID, command: "ask" },
        { prompt: "/plan Make a plan first", label: "Plan", participant: PARTICIPANT_ID, command: "plan" },
        { prompt: "/debug Debug this", label: "Debug", participant: PARTICIPANT_ID, command: "debug" },
      ];
      const order = ["agent", "plan", "debug", "ask"] as const;
      followups.sort((a, b) => {
        const ai = order.indexOf((a.command || "") as (typeof order)[number]);
        const bi = order.indexOf((b.command || "") as (typeof order)[number]);
        if (a.command === cur) return -1;
        if (b.command === cur) return 1;
        return ai - bi;
      });
      return followups;
    },
  };

  context.subscriptions.push(participant);
}

async function pickAndSubmitImageModel(): Promise<void> {
  const pending = getPendingImageChoice();
  const options: ImageModelOption[] =
    pending?.status === "needs_model_choice" && pending.options.length
      ? pending.options
      : FALLBACK_IMAGE_MODELS;
  const prompt = pending?.prompt || "";

  const items = options.map((opt) => ({
    label: opt.available === false ? `$(key) ${opt.label}` : opt.label,
    description: opt.provider,
    detail: opt.available === false
      ? "Add API key in Settings"
      : opt.description || opt.id,
    opt,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Choose an image model",
    placeHolder: pending?.message || "Select a model to continue generation",
    ignoreFocusOut: true,
  });
  if (!picked) {
    return;
  }
  if (picked.opt.available === false) {
    await vscode.commands.executeCommand(OPEN_IMAGE_SETTINGS_CMD);
    return;
  }
  await submitImageModelChoice(picked.opt.id, prompt);
}

async function submitImageModelChoice(
  modelId: string,
  originalPrompt: string
): Promise<void> {
  const pending = getPendingImageChoice();
  const prompt = (originalPrompt || pending?.prompt || "").trim();
  const query = buildImageModelFollowUp(modelId, prompt);

  // Ensure pending exists so we can detect when the follow-up actually starts
  // (handler clears pending on isImageFollowUp).
  if (!getPendingImageChoice()) {
    setPendingImageChoice({
      prompt,
      options: FALLBACK_IMAGE_MODELS,
      status: "needs_model_choice",
      message: "Select a model to continue generation.",
    });
  }

  void vscode.window.setStatusBarMessage(
    `AIPiloty: waiting to start ${modelId}…`,
    12000
  );

  // chat.open/acceptInput silently no-ops while a request is still in progress.
  // Retry until our participant starts (pending cleared) or we give up.
  for (let attempt = 0; attempt < 16; attempt++) {
    if (attempt > 0) {
      await sleep(400);
    }
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", {
        query,
        isPartialQuery: false,
      });
    } catch (err) {
      console.warn("[aipiloty] chat.open accept failed", err);
    }

    await sleep(200);
    if (!getPendingImageChoice()) {
      void vscode.window.setStatusBarMessage(
        `AIPiloty: generating with ${modelId}…`,
        8000
      );
      return;
    }
  }

  // Fallback: put the follow-up in the input so Enter works once idle
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query,
      isPartialQuery: true,
    });
    void vscode.window.showInformationMessage(
      `Selected ${modelId}. Press Enter in Chat to generate the image.`
    );
    return;
  } catch (err) {
    console.warn("[aipiloty] chat.open partial failed", err);
  }

  await vscode.env.clipboard.writeText(query);
  const open = "Paste in Chat";
  const choice = await vscode.window.showWarningMessage(
    `Selected ${modelId}. Chat submit failed — prompt copied to clipboard.`,
    open
  );
  if (choice === open) {
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open");
    } catch {
      /* ignore */
    }
  }
}

function buildImageChoiceFollowups(
  choice: ImageChoicePayload | null,
  originalPrompt: string
): vscode.ChatFollowup[] {
  if (!choice || choice.status !== "needs_model_choice") {
    return [];
  }
  return (choice.options || [])
    .filter((o) => o.available !== false)
    .map((o) => ({
      label: o.label,
      prompt: buildImageModelFollowUp(o.id, originalPrompt),
      participant: PARTICIPANT_ID,
      tooltip: o.description || o.id,
    }));
}

interface RenderContext {
  backendUrl: string;
  keychain: KeychainService;
  lastImagePrompt: string;
}

function renderEvent(
  stream: vscode.ChatResponseStream,
  event: SSEEvent,
  ctx: RenderContext
): Promise<void> | void {
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
              : String(
                  (s as { title?: string; text?: string }).title ??
                    (s as { text?: string }).text ??
                    s
                );
          return `${i + 1}. ${label}`;
        });
        stream.markdown(`\n\n**Plan**\n${lines.join("\n")}\n\n`);
      } else if (event.data["content"]) {
        stream.markdown(`\n\n**Plan**\n${String(event.data["content"])}\n\n`);
      }
      break;
    }
    case "tool_start":
      stream.progress(`Running: ${String(event.data["name"] ?? event.data["tool"] ?? "tool")}…`);
      break;
    case "tool_output":
      return renderToolOutput(stream, event, ctx);
    case "approval_required": {
      const tool = String(event.data["tool"] ?? "tool");
      const risk = String(event.data["risk_level"] ?? "high");
      stream.markdown(`\n\n> **${risk} risk:** \`${tool}\` needs approval.\n`);
      break;
    }
    case "provider_switched":
      stream.progress(
        `Switched provider → ${String(event.data["active"] ?? event.data["to"] ?? "…")}`
      );
      break;
    case "error":
      stream.markdown(`\n\n**Error:** ${String(event.data["message"] ?? "unknown error")}`);
      break;
    default:
      break;
  }
}

async function renderToolOutput(
  stream: vscode.ChatResponseStream,
  event: SSEEvent,
  ctx: RenderContext
): Promise<void> {
  const tool = String(event.data["tool"] ?? event.data["name"] ?? "");
  const out = String(event.data["output"] ?? event.data["content"] ?? "");

  if (tool === "generate_image") {
    const choice = parseImageChoicePayload(out);
    if (choice) {
      renderImageModelChoice(stream, choice, ctx.lastImagePrompt);
      return;
    }
    const generated = parseGeneratedImagePayload(out);
    if (generated) {
      await renderGeneratedImage(stream, generated, ctx);
      return;
    }
  }

  if (out) {
    const preview = out.length > 1500 ? `${out.slice(0, 1500)}…` : out;
    if (preview.trim().startsWith("{") || preview.trim().startsWith("[")) {
      stream.markdown(`\n\n_${tool || "tool"} finished._\n`);
    } else {
      stream.markdown(`\n\`\`\`\n${preview}\n\`\`\`\n`);
    }
  }
}

function renderImageModelChoice(
  stream: vscode.ChatResponseStream,
  choice: NonNullable<ReturnType<typeof parseImageChoicePayload>>,
  originalPrompt: string
): void {
  if (choice.status === "needs_api_key") {
    stream.markdown(
      `\n\n**Image API key required**\n\n${
        choice.message ||
        "Add an OpenAI or Gemini key in Settings to generate images."
      }\n\n`
    );
    // No-arg button — avoids CommandsConverter argument cache issues
    stream.button({
      title: "Open Image Providers",
      command: OPEN_IMAGE_SETTINGS_CMD,
    });
    return;
  }

  const options = choice.options || [];
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = {
    enabledCommands: [CHOOSE_IMAGE_MODEL_CMD, PICK_IMAGE_MODEL_CMD, OPEN_IMAGE_SETTINGS_CMD],
  };
  md.appendMarkdown(
    `\n\n**Choose an image model**\n\n${
      choice.message || "Select a model to continue generation."
    }\n\n`
  );

  for (const opt of options) {
    if (opt.available === false) {
      md.appendMarkdown(
        `- $(key) **${opt.label}** — [Add API key](command:${OPEN_IMAGE_SETTINGS_CMD})\n`
      );
      continue;
    }
    const args = encodeURIComponent(JSON.stringify([opt.id, originalPrompt]));
    md.appendMarkdown(
      `- [**${opt.label}**](command:${CHOOSE_IMAGE_MODEL_CMD}?${args}) — \`${opt.id}\`\n`
    );
  }
  md.appendMarkdown(
    `\n[Show model picker…](command:${PICK_IMAGE_MODEL_CMD})\n`
  );
  stream.markdown(md);

  // No-arg buttons (reliable) — one picker + settings
  stream.button({
    title: "Choose image model…",
    command: PICK_IMAGE_MODEL_CMD,
  });
  if (!options.some((o) => o.available !== false)) {
    stream.button({
      title: "Open Image Providers",
      command: OPEN_IMAGE_SETTINGS_CMD,
    });
  }
}

async function renderGeneratedImage(
  stream: vscode.ChatResponseStream,
  generated: NonNullable<ReturnType<typeof parseGeneratedImagePayload>>,
  ctx: RenderContext
): Promise<void> {
  const meta = [generated.model, generated.provider].filter(Boolean).join(" · ");
  stream.markdown(`\n\n**Image generated**${meta ? ` (${meta})` : ""}\n\n`);

  const rel = (generated.download_url || generated.relative_path || "")
    .replace(/^\/api\/v1\/files\/generated\//, "")
    .replace(/^generated\//, "");
  if (!rel) {
    return;
  }

  try {
    const url = `${ctx.backendUrl.replace(/\/$/, "")}/api/v1/files/generated/${rel}`;
    const headers = await ctx.keychain.backendHeaders();
    const res = await fetch(url, { headers });
    if (!res.ok) {
      stream.markdown(`_Preview unavailable (HTTP ${res.status}). File: \`${rel}\`_\n`);
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = path.extname(rel) || ".png";
    const tmp = path.join(os.tmpdir(), `aipiloty-img-${Date.now()}${ext}`);
    fs.writeFileSync(tmp, buf);
    const fileUri = vscode.Uri.file(tmp);
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.appendMarkdown(`![generated image](${fileUri.toString()})\n\n`);
    md.appendMarkdown(`[Open image](${fileUri.toString()})\n`);
    stream.markdown(md);
    stream.reference(fileUri);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stream.markdown(`_Could not load image preview: ${message}_\n`);
  }
}

async function buildMessages(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext
): Promise<ChatMessage[]> {
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

  const attached = await resolvePromptReferences(request);
  const hasAttachments = Boolean(attached.text.trim());

  // When the user @ / drag-dropped context, do NOT inject unrelated editor
  // selection from the open IDE project — that leaks sibling folders into the answer.
  let userQuestion = request.prompt;
  if (!hasAttachments) {
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      const sel = editor.document.getText(editor.selection);
      const lang = editor.document.languageId;
      userQuestion = `${request.prompt}\n\nSelected code (${lang}):\n\`\`\`${lang}\n${sel}\n\`\`\``;
    }
  }

  let prompt = userQuestion;
  if (hasAttachments) {
    const pathList =
      attached.paths.length > 0
        ? attached.paths.map((p) => `- \`${p}\``).join("\n")
        : "- (see attached material below)";
    messages.push({
      role: "system",
      content: [
        "CONTEXT SCOPE — MANDATORY",
        "The user attached specific file(s)/folder(s). Treat those as the ONLY project in scope.",
        "Rules:",
        "1. Answer ONLY about the attached paths listed below.",
        "2. Ignore the IDE workspace root, sibling folders, open editors, and any other repo not listed.",
        "3. Phrases like \"this project\" / \"this folder\" mean the attached item(s), not the whole workspace.",
        "4. Do not use tools to list/read/search outside the attached paths unless the user explicitly asks to expand scope.",
        "5. If attached material is incomplete, say what is missing — do not invent from other folders.",
        "",
        "Allowed paths:",
        pathList,
      ].join("\n"),
    });
    prompt = [
      "User question:",
      userQuestion,
      "",
      "---",
      "ATTACHED CONTEXT (sole source of truth for this turn):",
      attached.text,
    ].join("\n");
  }

  messages.push({ role: "user", content: prompt });
  return messages;
}

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "out",
  "build",
  ".next",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".turbo",
  "coverage",
]);

interface ResolvedAttachments {
  text: string;
  paths: string[];
}

async function resolvePromptReferences(
  request: vscode.ChatRequest
): Promise<ResolvedAttachments> {
  const refs = [...(request.references ?? [])];
  const parts: string[] = [];
  const paths: string[] = [];
  const seen = new Set<string>();
  const seenPaths = new Set<string>();

  const addPath = (p?: string) => {
    if (!p || seenPaths.has(p)) return;
    seenPaths.add(p);
    paths.push(p);
  };

  for (const ref of refs) {
    const label =
      ref.modelDescription ||
      (typeof (ref as { name?: string }).name === "string"
        ? (ref as { name?: string }).name
        : undefined) ||
      ref.id;
    const formatted = await formatReference(ref.value, label);
    if (formatted) {
      addPath(formatted.path);
      const key = formatted.text.slice(0, 120);
      if (!seen.has(key)) {
        seen.add(key);
        parts.push(formatted.text);
      }
    }
  }

  // Fallback: prompt still has #file:name / #folder:name but refs were lost
  if (!parts.length) {
    const fromPrompt = await resolveHashMentionsFromPrompt(request.prompt);
    for (const item of fromPrompt) {
      addPath(item.path);
      parts.push(item.text);
    }
  }

  return { text: parts.join("\n\n"), paths };
}

async function formatReference(
  value: unknown,
  name?: string
): Promise<{ text: string; path?: string } | undefined> {
  if (typeof value === "string" && value.trim()) {
    return {
      text: `[${name || "context"}]\n${value.trim().slice(0, 12_000)}`,
    };
  }

  let uri: vscode.Uri | undefined;
  let range: vscode.Range | undefined;
  if (value instanceof vscode.Uri) {
    uri = value;
  } else if (value && typeof value === "object" && "uri" in (value as object)) {
    const loc = value as vscode.Location;
    uri = loc.uri;
    range = loc.range;
  }
  if (!uri) {
    return undefined;
  }

  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.Directory) {
      return { text: await formatFolderContext(uri), path: uri.fsPath };
    }
    return { text: await formatFileContext(uri, range), path: uri.fsPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `[Missing: ${uri.fsPath}] ${msg}`, path: uri.fsPath };
  }
}

async function formatFileContext(
  uri: vscode.Uri,
  range?: vscode.Range
): Promise<string> {
  const rel = vscode.workspace.asRelativePath(uri, false);
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    let text = Buffer.from(raw).toString("utf8");
    if (looksBinary(text)) {
      return `### File: ${rel}\n_Binary or non-text file (${raw.byteLength} bytes)._`;
    }
    if (range) {
      const lines = text.split(/\r?\n/);
      const start = Math.max(0, range.start.line);
      const end = Math.min(lines.length, range.end.line + 1);
      text = lines.slice(start, end).join("\n");
      return `### File: ${rel} (lines ${start + 1}-${end})\n\`\`\`\n${truncate(text, 40_000)}\n\`\`\``;
    }
    return `### File: ${rel}\n\`\`\`\n${truncate(text, 40_000)}\n\`\`\``;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `### File: ${rel}\n_Could not read: ${msg}_`;
  }
}

async function formatFolderContext(uri: vscode.Uri): Promise<string> {
  const rel = vscode.workspace.asRelativePath(uri, false);
  const tree: string[] = [];
  const filesToSample: vscode.Uri[] = [];
  await walkFolder(uri, uri, 0, 3, tree, filesToSample, { files: 0, maxFiles: 80 });

  const prefer = [/readme/i, /package\.json$/i, /pyproject\.toml$/i, /Cargo\.toml$/i, /go\.mod$/i, /Makefile$/i, /AGENTS\.md$/i];
  const samples: string[] = [];
  const picked = new Set<string>();
  for (const re of prefer) {
    const hit = filesToSample.find((f) => re.test(f.fsPath) && !picked.has(f.fsPath));
    if (hit) {
      picked.add(hit.fsPath);
      samples.push(await formatFileContext(hit));
    }
  }
  for (const f of filesToSample) {
    if (samples.length >= 5) break;
    if (picked.has(f.fsPath)) continue;
    if (!/\.(md|ts|tsx|js|jsx|py|go|rs|java|kt|swift|json|yml|yaml|toml)$/i.test(f.fsPath)) {
      continue;
    }
    picked.add(f.fsPath);
    samples.push(await formatFileContext(f));
  }

  return [
    `### Folder: ${rel}`,
    `Absolute path: \`${uri.fsPath}\``,
    "Scope: this folder ONLY (not sibling folders in the IDE workspace).",
    "Tree (truncated):",
    "```",
    tree.join("\n") || "(empty)",
    "```",
    samples.length ? "Sample files from this folder:\n\n" + samples.join("\n\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function walkFolder(
  root: vscode.Uri,
  dir: vscode.Uri,
  depth: number,
  maxDepth: number,
  tree: string[],
  files: vscode.Uri[],
  budget: { files: number; maxFiles: number }
): Promise<void> {
  if (depth > maxDepth || budget.files >= budget.maxFiles) {
    return;
  }
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return;
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const indent = "  ".repeat(depth);
  for (const [name, type] of entries) {
    if (name.startsWith(".") && name !== ".env.example") {
      if (SKIP_DIR_NAMES.has(name) || name === ".git") continue;
    }
    if (SKIP_DIR_NAMES.has(name)) {
      tree.push(`${indent}${name}/  (skipped)`);
      continue;
    }
    const child = vscode.Uri.joinPath(dir, name);
    if (type & vscode.FileType.Directory) {
      tree.push(`${indent}${name}/`);
      await walkFolder(root, child, depth + 1, maxDepth, tree, files, budget);
    } else {
      tree.push(`${indent}${name}`);
      if (budget.files < budget.maxFiles) {
        files.push(child);
        budget.files += 1;
      }
    }
    if (tree.length > 200) {
      tree.push(`${indent}…`);
      return;
    }
  }
}

async function resolveHashMentionsFromPrompt(
  prompt: string
): Promise<Array<{ text: string; path?: string }>> {
  const re = /#(file|folder):([^\s#]+)/gi;
  const parts: Array<{ text: string; path?: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    const kind = m[1]!.toLowerCase();
    const name = m[2]!;
    const uri = await findWorkspaceUriByBasename(name, kind === "folder");
    if (!uri) {
      parts.push({
        text: `### ${kind}: ${name}\n_Could not resolve in the open workspace. Open the folder that contains it, or drag the full path._`,
      });
      continue;
    }
    parts.push({
      text:
        kind === "folder"
          ? await formatFolderContext(uri)
          : await formatFileContext(uri),
      path: uri.fsPath,
    });
  }
  return parts;
}

async function findWorkspaceUriByBasename(
  name: string,
  wantFolder: boolean
): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const wf of folders) {
    if (wantFolder && (wf.name === name || basenamePath(wf.uri.fsPath) === name)) {
      return wf.uri;
    }
    const direct = vscode.Uri.joinPath(wf.uri, name);
    try {
      const st = await vscode.workspace.fs.stat(direct);
      const isDir = !!(st.type & vscode.FileType.Directory);
      if (wantFolder === isDir) {
        return direct;
      }
    } catch {
      /* continue */
    }
  }
  // Shallow search under each workspace root
  for (const wf of folders) {
    const hit = await findNamedChild(wf.uri, name, wantFolder, 0, 4);
    if (hit) return hit;
  }
  return undefined;
}

async function findNamedChild(
  dir: vscode.Uri,
  name: string,
  wantFolder: boolean,
  depth: number,
  maxDepth: number
): Promise<vscode.Uri | undefined> {
  if (depth > maxDepth) return undefined;
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return undefined;
  }
  for (const [childName, type] of entries) {
    if (SKIP_DIR_NAMES.has(childName) || childName === ".git") continue;
    const child = vscode.Uri.joinPath(dir, childName);
    const isDir = !!(type & vscode.FileType.Directory);
    if (childName === name && isDir === wantFolder) {
      return child;
    }
    if (isDir) {
      const nested = await findNamedChild(child, name, wantFolder, depth + 1, maxDepth);
      if (nested) return nested;
    }
  }
  return undefined;
}

function basenamePath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n…[truncated]";
}

function looksBinary(text: string): boolean {
  return text.includes("\u0000");
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
