/**
 * SSE streaming client for AIPiloty backend.
 *
 * Connects to POST /api/v1/chat/stream and emits typed events.
 * Works in Node.js (VS Code extension host) using http/https modules.
 */

import * as https from "https";
import * as http from "http";
import { URL } from "url";
import type { KeychainService } from "../keychain";

export type SSEEventType =
  | "session"
  | "token"
  | "thinking"
  | "planning"
  | "tool_start"
  | "tool_output"
  | "tool_error"
  | "provider_switched"
  | "provider_health"
  | "approval_required"
  | "risk_analysis"
  | "confidence"
  | "final_report"
  | "progress"
  | "log"
  | "error"
  | "done"
  | "cancelled";

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamOptions {
  messages: ChatMessage[];
  sessionKey?: string;
  model?: string;
  mode?: "auto" | "ask" | "agent" | "plan" | "debug";
  autoApprove?: boolean;
  onEvent: (event: SSEEvent) => void;
  signal?: AbortSignal;
}

/**
 * Stream a chat request to the AIPiloty backend.
 * Calls onEvent for each SSE event received.
 * Returns a promise that resolves when the stream ends.
 */
export async function streamChat(
  backendUrl: string,
  keychain: KeychainService,
  opts: StreamOptions
): Promise<void> {
  const { messages, sessionKey, model, mode = "auto", autoApprove = false, onEvent, signal } = opts;

  const headers = await keychain.backendHeaders();
  const body = JSON.stringify({
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    session_key: sessionKey,
    model: model ?? null,
    mode,
    auto_approve: autoApprove,
  });

  const parsed = new URL(backendUrl);
  const httpModule = parsed.protocol === "https:" ? https : http;
  const reqOptions: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10),
    path: "/api/v1/chat/stream",
    method: "POST",
    headers: {
      ...headers,
      "Accept": "text/event-stream",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted"));

    const req = httpModule.request(reqOptions, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }

      let buffer = "";

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") { resolve(); return; }
          try {
            const parsed = JSON.parse(raw) as { type: string; data: Record<string, unknown> };
            onEvent({ type: parsed.type as SSEEventType, data: parsed.data ?? {} });
            if (parsed.type === "done" || parsed.type === "cancelled") {
              resolve();
            }
          } catch {
            // Ignore malformed lines
          }
        }
      });

      res.on("end", () => resolve());
      res.on("error", reject);
    });

    req.on("error", reject);

    signal?.addEventListener("abort", () => {
      req.destroy();
      reject(new Error("Aborted"));
    });

    req.write(body);
    req.end();
  });
}

/** Fetch provider health synchronously (fire-and-forget helper). */
export async function getProviderHealth(
  backendUrl: string,
  keychain: KeychainService
): Promise<{ active: string; chain: string[]; health: Record<string, unknown> } | null> {
  const headers = await keychain.backendHeaders();
  const parsed = new URL(backendUrl);
  const httpModule = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    const req = httpModule.request(
      {
        hostname: parsed.hostname,
        port: parseInt(parsed.port || "80", 10),
        path: "/api/v1/providers/llm/health",
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => { body += c.toString(); });
        res.on("end", () => {
          try {
            const data = JSON.parse(body) as {
              active?: string;
              chain?: string[];
              health?: Record<string, unknown>;
              detail?: unknown;
            };
            if (!data || typeof data !== "object" || data.detail) {
              resolve(null);
              return;
            }
            resolve({
              active: data.active ?? "unknown",
              chain: Array.isArray(data.chain) ? data.chain : [],
              health: data.health ?? {},
            });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.setTimeout(3_000, () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
    req.end();
  });
}
