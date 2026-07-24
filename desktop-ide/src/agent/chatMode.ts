/**
 * Chat mode for the stock VS Code Chat panel (right side).
 * Extension APIs cannot add a Cursor-style dropdown into that composer,
 * so we mirror modes via: status bar, QuickPick, slash commands, Shift+Tab.
 */

import * as vscode from "vscode";

export type AgentMode = "agent" | "ask" | "plan" | "debug";

const STATE_KEY = "aipiloty.chatMode";

const MODE_META: Record<
  AgentMode,
  { label: string; icon: string; detail: string; placeholder: string }
> = {
  agent: {
    label: "Agent",
    icon: "$(sparkle)",
    detail: "Plan, search, make edits, run commands",
    placeholder: "Plan, search, build anything",
  },
  plan: {
    label: "Plan",
    icon: "$(checklist)",
    detail: "Generate an implementation plan",
    placeholder: "Plan and design before coding...",
  },
  debug: {
    label: "Debug",
    icon: "$(bug)",
    detail: "Pinpoint the root cause of an issue",
    placeholder: "Debug and troubleshoot issues...",
  },
  ask: {
    label: "Ask",
    icon: "$(comment-discussion)",
    detail: "Answer questions without making edits",
    placeholder: "Ask questions without making changes...",
  },
};

const MODE_ORDER: AgentMode[] = ["agent", "plan", "debug", "ask"];

export class ChatModeService {
  private readonly bar: vscode.StatusBarItem;
  private mode: AgentMode;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.mode = this.readStored();
    this.bar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.bar.command = "aipiloty.selectChatMode";
    this.bar.tooltip = "AIPiloty chat mode (also: /agent /ask /plan /debug · ⇧Tab)";
    this.refreshBar();
    this.bar.show();
    context.subscriptions.push(this.bar);
  }

  get current(): AgentMode {
    return this.mode;
  }

  setMode(mode: AgentMode): void {
    this.mode = mode;
    void this.context.workspaceState.update(STATE_KEY, mode);
    this.refreshBar();
    void vscode.window.setStatusBarMessage(
      `AIPiloty mode: ${MODE_META[mode].label}`,
      2500
    );
  }

  cycle(): AgentMode {
    const i = MODE_ORDER.indexOf(this.mode);
    const next = MODE_ORDER[(i + 1) % MODE_ORDER.length];
    this.setMode(next);
    return next;
  }

  async pick(): Promise<AgentMode | undefined> {
    const picked = await vscode.window.showQuickPick(
      MODE_ORDER.map((id) => ({
        id,
        label: `${MODE_META[id].icon} ${MODE_META[id].label}`,
        description: id === this.mode ? "current" : undefined,
        detail: MODE_META[id].detail,
      })),
      {
        title: "AIPiloty chat mode (like Cursor Agent / Ask / Plan / Debug)",
        placeHolder: "Select mode for the next Chat messages",
      }
    );
    if (!picked) return undefined;
    this.setMode(picked.id);
    return picked.id;
  }

  private readStored(): AgentMode {
    const v = this.context.workspaceState.get<string>(STATE_KEY, "agent");
    return MODE_ORDER.includes(v as AgentMode) ? (v as AgentMode) : "agent";
  }

  private refreshBar(): void {
    const m = MODE_META[this.mode];
    this.bar.text = `${m.icon} ${m.label}`;
  }
}

export function resolveModeFromCommand(
  command: string | undefined,
  fallback: AgentMode
): AgentMode {
  switch (command) {
    case "explain":
    case "ask":
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
      return fallback;
  }
}
