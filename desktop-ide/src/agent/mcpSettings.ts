/**
 * MCP Servers settings — Cursor-like management UI backed by
 * GET/POST /api/v1/mcp/* on the AIPiloty FastAPI backend.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import type { KeychainService } from "../keychain";

interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  description?: string;
  enabled?: boolean;
}

export class McpSettingsProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aipiloty.mcpView";
  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly backendUrl: string,
    private readonly keychain: KeychainService
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = this.html(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
        case "refresh":
          await this.pushServers();
          break;
        case "add":
          await this.addServer(msg.server as Omit<MCPServer, "id">);
          break;
        case "delete":
          await this.deleteServer(String(msg.id));
          break;
        case "toggle":
          await this.toggleServer(String(msg.id), Boolean(msg.enabled));
          break;
        case "probe":
          await this.probeServer(String(msg.id));
          break;
        case "import":
          await this.importConfig(msg.config as Record<string, unknown>);
          break;
      }
    });
  }

  /** Open as a full editor panel (command palette). */
  async openPanel(): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      "aipiloty.mcpPanel",
      "MCP Servers",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage(async (msg) => {
      // Reuse same handlers via temporary view binding
      const prev = this.view;
      this.view = {
        webview: panel.webview,
      } as vscode.WebviewView;
      try {
        switch (msg.type) {
          case "ready":
          case "refresh":
            await this.pushServers();
            break;
          case "add":
            await this.addServer(msg.server as Omit<MCPServer, "id">);
            break;
          case "delete":
            await this.deleteServer(String(msg.id));
            break;
          case "toggle":
            await this.toggleServer(String(msg.id), Boolean(msg.enabled));
            break;
          case "probe":
            await this.probeServer(String(msg.id));
            break;
          case "import":
            await this.importConfig(msg.config as Record<string, unknown>);
            break;
        }
      } finally {
        this.view = prev;
      }
    });
    await this.pushServersTo(panel.webview);
  }

  private html(webview: vscode.Webview): string {
    const path = vscode.Uri.joinPath(this.context.extensionUri, "media", "mcp.html");
    let html = fs.readFileSync(path.fsPath, "utf-8");
    return html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      "X-API-Key": await this.keychain.getApiKey(),
    };
  }

  private async pushServers(): Promise<void> {
    if (this.view) await this.pushServersTo(this.view.webview);
  }

  private async pushServersTo(webview: vscode.Webview): Promise<void> {
    try {
      const res = await fetch(`${this.backendUrl}/api/v1/mcp/servers`, {
        headers: await this.headers(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const servers = (await res.json()) as MCPServer[];
      webview.postMessage({ type: "servers", servers });
    } catch (err) {
      webview.postMessage({
        type: "toast",
        message: `Failed to load MCP servers: ${err instanceof Error ? err.message : String(err)}`,
      });
      webview.postMessage({ type: "servers", servers: [] });
    }
  }

  private async addServer(server: Omit<MCPServer, "id">): Promise<void> {
    if (!server.name?.trim() || !server.command?.trim()) {
      this.toast("Name and command are required");
      return;
    }
    const res = await fetch(`${this.backendUrl}/api/v1/mcp/servers`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(server),
    });
    if (!res.ok) {
      this.toast(`Add failed: HTTP ${res.status}`);
      return;
    }
    this.toast(`Added ${server.name}`);
    await this.pushServers();
  }

  private async deleteServer(id: string): Promise<void> {
    await fetch(`${this.backendUrl}/api/v1/mcp/servers/${id}`, {
      method: "DELETE",
      headers: await this.headers(),
    });
    await this.pushServers();
  }

  private async toggleServer(id: string, enabled: boolean): Promise<void> {
    const res = await fetch(`${this.backendUrl}/api/v1/mcp/servers`, {
      headers: await this.headers(),
    });
    if (!res.ok) return;
    const servers = (await res.json()) as MCPServer[];
    const s = servers.find((x) => x.id === id);
    if (!s) return;
    await fetch(`${this.backendUrl}/api/v1/mcp/servers/${id}`, {
      method: "PUT",
      headers: await this.headers(),
      body: JSON.stringify({
        name: s.name,
        command: s.command,
        args: s.args ?? [],
        env: s.env ?? {},
        description: s.description ?? "",
        enabled,
      }),
    });
    await this.pushServers();
  }

  private async probeServer(id: string): Promise<void> {
    try {
      const res = await fetch(`${this.backendUrl}/api/v1/mcp/servers/${id}/probe`, {
        method: "POST",
        headers: await this.headers(),
      });
      const data = (await res.json()) as {
        tools?: Array<{ name: string; description?: string }>;
        detail?: string;
      };
      this.view?.webview.postMessage({
        type: "probeResult",
        id,
        tools: data.tools ?? [],
        error: res.ok ? undefined : data.detail || `HTTP ${res.status}`,
      });
    } catch (err) {
      this.view?.webview.postMessage({
        type: "probeResult",
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async importConfig(config: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.backendUrl}/api/v1/mcp/import-claude-config`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      this.toast(`Import failed: HTTP ${res.status}`);
      return;
    }
    const data = (await res.json()) as { imported?: number };
    this.toast(`Imported ${data.imported ?? 0} server(s)`);
    await this.pushServers();
  }

  private toast(message: string): void {
    this.view?.webview.postMessage({ type: "toast", message });
  }
}

export function registerMcpSettings(
  context: vscode.ExtensionContext,
  backendUrl: string,
  keychain: KeychainService
): McpSettingsProvider {
  const provider = new McpSettingsProvider(context, backendUrl, keychain);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(McpSettingsProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("aipiloty.openMcpSettings", () => provider.openPanel())
  );
  return provider;
}
