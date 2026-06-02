const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api/v1";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "aipiloty-dev-key";

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json", "X-API-Key": API_KEY };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("jwt_token");
    if (token) h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Auth ──────────────────────────────────────────
export async function login(username: string, password: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return handleRes(res);
}

export function logout() {
  if (typeof window !== "undefined") localStorage.removeItem("jwt_token");
}

export function getStoredToken(): string | null {
  if (typeof window !== "undefined") return localStorage.getItem("jwt_token");
  return null;
}

export function storeToken(token: string) {
  if (typeof window !== "undefined") localStorage.setItem("jwt_token", token);
}

export interface SSEEvent {
  type: string;
  data: any;
}

// ── Attachments ──────────────────────────────────
export interface AttachmentMeta {
  id: string;
  filename: string;
  mime_type: string;
  category: "image" | "document";
  size_bytes: number;
  extracted_text?: string | null;
}

export async function uploadAttachment(file: File): Promise<AttachmentMeta> {
  const form = new FormData();
  form.append("file", file);
  const h: Record<string, string> = { "X-API-Key": API_KEY };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("jwt_token");
    if (token) h["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/attachments/upload`, {
    method: "POST",
    headers: h,
    body: form,
  });
  return handleRes<AttachmentMeta>(res);
}

// ── Chat ──────────────────────────────────────────
export function streamChat(
  message: string,
  sessionKey: string | null,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal,
  autoApprove: boolean = false,
  model?: string | null,
  attachmentIds?: string[]
) {
  const url = `${API_BASE}/chat/stream`;
  const msg: Record<string, unknown> = { role: "user", content: message };
  if (attachmentIds && attachmentIds.length > 0) msg.attachment_ids = attachmentIds;
  const payload: Record<string, unknown> = {
    messages: [msg],
    session_key: sessionKey,
    auto_approve: autoApprove,
  };
  if (model) payload.model = model;
  const body = JSON.stringify(payload);

  const MAX_RETRIES = 3;
  let lastEventId: string | null = null;

  async function attempt(retryCount: number): Promise<void> {
    if (signal?.aborted) return;

    const baseHeaders = headers() as Record<string, string>;
    const reqHeaders: Record<string, string> = { ...baseHeaders };
    if (lastEventId) reqHeaders["Last-Event-ID"] = lastEventId;

    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: reqHeaders, body, signal });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      // Network error — retry with backoff
      if (retryCount < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, Math.pow(2, retryCount) * 1000));
        return attempt(retryCount + 1);
      }
      onEvent({ type: "error", data: { message: "Connection lost after multiple retries." } });
      return;
    }

    if (!res.ok) {
      const friendly: Record<number, string> = {
        401: "Session expired — please log in again.",
        403: "You don't have permission for this action.",
        422: "The request was malformed. Please rephrase and try again.",
        429: "Too many requests — wait a moment and retry.",
        500: "Server error — the backend hit an unexpected problem.",
        502: "Backend unreachable — is the server running?",
        503: "Service temporarily unavailable. Try again shortly.",
        504: "Request timed out — the model may be overloaded.",
      };
      onEvent({ type: "error", data: { message: friendly[res.status] || `Unexpected error (${res.status})` } });
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    let droppedMidStream = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("id: ")) {
            lastEventId = line.slice(4).trim();
          } else if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") {
              onEvent({ type: "done", data: {} });
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              onEvent(parsed);
            } catch {
              // skip malformed lines
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      droppedMidStream = true;
    }

    // Stream ended without [DONE] — attempt reconnect if we have a last event ID
    if (droppedMidStream && lastEventId && retryCount < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, Math.pow(2, retryCount) * 1000));
      return attempt(retryCount + 1);
    }
  }

  attempt(0).catch((err) => {
    if (err.name !== "AbortError") {
      onEvent({ type: "error", data: { message: err.message } });
    }
  });
}

// ── Sessions ──────────────────────────────────────
export async function getSessions() {
  const res = await fetch(`${API_BASE}/chat/sessions`, { headers: headers() });
  return handleRes<any[]>(res);
}

export async function deleteSession(key: string) {
  const res = await fetch(`${API_BASE}/chat/sessions/${key}`, { method: "DELETE", headers: headers() });
  return handleRes<any>(res);
}

export async function fetchSessionMessages(key: string) {
  const res = await fetch(`${API_BASE}/chat/sessions/${key}`, { headers: headers() });
  return handleRes<{
    session_key: string;
    title: string;
    messages: Array<{
      role: string;
      content: string;
      tool_calls: Array<{ name: string; arguments: Record<string, any> }>;
      tool_results: Array<Record<string, any>>;
      created_at: string;
      final_report?: Record<string, unknown> | null;
    }>;
  }>(res);
}

// ── VMs ──────────────────────────────────────
export async function getVMs() {
  const res = await fetch(`${API_BASE}/vms/`, { headers: headers() });
  return handleRes<any[]>(res);
}
export async function createVM(data: Record<string, any>) {
  const res = await fetch(`${API_BASE}/vms/`, { method: "POST", headers: headers(), body: JSON.stringify(data) });
  return handleRes<any>(res);
}
export async function deleteVM(id: number) {
  const res = await fetch(`${API_BASE}/vms/${id}`, { method: "DELETE", headers: headers() });
  return handleRes<any>(res);
}
export async function trustHostKey(id: number) {
  const res = await fetch(`${API_BASE}/vms/${id}/trust-host-key`, { method: "POST", headers: headers() });
  return handleRes<any>(res);
}

// ── Deployments ──────────────────────────────────────
export async function getDeployments() {
  const res = await fetch(`${API_BASE}/deployments/`, { headers: headers() });
  return handleRes<any[]>(res);
}
export async function getDeployment(id: number) {
  const res = await fetch(`${API_BASE}/deployments/${id}`, { headers: headers() });
  return handleRes<any>(res);
}
export async function createDeployment(data: Record<string, any>) {
  const res = await fetch(`${API_BASE}/deployments/`, { method: "POST", headers: headers(), body: JSON.stringify(data) });
  return handleRes<any>(res);
}
export async function updateDeployment(id: number, data: Record<string, any>) {
  const res = await fetch(`${API_BASE}/deployments/${id}`, { method: "PUT", headers: headers(), body: JSON.stringify(data) });
  return handleRes<any>(res);
}
export async function deploymentAction(id: number, action: string) {
  const res = await fetch(`${API_BASE}/deployments/${id}/action`, { method: "POST", headers: headers(), body: JSON.stringify({ action }) });
  return handleRes<any>(res);
}
export async function deleteDeployment(id: number) {
  const res = await fetch(`${API_BASE}/deployments/${id}`, { method: "DELETE", headers: headers() });
  return handleRes<any>(res);
}
export async function getDeploymentRuns(id: number, limit = 20) {
  const res = await fetch(`${API_BASE}/deployments/${id}/runs?limit=${limit}`, { headers: headers() });
  return handleRes<any[]>(res);
}
export async function getDeploymentRun(id: number, runId: number) {
  const res = await fetch(`${API_BASE}/deployments/${id}/runs/${runId}`, { headers: headers() });
  return handleRes<any>(res);
}
export async function seedDeployments() {
  const res = await fetch(`${API_BASE}/deployments/seed/defaults`, { method: "POST", headers: headers() });
  return handleRes<{ created: string[]; skipped: string[] }>(res);
}

/** SSE pipeline run — streams progress events until [DONE] */
export function streamDeploymentRun(
  id: number,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal
) {
  const url = `${API_BASE}/deployments/${id}/run`;
  fetch(url, { method: "POST", headers: headers(), signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`API ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") { onEvent({ type: "done", data: {} }); return; }
            try { onEvent(JSON.parse(raw)); } catch { /* skip malformed */ }
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") onEvent({ type: "error", data: { message: err.message } });
    });
}

// ── Health ──────────────────────────────────────
export async function getHealth() {
  const res = await fetch(`${API_BASE}/health`, { headers: headers() });
  return handleRes<any>(res);
}

// ── Knowledge Base ──────────────────────────────────────
export async function getKBHealth() {
  const res = await fetch(`${API_BASE}/knowledge/health`, { headers: headers() });
  return handleRes<any>(res);
}
export async function getKBStats() {
  const res = await fetch(`${API_BASE}/knowledge/stats`, { headers: headers() });
  return handleRes<any>(res);
}
export async function getKBDocuments(limit = 50, offset = 0) {
  const res = await fetch(`${API_BASE}/knowledge/?limit=${limit}&offset=${offset}`, { headers: headers() });
  return handleRes<any>(res);
}
export async function searchKB(query: string, limit = 10) {
  const res = await fetch(`${API_BASE}/knowledge/search?query=${encodeURIComponent(query)}&limit=${limit}`, { headers: headers() });
  return handleRes<any>(res);
}
export async function deleteKBDocument(id: number) {
  const res = await fetch(`${API_BASE}/knowledge/${id}`, { method: "DELETE", headers: headers() });
  return handleRes<any>(res);
}

// ── Database ──────────────────────────────────────
export async function getDBTables() {
  const res = await fetch(`${API_BASE}/database/tables`, { headers: headers() });
  return handleRes<{ tables: string[] }>(res);
}
export async function getDBTableRows(name: string, limit = 50, offset = 0) {
  const res = await fetch(`${API_BASE}/database/tables/${encodeURIComponent(name)}?limit=${limit}&offset=${offset}`, { headers: headers() });
  return handleRes<{ table: string; columns: string[]; rows: any[]; total: number; limit: number; offset: number }>(res);
}
export async function getDBTableSchema(name: string) {
  const res = await fetch(`${API_BASE}/database/tables/${encodeURIComponent(name)}/schema`, { headers: headers() });
  return handleRes<any>(res);
}

// ── Workspace ──────────────────────────────────────
export async function getWorkspaceTree(path = ".", depth = 4, projectId?: string) {
  const params = new URLSearchParams({ path, depth: String(depth) });
  if (projectId) params.set("project_id", projectId);
  const res = await fetch(`${API_BASE}/workspace/tree?${params}`, { headers: headers() });
  return handleRes<{ root: string; tree: any[]; total_entries: number; truncated: boolean }>(res);
}
export async function getWorkspaceFile(path: string, projectId?: string) {
  const params = new URLSearchParams({ path });
  if (projectId) params.set("project_id", projectId);
  const res = await fetch(`${API_BASE}/workspace/file?${params}`, { headers: headers() });
  return handleRes<{ path: string; content: string; size: number; language: string }>(res);
}
export async function saveWorkspaceFile(path: string, content: string, projectId?: string) {
  const params = projectId ? `?project_id=${projectId}` : "";
  const res = await fetch(`${API_BASE}/workspace/file${params}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ path, content }),
  });
  return handleRes<{ success: boolean; path: string; size: number }>(res);
}
export async function patchWorkspaceFile(path: string, oldStr: string, newStr: string) {
  const res = await fetch(`${API_BASE}/workspace/patch`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ path, old_str: oldStr, new_str: newStr }),
  });
  return handleRes<{ success: boolean; path: string; applied: boolean }>(res);
}
export async function searchWorkspace(query: string, path = ".", maxResults = 100) {
  const res = await fetch(`${API_BASE}/workspace/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ query, path, max_results: maxResults }),
  });
  return handleRes<{ results: Array<{ file: string; line: number; content: string }>; total: number; truncated: boolean }>(res);
}

// ── Config ──────────────────────────────────────
export async function getConfig() {
  const res = await fetch(`${API_BASE}/config/`, { headers: headers() });
  return handleRes<any>(res);
}

export async function updateConfig(data: { ollama_model?: string; ollama_temperature?: number; ollama_context_length?: number }) {
  const res = await fetch(`${API_BASE}/config/`, { method: "POST", headers: headers(), body: JSON.stringify(data) });
  return handleRes<{ success: boolean; updated: Record<string, unknown> }>(res);
}

export async function listModels() {
  const res = await fetch(`${API_BASE}/config/models`, { headers: headers() });
  return handleRes<{ models: { name: string; size: number; parameter_size: string; family: string }[]; current: string }>(res);
}

// ── Service management ──────────────────────────────────────────────────────
export interface ServiceStatus {
  enabled: boolean;
  reachable?: boolean;
  active: boolean;
  model?: string;
  base_url?: string;
  url?: string;
  provider?: string;
}
export interface ServicesResponse {
  ollama: ServiceStatus;
  qdrant: ServiceStatus;
  image_gen: ServiceStatus;
}

export async function getServices(): Promise<ServicesResponse> {
  const res = await fetch(`${API_BASE}/config/services`, { headers: headers() });
  return handleRes<ServicesResponse>(res);
}

export async function toggleService(service: string, enabled: boolean): Promise<{ success: boolean; service: string; enabled: boolean }> {
  const res = await fetch(`${API_BASE}/config/services`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ service, enabled }),
  });
  return handleRes(res);
}

// ── System Manager ──────────────────────────────────────────────────────────
export async function getDisk() {
  const res = await fetch(`${API_BASE}/system-manager/disk`, { headers: headers() });
  return handleRes<{ total: number; used: number; free: number; percent: number; home_used: number; total_human: string; used_human: string; free_human: string; home_used_human: string }>(res);
}

export async function getCaches() {
  const res = await fetch(`${API_BASE}/system-manager/caches`, { headers: headers() });
  return handleRes<{ caches: { path: string; label: string; size_bytes: number; size_human: string; deletable: boolean }[] }>(res);
}

export async function scanLargeFiles(path: string, minMb = 50, limit = 50) {
  const res = await fetch(`${API_BASE}/system-manager/scan/large-files`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ path, min_mb: minMb, limit }),
  });
  return handleRes<{ files: { path: string; size_bytes: number; size_human: string; modified: number }[]; count: number; scanned_path: string }>(res);
}

export async function scanDuplicates(path: string, minKb = 100) {
  const res = await fetch(`${API_BASE}/system-manager/scan/duplicates`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ path, min_kb: minKb }),
  });
  return handleRes<{ groups: { hash: string; count: number; size_each_human: string; wasted_bytes: number; wasted_human: string; files: { path: string; size_bytes: number; size_human: string; modified: number }[] }[]; group_count: number; total_wasted_bytes: number; total_wasted_human: string; scanned_path: string }>(res);
}

export async function cleanupPaths(paths: string[]) {
  const res = await fetch(`${API_BASE}/system-manager/cleanup`, {
    method: "DELETE",
    headers: headers(),
    body: JSON.stringify({ paths }),
  });
  return handleRes<{ deleted: number; freed_bytes: number; freed_human: string; errors: string[] }>(res);
}

export async function getProcesses() {
  const res = await fetch(`${API_BASE}/system-manager/processes`, { headers: headers() });
  return handleRes<{ processes: { pid: number; name: string; cpu_percent: number; memory_percent: number; status: string; username: string }[] }>(res);
}

// ── Logs ──────────────────────────────────────────
export async function getLogs(limit: number = 100, level?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (level) params.set("level", level);
  const res = await fetch(`${API_BASE}/logs/?${params}`, { headers: headers() });
  return handleRes<{ count: number; entries: Array<{ timestamp: string; level: string; event: string; logger: string; [k: string]: unknown }> }>(res);
}

// ── Metrics ──────────────────────────────────────────
export async function getMetrics() {
  const res = await fetch(`${API_BASE}/metrics/`, { headers: headers() });
  return handleRes<{ timings: Record<string, { count: number; p50_ms: number; p95_ms: number; avg_ms: number; max_ms: number }>; counters: Record<string, number>; errors: Record<string, number> }>(res);
}

// ── RAG (Native Knowledge Base) ──────────────────────────────────────
export async function getRAGHealth() {
  const res = await fetch(`${API_BASE}/rag/health`, { headers: headers() });
  return handleRes<{ qdrant: string; embedding_model: string; doc_count: number; collection: string }>(res);
}
export async function getRAGStats() {
  const res = await fetch(`${API_BASE}/rag/stats`, { headers: headers() });
  return handleRes<{ collection: string; points_count: number; status: string }>(res);
}
export async function ragIngest(paths: string[], force = false) {
  const res = await fetch(`${API_BASE}/rag/ingest`, { method: "POST", headers: headers(), body: JSON.stringify({ paths, force }) });
  return handleRes<{ files_processed: number; chunks_created: number; skipped_unchanged: number; errors: string[] }>(res);
}
export async function ragDeleteSource(sourcePath: string) {
  const res = await fetch(`${API_BASE}/rag/source`, { method: "DELETE", headers: headers(), body: JSON.stringify({ source_path: sourcePath }) });
  return handleRes<any>(res);
}

// ── Git ─────────────────────────────────────────────
export async function gitStatus() {
  const res = await fetch(`${API_BASE}/git/status`, { headers: headers() });
  return handleRes<{ branch: string; files: { status: string; path: string }[]; clean: boolean }>(res);
}
export async function gitDiff(file?: string, staged = false) {
  const params = new URLSearchParams();
  if (file) params.set("file", file);
  if (staged) params.set("staged", "true");
  const res = await fetch(`${API_BASE}/git/diff?${params}`, { headers: headers() });
  return handleRes<{ diff: string; file?: string }>(res);
}
export async function gitLog(limit = 20) {
  const res = await fetch(`${API_BASE}/git/log?limit=${limit}`, { headers: headers() });
  return handleRes<{ hash: string; short_hash: string; author: string; date: string; message: string }[]>(res);
}
export async function gitCommit(message: string, files?: string[]) {
  const res = await fetch(`${API_BASE}/git/commit`, { method: "POST", headers: headers(), body: JSON.stringify({ message, files }) });
  return handleRes<{ hash: string; message: string }>(res);
}

// ── Images ──────────────────────────────────────────
export interface ImageGenRequest {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
}
export interface ImageGenResponse {
  success: boolean;
  image_id?: string;
  path?: string;
  seed?: number;
  width?: number;
  height?: number;
  generation_time_ms?: number;
  error?: string;
}
export interface ImageInfo {
  id: number;
  image_id: string;
  prompt: string;
  negative_prompt?: string;
  width: number;
  height: number;
  steps: number;
  seed?: number;
  model?: string;
  provider: string;
  relative_path: string;
  file_size: number;
  generation_time_ms: number;
  status: string;
  created_at: string;
  error_message?: string | null;
}
export async function generateImage(req: ImageGenRequest) {
  const res = await fetch(`${API_BASE}/images/generate`, { method: "POST", headers: headers(), body: JSON.stringify(req) });
  return handleRes<ImageGenResponse>(res);
}
export async function getImageProviderStatus() {
  const res = await fetch(`${API_BASE}/images/provider/status`, { headers: headers() });
  return handleRes<{ provider: string; available: boolean; supported_providers: string[] }>(res);
}
export async function getImageHistory(page = 1, perPage = 20) {
  const res = await fetch(`${API_BASE}/images/history?page=${page}&per_page=${perPage}`, { headers: headers() });
  return handleRes<{ images: ImageInfo[]; total: number; page: number; per_page: number }>(res);
}
export async function deleteImage(imageId: string) {
  const res = await fetch(`${API_BASE}/images/${imageId}`, { method: "DELETE", headers: headers() });
  return handleRes<{ success: boolean }>(res);
}
export function imageUrl(relativePath: string) {
  return `${API_BASE}/files/${relativePath}`;
}

// ── VM Monitoring + Users ──────────────────────────
export async function getVMMonitoring(id: number) {
  const res = await fetch(`${API_BASE}/vms/${id}/monitoring`, { headers: headers() });
  return handleRes<{ cpu_percent: number; memory_percent: number; memory_used_mb: number; memory_total_mb: number; disk_percent: number; disk_used_gb: number; disk_total_gb: number; uptime: string; load_avg: string }>(res);
}
export async function testVMConnection(id: number) {
  const res = await fetch(`${API_BASE}/vms/${id}/test`, { method: "POST", headers: headers() });
  return handleRes<{ success: boolean; latency_ms: number; message: string }>(res);
}
export async function getVMUsers(id: number) {
  const res = await fetch(`${API_BASE}/vms/${id}/users`, { headers: headers() });
  return handleRes<any[]>(res);
}
export async function createVMUser(vmId: number, data: { username: string; shell?: string; groups?: string[] }) {
  const res = await fetch(`${API_BASE}/vms/${vmId}/users`, { method: "POST", headers: headers(), body: JSON.stringify(data) });
  return handleRes<any>(res);
}
export async function deleteVMUser(vmId: number, username: string) {
  const res = await fetch(`${API_BASE}/vms/${vmId}/users/${username}`, { method: "DELETE", headers: headers() });
  return handleRes<any>(res);
}

// ── Webhooks ──────────────────────────────────────
export async function getWebhooks() {
  const res = await fetch(`${API_BASE}/webhooks/`, { headers: headers() });
  return handleRes<any[]>(res);
}
export async function createWebhook(data: { name: string; url: string; events: string[]; secret?: string }) {
  const res = await fetch(`${API_BASE}/webhooks/`, { method: "POST", headers: headers(), body: JSON.stringify(data) });
  return handleRes<any>(res);
}
export async function deleteWebhook(id: number) {
  const res = await fetch(`${API_BASE}/webhooks/${id}`, { method: "DELETE", headers: headers() });
  return handleRes<any>(res);
}
export async function testWebhook(id: number) {
  const res = await fetch(`${API_BASE}/webhooks/${id}/test`, { method: "POST", headers: headers() });
  return handleRes<any>(res);
}

// ── Scheduler ──────────────────────────────────────
export async function getSchedulerJobs() {
  const res = await fetch(`${API_BASE}/scheduler/jobs`, { headers: headers() });
  return handleRes<any[]>(res);
}
export async function createSchedulerJob(data: { name: string; cron: string; command: string; enabled?: boolean }) {
  const res = await fetch(`${API_BASE}/scheduler/jobs`, { method: "POST", headers: headers(), body: JSON.stringify(data) });
  return handleRes<any>(res);
}
export async function deleteSchedulerJob(id: string) {
  const res = await fetch(`${API_BASE}/scheduler/jobs/${id}`, { method: "DELETE", headers: headers() });
  return handleRes<any>(res);
}
export async function toggleSchedulerJob(id: string, enabled: boolean) {
  const res = await fetch(`${API_BASE}/scheduler/jobs/${id}/toggle`, { method: "POST", headers: headers(), body: JSON.stringify({ enabled }) });
  return handleRes<any>(res);
}

// ── Runbooks ──────────────────────────────────────
export async function getRunbooks() {
  const res = await fetch(`${API_BASE}/runbooks/`, { headers: headers() });
  return handleRes<any[]>(res);
}
export async function createRunbook(data: { name: string; description?: string; steps: { command: string; description?: string }[] }) {
  const res = await fetch(`${API_BASE}/runbooks/`, { method: "POST", headers: headers(), body: JSON.stringify(data) });
  return handleRes<any>(res);
}
export async function deleteRunbook(id: number) {
  const res = await fetch(`${API_BASE}/runbooks/${id}`, { method: "DELETE", headers: headers() });
  return handleRes<any>(res);
}
export async function executeRunbook(id: number, vmId?: number) {
  const res = await fetch(`${API_BASE}/runbooks/${id}/execute`, { method: "POST", headers: headers(), body: JSON.stringify({ vm_id: vmId }) });
  return handleRes<any>(res);
}

// ── Infrastructure Stats ──────────────────────────
export async function getInfraStats() {
  const res = await fetch(`${API_BASE}/infrastructure/stats`, { headers: headers() });
  return handleRes<any>(res);
}

// ── Projects ──────────────────────────────────────
export interface Project { id: string; name: string; path: string; color: string; }

export async function listProjects() {
  const res = await fetch(`${API_BASE}/projects`, { headers: headers() });
  return handleRes<Project[]>(res);
}
export async function createProject(name: string, path: string) {
  const res = await fetch(`${API_BASE}/projects`, { method: "POST", headers: headers(), body: JSON.stringify({ name, path }) });
  return handleRes<Project>(res);
}
export async function deleteProject(id: string) {
  const res = await fetch(`${API_BASE}/projects/${id}`, { method: "DELETE", headers: headers() });
  if (res.status === 204) return;
  return handleRes<any>(res);
}

// ── Filesystem Browser ────────────────────────────
export interface FsEntry { name: string; path: string; is_dir: boolean; is_project: boolean; }
export interface FsBrowseResult { path: string; name: string; parent: string | null; entries: FsEntry[]; }

export async function getHomePath() {
  const res = await fetch(`${API_BASE}/filesystem/home`, { headers: headers() });
  return handleRes<{ path: string }>(res);
}
export async function browseFilesystem(path: string) {
  const res = await fetch(`${API_BASE}/filesystem/browse?path=${encodeURIComponent(path)}`, { headers: headers() });
  return handleRes<FsBrowseResult>(res);
}

// ── MCP Servers ───────────────────────────────────
export interface MCPServer { id: string; name: string; command: string; args: string[]; env: Record<string, string>; description: string; }
export interface MCPTool { name: string; description?: string; inputSchema?: any; }

export async function listMCPServers() {
  const res = await fetch(`${API_BASE}/mcp/servers`, { headers: headers() });
  return handleRes<MCPServer[]>(res);
}
export async function addMCPServer(data: Omit<MCPServer, "id">) {
  const res = await fetch(`${API_BASE}/mcp/servers`, { method: "POST", headers: headers(), body: JSON.stringify(data) });
  return handleRes<MCPServer>(res);
}
export async function updateMCPServer(id: string, data: Omit<MCPServer, "id">) {
  const res = await fetch(`${API_BASE}/mcp/servers/${id}`, { method: "PUT", headers: headers(), body: JSON.stringify(data) });
  return handleRes<MCPServer>(res);
}
export async function deleteMCPServer(id: string) {
  const res = await fetch(`${API_BASE}/mcp/servers/${id}`, { method: "DELETE", headers: headers() });
  if (res.status === 204) return;
  return handleRes<any>(res);
}
export async function probeMCPServer(id: string) {
  const res = await fetch(`${API_BASE}/mcp/servers/${id}/probe`, { method: "POST", headers: headers() });
  return handleRes<{ ok: boolean; tool_count: number; tools: MCPTool[] }>(res);
}
export async function importClaudeDesktopConfig(config: { mcpServers: Record<string, any> }) {
  const res = await fetch(`${API_BASE}/mcp/import-claude-config`, { method: "POST", headers: headers(), body: JSON.stringify(config) });
  return handleRes<{ imported: number; servers: MCPServer[] }>(res);
}

// ── Doc Studio ───────────────────────────────────────────────────────────────

export interface DSNotebook {
  id: string;
  name: string;
  project_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DSSource {
  id: string;
  kind: "upload" | "url" | "project_ingest";
  title: string;
  is_enabled: boolean;
  status: "pending" | "indexing" | "ready" | "error";
  meta?: Record<string, any>;
  created_at?: string | null;
}

export interface DSArtifact {
  id: string;
  template: string;
  title: string;
  content_md?: string;
  has_md?: boolean;
  has_docx?: boolean;
  has_pdf?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DSTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  gradient: string;
  sections: string[];
}

export async function listDSTemplates(): Promise<{ templates: DSTemplate[] }> {
  const res = await fetch(`${API_BASE}/doc-studio/templates`, { headers: headers() });
  return handleRes(res);
}

export async function listNotebooks(): Promise<{ notebooks: DSNotebook[] }> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks`, { headers: headers() });
  return handleRes(res);
}

export async function createNotebook(name: string, project_id?: string): Promise<DSNotebook> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name, project_id }),
  });
  return handleRes(res);
}

export async function renameNotebook(id: string, name: string): Promise<DSNotebook> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ name }),
  });
  return handleRes(res);
}

export async function deleteNotebook(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${id}`, { method: "DELETE", headers: headers() });
  if (res.status === 204) return;
  return handleRes(res);
}

export async function listSources(notebookId: string): Promise<{ sources: DSSource[] }> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/sources`, { headers: headers() });
  return handleRes(res);
}

export async function uploadSource(notebookId: string, file: File): Promise<DSSource> {
  const form = new FormData();
  form.append("file", file);
  const h: Record<string, string> = { "X-API-Key": API_KEY };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("jwt_token");
    if (token) h["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/sources/upload`, {
    method: "POST",
    headers: h,
    body: form,
  });
  return handleRes(res);
}

export async function addUrlSource(notebookId: string, url: string, title?: string): Promise<DSSource> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/sources/url`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ url, title }),
  });
  return handleRes(res);
}

export async function addProjectSource(notebookId: string, project_path: string, title?: string): Promise<DSSource> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/sources/project`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ project_path, title }),
  });
  return handleRes(res);
}

export async function toggleSource(notebookId: string, sourceId: string, is_enabled: boolean): Promise<DSSource> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/sources/${sourceId}/toggle`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ is_enabled }),
  });
  return handleRes(res);
}

export async function deleteSource(notebookId: string, sourceId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/sources/${sourceId}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (res.status === 204) return;
  return handleRes(res);
}

export function streamNotebookChat(
  notebookId: string,
  message: string,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal,
  modelOverride?: string,
) {
  const body = JSON.stringify({ message, model_override: modelOverride ?? null });
  fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/chat`, {
    method: "POST",
    headers: headers(),
    body,
    signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`API ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { onEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") onEvent({ type: "error", data: { message: err.message } });
    });
}

export function streamStudioRun(
  notebookId: string,
  templateId: string,
  extraContext: string,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal,
  modelOverride?: string,
) {
  const body = JSON.stringify({ template_id: templateId, extra_context: extraContext, model_override: modelOverride ?? null });
  fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/studio/run`, {
    method: "POST",
    headers: headers(),
    body,
    signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { onEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") onEvent({ type: "error", data: { message: err.message } });
    });
}

export async function listArtifacts(notebookId: string): Promise<{ artifacts: DSArtifact[] }> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/artifacts`, { headers: headers() });
  return handleRes(res);
}

export async function getArtifact(notebookId: string, artifactId: string): Promise<DSArtifact> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/artifacts/${artifactId}`, { headers: headers() });
  return handleRes(res);
}

export async function deleteArtifact(notebookId: string, artifactId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/doc-studio/notebooks/${notebookId}/artifacts/${artifactId}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (res.status === 204) return;
  return handleRes(res);
}

export function downloadArtifactUrl(notebookId: string, artifactId: string, format: "md" | "docx" | "pdf"): string {
  return `${API_BASE}/doc-studio/notebooks/${notebookId}/artifacts/${artifactId}/download/${format}`;
}
