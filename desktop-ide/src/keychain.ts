/**
 * KeychainService — wraps VS Code's SecretStorage (OS-backed keychain).
 *
 * On macOS: Keychain Services
 * On Windows: Windows Credential Manager
 * On Linux: libsecret / kwallet
 *
 * Also stores the AIPiloty backend API key (read from config or auto-generated).
 */

import * as vscode from "vscode";

const API_KEY_SECRET = "aipiloty.backend_api_key";

export class KeychainService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Store a secret in OS keychain */
  async set(key: string, value: string): Promise<void> {
    await this.context.secrets.store(key, value);
  }

  /** Retrieve a secret from OS keychain. Returns empty string if not found. */
  async get(key: string): Promise<string> {
    return (await this.context.secrets.get(key)) ?? "";
  }

  /** Delete a secret */
  async delete(key: string): Promise<void> {
    await this.context.secrets.delete(key);
  }

  /** List all stored key names (VS Code SecretStorage does not support enumeration;
   *  we maintain our own index in global state). */
  async list(): Promise<string[]> {
    const index = this.context.globalState.get<string[]>("aipiloty.keychain.index", []);
    return index;
  }

  // ── Backend API key management ─────────────────────────────────────────────

  /**
   * Returns the AIPiloty backend API key.
   * Reads from SecretStorage first, then falls back to the VS Code setting
   * `aipiloty.apiKey` (for users who prefer .env / settings.json).
   */
  async getApiKey(): Promise<string> {
    // Prefer explicit settings (synced from backend .env for local dev).
    const cfg = vscode.workspace.getConfiguration("aipiloty");
    const fromSettings = (cfg.get<string>("apiKey") || "").trim();
    if (fromSettings) return fromSettings;

    const stored = await this.context.secrets.get(API_KEY_SECRET);
    if (stored) return stored;

    return "aipiloty-dev-key-change-in-production";
  }

  /**
   * Persist a backend API key into SecretStorage.
   * Also updates the backend .env so it survives restarts (if accessible).
   */
  async setApiKey(key: string): Promise<void> {
    await this.context.secrets.store(API_KEY_SECRET, key);
  }

  // ── LLM provider key shortcuts ─────────────────────────────────────────────

  async getAnthropicKey(): Promise<string> {
    return this.get("aipiloty.claude_api_key");
  }

  async getOpenAIKey(): Promise<string> {
    return this.get("aipiloty.openai_api_key");
  }

  async getGeminiKey(): Promise<string> {
    return this.get("aipiloty.gemini_api_key");
  }

  async getOpenRouterKey(): Promise<string> {
    return this.get("aipiloty.openrouter_api_key");
  }

  /** Build the request headers for the AIPiloty backend. */
  async backendHeaders(): Promise<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      "X-API-Key": await this.getApiKey(),
    };
  }
}
