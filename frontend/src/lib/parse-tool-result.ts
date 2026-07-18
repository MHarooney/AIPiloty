/**
 * Parse tool output JSON from generate_* tools to extract downloadable file info.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api/v1";

const MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export interface ParsedFile {
  fileName: string;
  downloadUrl: string;
  mimeType: string;
}

/** Tool names that produce downloadable files. */
const GENERATE_TOOLS = new Set([
  "generate_pdf",
  "generate_docx",
  "generate_pptx",
  "generate_xlsx",
  "generate_image",
]);

export function isDownloadableTool(toolName: string): boolean {
  return GENERATE_TOOLS.has(toolName);
}

/**
 * Parse tool output string (JSON or plain text) and extract file info.
 * Handles multiple backend output shapes:
 *  - { relative_path: "..." }
 *  - { path: "..." }
 *  - { output: { relative_path: "..." } }
 *  - { file_path: "..." }
 */
function extractRelativePath(data: Record<string, unknown>): string | null {
  const direct =
    data.relative_path ??
    data.file_path ??
    data.path;
  if (typeof direct === "string" && direct) return direct;

  const out = data.output;
  if (out && typeof out === "object" && !Array.isArray(out)) {
    const o = out as Record<string, unknown>;
    const nested =
      o.relative_path ?? o.file_path ?? o.path;
    if (typeof nested === "string" && nested) return nested;
  }
  if (typeof out === "string" && out.trim().startsWith("{")) {
    try {
      return extractRelativePath(JSON.parse(out) as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  }
  return null;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

export function isImageFile(file: ParsedFile): boolean {
  const ext = file.fileName.includes(".")
    ? `.${file.fileName.split(".").pop()!.toLowerCase()}`
    : "";
  return IMAGE_EXTENSIONS.has(ext);
}

function buildGeneratedFileUrl(relPath: string): string {
  // Route is /files/generated/{path}; strip leading generated/ to avoid double prefix.
  let fp = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (fp.startsWith("generated/")) fp = fp.slice("generated/".length);
  // Encode each segment, keep slashes for FastAPI {filepath:path}
  const encoded = fp
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${API_BASE}/files/generated/${encoded}`;
}

export function parseToolOutput(toolName: string, output: string): ParsedFile | null {
  if (!isDownloadableTool(toolName)) return null;

  try {
    const data = JSON.parse(output) as Record<string, unknown>;
    const relPath = extractRelativePath(data);

    // Prefer backend-provided download_url when present
    const rawUrl = data.download_url;
    if (typeof rawUrl === "string" && rawUrl.trim()) {
      const url = rawUrl.startsWith("http")
        ? rawUrl
        : `${API_BASE.replace(/\/api\/v1$/, "")}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
      // Normalize legacy /api/v1/files/generated/... paths that omit the generated/ segment prefix
      let downloadUrl = url;
      if (url.includes("/api/v1/files/") && !url.includes("/api/v1/files/generated/")) {
        downloadUrl = url.replace("/api/v1/files/", "/api/v1/files/generated/");
      }
      const fileName =
        (typeof relPath === "string" && relPath.split("/").pop()) ||
        downloadUrl.split("/").pop() ||
        "file";
      const ext = fileName.includes(".") ? `.${fileName.split(".").pop()!.toLowerCase()}` : "";
      return {
        fileName,
        downloadUrl,
        mimeType: MIME_MAP[ext] || "application/octet-stream",
      };
    }

    if (typeof relPath !== "string" || !relPath) return null;

    const fileName = relPath.split("/").pop() || relPath;
    const ext = fileName.includes(".") ? `.${fileName.split(".").pop()!.toLowerCase()}` : "";
    const mimeType = MIME_MAP[ext] || "application/octet-stream";

    return { fileName, downloadUrl: buildGeneratedFileUrl(relPath), mimeType };
  } catch {
    // Not valid JSON — may be plain text success message
    return null;
  }
}
