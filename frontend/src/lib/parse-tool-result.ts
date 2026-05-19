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

export function parseToolOutput(toolName: string, output: string): ParsedFile | null {
  if (!isDownloadableTool(toolName)) return null;

  try {
    const data = JSON.parse(output) as Record<string, unknown>;
    const relPath = extractRelativePath(data);

    if (typeof relPath !== "string" || !relPath) return null;

    const fileName = relPath.split("/").pop() || relPath;
    const ext = fileName.includes(".") ? `.${fileName.split(".").pop()!.toLowerCase()}` : "";
    const mimeType = MIME_MAP[ext] || "application/octet-stream";

    // Backend serves files at /api/v1/files/generated/{relative_path}
    const downloadUrl = `${API_BASE}/files/generated/${encodeURIComponent(relPath)}`;

    return { fileName, downloadUrl, mimeType };
  } catch {
    // Not valid JSON — may be plain text success message
    return null;
  }
}
