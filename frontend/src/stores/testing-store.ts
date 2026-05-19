/**
 * Testing Zustand store
 *
 * SECURITY: auth_header is held in-memory only — never persisted,
 * never logged, never serialised outside of the live API call body.
 */

import { create } from "zustand";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api/v1";
const API_KEY  = process.env.NEXT_PUBLIC_API_KEY  || "aipiloty-dev-key";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Screenshot {
  image_b64: string;
  caption: string;
  step: number;
  url: string;
  timestamp: number;
}

export interface TestRun {
  id: number;
  target_id: number | null;
  status: string;
  pass_count: number;
  fail_count: number;
  skip_count: number;
  output_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  result: string;
  success: boolean;
}

export interface TestingMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  isStreaming?: boolean;
  isError?: boolean;
  timestamp: number;
}

export type TestingSystemState = "idle" | "thinking" | "tool_running" | "error";

interface TestingStore {
  // Target credentials (in-memory only — never persisted)
  targetUrl: string;
  authHeader: string;
  envLabel: string;
  username: string;
  password: string;
  probeStatus: "unknown" | "reachable" | "unreachable" | "probing";

  // Browser mirror
  screenshots: Screenshot[];
  browserSessionActive: boolean;

  // Chat
  sessionKey: string | null;
  messages: TestingMessage[];
  systemState: TestingSystemState;
  isStreaming: boolean;
  currentToolCall: string | null;
  planningSteps: string[];

  // History
  runs: TestRun[];
  activeRunId: number | null;

  // Actions — target config
  setTargetUrl: (url: string) => void;
  setAuthHeader: (header: string) => void;
  setEnvLabel: (label: string) => void;
  setUsername: (u: string) => void;
  setPassword: (p: string) => void;
  setProbeStatus: (s: TestingStore["probeStatus"]) => void;

  // Actions — chat
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  cancelStream: () => void;
  loadSession: (sessionKey: string, apiMessages: ApiMessage[]) => void;

  // Actions — runs
  loadRuns: () => Promise<void>;
  setActiveRun: (id: number | null) => void;

  // Internal
  _abortController: AbortController | null;
}

/** Shape returned by GET /chat/sessions/{key} for each message. */
export interface ApiMessage {
  role: string;
  content: string;
  /** Testing API stores tool calls as {tool, arguments, thinking?} — normalised to {name, arguments} by backend */
  tool_calls?: Array<{ name?: string; tool?: string; arguments?: Record<string, unknown> }>;
  tool_results?: Array<{ tool?: string; name?: string; result?: string; output?: string; success?: boolean }>;
  created_at?: string;
}

// ── API headers ───────────────────────────────────────────────────────────────

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("jwt_token");
    if (token) h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}

// ── URL auto-detection ────────────────────────────────────────────────────────

function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0].replace(/[.,;!?)]+$/, "") : null;
}

// ── Credential auto-detection ─────────────────────────────────────────────────

function extractCredentials(text: string): { username?: string; password?: string } | null {
  // Match patterns like: "email@domain.com mypassword" or "username: foo password: bar"
  const emailPwMatch = text.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\s+(\S{4,})/);
  if (emailPwMatch) return { username: emailPwMatch[1], password: emailPwMatch[2] };
  const labeledMatch = text.match(/username[:\s]+(\S+)\s+password[:\s]+(\S+)/i);
  if (labeledMatch) return { username: labeledMatch[1], password: labeledMatch[2] };
  return null;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useTestingStore = create<TestingStore>((set, get) => ({
  targetUrl: "",
  authHeader: "",
  envLabel: "",
  username: "",
  password: "",
  probeStatus: "unknown",

  screenshots: [],
  browserSessionActive: false,

  sessionKey: null,
  messages: [],
  systemState: "idle",
  isStreaming: false,
  currentToolCall: null,
  planningSteps: [],

  runs: [],
  activeRunId: null,

  _abortController: null,

  // ── Target config ─────────────────────────────────────────────────────────
  setTargetUrl: (url) => set({ targetUrl: url, probeStatus: "unknown" }),
  setAuthHeader: (header) => set({ authHeader: header }),
  setEnvLabel: (label) => set({ envLabel: label }),
  setUsername: (u) => set({ username: u }),
  setPassword: (p) => set({ password: p }),
  setProbeStatus: (s) => set({ probeStatus: s }),

  cancelStream: () => {
    const { _abortController } = get();
    if (_abortController) {
      _abortController.abort();
      set({ isStreaming: false, systemState: "idle", _abortController: null, currentToolCall: null });
    }
  },

  // ── Chat ──────────────────────────────────────────────────────────────────
  sendMessage: async (content) => {
    const state = get();
    if (state.isStreaming || !content.trim()) return;

    // Auto-detect URL from message if targetUrl not set
    let { targetUrl } = state;
    if (!targetUrl) {
      const detected = extractUrl(content);
      if (detected) {
        targetUrl = detected;
        set({ targetUrl: detected, probeStatus: "unknown" });
      }
    }

    // Auto-detect credentials from message (e.g. "email@domain.com Password123")
    if (!state.username || !state.password) {
      const creds = extractCredentials(content);
      if (creds) {
        if (creds.username) set({ username: creds.username });
        if (creds.password) set({ password: creds.password });
      }
    }

    const userMsg: TestingMessage = { role: "user", content, timestamp: Date.now() };
    const assistantMsg: TestingMessage = {
      role: "assistant",
      content: "",
      toolCalls: [],
      toolResults: [],
      isStreaming: true,
      timestamp: Date.now(),
    };

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      isStreaming: true,
      systemState: "thinking",
      planningSteps: [],
      currentToolCall: null,
    }));

    const { authHeader, envLabel, sessionKey, username, password } = get();

    const payload = {
      messages: [{ role: "user", content }],
      testing_context: {
        url: targetUrl,
        auth_header: authHeader || undefined,
        env_label: envLabel,
        username: username || undefined,
        password: password || undefined,
      },
      session_key: sessionKey,
    };

    const controller = new AbortController();
    set({ _abortController: controller });

    const _appendToLastAssistant = (updater: (msg: TestingMessage) => TestingMessage) => {
      set((s) => {
        const msgs = [...s.messages];
        const idx = msgs.length - 1;
        if (idx >= 0 && msgs[idx].role === "assistant") {
          msgs[idx] = updater(msgs[idx]);
        }
        return { messages: msgs };
      });
    };

    try {
      const res = await fetch(`${API_BASE}/testing/chat/stream`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errMap: Record<number, string> = {
          401: "Authentication failed — check your API key or log in again.",
          403: "Not authorised for this action.",
          422: "Invalid request — check your inputs.",
          429: "Rate limited — wait a moment and retry.",
          500: "Backend error — check server logs.",
          503: "Testing agent not ready — backend may still be starting.",
        };
        throw new Error(errMap[res.status] || `Server returned ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const ev = JSON.parse(raw);
            const { type, data } = ev;

            if (type === "session") {
              set({ sessionKey: data.session_key });

            } else if (type === "planning") {
              set({ systemState: "thinking", planningSteps: data.steps ?? [] });

            } else if (type === "token") {
              const token: string = data.token ?? "";
              _appendToLastAssistant((m) => ({ ...m, content: m.content + token }));

            } else if (type === "tool_start") {
              set({ systemState: "tool_running", currentToolCall: data.tool });
              _appendToLastAssistant((m) => ({
                ...m,
                toolCalls: [...(m.toolCalls ?? []), { tool: data.tool, arguments: data.arguments ?? {} }],
              }));

            } else if (type === "tool_end") {
              set({ currentToolCall: null, systemState: "thinking" });
              _appendToLastAssistant((m) => ({
                ...m,
                toolResults: [
                  ...(m.toolResults ?? []),
                  { tool: data.tool, result: data.result ?? "", success: !!data.success },
                ],
              }));

            } else if (type === "screenshot") {
              const shot: Screenshot = {
                image_b64: data.image_b64 ?? "",
                caption: data.caption ?? "",
                step: data.step ?? 0,
                url: data.url ?? "",
                timestamp: Date.now(),
              };
              set((s) => ({
                screenshots: [...s.screenshots, shot],
                browserSessionActive: true,
              }));

            } else if (type === "done") {
              _appendToLastAssistant((m) => ({ ...m, isStreaming: false }));
              set({ isStreaming: false, systemState: "idle", currentToolCall: null, _abortController: null });
              get().loadRuns();

            } else if (type === "error") {
              const errMsg = data.message ?? "An unexpected error occurred.";
              _appendToLastAssistant((m) => ({
                ...m,
                content: m.content || `⚠️ ${errMsg}`,
                isError: true,
                isStreaming: false,
              }));
              set({ isStreaming: false, systemState: "error", currentToolCall: null, _abortController: null });
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        _appendToLastAssistant((m) => ({ ...m, content: m.content || "Cancelled.", isStreaming: false }));
      } else {
        const msg = (err as Error)?.message ?? "Connection error";
        _appendToLastAssistant((m) => ({
          ...m,
          content: m.content || `⚠️ ${msg}`,
          isError: true,
          isStreaming: false,
        }));
      }
      set({ isStreaming: false, systemState: "idle", currentToolCall: null, _abortController: null });
    }
  },

  clearMessages: () => set({
    messages: [],
    sessionKey: null,
    systemState: "idle",
    planningSteps: [],
    screenshots: [],
    browserSessionActive: false,
  }),

  loadSession: (sessionKey, apiMessages) => set({
    sessionKey,
    isStreaming: false,
    systemState: "idle",
    currentToolCall: null,
    planningSteps: [],
    screenshots: [],
    browserSessionActive: false,
    messages: apiMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m): TestingMessage => ({
        role: m.role as "user" | "assistant",
        content: m.content ?? "",
        isStreaming: false,
        timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
        toolCalls: Array.isArray(m.tool_calls)
          ? m.tool_calls.map((tc) => ({
              // backend normalises to {name, arguments}, but testing saved {tool, arguments}
              tool: (tc.name ?? tc.tool ?? "") as string,
              arguments: (tc.arguments ?? {}) as Record<string, unknown>,
            }))
          : undefined,
        toolResults: Array.isArray(m.tool_results)
          ? m.tool_results.map((tr) => ({
              tool: (tr.tool ?? tr.name ?? "") as string,
              result: (tr.result ?? tr.output ?? "") as string,
              success: tr.success !== false,
            }))
          : undefined,
      })),
  }),

  // ── Runs ──────────────────────────────────────────────────────────────────
  loadRuns: async () => {
    try {
      const res = await fetch(`${API_BASE}/testing/runs`, { headers: apiHeaders() });
      if (!res.ok) return;
      const data: TestRun[] = await res.json();
      set((s) => ({
        runs: data,
        // Auto-activate the most recent run if streaming just finished
        activeRunId: data.length > 0 && s.activeRunId === null ? data[0].id : s.activeRunId,
      }));
    } catch {
      // non-fatal
    }
  },

  setActiveRun: (id) => set({ activeRunId: id }),
}));
