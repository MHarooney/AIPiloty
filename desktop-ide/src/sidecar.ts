/**
 * SidecarManager — spawns and monitors the AIPiloty FastAPI backend + Ollama.
 *
 * Spawns/monitors FastAPI (+ optional Ollama) from the VS Code extension host.
 */

import * as vscode from "vscode";
import * as child_process from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";

const MAX_RETRIES = 5;
const HEALTH_POLL_MS = 1_000;
const HEALTH_TIMEOUT_MS = 45_000;
const BACKOFF_BASE_MS = 2_000;

export class SidecarManager {
  private proc: child_process.ChildProcess | null = null;
  private ready = false;
  private stopping = false;
  private restartCount = 0;
  private readonly port: number;
  private readonly outputChannel: vscode.OutputChannel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly backendUrl: string,
  ) {
    this.port = parseInt(new URL(backendUrl).port || "8100", 10);
    this.outputChannel = vscode.window.createOutputChannel("AIPiloty Backend");
    context.subscriptions.push(this.outputChannel);
  }

  get isReady(): boolean { return this.ready; }

  async start(): Promise<void> {
    this.stopping = false;

    // run-dev.sh / make fork often already started the backend — reuse it.
    if (await this.probeHealth()) {
      this.ready = true;
      this.outputChannel.appendLine("[sidecar] Backend already healthy — skipping spawn");
      return;
    }

    await this.ensureOllama();
    await this.spawnBackend();
    await this.waitForHealth();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.ready = false;
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { this.proc?.kill("SIGKILL"); resolve(); }, 5_000);
        this.proc?.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    this.proc = null;
  }

  // ── Ollama ────────────────────────────────────────────────────────────────

  private async ensureOllama(): Promise<void> {
    const running = await this.checkOllamaHealth();
    if (running) {
      this.outputChannel.appendLine("[sidecar] Ollama already running");
      return;
    }
    this.outputChannel.appendLine("[sidecar] Starting Ollama…");
    child_process.spawn("ollama", ["serve"], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (await this.checkOllamaHealth()) {
        this.outputChannel.appendLine("[sidecar] Ollama ready");
        return;
      }
    }
    this.outputChannel.appendLine("[sidecar] Ollama did not start in time — continuing without it");
  }

  private checkOllamaHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get("http://127.0.0.1:11434/", (res) => {
        resolve((res.statusCode ?? 0) < 500);
        res.resume();
      });
      req.setTimeout(1_000, () => { req.destroy(); resolve(false); });
      req.on("error", () => resolve(false));
    });
  }

  // ── FastAPI backend ───────────────────────────────────────────────────────

  private backendDir(): string {
    const configPath = vscode.workspace
      .getConfiguration("aipiloty")
      .get<string>("backendDir", "");
    if (configPath && fs.existsSync(configPath)) return configPath;

    const candidates: string[] = [];

    // Workspace roots (evo-lms/ or aipiloty/)
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = folder.uri.fsPath;
      candidates.push(path.join(root, "aipiloty", "backend"));
      candidates.push(path.join(root, "backend"));
    }

    // Extension install locations:
    //   desktop-ide/                 → ../backend
    //   vscode-fork/extensions/aipiloty-agent → ../../../backend
    const ext = this.context.extensionPath;
    candidates.push(
      path.resolve(ext, "../backend"),
      path.resolve(ext, "../../backend"),
      path.resolve(ext, "../../../backend"),
      path.resolve(ext, "../../../../aipiloty/backend"),
    );

    for (const c of candidates) {
      if (fs.existsSync(path.join(c, "app", "main.py"))) return c;
    }
    throw new Error(
      "Cannot find AIPiloty backend directory. " +
      "Set `aipiloty.backendDir` in Settings (e.g. /path/to/aipiloty/backend)."
    );
  }

  private pythonExe(): string {
    const configPython = vscode.workspace
      .getConfiguration("aipiloty")
      .get<string>("backendPythonPath", "");
    if (configPython && fs.existsSync(configPython)) return configPython;

    const backendDir = this.backendDir();
    const venvPython = path.join(backendDir, ".venv", "bin", "python3");
    if (fs.existsSync(venvPython)) return venvPython;
    return "python3";
  }

  private spawnBackend(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cwd = this.backendDir();
      const python = this.pythonExe();
      const isDev = process.env["AIPILOTY_DEV"] === "1";

      const args = [
        "-m", "uvicorn",
        "app.main:app",
        "--host", "127.0.0.1",
        "--port", String(this.port),
        "--log-level", isDev ? "info" : "warning",
      ];

      this.outputChannel.appendLine(`[sidecar] Spawning: ${python} ${args.join(" ")}`);
      this.outputChannel.appendLine(`[sidecar] cwd: ${cwd}`);

      this.proc = child_process.spawn(python, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      this.proc.stdout?.on("data", (d: Buffer) => this.outputChannel.append(d.toString()));
      this.proc.stderr?.on("data", (d: Buffer) => this.outputChannel.append(d.toString()));

      this.proc.once("error", (err) => {
        this.outputChannel.appendLine(`[sidecar] Spawn error: ${err.message}`);
        reject(err);
      });

      this.proc.on("exit", (code, signal) => {
        this.ready = false;
        this.outputChannel.appendLine(`[sidecar] Backend exited (code=${code} signal=${signal})`);
        if (!this.stopping) this.scheduleRestart();
      });

      resolve();
    });
  }

  // ── Health polling ────────────────────────────────────────────────────────

  private probeHealth(): Promise<boolean> {
    const url = `http://127.0.0.1:${this.port}/api/v1/health`;
    return new Promise((resolve) => {
      const req = http.get(url, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.setTimeout(1_000, () => { req.destroy(); resolve(false); });
      req.on("error", () => resolve(false));
    });
  }

  private waitForHealth(): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();

      const poll = async () => {
        if (this.stopping) return reject(new Error("Stopping"));
        if (Date.now() - started > HEALTH_TIMEOUT_MS) {
          return reject(new Error(`Backend health check timed out after ${HEALTH_TIMEOUT_MS}ms`));
        }
        if (await this.probeHealth()) {
          this.ready = true;
          this.restartCount = 0;
          this.outputChannel.appendLine("[sidecar] Backend ready ✓");
          resolve();
          return;
        }
        setTimeout(poll, HEALTH_POLL_MS);
      };
      setTimeout(poll, HEALTH_POLL_MS);
    });
  }

  // ── Auto-restart ──────────────────────────────────────────────────────────

  private scheduleRestart(): void {
    if (this.stopping || this.restartCount >= MAX_RETRIES) {
      if (this.restartCount >= MAX_RETRIES) {
        vscode.window.showErrorMessage(
          "AIPiloty backend failed to restart after 5 attempts. " +
          "Check the 'AIPiloty Backend' output channel.",
          "Open Output"
        ).then((choice) => {
          if (choice === "Open Output") this.outputChannel.show();
        });
      }
      return;
    }
    const delay = BACKOFF_BASE_MS * Math.pow(2, this.restartCount);
    this.restartCount++;
    this.outputChannel.appendLine(
      `[sidecar] Restarting in ${delay}ms (attempt ${this.restartCount}/${MAX_RETRIES})…`
    );
    setTimeout(async () => {
      try {
        await this.spawnBackend();
        await this.waitForHealth();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine(`[sidecar] Restart failed: ${msg}`);
        this.scheduleRestart();
      }
    }, delay);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
