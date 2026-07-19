/**
 * Normalize LLM chat Markdown before render:
 * - unwrap ```markdown / ```md fences around tables
 * - unwrap mis-labeled ```mermaid pipe tables (via repair-mermaid)
 * - rebuild vertical one-cell-per-line pipe tables into GFM rows
 */

import { unwrapMermaidPipeTablesInMarkdown } from "@/lib/repair-mermaid";

const FENCE_RE = /```(?:markdown|md|gfm|text)?\s*\n([\s\S]*?)```/gi;
const SINGLE_CELL_RE = /^\|\s*([^|\n]*?)\s*$/;
const SEP_CELL_RE = /^:?-{2,}:?$/;

function looksLikePipeTable(body: string): boolean {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|")) continue;
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      return true;
    }
  }
  return false;
}

function looksVerticalTable(body: string): boolean {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 6) return false;
  const single = lines.filter((l) => l === "|" || SINGLE_CELL_RE.test(l)).length;
  return single >= Math.max(6, Math.floor(lines.length * 0.7));
}

/** Rebuild `|\\n| Model\\n|\\n| Speed` into a real GFM table. */
export function repairVerticalPipeTable(text: string): string {
  if (!text || !text.includes("|")) return text;
  // Already has a multi-column row
  if (/^\|[^|\n]+\|[^|\n]+\|/m.test(text) && looksLikePipeTable(text)) {
    return text;
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cells: string[] = [];
  const before: string[] = [];
  const after: string[] = [];
  let saw = false;
  let inTable = false;

  for (const line of lines) {
    const t = line.trim();
    if (t === "|") {
      saw = true;
      inTable = true;
      continue;
    }
    const m = SINGLE_CELL_RE.exec(t);
    if (m && !m[1].includes("|")) {
      saw = true;
      inTable = true;
      cells.push(m[1].trim());
      continue;
    }
    if (inTable && !t) continue;
    if (saw && t && !t.startsWith("|")) {
      inTable = false;
      after.push(line);
      continue;
    }
    if (!saw) before.push(line);
    else after.push(line);
  }

  if (cells.length < 4) return text;

  const sepIdx = cells.findIndex((c) => SEP_CELL_RE.test(c.replace(/\s/g, "")));
  if (sepIdx < 2) return text;

  const headers = cells.slice(0, sepIdx).filter(Boolean);
  const data = cells.slice(sepIdx + 1);
  const ncols = headers.length;
  if (ncols < 2) return text;

  const rows: string[][] = [];
  for (let i = 0; i < data.length; i += ncols) {
    const chunk = data.slice(i, i + ncols);
    if (!chunk.some(Boolean)) continue;
    while (chunk.length < ncols) chunk.push("");
    rows.push(chunk);
  }

  const table = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

  return [before.join("\n").trim(), table, after.join("\n").trim()]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function unwrapMarkdownTableFences(markdown: string): string {
  if (!markdown || !markdown.includes("```")) return markdown;
  return markdown.replace(FENCE_RE, (full, body: string) => {
    const raw = String(body).trim();
    if (looksLikePipeTable(raw) || looksVerticalTable(raw)) return raw;
    if (raw.split("|").length > 4 && !/flowchart/i.test(raw)) return raw;
    return full;
  });
}

const SEP_ROW_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/** Insert `|---|` when header+body rows exist without a separator. */
export function ensureGfmTableSeparator(text: string): string {
  if (!text || !text.includes("|")) return text;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let insertedForBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t.startsWith("|")) {
      insertedForBlock = false;
      out.push(line);
      continue;
    }
    if (SEP_ROW_RE.test(t)) {
      insertedForBlock = true;
      out.push(line);
      continue;
    }
    if (
      !insertedForBlock &&
      (t.match(/\|/g) || []).length >= 3 &&
      i + 1 < lines.length
    ) {
      const nxt = lines[i + 1].trim();
      if (
        nxt.startsWith("|") &&
        (nxt.match(/\|/g) || []).length >= 3 &&
        !SEP_ROW_RE.test(nxt)
      ) {
        const ncols = Math.max(1, (t.match(/\|/g) || []).length - 1);
        out.push(line);
        out.push(`| ${Array(ncols).fill("---").join(" | ")} |`);
        insertedForBlock = true;
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Full chat Markdown normalize pipeline for the renderer. */
export function normalizeChatMarkdown(markdown: string): string {
  let out = markdown || "";
  out = unwrapMermaidPipeTablesInMarkdown(out);
  out = unwrapMarkdownTableFences(out);
  out = repairVerticalPipeTable(out);
  out = ensureGfmTableSeparator(out);
  out = unwrapMarkdownTableFences(out);
  return out;
}
