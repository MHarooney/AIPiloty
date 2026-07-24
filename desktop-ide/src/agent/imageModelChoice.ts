/**
 * Parse generate_image tool payloads for model-choice / API-key gates
 * (matches aipiloty/frontend ImageModelChoiceCard).
 *
 * Pending choice is persisted in workspaceState so button clicks still work
 * after the chat response finishes (in-memory alone was getting cleared).
 */

import type * as vscode from "vscode";

export interface ImageModelOption {
  id: string;
  provider: string;
  label: string;
  description?: string;
  available?: boolean;
}

export interface ImageChoicePayload {
  status: "needs_model_choice" | "needs_api_key" | string;
  message?: string;
  options?: ImageModelOption[];
  hint?: string;
}

export interface GeneratedImagePayload {
  relative_path?: string;
  download_url?: string;
  model?: string;
  provider?: string;
  success?: boolean;
}

export interface PendingImageChoice {
  prompt: string;
  options: ImageModelOption[];
  status: string;
  message?: string;
}

const PENDING_KEY = "aipiloty.pendingImageChoice";

let memoryPending: PendingImageChoice | null = null;
let storage: vscode.Memento | undefined;

/** Call once from extension activate / registerChatParticipant. */
export function bindImageChoiceStorage(memento: vscode.Memento): void {
  storage = memento;
  const stored = memento.get<PendingImageChoice>(PENDING_KEY);
  if (stored?.status === "needs_model_choice") {
    memoryPending = stored;
  }
}

export function setPendingImageChoice(value: PendingImageChoice | null): void {
  memoryPending = value;
  void storage?.update(PENDING_KEY, value ?? undefined);
}

export function getPendingImageChoice(): PendingImageChoice | null {
  if (memoryPending?.status === "needs_model_choice") {
    return memoryPending;
  }
  const stored = storage?.get<PendingImageChoice>(PENDING_KEY);
  if (stored?.status === "needs_model_choice") {
    memoryPending = stored;
    return stored;
  }
  return null;
}

/** Fallback catalog when pending state was lost but user still clicks the picker. */
export const FALLBACK_IMAGE_MODELS: ImageModelOption[] = [
  { id: "gpt-image-1", provider: "openai", label: "GPT Image 1", available: true },
  { id: "dall-e-3", provider: "openai", label: "DALL·E 3", available: true },
  {
    id: "gemini-2.5-flash-image",
    provider: "gemini",
    label: "Gemini Nano Banana",
    available: true,
  },
  {
    id: "gemini-3.1-flash-image",
    provider: "gemini",
    label: "Gemini Nano Banana 2",
    available: true,
  },
];

function unwrapRoot(raw: unknown): Record<string, unknown> | null {
  let cur: unknown = raw;
  for (let i = 0; i < 4; i++) {
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
      } catch {
        return null;
      }
      continue;
    }
    if (!cur || typeof cur !== "object") {
      return null;
    }
    const obj = cur as Record<string, unknown>;
    if (typeof obj.status === "string") {
      return obj;
    }
    if ("output" in obj) {
      cur = obj.output;
      continue;
    }
    if (obj.success === true && (obj.relative_path || obj.download_url)) {
      return obj;
    }
    return null;
  }
  return null;
}

export function parseImageChoicePayload(output?: string): ImageChoicePayload | null {
  if (!output) {
    return null;
  }
  try {
    const root = unwrapRoot(output);
    if (!root || typeof root.status !== "string") {
      return null;
    }
    if (root.status !== "needs_model_choice" && root.status !== "needs_api_key") {
      return null;
    }
    return {
      status: root.status,
      message: typeof root.message === "string" ? root.message : undefined,
      hint: typeof root.hint === "string" ? root.hint : undefined,
      options: Array.isArray(root.options)
        ? (root.options as ImageModelOption[]).filter((o) => o && typeof o.id === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export function parseGeneratedImagePayload(output?: string): GeneratedImagePayload | null {
  if (!output) {
    return null;
  }
  try {
    const root = unwrapRoot(output);
    if (!root) {
      return null;
    }
    if (root.success === false) {
      return null;
    }
    const relative =
      typeof root.relative_path === "string" ? root.relative_path : undefined;
    const download =
      typeof root.download_url === "string" ? root.download_url : undefined;
    if (!relative && !download) {
      return null;
    }
    return {
      success: true,
      relative_path: relative,
      download_url: download,
      model: typeof root.model === "string" ? root.model : undefined,
      provider: typeof root.provider === "string" ? root.provider : undefined,
    };
  } catch {
    return null;
  }
}

export function buildImageModelFollowUp(modelId: string, originalPrompt?: string): string {
  const prompt = (originalPrompt || "").trim();
  return prompt
    ? `Generate the image now using model "${modelId}" (do not ask again). Prompt: ${prompt}`
    : `Generate the image now using model "${modelId}" (do not ask again).`;
}

export const CHOOSE_IMAGE_MODEL_CMD = "aipiloty.chat.chooseImageModel";
export const PICK_IMAGE_MODEL_CMD = "aipiloty.chat.pickImageModel";
export const OPEN_IMAGE_SETTINGS_CMD = "aipiloty.chat.openImageSettings";
