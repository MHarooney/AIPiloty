import { create } from "zustand";
import { notifyToolStart, notifyToolDone, notifyToolError } from "@/lib/notifications";
import { streamChat } from "@/lib/api";

/* ═══════════════════════════════════════════════════════════
   TYPE DEFINITIONS
   ═══════════════════════════════════════════════════════════ */

export type AvatarPhase =
  | "idle"
  | "thinking"
  | "tool_running"
  | "success"
  | "error"
  | "waiting_approval"
  | "analyzing_risk"
  | "explaining";

export type SystemState =
  | "idle"
  | "thinking"
  | "planning"
  | "waiting_approval"
  | "executing";

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  name: string;
  output?: string;
  error?: string;
}

export interface TerminalOutput {
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  hostname: string;
  duration_ms: number;
}

export interface PendingApproval {
  tool: string;
  arguments: Record<string, any>;
  riskLevel: string;
  status: "pending" | "approved" | "denied";
  explanation?: string;
  affectedResources?: string[];
  /** The original user message that triggered this approval */
  originalMessage: string;
}

export interface PlanStep {
  label: string;
  status: "pending" | "active" | "completed";
}

export interface FinalReportFinding {
  tool: string;
  summary: string;
}

export interface FinalReportStep {
  tool: string;
  success: boolean;
  duration_ms: number;
}

export interface FinalReport {
  summary: string;
  steps: FinalReportStep[];
  findings: FinalReportFinding[];
  confidence: number;
  duration_ms: number;
  tools_used: number;
  iterations: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  terminalOutputs?: TerminalOutput[];
  pendingApproval?: PendingApproval;
  /** Persisted execution report (saved with assistant message; survives reload / history). */
  finalReport?: FinalReport;
  /** Attachments associated with this message (images/documents). */
  attachments?: ChatAttachment[];
  isStreaming?: boolean;
  timestamp: number;
}

export interface ChatAttachment {
  id: string;
  filename: string;
  mime_type: string;
  category: "image" | "document";
  /** Local preview URL (created via URL.createObjectURL) */
  previewUrl?: string;
}

export interface SSEEvent {
  type: string;
  data: any;
}

export interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
  id: string;
}

export interface TimelineStep {
  id: string;
  type: "thinking" | "tool_start" | "tool_output" | "tool_error" | "approval" | "done" | "planning";
  label: string;
  detail?: string;
  status: "active" | "completed" | "error";
  timestamp: number;
}

export type ToolPermission = "always_ask" | "auto_approve" | "block";

export type ChatMode = "agent" | "ask" | "auto";

export interface ApprovalSettings {
  autoApproveSafe: boolean;
  autoApproveSession: boolean;
  whitelist: string[];
  blacklist: string[];
  perToolRules: Record<string, ToolPermission>;
}

/* ═══════════════════════════════════════════════════════════
   STORE INTERFACE
   ═══════════════════════════════════════════════════════════ */

interface ChatState {
  messages: ChatMessage[];
  sessionKey: string | null;
  isStreaming: boolean;
  pendingApproval: ToolCall | null;
  avatarPhase: AvatarPhase;
  lastUserMessage: string;
  backgroundLogs: LogEntry[];
  executionTimeline: TimelineStep[];
  /** Files staged for the next message send. */
  pendingAttachments: ChatAttachment[];

  /* ── Chat mode ── */
  chatMode: ChatMode;

  /* ── AI OS state extensions ── */
  systemState: SystemState;
  intensityLevel: number;
  executionPlan: PlanStep[];
  approvalSettings: ApprovalSettings;
  confidenceScore: number | null;
  /** Wall-clock start of current LLM wait (for live elapsed UI during long Ollama TTFT). */
  llmWaitStartedAt: number | null;
  /**
   * True after a `thinking` SSE until `tool_start` / `planning` / approval for that turn.
   * While true, token streaming should keep UI in "thinking" (journey) — the model output
   * is still being generated before any tool runs.
   */
  pendingToolInThisTurn: boolean;

  /* ── Actions ── */
  addUserMessage: (content: string, attachments?: ChatAttachment[]) => void;
  startAssistantMessage: () => void;
  appendToken: (token: string) => void;
  finalizeAssistantMessage: () => void;
  addToolCall: (tool: ToolCall) => void;
  addToolResult: (result: ToolResult) => void;
  addTerminalOutput: (output: TerminalOutput) => void;
  setPendingApproval: (tool: ToolCall | null) => void;
  setSessionKey: (key: string) => void;
  setIsStreaming: (v: boolean) => void;
  setAvatarPhase: (phase: AvatarPhase) => void;
  setSystemState: (state: SystemState) => void;
  setIntensityLevel: (level: number) => void;
  setApprovalSettings: (settings: Partial<ApprovalSettings>) => void;
  setChatMode: (mode: ChatMode) => void;
  addPendingAttachment: (att: ChatAttachment) => void;
  removePendingAttachment: (id: string) => void;
  clearPendingAttachments: () => void;
  handleSSEEvent: (event: SSEEvent) => void;
  approveToolExecution: () => void;
  denyToolExecution: () => void;
  clearChat: () => void;
  retryLastMessage: () => void;
  sendQuickPrompt: (prompt: string) => void;
  dismissMessageFinalReport: (messageId: string) => void;
  loadSession: (
    sessionKey: string,
    messages: Array<{
      role: string;
      content: string;
      tool_calls: Array<{ name: string; arguments: Record<string, any> }>;
      tool_results: Array<Record<string, any>>;
      created_at: string;
      final_report?: Record<string, unknown> | null;
    }>
  ) => void;
  /** Try to restore the last active session from localStorage. Returns true if a key was found. */
  restoreLastSession: () => string | null;
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;

/** Normalize API / SSE final_report payload to FinalReport. */
export function normalizeFinalReport(raw: unknown): FinalReport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  return {
    summary: String(o.summary ?? ""),
    steps: Array.isArray(o.steps) ? (o.steps as FinalReport["steps"]) : [],
    findings: Array.isArray(o.findings) ? (o.findings as FinalReport["findings"]) : [],
    confidence: Number(o.confidence) || 0,
    duration_ms: Number(o.duration_ms) || 0,
    tools_used: Number(o.tools_used) || 0,
    iterations: Number(o.iterations) || 0,
  };
}

const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
  autoApproveSafe: false,
  autoApproveSession: false,
  whitelist: [],
  blacklist: [],
  perToolRules: {},
};

/**
 * Load approval settings from localStorage if available.
 */
function loadApprovalSettings(): ApprovalSettings {
  if (typeof window === "undefined") return DEFAULT_APPROVAL_SETTINGS;
  try {
    const stored = localStorage.getItem("aipiloty_approval_settings");
    if (stored) return { ...DEFAULT_APPROVAL_SETTINGS, ...JSON.parse(stored) };
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_APPROVAL_SETTINGS;
}

/**
 * Persist approval settings to localStorage.
 */
function saveApprovalSettings(settings: ApprovalSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("aipiloty_approval_settings", JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

/* ═══════════════════════════════════════════════════════════
   STORE
   ═══════════════════════════════════════════════════════════ */

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sessionKey: null,
  isStreaming: false,
  pendingApproval: null,
  avatarPhase: "idle" as AvatarPhase,
  lastUserMessage: "",
  backgroundLogs: [],
  executionTimeline: [],
  pendingAttachments: [],
  chatMode: "agent" as ChatMode,

  /* ── AI OS defaults ── */
  systemState: "idle" as SystemState,
  intensityLevel: 0,
  executionPlan: [],
  approvalSettings: loadApprovalSettings(),
  confidenceScore: null,
  llmWaitStartedAt: null,
  pendingToolInThisTurn: false,

  /* ── Message mutations ── */

  addUserMessage: (content, attachments) =>
    set((s) => ({
      lastUserMessage: content,
      confidenceScore: null,
      pendingAttachments: [],
      messages: [
        ...s.messages,
        { id: newId(), role: "user", content, attachments: attachments || undefined, timestamp: Date.now() },
      ],
    })),

  startAssistantMessage: () =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: newId(),
          role: "assistant",
          content: "",
          isStreaming: true,
          toolCalls: [],
          toolResults: [],
          timestamp: Date.now(),
        },
      ],
    })),

  appendToken: (token) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: last.content + token };
      }
      return { messages: msgs };
    }),

  finalizeAssistantMessage: () =>
    set((s) => {
      if (typeof document !== "undefined") document.title = "AIPiloty";
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, isStreaming: false };
      }
      return { messages: msgs, isStreaming: false };
    }),

  addToolCall: (tool) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          toolCalls: [...(last.toolCalls || []), tool],
        };
      }
      return { messages: msgs };
    }),

  addToolResult: (result) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          toolResults: [...(last.toolResults || []), result],
        };
      }
      return { messages: msgs };
    }),

  addTerminalOutput: (output) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = {
          ...last,
          terminalOutputs: [...(last.terminalOutputs || []), output],
        };
      }
      return { messages: msgs };
    }),

  /* ── Simple setters ── */
  setPendingApproval: (tool) => set({ pendingApproval: tool }),
  setSessionKey: (key) => {
    if (typeof window !== "undefined") {
      try { localStorage.setItem("aipiloty_last_session", key); } catch { /* ignore */ }
    }
    set({ sessionKey: key });
  },
  setIsStreaming: (v) => {
    if (typeof document !== "undefined") {
      document.title = v ? "⏳ Generating… | AIPiloty" : "AIPiloty";
    }
    set({ isStreaming: v });
  },
  setAvatarPhase: (phase) => set({ avatarPhase: phase }),
  setSystemState: (state) => set({ systemState: state }),
  setIntensityLevel: (level) => set({ intensityLevel: Math.max(0, Math.min(1, level)) }),

  setApprovalSettings: (partial) => {
    const current = get().approvalSettings;
    const updated = { ...current, ...partial };
    saveApprovalSettings(updated);
    set({ approvalSettings: updated });
  },

  setChatMode: (mode) => set({ chatMode: mode }),

  addPendingAttachment: (att) =>
    set((s) => ({ pendingAttachments: [...s.pendingAttachments, att] })),

  removePendingAttachment: (id) =>
    set((s) => ({ pendingAttachments: s.pendingAttachments.filter((a) => a.id !== id) })),

  clearPendingAttachments: () => set({ pendingAttachments: [] }),

  dismissMessageFinalReport: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, finalReport: undefined } : m
      ),
    })),

  /* ═══════════════════════════════════════════════════════════
     SSE EVENT HANDLER — The core of the AI OS reactive system
     ═══════════════════════════════════════════════════════════ */

  handleSSEEvent: (event: SSEEvent) => {
    const state = get();
    const { type, data } = event;

    switch (type) {
      case "session":
        state.setSessionKey(data.session_key);
        set({
          backgroundLogs: [],
          executionTimeline: [],
          executionPlan: [],
          confidenceScore: null,
          llmWaitStartedAt: null,
          pendingToolInThisTurn: false,
        });
        break;

      case "thinking":
        if (!state.isStreaming) {
          state.startAssistantMessage();
          state.setIsStreaming(true);
        }
        state.setAvatarPhase("thinking");
        state.setSystemState("thinking");
        state.setIntensityLevel(0.4);
        set((s) => {
          const last = s.messages[s.messages.length - 1];
          const hasPriorTools =
            last?.role === "assistant" && (last.toolCalls?.length ?? 0) > 0;
          // First LLM pass: model may emit a tool call (stay in "thinking" UI during stream).
          // After tools ran, the next pass is usually final synthesis → use "explaining" during tokens.
          return {
            pendingToolInThisTurn: !hasPriorTools,
            llmWaitStartedAt: Date.now(),
            executionTimeline: [
              ...s.executionTimeline.map((step) =>
                step.status === "active" ? { ...step, status: "completed" as const } : step
              ),
              {
                id: newId(),
                type: "thinking" as const,
                label: `Thinking (iteration ${data.iteration || "?"})`,
                status: "active" as const,
                timestamp: Date.now(),
              },
            ],
          };
        });
        break;

      case "planning":
        state.setSystemState("planning");
        state.setAvatarPhase("thinking");
        state.setIntensityLevel(0.5);
        set({ pendingToolInThisTurn: false, llmWaitStartedAt: null });
        set({
          executionPlan: (data.steps || []).map((label: string, i: number) => ({
            label,
            status: i === 0 ? "active" : "pending",
          })),
        });
        set((s) => ({
          executionTimeline: [
            ...s.executionTimeline.map((step) =>
              step.status === "active" ? { ...step, status: "completed" as const } : step
            ),
            {
              id: newId(),
              type: "planning" as const,
              label: `Planning: ${data.tool || "next step"}`,
              status: "active" as const,
              timestamp: Date.now(),
            },
          ],
        }));
        break;

      case "risk_analysis":
        state.setAvatarPhase("analyzing_risk");
        state.setIntensityLevel(0.7);
        set((s) => ({
          backgroundLogs: [
            ...s.backgroundLogs.slice(-99),
            {
              id: newId(),
              level: "warn" as const,
              message: data.explanation || `Risk analysis: ${data.risk_level}`,
              timestamp: Date.now(),
            },
          ],
        }));
        break;

      case "token":
        if (!state.isStreaming) {
          state.startAssistantMessage();
          state.setIsStreaming(true);
        }
        state.appendToken(data.token || "");
        {
          const after = get();
          if (after.pendingToolInThisTurn) {
            state.setSystemState("thinking");
            state.setAvatarPhase("thinking");
            state.setIntensityLevel(0.48);
          } else {
            state.setSystemState("executing");
            state.setAvatarPhase("explaining");
            state.setIntensityLevel(0.62);
          }
        }
        // Advance plan steps
        set((s) => ({
          executionPlan: s.executionPlan.map((step, i) => {
            if (step.status === "active") return { ...step, status: "completed" as const };
            if (step.status === "pending" && i > 0 && s.executionPlan[i - 1]?.status === "active") {
              return { ...step, status: "active" as const };
            }
            return step;
          }),
        }));
        break;

      case "tool_start":
        set({ pendingToolInThisTurn: false, llmWaitStartedAt: null });
        state.addToolCall({
          name: data.tool,
          arguments: data.arguments || {},
        });
        state.setAvatarPhase("tool_running");
        state.setSystemState("executing");
        state.setIntensityLevel(0.8);
        notifyToolStart(data.tool);
        set((s) => ({
          executionTimeline: [
            ...s.executionTimeline.map((step) =>
              step.status === "active" ? { ...step, status: "completed" as const } : step
            ),
            {
              id: newId(),
              type: "tool_start" as const,
              label: data.tool?.replace(/_/g, " ") || "Tool",
              detail: JSON.stringify(data.arguments || {}),
              status: "active" as const,
              timestamp: Date.now(),
            },
          ],
        }));
        break;

      case "tool_output":
        state.addToolResult({
          name: data.tool,
          output: typeof data.output === "string" ? data.output : JSON.stringify(data.output),
        });
        notifyToolDone(data.tool);
        set((s) => ({
          executionTimeline: s.executionTimeline.map((step) =>
            step.type === "tool_start" && step.status === "active"
              ? { ...step, status: "completed" as const }
              : step
          ),
        }));
        break;

      case "tool_error":
        state.addToolResult({
          name: data.tool,
          error: data.error,
        });
        state.setAvatarPhase("error");
        state.setIntensityLevel(0.3);
        setTimeout(() => state.setAvatarPhase("idle"), 2000);
        notifyToolError(data.tool, data.error || "Unknown error");
        set((s) => ({
          executionTimeline: s.executionTimeline.map((step) =>
            step.type === "tool_start" && step.status === "active"
              ? { ...step, status: "error" as const }
              : step
          ),
        }));
        break;

      case "terminal_output":
        state.addTerminalOutput({
          command: data.command || "",
          exit_code: data.exit_code ?? -1,
          stdout: data.stdout || "",
          stderr: data.stderr || "",
          truncated: data.truncated || false,
          hostname: data.hostname || "localhost",
          duration_ms: data.duration_ms || 0,
        });
        break;

      case "confidence":
        set({ confidenceScore: data.score });
        break;

      case "log":
        set((s) => ({
          backgroundLogs: [
            ...s.backgroundLogs.slice(-99),
            {
              id: newId(),
              level: data.level || "info",
              message: data.message || "",
              timestamp: data.timestamp || 0,
            },
          ],
        }));
        break;

      case "progress":
        set((s) => ({
          backgroundLogs: [
            ...s.backgroundLogs.slice(-99),
            {
              id: newId(),
              level: "info" as const,
              message:
                data.message ||
                `Working… iteration ${data.iteration ?? "?"} · ${data.elapsed_s ?? 0}s`,
              timestamp: Date.now(),
            },
          ],
        }));
        break;

      case "approval_required":
        set({ pendingToolInThisTurn: false, llmWaitStartedAt: null });
        state.setAvatarPhase("waiting_approval");
        state.setSystemState("waiting_approval");
        state.setIntensityLevel(0.2);
        set((s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            msgs[msgs.length - 1] = {
              ...last,
              isStreaming: false,
              pendingApproval: {
                tool: data.tool,
                arguments: data.arguments || {},
                riskLevel: data.risk_level || "high",
                status: "pending",
                explanation: data.explanation,
                affectedResources: data.affected_resources,
                originalMessage: s.lastUserMessage,
              },
            };
          }
          return { messages: msgs, isStreaming: false };
        });
        state.setPendingApproval({
          name: data.tool,
          arguments: data.arguments || {},
        });
        break;

      case "final_report": {
        const report = normalizeFinalReport(data);
        if (!report) break;
        set((s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, finalReport: report };
          }
          return {
            messages: msgs,
            confidenceScore: data.confidence ?? null,
          };
        });
        break;
      }

      case "error":
        if (!state.isStreaming) {
          state.startAssistantMessage();
          state.setIsStreaming(true);
        }
        state.appendToken(`\n\n**Error:** ${data.message || "Unknown error"}`);
        state.finalizeAssistantMessage();
        state.setAvatarPhase("error");
        state.setSystemState("idle");
        state.setIntensityLevel(0);
        set({ pendingToolInThisTurn: false, llmWaitStartedAt: null });
        setTimeout(() => state.setAvatarPhase("idle"), 2000);
        break;

      case "done":
        state.finalizeAssistantMessage();
        state.setAvatarPhase("success");
        state.setSystemState("idle");
        state.setIntensityLevel(0);
        set({ pendingToolInThisTurn: false, llmWaitStartedAt: null });
        // Complete all plan steps
        set((s) => ({
          executionPlan: s.executionPlan.map((step) => ({ ...step, status: "completed" as const })),
        }));
        setTimeout(() => state.setAvatarPhase("idle"), 2000);
        break;
    }
  },

  /* ── Approval flow ── */

  approveToolExecution: () => {
    const state = get();
    const msgWithApproval = [...state.messages].reverse().find(
      (m) => m.pendingApproval?.status === "pending"
    );
    if (!msgWithApproval?.pendingApproval) return;

    const originalMessage = msgWithApproval.pendingApproval.originalMessage;

    set((s) => ({
      pendingApproval: null,
      systemState: "executing" as SystemState,
      messages: s.messages.map((m) =>
        m.id === msgWithApproval.id
          ? { ...m, pendingApproval: { ...m.pendingApproval!, status: "approved" as const } }
          : m
      ),
    }));

    streamChat(
      originalMessage,
      state.sessionKey,
      state.handleSSEEvent,
      undefined,
      true // auto_approve
    );
  },

  denyToolExecution: () => {
    const state = get();
    const msgWithApproval = [...state.messages].reverse().find(
      (m) => m.pendingApproval?.status === "pending"
    );
    if (!msgWithApproval) return;

    set((s) => ({
      pendingApproval: null,
      systemState: "idle" as SystemState,
      avatarPhase: "idle" as AvatarPhase,
      intensityLevel: 0,
      messages: s.messages.map((m) =>
        m.id === msgWithApproval.id
          ? { ...m, pendingApproval: { ...m.pendingApproval!, status: "denied" as const } }
          : m
      ),
    }));
  },

  /* ── Retry / quick-prompts ── */

  retryLastMessage: () => {
    const state = get();
    if (state.isStreaming) return;
    const lastUser = state.lastUserMessage;
    if (!lastUser) return;
    // Remove the last assistant message (the failed/unsatisfying one)
    const msgs = [...state.messages];
    if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant") {
      msgs.pop();
    }
    set({
      messages: msgs,
      isStreaming: false,
      pendingApproval: null,
      executionTimeline: [],
      executionPlan: [],
      confidenceScore: null,
    });
    // Re-send
    const store = get();
    store.addUserMessage(lastUser);
    // Remove the duplicate user msg we just added (it was already there)
    set((s) => {
      const m = [...s.messages];
      // Remove the second-to-last user msg if it duplicates
      if (m.length >= 2 && m[m.length - 1].role === "user" && m[m.length - 2].role === "user" && m[m.length - 2].content === lastUser) {
        m.splice(m.length - 2, 1);
      }
      return { messages: m };
    });
    streamChat(lastUser, store.sessionKey, store.handleSSEEvent);
  },

  sendQuickPrompt: (prompt: string) => {
    const state = get();
    if (state.isStreaming) return;
    state.addUserMessage(prompt);
    streamChat(prompt, state.sessionKey, state.handleSSEEvent);
  },

  /* ── Reset / load ── */

  clearChat: () => {
    if (typeof window !== "undefined") {
      try { localStorage.removeItem("aipiloty_last_session"); } catch { /* ignore */ }
    }
    set({
      messages: [],
      sessionKey: null,
      isStreaming: false,
      pendingApproval: null,
      avatarPhase: "idle" as AvatarPhase,
      backgroundLogs: [],
      executionTimeline: [],
      systemState: "idle" as SystemState,
      intensityLevel: 0,
      executionPlan: [],
      confidenceScore: null,
      llmWaitStartedAt: null,
      pendingToolInThisTurn: false,
    });
  },

  loadSession: (sessionKey, apiMessages) =>
    set({
      sessionKey,
      isStreaming: false,
      pendingApproval: null,
      systemState: "idle" as SystemState,
      intensityLevel: 0,
      executionPlan: [],
      confidenceScore: null,
      llmWaitStartedAt: null,
      pendingToolInThisTurn: false,
      messages: apiMessages.map((m) => ({
        id: newId(),
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
        toolCalls: m.tool_calls?.map((tc) => ({ name: tc.name, arguments: tc.arguments })),
        toolResults: m.tool_results?.map((tr) => ({
          name: tr.tool || tr.name || "",
          output: tr.output != null ? (typeof tr.output === "string" ? tr.output : JSON.stringify(tr.output)) : undefined,
          error: tr.error,
        })),
        finalReport: normalizeFinalReport(m.final_report),
        isStreaming: false,
        timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
      })),
    }),

  restoreLastSession: () => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("aipiloty_last_session");
    } catch {
      return null;
    }
  },
}));
