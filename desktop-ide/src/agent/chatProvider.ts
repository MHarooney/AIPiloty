/**
 * ChatViewProvider — WebviewViewProvider for the AIPiloty chat sidebar.
 *
 * Manages the chat webview lifecycle and bridges VS Code ↔ webview messages.
 * The webview HTML renders the chat UI (messages, input, tool events).
 *
 * Message protocol:
 *   webview → extension:
 *     { type: "send",      text: string, mode: string }
 *     { type: "cancel" }
 *     { type: "newSession" }
 *     { type: "ready" }        — webview loaded and ready
 *
 *   extension → webview:
 *     { type: "token",         token: string, done: boolean }
 *     { type: "thinking",      iteration: number }
 *     { type: "tool_start",    tool: string, args: object }
 *     { type: "tool_output",   tool: string, output: string }
 *     { type: "tool_error",    tool: string, error: string }
 *     { type: "provider_switched", from: string, to: string, reason: string }
 *     { type: "error",         message: string }
 *     { type: "done" }
 *     { type: "session",       sessionKey: string }
 *     { type: "context",       filename: string, language: string, selection: string }
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { promptAndResumeAfterApproval, shouldAutoApprove } from "./approvals";
import { streamChat, type ChatMessage, type SSEEvent } from "./streaming";
import type { KeychainService } from "../keychain";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private sessionKey?: string;
  private messages: ChatMessage[] = [];
  private abortController?: AbortController;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly backendUrl: string,
    private readonly keychain: KeychainService,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _resolveContext: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      ],
    };

    webviewView.webview.html = this.buildWebviewHtml(webviewView.webview);

    // Listen for messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (message: { type: string; text?: string; mode?: string }) => {
        switch (message.type) {
          case "send":
            await this.handleSend(message.text ?? "", message.mode ?? "agent");
            break;
          case "cancel":
            this.abortController?.abort();
            break;
          case "newSession":
            this.newSession();
            break;
          case "openMcp":
            await vscode.commands.executeCommand("aipiloty.openMcpSettings");
            break;
          case "openImageSettings":
            await vscode.commands.executeCommand("aipiloty.chat.openImageSettings");
            break;
          case "ready":
            // Inject current editor context
            this.sendEditorContext();
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    // Update context when active editor changes
    vscode.window.onDidChangeActiveTextEditor(
      () => this.sendEditorContext(),
      undefined,
      this.context.subscriptions
    );

    // Update context when selection changes
    vscode.window.onDidChangeTextEditorSelection(
      () => this.sendEditorContext(),
      undefined,
      this.context.subscriptions
    );
  }

  /** Start a new chat session, clearing history. */
  newSession(): void {
    this.messages = [];
    this.sessionKey = undefined;
    this.abortController?.abort();
    this.post({ type: "newSession" });
  }

  /** Send a message programmatically (e.g. from "Explain Selection"). */
  sendMessage(text: string): void {
    // Ensure the view is visible, then dispatch
    if (this.view) {
      this.handleSend(text, "ask");
      this.post({ type: "externalSend", text });
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async handleSend(text: string, mode: string): Promise<void> {
    if (!text.trim()) return;

    this.abortController?.abort();
    this.abortController = new AbortController();

    this.messages.push({ role: "user", content: text });
    let assistant = "";
    const uiMode = (mode || "agent").toLowerCase();
    const backendMode =
      uiMode === "ask"
        ? "ask"
        : uiMode === "plan"
          ? "plan"
          : uiMode === "debug"
            ? "debug"
            : "agent";
    const autoApprove = shouldAutoApprove(
      backendMode === "ask" ? "ask" : backendMode === "agent" ? "agent" : "auto"
    );

    try {
      let pendingApproval: SSEEvent | undefined;
      await streamChat(this.backendUrl, this.keychain, {
        messages: this.messages,
        sessionKey: this.sessionKey,
        mode: backendMode,
        autoApprove,
        signal: this.abortController.signal,
        onEvent: (event: SSEEvent) => {
          if (event.type === "token") {
            assistant += String(event.data["token"] ?? "");
          }
          if (event.type === "done" || (event.type === "token" && event.data["done"])) {
            if (assistant.trim()) {
              this.messages.push({ role: "assistant", content: assistant });
              assistant = "";
            }
          }
          if (event.type === "approval_required") {
            pendingApproval = event;
          }
          this.handleSSEEvent(event);
        },
      });
      if (assistant.trim()) {
        this.messages.push({ role: "assistant", content: assistant });
      }
      if (pendingApproval && this.sessionKey) {
        await promptAndResumeAfterApproval(this.backendUrl, this.keychain, {
          sessionKey: this.sessionKey,
          messages: this.messages,
          mode: backendMode,
          event: pendingApproval,
          handlers: {
            signal: this.abortController?.signal,
            onEvent: (event: SSEEvent) => this.handleSSEEvent(event),
          },
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "Aborted") return;
      const msg = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", message: `Backend error: ${msg}` });
    }
  }

  private handleSSEEvent(event: SSEEvent): void {
    const d = event.data;
    switch (event.type) {
      case "session":
        this.sessionKey = d["session_key"] as string;
        this.post({ type: "session", sessionKey: this.sessionKey });
        break;
      case "token":
        this.post({ type: "token", token: d["token"] ?? "", done: d["done"] ?? false });
        break;
      case "thinking":
        this.post({ type: "thinking", iteration: d["iteration"] ?? 1 });
        break;
      case "planning":
        this.post({ type: "planning", tool: d["tool"], steps: d["steps"] });
        break;
      case "tool_start":
        this.post({ type: "tool_start", tool: d["tool"], args: d["arguments"] });
        break;
      case "tool_output":
        this.post({ type: "tool_output", tool: d["tool"], output: d["output"] });
        break;
      case "tool_error":
        this.post({ type: "tool_error", tool: d["tool"], error: d["error"] });
        break;
      case "provider_switched":
        this.post({ type: "provider_switched", from: d["from"], to: d["to"], reason: d["reason"] });
        vscode.window.setStatusBarMessage(
          `$(arrow-swap) AIPiloty: switched to ${d["to"]} (${d["reason"]})`,
          5_000
        );
        break;
      case "approval_required":
        this.post({
          type: "approval_required",
          tool: d["tool"],
          risk: d["risk_level"],
          explanation: d["explanation"],
          args: d["arguments"],
        });
        break;
      case "error":
        this.post({ type: "error", message: d["message"] ?? "Unknown error" });
        break;
      case "done":
        this.post({ type: "done" });
        break;
    }
  }

  private sendEditorContext(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.view) return;
    const selection = editor.document.getText(editor.selection);
    this.post({
      type: "context",
      filename: path.basename(editor.document.fileName),
      language: editor.document.languageId,
      selection: selection.slice(0, 2000), // truncate large selections
    });
  }

  private post(message: Record<string, unknown>): void {
    this.view?.webview.postMessage(message);
  }

  // ── Webview HTML ──────────────────────────────────────────────────────────

  private buildWebviewHtml(webview: vscode.Webview): string {
    // Load from media/chat.html if it exists (for easier iteration)
    const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "chat.html");
    if (fs.existsSync(htmlPath.fsPath)) {
      let html = fs.readFileSync(htmlPath.fsPath, "utf-8");
      // Replace asset URIs + bust webview cache when HTML changes
      html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
      const stamp = fs.statSync(htmlPath.fsPath).mtimeMs.toString(36);
      html = html.replace("</head>", `<!-- v:${stamp} --></head>`);
      return html;
    }
    // Inline fallback
    return this.buildInlineHtml(webview);
  }

  private buildInlineHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = webview.cspSource;
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${csp} data:;">
  <title>AIPiloty</title>
  <style>
    /* VS Code-native colours */
    :root {
      --bg: var(--vscode-sideBar-background, #1e1e1e);
      --fg: var(--vscode-foreground, #cccccc);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-border: var(--vscode-input-border, #6b6b6b);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --border: var(--vscode-panel-border, #424242);
      --tool-bg: var(--vscode-editorWidget-background, #252526);
      --accent: var(--vscode-focusBorder, #007fd4);
      --warn: var(--vscode-editorWarning-foreground, #cca700);
      --error: var(--vscode-errorForeground, #f48771);
      --success: var(--vscode-testing-iconPassed, #73c991);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--bg);
      color: var(--fg);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Context bar */
    #ctx-bar {
      padding: 4px 10px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      overflow: hidden;
    }
    #ctx-bar .lang { opacity: 0.6; }
    #ctx-bar .sel { color: var(--accent); font-size: 10px; }

    /* Messages */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .msg { display: flex; flex-direction: column; gap: 3px; }
    .msg.user .bubble {
      background: var(--vscode-editorHoverWidget-background, #2d2d2d);
      border-radius: 8px 8px 2px 8px;
      padding: 8px 10px;
      font-size: 12px;
      align-self: flex-end;
      max-width: 92%;
    }
    .msg.assistant .bubble {
      font-size: 12px;
      line-height: 1.6;
      max-width: 100%;
    }
    .msg .label {
      font-size: 10px;
      opacity: 0.55;
      padding: 0 2px;
    }
    .msg.user .label { align-self: flex-end; }

    /* Thinking / tool events */
    .event-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      background: var(--tool-bg);
      border: 1px solid var(--border);
      color: var(--vscode-descriptionForeground, #999);
      max-width: fit-content;
    }
    .event-pill.thinking { border-color: var(--accent); color: var(--accent); }
    .event-pill.tool { border-color: var(--warn); color: var(--warn); }
    .event-pill.tool.done { border-color: var(--success); color: var(--success); }
    .event-pill.tool.error { border-color: var(--error); color: var(--error); }
    .event-pill.provider { border-color: var(--warn); color: var(--warn); }
    .event-pill .spin { animation: spin 1s linear infinite; display: inline-block; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Code blocks */
    pre {
      background: var(--tool-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      margin: 4px 0;
    }
    code { font-family: inherit; }

    /* Input area */
    #input-area {
      border-top: 1px solid var(--border);
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #mode-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .mode-btn {
      padding: 2px 8px;
      font-size: 10px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--fg);
      border-radius: 4px;
      cursor: pointer;
    }
    .mode-btn.active {
      background: var(--btn-bg);
      border-color: var(--btn-bg);
      color: var(--btn-fg);
    }
    #provider-badge {
      margin-left: auto;
      font-size: 10px;
      opacity: 0.6;
      padding: 2px 6px;
      border: 1px solid var(--border);
      border-radius: 4px;
    }
    #input-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }
    #input {
      flex: 1;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-fg);
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 12px;
      font-family: inherit;
      resize: none;
      min-height: 36px;
      max-height: 120px;
      outline: none;
      line-height: 1.5;
    }
    #input:focus { border-color: var(--accent); }
    #send-btn, #cancel-btn {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }
    #send-btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
    }
    #send-btn:hover { background: var(--btn-hover); }
    #send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #cancel-btn {
      background: var(--tool-bg);
      color: var(--fg);
      border: 1px solid var(--border);
      display: none;
    }
    #cancel-btn:hover { background: var(--error); color: white; }
    .streaming #cancel-btn { display: block; }
    .streaming #send-btn { display: none; }
  </style>
</head>
<body>
  <div id="ctx-bar">
    <span id="ctx-file">No file open</span>
    <span class="lang" id="ctx-lang"></span>
    <span class="sel" id="ctx-sel"></span>
  </div>

  <div id="messages"></div>

  <div id="input-area">
    <div id="mode-row">
      <button class="mode-btn active" data-mode="auto" onclick="setMode('auto')">Auto</button>
      <button class="mode-btn" data-mode="ask" onclick="setMode('ask')">Ask</button>
      <button class="mode-btn" data-mode="agent" onclick="setMode('agent')">Agent</button>
      <span id="provider-badge">ollama</span>
    </div>
    <div id="input-row">
      <textarea id="input" rows="1" placeholder="Ask AIPiloty anything… (Enter to send, Shift+Enter for newline)"></textarea>
      <button id="send-btn" onclick="sendMessage()">Send</button>
      <button id="cancel-btn" onclick="cancelStream()">Stop</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let mode = 'auto';
    let streaming = false;
    let currentAssistantEl = null;
    let currentTokens = '';

    // ── Mode toggle ────────────────────────────────────────────────────────
    function setMode(m) {
      mode = m;
      document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === m);
      });
    }

    // ── Input handling ─────────────────────────────────────────────────────
    const inputEl = document.getElementById('input');
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
      // Auto-resize
      setTimeout(() => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
      }, 0);
    });

    function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || streaming) return;
      inputEl.value = '';
      inputEl.style.height = '36px';
      appendUserMsg(text);
      vscode.postMessage({ type: 'send', text, mode });
    }

    function cancelStream() {
      vscode.postMessage({ type: 'cancel' });
    }

    // ── Message rendering ──────────────────────────────────────────────────
    function appendUserMsg(text) {
      const el = document.createElement('div');
      el.className = 'msg user';
      el.innerHTML = '<div class="label">You</div><div class="bubble">' + escHtml(text) + '</div>';
      document.getElementById('messages').appendChild(el);
      scrollBottom();
    }

    function startAssistantMsg() {
      currentAssistantEl = document.createElement('div');
      currentAssistantEl.className = 'msg assistant';
      currentAssistantEl.innerHTML = '<div class="label">AIPiloty</div><div class="bubble"></div>';
      document.getElementById('messages').appendChild(currentAssistantEl);
      currentTokens = '';
      setStreaming(true);
      scrollBottom();
    }

    function appendToken(token) {
      if (!currentAssistantEl) startAssistantMsg();
      currentTokens += token;
      const bubble = currentAssistantEl.querySelector('.bubble');
      bubble.innerHTML = renderMarkdown(currentTokens);
      scrollBottom();
    }

    function appendEventPill(cls, text) {
      const pill = document.createElement('div');
      pill.className = 'event-pill ' + cls;
      pill.textContent = text;
      document.getElementById('messages').appendChild(pill);
      scrollBottom();
    }

    function setStreaming(v) {
      streaming = v;
      document.body.classList.toggle('streaming', v);
    }

    function scrollBottom() {
      const el = document.getElementById('messages');
      el.scrollTop = el.scrollHeight;
    }

    // ── Minimal markdown renderer ──────────────────────────────────────────
    function renderMarkdown(text) {
      return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\\n/g, '<br>');
    }

    function escHtml(text) {
      return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Messages from extension ────────────────────────────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'token':
          appendToken(msg.token || '');
          if (msg.done) {
            setStreaming(false);
            currentAssistantEl = null;
            currentTokens = '';
          }
          break;
        case 'thinking':
          if (!currentAssistantEl) startAssistantMsg();
          appendEventPill('thinking', '⟳ Thinking…');
          break;
        case 'tool_start':
          appendEventPill('tool spin', '⚙ ' + (msg.tool || 'tool'));
          break;
        case 'tool_output':
          // Update last tool pill to done
          const pills = document.querySelectorAll('.event-pill.tool.spin');
          if (pills.length) {
            const last = pills[pills.length - 1];
            last.classList.remove('spin');
            last.classList.add('done');
            last.textContent = '✓ ' + (msg.tool || 'tool');
          }
          break;
        case 'tool_error':
          appendEventPill('tool error', '✗ ' + (msg.tool || 'tool'));
          break;
        case 'provider_switched':
          appendEventPill('provider', '↷ ' + msg.from + ' → ' + msg.to + ' (' + msg.reason + ')');
          document.getElementById('provider-badge').textContent = msg.to;
          break;
        case 'error':
          setStreaming(false);
          appendEventPill('tool error', '⚠ ' + (msg.message || 'Error'));
          break;
        case 'done':
          setStreaming(false);
          currentAssistantEl = null;
          currentTokens = '';
          break;
        case 'newSession':
          document.getElementById('messages').innerHTML = '';
          currentAssistantEl = null;
          currentTokens = '';
          setStreaming(false);
          break;
        case 'externalSend':
          appendUserMsg(msg.text || '');
          break;
        case 'context':
          document.getElementById('ctx-file').textContent = msg.filename || '';
          document.getElementById('ctx-lang').textContent = msg.language ? '[' + msg.language + ']' : '';
          document.getElementById('ctx-sel').textContent = msg.selection ? msg.selection.split('\\n').length + ' lines selected' : '';
          break;
      }
    });

    // Tell extension we're ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
