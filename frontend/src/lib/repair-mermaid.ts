/**
 * Best-effort repair of common Mermaid mistakes from small LLMs.
 * Returns candidates in preference order (original first, then repaired variants).
 */

/** `style Foo --> Bar` is invalid — style only takes CSS props. */
const STYLE_ARROW_RE = /^\s*style\s+(\S+)\s*(-->|---|-.->|==>|~~>)\s*(.+)$/i;

/** Bare node ids that contain / or spaces break the parser. */
const BAD_ID_IN_BRACKETS_RE = /(\b)([A-Za-z][\w./-]*)\[([^\]]*)\]/g;

/** `Design[Design]((10d))` / `A[Label](round)` — mixed shapes. */
const MIXED_SHAPE_RE =
  /\b([A-Za-z][\w]*)\[([^\]]*)\]\s*(\(\([^)]*\)\)|\([^)]*\))/g;

/** `title=Foo` or `title Foo Bar` inside graph/flowchart (invalid). */
const TITLE_EQ_RE = /^\s*title\s*=\s*(.+)$/i;
const TITLE_BARE_RE = /^\s*title\s+(?!\:)(.+)$/i;

const DIAGRAM_HEADERS =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|mindmap|timeline|gitGraph|journey|quadrantChart|sankey-beta|xychart-beta|requirementDiagram|C4Context)\b/i;

const DURATION_RE = /(\d+)\s*(d|w|h|m|day|days|week|weeks|hour|hours)\b/i;

/** GFM table separator: `|---|---|` or `| :--- | ---: |` */
const PIPE_TABLE_SEP_RE =
  /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/**
 * True when the body is a GitHub-flavored Markdown pipe table (not Mermaid).
 * LLMs often mis-label tables as ```mermaid; salvage must NOT prepend flowchart TD
 * (the `|---|` separator matches a naive `---` edge check).
 */
export function looksLikeMarkdownPipeTable(source: string): boolean {
  const lines = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Ignore accidental mermaid headers the model/salvage may have prepended
  const body = lines.filter(
    (l) => !/^(flowchart|graph)\b/i.test(l) && !/^%%/.test(l),
  );
  if (body.length < 2) return false;

  for (let i = 0; i < body.length - 1; i++) {
    const header = body[i];
    const sep = body[i + 1];
    if (!PIPE_TABLE_SEP_RE.test(sep)) continue;
    // Header must look like a pipe row (at least one `|`) and not a diagram directive
    if (!header.includes("|")) continue;
    if (DIAGRAM_HEADERS.test(header)) continue;
    // Prefer classic `| col | col |` rows; also accept `col | col`
    const cells = header.split("|").filter((c) => c.trim().length > 0);
    if (cells.length >= 2) return true;
  }
  return false;
}

/** Strip junk mermaid headers and return the pipe-table markdown body. */
export function extractMarkdownPipeTable(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (/^(flowchart|graph)\b/i.test(t)) return false;
    if (/^%%/.test(t)) return false;
    return true;
  });
  // Drop leading/trailing blank lines
  while (kept.length && !kept[0].trim()) kept.shift();
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.join("\n").trim();
}

/**
 * If a ```mermaid fence wraps a Markdown pipe table, unwrap it to plain GFM.
 * Leaves real Mermaid diagrams untouched.
 */
export function unwrapMermaidPipeTablesInMarkdown(markdown: string): string {
  if (!markdown || !/```mermaid/i.test(markdown)) return markdown;
  return markdown.replace(
    /```mermaid[^\n]*\n([\s\S]*?)```/gi,
    (_full, body: string) => {
      const raw = String(body);
      if (!looksLikeMarkdownPipeTable(raw)) {
        return _full;
      }
      return extractMarkdownPipeTable(raw);
    },
  );
}

function sanitizeNodeId(raw: string): string {
  return (
    raw
      .replace(/[^A-Za-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_") || "node"
  );
}

function repairStyleArrows(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const m = line.match(STYLE_ARROW_RE);
      if (!m) return line;
      return `${m[1]} ${m[2]} ${m[3].trim()}`;
    })
    .join("\n");
}

function repairBracketNodeIds(source: string): string {
  return source.replace(BAD_ID_IN_BRACKETS_RE, (_full, pre, id, label) => {
    if (!/[\/\s.-]/.test(id)) return `${pre}${id}[${label}]`;
    return `${pre}${sanitizeNodeId(id)}[${label}]`;
  });
}

function repairBogusStyleLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t.toLowerCase().startsWith("style ")) return true;
      if (/fill\s*:|stroke\s*:|color\s*:|stroke-width\s*:/i.test(t)) return true;
      if (/-->|---|==>/.test(t)) return false;
      return /style\s+\S+\s+\S+/i.test(t);
    })
    .join("\n");
}

/**
 * Extract a title from invalid `title=...` / `title ...` lines.
 * Returns cleaned source + optional title text.
 */
function extractAndStripTitles(source: string): { source: string; title?: string } {
  let title: string | undefined;
  const lines = source.split("\n").filter((line) => {
    const eq = line.match(TITLE_EQ_RE);
    if (eq) {
      title = eq[1].trim().replace(/^["']|["']$/g, "");
      return false;
    }
    // Valid gantt/pie use `title Foo` — keep those when header is gantt/pie
    return true;
  });

  const header = (lines[0] || "").trim().toLowerCase();
  const isGanttOrPie = header.startsWith("gantt") || header.startsWith("pie");

  if (!isGanttOrPie) {
    const cleaned = lines.filter((line) => {
      const bare = line.match(TITLE_BARE_RE);
      // `title:` YAML-ish or mermaid frontmatter-ish inside body
      if (/^\s*title\s*:/.test(line)) {
        title = line.replace(/^\s*title\s*:\s*/i, "").trim().replace(/^["']|["']$/g, "");
        return false;
      }
      if (bare) {
        title = bare[1].trim().replace(/^["']|["']$/g, "");
        return false;
      }
      return true;
    });
    return { source: cleaned.join("\n"), title };
  }

  return { source: lines.join("\n"), title };
}

/** Keep title as a Mermaid comment (frontmatter is flaky across environments). */
function applyTitleComment(source: string, title?: string): string {
  if (!title) return source;
  const comment = `%% ${title.replace(/\n/g, " ").slice(0, 120)}`;
  if (source.includes(comment)) return source;
  const lines = source.split("\n");
  // Insert after diagram header (or after frontmatter block if present)
  let idx = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    idx = end >= 0 ? end + 1 : 0;
  }
  const headerIdx = lines.findIndex((l, i) => i >= idx && DIAGRAM_HEADERS.test(l.trim()));
  const at = headerIdx >= 0 ? headerIdx + 1 : idx;
  lines.splice(at, 0, comment);
  return lines.join("\n");
}


/** Fix `Id[Label]((10d))` → `Id["Label (10d)"]`. */
function repairMixedShapes(source: string): string {
  return source.replace(MIXED_SHAPE_RE, (_full, id, label, shape) => {
    const inner = String(shape).replace(/^\(+|\)+$/g, "").trim();
    const lab = String(label).trim() || id;
    const combined = inner ? `${lab} (${inner})` : lab;
    return `${id}["${combined.replace(/"/g, "'")}"]`;
  });
}

function normalizeHeader(source: string): string {
  // Never treat GFM pipe tables as flowcharts (`|---|` contains `---`)
  if (looksLikeMarkdownPipeTable(source)) return source;

  const lines = source.trimStart().split("\n");
  if (!lines.length) return source;
  // Skip frontmatter when detecting header
  let headerIdx = 0;
  if (lines[0].trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    headerIdx = end >= 0 ? end + 1 : 0;
  }
  const first = (lines[headerIdx] || "").trim();
  const firstLower = first.toLowerCase();
  if (firstLower.startsWith("graph ") || firstLower.startsWith("flowchart ")) {
    lines[headerIdx] = lines[headerIdx]
      .replace(/^\s*Graph\b/i, "graph")
      .replace(/^\s*Flowchart\b/i, "flowchart");
  }
  // Real Mermaid edges only — not Markdown table separators
  const hasMermaidEdge =
    /-->|==>|-\.->|~~>/.test(source) || /(?<!\|)---(?!\|)/.test(source);
  if (!DIAGRAM_HEADERS.test(first) && hasMermaidEdge) {
    lines.splice(headerIdx, 0, "flowchart TD");
  }
  return lines.join("\n");
}

function repairSingleDashArrows(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      if (/^\s*style\b/i.test(line)) return line;
      return line.replace(/(\S)\s+->\s+(\S)/g, "$1 --> $2");
    })
    .join("\n");
}

/** Collect node ids from common declarations when the model forgot edges. */
function collectDeclaredNodes(source: string): { id: string; label: string }[] {
  const nodes: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  const re =
    /\b([A-Za-z][\w]*)\s*(?:\[([^\]]*)\]|\(\[([^\]]*)\]\)|\(\(([^)]*)\)\)|\(([^)]*)\)|\{([^}]*)\}|\{\{([^}]*)\}\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const id = m[1];
    if (/^(style|classDef|class|linkStyle|click|graph|flowchart)$/i.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const label = (m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? id).trim();
    nodes.push({ id, label });
  }
  return nodes;
}

/** If nodes exist but no edges, chain them so the diagram still renders. */
function repairMissingEdges(source: string): string {
  if (/-->|---|==>|-.->/.test(source)) return source;
  const headerLine = source
    .split("\n")
    .map((l) => l.trim())
    .find((l) => DIAGRAM_HEADERS.test(l));
  if (!headerLine || !/^(graph|flowchart)\b/i.test(headerLine)) return source;
  const nodes = collectDeclaredNodes(source);
  if (nodes.length < 2) return source;
  const edges = nodes
    .slice(0, -1)
    .map((n, i) => `  ${n.id} --> ${nodes[i + 1].id}`)
    .join("\n");
  return `${source.trimEnd()}\n${edges}`;
}

/**
 * When the model fakes a Gantt with graph + durations, rebuild a real gantt.
 */
export function salvageAsGantt(source: string): string | null {
  const lower = source.toLowerCase();
  // Don't steal pie charts
  if (/^pie\b/m.test(lower) || /:\s*[\d.]+\s*%/.test(source)) return null;

  const looksLikeGantt =
    /\bgantt\b/.test(lower) ||
    /\bsprint\b/.test(lower) ||
    /\bschedule\b/.test(lower) ||
    (/\btimeline\b/.test(lower) && !/^pie\b/m.test(lower)) ||
    DURATION_RE.test(source) ||
    /\[\w[^\]]*\]\s*\(\(/.test(source);

  if (!looksLikeGantt) return null;

  const { title: extractedTitle } = extractAndStripTitles(source);
  const titleMatch =
    extractedTitle ||
    source.match(/title\s*=\s*(.+)/i)?.[1]?.trim() ||
    source.match(/title\s+(.+)/i)?.[1]?.trim() ||
    "Project timeline";

  const tasks: { name: string; days: number }[] = [];

  // Design[Design]((10d)) or Design : 10d or Design[Design 10d]
  const mixed = [
    ...source.matchAll(
      /\b([A-Za-z][\w]*)\s*\[([^\]]*)\]\s*\(\(\s*([^)]+)\s*\)\)/g,
    ),
  ];
  for (const m of mixed) {
    const dur = m[3].match(DURATION_RE);
    const days = dur ? Number(dur[1]) * ( /^w/i.test(dur[2]) ? 7 : 1) : 3;
    tasks.push({ name: (m[2] || m[1]).trim(), days: Math.max(1, days) });
  }

  if (!tasks.length) {
    for (const n of collectDeclaredNodes(source)) {
      const dur = `${n.label} ${n.id}`.match(DURATION_RE);
      const days = dur ? Number(dur[1]) * (/^w/i.test(dur[2]) ? 7 : 1) : 3;
      if (!/^(graph|flowchart|title)$/i.test(n.id)) {
        tasks.push({ name: n.label || n.id, days });
      }
    }
  }

  // Deduplicate by name
  const uniq: { name: string; days: number }[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    const key = t.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(t);
  }

  if (uniq.length < 1) {
    uniq.push(
      { name: "Design", days: 5 },
      { name: "Build", days: 5 },
      { name: "Test", days: 4 },
    );
  }

  const lines = [
    "gantt",
    `  title ${titleMatch.replace(/^["']|["']$/g, "").slice(0, 80)}`,
    "  dateFormat YYYY-MM-DD",
    "  axisFormat %b %d",
    "  section Sprint",
  ];
  let dayOffset = 0;
  const start = "2024-01-01";
  uniq.forEach((t, i) => {
    const id = `t${i + 1}`;
    if (i === 0) {
      lines.push(`  ${t.name} :${id}, ${start}, ${t.days}d`);
    } else {
      lines.push(`  ${t.name} :${id}, after t${i}, ${t.days}d`);
    }
    dayOffset += t.days;
  });
  void dayOffset;
  return lines.join("\n");
}

/** Flowchart salvage: strip bad titles, fix shapes, chain nodes. */
export function salvageAsFlowchart(source: string): string {
  // Pipe tables must never become flowcharts
  if (looksLikeMarkdownPipeTable(source)) {
    return extractMarkdownPipeTable(source);
  }
  const { source: stripped, title } = extractAndStripTitles(source);
  let out = stripped;
  out = repairMixedShapes(out);
  out = normalizeHeader(out);
  out = repairStyleArrows(out);
  out = repairBogusStyleLines(out);
  out = repairSingleDashArrows(out);
  out = repairBracketNodeIds(out);
  out = repairMissingEdges(out);
  out = applyTitleComment(out, title);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Mermaid pie rejects `%` and prefers quoted labels:
 * bad:  Coding : 40%
 * good: "Coding" : 40
 */
export function salvageAsPie(source: string): string | null {
  const trimmed = source.replace(/\r\n/g, "\n").trim();
  const lower = trimmed.toLowerCase();
  const hasPieHeader = /^pie\b/m.test(lower);
  const hasPctSlices = /:\s*[\d.]+\s*%/.test(trimmed);
  const hasSliceLines = /^\s*(?:"[^"]+"|'[^']+'|[^:\n]+)\s*:\s*[\d.]+/m.test(trimmed);

  if (!hasPieHeader && !hasPctSlices) return null;
  if (!hasPieHeader && !hasSliceLines) return null;

  const lines = trimmed.split("\n");
  let header = "pie showData";
  const titleParts: string[] = [];
  const slices: { label: string; value: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;

    if (i === 0 || /^pie\b/i.test(t)) {
      if (/^pie\b/i.test(t)) {
        header = /showdata/i.test(t) ? "pie showData" : "pie showData";
        const rest = t.replace(/^pie\b/i, "").replace(/\bshowdata\b/i, "").trim();
        if (rest && !/^title\b/i.test(rest)) {
          // ignore junk after pie
        }
        continue;
      }
    }

    if (/^title\s*=/.test(t)) {
      titleParts.push(t.replace(/^title\s*=\s*/i, "").replace(/^["']|["']$/g, "").trim());
      continue;
    }
    if (/^title\s+/i.test(t) && !/^title\s*:/.test(t)) {
      titleParts.push(t.replace(/^title\s+/i, "").replace(/^["']|["']$/g, "").trim());
      continue;
    }

    const slice = t.match(
      /^(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*([\d.]+)\s*%?\s*$/,
    );
    if (slice) {
      const label = (slice[1] || slice[2] || slice[3] || "").trim();
      if (label && !/^title$/i.test(label)) {
        slices.push({ label, value: slice[4] });
      }
      continue;
    }
  }

  if (!slices.length) return null;

  const out = [header];
  if (titleParts[0]) out.push(`  title ${titleParts[0].slice(0, 80)}`);
  for (const s of slices) {
    out.push(`  "${s.label.replace(/"/g, "'")}" : ${s.value}`);
  }
  return out.join("\n");
}

function quoteAxisLabel(label: string): string {
  const t = label.trim().replace(/^["']|["']$/g, "");
  if (!t) return '"?"';
  // Mermaid x-axis: quote if spaces or special chars
  if (/[^A-Za-z0-9_]/.test(t)) return `"${t.replace(/"/g, "'")}"`;
  return t;
}

/**
 * Rebuild broken LLM xychart-beta into valid syntax.
 * bad:  xaxis label "Month" / bar Jan-12: 1
 * good: x-axis [Jan-12, ...] / bar [1, ...]
 */
export function salvageAsXyChart(source: string): string | null {
  const trimmed = source.replace(/\r\n/g, "\n").trim();
  const lower = trimmed.toLowerCase();
  if (/^pie\b/m.test(lower) || /^gantt\b/m.test(lower) || /^mindmap\b/m.test(lower)) {
    return null;
  }

  const hasXyHeader = /^xychart(-beta)?\b/m.test(lower);
  const hasBrokenAxis = /\bx-?axis\s+label\b/i.test(trimmed) || /\by-?axis\s+label\b/i.test(trimmed);
  const hasBarPairs = /^\s*bar\s+.+:\s*[\d.]+/im.test(trimmed);
  const hasLinePairs = /^\s*line\s+.+:\s*[\d.]+/im.test(trimmed);
  const hasTypoAxis = /\b(xaxis|yaxis)\b/i.test(trimmed);

  if (!hasXyHeader && !hasBrokenAxis && !hasBarPairs && !hasTypoAxis) return null;

  let title = "Chart";
  let yLabel = "Value";
  let xLabel = "";
  const barPoints: { label: string; value: number }[] = [];
  const linePoints: { label: string; value: number }[] = [];
  let barArray: number[] | null = null;
  let lineArray: number[] | null = null;
  let xCategories: string[] | null = null;
  let yMin = 0;
  let yMax: number | null = null;
  let horizontal = /\bhorizontal\b/i.test(trimmed.split("\n")[0] || "");

  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^xychart(-beta)?\b/i.test(t)) continue;

    const titleM = t.match(/^title\s+(.+)$/i);
    if (titleM) {
      title = titleM[1].replace(/^["']|["']$/g, "").trim();
      continue;
    }

    // x-axis [a, b]  OR  xaxis label "Month"  OR  x-axis "Title" [a,b]
    const xArr = t.match(/^x-?axis\b(?:\s+"([^"]*)")?\s*\[([^\]]+)\]/i);
    if (xArr) {
      if (xArr[1]) xLabel = xArr[1];
      xCategories = xArr[2].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    const xLab = t.match(/^x-?axis\s+(?:label\s+)?(.+)$/i);
    if (xLab) {
      xLabel = xLab[1].replace(/^["']|["']$/g, "").trim();
      continue;
    }

    const yRange = t.match(
      /^y-?axis\b(?:\s+"([^"]*)")?\s+(-?[\d.]+)\s*-->\s*(-?[\d.]+)/i,
    );
    if (yRange) {
      if (yRange[1]) yLabel = yRange[1];
      yMin = Number(yRange[2]);
      yMax = Number(yRange[3]);
      continue;
    }
    const yLab = t.match(/^y-?axis\s+(?:label\s+)?(.+)$/i);
    if (yLab) {
      yLabel = yLab[1]
        .replace(/^["']|["']$/g, "")
        .replace(/\s+-?[\d.]+\s*-->\s*-?[\d.]+/, "")
        .trim();
      continue;
    }

    const barArr = t.match(/^bar\b(?:\s+"[^"]*")?\s*\[([^\]]+)\]/i);
    if (barArr) {
      barArray = barArr[1].split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
      continue;
    }
    const lineArr = t.match(/^line\b(?:\s+"[^"]*")?\s*\[([^\]]+)\]/i);
    if (lineArr) {
      lineArray = lineArr[1].split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
      continue;
    }

    const barPair = t.match(/^bar\s+(.+?)\s*:\s*(-?[\d.]+)\s*$/i);
    if (barPair) {
      barPoints.push({
        label: barPair[1].replace(/^["']|["']$/g, "").trim(),
        value: Number(barPair[2]),
      });
      continue;
    }
    const linePair = t.match(/^line\s+(.+?)\s*:\s*(-?[\d.]+)\s*$/i);
    if (linePair) {
      linePoints.push({
        label: linePair[1].replace(/^["']|["']$/g, "").trim(),
        value: Number(linePair[2]),
      });
      continue;
    }
  }

  const points = barPoints.length ? barPoints : linePoints;
  if (points.length) {
    const labels = points.map((p) => quoteAxisLabel(p.label));
    const values = points.map((p) => p.value);
    const maxV = Math.max(...values, 1);
    const ymax = yMax ?? Math.max(Math.ceil(maxV * 1.25), maxV + 1);
    const seriesKind = barPoints.length ? "bar" : "line";
    const out = [
      horizontal ? "xychart-beta horizontal" : "xychart-beta",
      `  title "${title.replace(/"/g, "'")}"`,
      xLabel
        ? `  x-axis "${xLabel.replace(/"/g, "'")}" [${labels.join(", ")}]`
        : `  x-axis [${labels.join(", ")}]`,
      `  y-axis "${yLabel.replace(/"/g, "'")}" ${yMin} --> ${ymax}`,
      `  ${seriesKind} [${values.join(", ")}]`,
    ];
    return out.join("\n");
  }

  // Already has arrays but broken axis keywords / unquoted title
  if (xCategories && (barArray || lineArray)) {
    const vals = barArray || lineArray || [];
    const maxV = Math.max(...vals, 1);
    const ymax = yMax ?? Math.max(Math.ceil(maxV * 1.25), maxV + 1);
    const labels = xCategories.map(quoteAxisLabel);
    const out = [
      horizontal ? "xychart-beta horizontal" : "xychart-beta",
      `  title "${title.replace(/"/g, "'")}"`,
      xLabel
        ? `  x-axis "${xLabel.replace(/"/g, "'")}" [${labels.join(", ")}]`
        : `  x-axis [${labels.join(", ")}]`,
      `  y-axis "${yLabel.replace(/"/g, "'")}" ${yMin} --> ${ymax}`,
    ];
    if (barArray) out.push(`  bar [${barArray.join(", ")}]`);
    if (lineArray) out.push(`  line [${lineArray.join(", ")}]`);
    return out.join("\n");
  }

  // Light rewrite only: fix xaxis/yaxis typos + quote title
  if (hasXyHeader && (hasTypoAxis || hasBrokenAxis || /^title\s+[^"]/m.test(trimmed))) {
    let fixed = trimmed
      .replace(/^xychart\b/im, "xychart-beta")
      .replace(/\bxaxis\b/gi, "x-axis")
      .replace(/\byaxis\b/gi, "y-axis")
      .replace(/^(\s*)x-axis\s+label\s+/gim, "$1x-axis ")
      .replace(/^(\s*)y-axis\s+label\s+/gim, "$1y-axis ")
      .replace(/^(\s*)title\s+(?!["'])(.+)$/gim, (_, sp, rest) => {
        const t = String(rest).trim().replace(/^["']|["']$/g, "");
        return `${sp}title "${t.replace(/"/g, "'")}"`;
      });
    // If still has bar Label: n, recurse once via points path — already handled above
    if (fixed !== trimmed && !/^\s*bar\s+.+:\s*[\d.]+/im.test(fixed)) {
      return fixed;
    }
  }

  return null;
}

export function repairMermaidSource(source: string): string {
  let out = source.replace(/\r\n/g, "\n").trim();
  if (!out) return out;

  // Mis-labeled Markdown tables — do not salvage as Mermaid
  if (looksLikeMarkdownPipeTable(out)) {
    return extractMarkdownPipeTable(out);
  }

  // Pie-specific path (must run before generic title stripping)
  if (/^pie\b/im.test(out) || /:\s*[\d.]+\s*%/.test(out)) {
    const pie = salvageAsPie(out);
    if (pie) return pie;
  }

  if (/^xychart/im.test(out) || /\b(xaxis|yaxis|x-axis|y-axis)\b/i.test(out)) {
    const xy = salvageAsXyChart(out);
    if (xy) return xy;
  }

  const { source: stripped, title } = extractAndStripTitles(out);
  out = stripped;
  out = repairMixedShapes(out);
  out = normalizeHeader(out);
  out = repairStyleArrows(out);
  out = repairBogusStyleLines(out);
  out = repairSingleDashArrows(out);
  out = repairBracketNodeIds(out);
  out = repairMissingEdges(out);
  out = applyTitleComment(out, title);
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/**
 * Aggressive local salvage when the model cannot fix itself.
 */
export function salvageMermaidSource(source: string): string {
  if (looksLikeMarkdownPipeTable(source)) {
    return extractMarkdownPipeTable(source);
  }
  const pie = salvageAsPie(source);
  if (pie) return pie;
  const xy = salvageAsXyChart(source);
  if (xy) return xy;
  const gantt = salvageAsGantt(source);
  if (gantt) return gantt;
  return salvageAsFlowchart(source);
}

/** True when the source matches known LLM Mermaid foot-guns. */
export function looksLikeBrokenMermaid(source: string): boolean {
  const s = source.trim();
  if (!s) return false;
  return (
    /title\s*=/.test(s) ||
    /:\s*[\d.]+\s*%/.test(s) || // pie values with %
    /\]\s*\(\(/.test(s) || // mixed shapes
    /style\s+\S+\s+-->/.test(s) ||
    (/^pie\b/im.test(s) && /:\s*[\d.]+/.test(s) && !/"[^"]+"\s*:/.test(s)) || // unquoted pie labels
    /\b(xaxis|yaxis)\b/i.test(s) || // should be x-axis / y-axis
    /\bx-?axis\s+label\b/i.test(s) ||
    /\by-?axis\s+label\b/i.test(s) ||
    /^\s*bar\s+.+:\s*[\d.]+/im.test(s) // bar Jan: 1 instead of bar [1]
  );
}

/**
 * Best deterministic source to show/render first (no LLM).
 * Prefers pie/xy/gantt/flowchart salvage over the raw broken original.
 */
export function pickPreferredMermaidSource(source: string): string {
  const original = source.trim();
  if (!original) return original;
  // Never salvage Markdown pipe tables into flowchart TD + pipes
  if (looksLikeMarkdownPipeTable(original)) {
    return extractMarkdownPipeTable(original);
  }
  const candidates = mermaidRenderCandidates(original);
  if (looksLikeBrokenMermaid(original)) {
    const fixed = candidates.find((c) => c !== original);
    if (fixed) return fixed;
  }
  const pie = salvageAsPie(original);
  if (pie && pie !== original) return pie;
  const xy = salvageAsXyChart(original);
  if (xy && xy !== original) return xy;
  return candidates[0] || original;
}

/** Rewrite every ```mermaid fence in markdown with a preferred salvage. */
export function repairMermaidFencesInMarkdown(markdown: string): string {
  if (!markdown || !/```mermaid/i.test(markdown)) return markdown;
  // First unwrap mis-labeled pipe tables (they must not stay as mermaid)
  const unwrapped = unwrapMermaidPipeTablesInMarkdown(markdown);
  if (!/```mermaid/i.test(unwrapped)) return unwrapped;
  return unwrapped.replace(/```mermaid[^\n]*\n([\s\S]*?)```/gi, (_full, body: string) => {
    const raw = String(body);
    if (looksLikeMarkdownPipeTable(raw)) {
      return extractMarkdownPipeTable(raw);
    }
    const preferred = pickPreferredMermaidSource(raw);
    return "```mermaid\n" + preferred.trim() + "\n```";
  });
}

/** Candidates to try when rendering. Broken sources try fixes BEFORE the original. */
export function mermaidRenderCandidates(source: string): string[] {
  const original = source.trim();
  if (!original) return [];

  // Pipe tables are not Mermaid — do not invent flowchart candidates
  if (looksLikeMarkdownPipeTable(original)) {
    return [extractMarkdownPipeTable(original)];
  }

  const pie = salvageAsPie(original);
  const xy = salvageAsXyChart(original);
  const repaired = repairMermaidSource(original);
  const gantt = salvageAsGantt(original);
  const flowchart = salvageAsFlowchart(original);

  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    const t = s?.trim();
    if (!t) return;
    if (!out.includes(t)) out.push(t);
  };

  if (looksLikeBrokenMermaid(original)) {
    // Auto-fix path: never lead with the broken original
    push(pie);
    push(xy);
    push(gantt);
    push(repaired);
    push(flowchart);
    push(original);
  } else {
    push(original);
    push(pie);
    push(xy);
    push(gantt);
    push(repaired);
    push(flowchart);
  }
  return out;
}

export function buildMermaidFixPrompt(
  brokenSource: string,
  parseError?: string,
): string {
  const wantsPie =
    /^pie\b/im.test(brokenSource) || /:\s*[\d.]+\s*%/.test(brokenSource);
  const wantsXy =
    !wantsPie &&
    (/^xychart/im.test(brokenSource) ||
      /\b(xaxis|yaxis|x-axis|y-axis)\b/i.test(brokenSource) ||
      /^\s*bar\s+.+:\s*[\d.]+/im.test(brokenSource));
  const wantsGantt =
    !wantsPie &&
    !wantsXy &&
    (/gantt|sprint|schedule|timeline/i.test(brokenSource) ||
      DURATION_RE.test(brokenSource) ||
      /\[\w[^\]]*\]\s*\(\(/.test(brokenSource));

  const rules = [
    "The previous Mermaid diagram failed to render. Reply with ONLY a corrected ```mermaid block (no tools, no preamble, no explanation).",
    parseError ? `Parser error: ${parseError.slice(0, 240)}` : "",
    "Hard rules:",
    '- Never write "title=Something" inside graph/flowchart.',
    '- Never write "style Node --> Other". style is only: style nodeId fill:#hex,stroke:#hex',
    "- Never mix shapes: bad `A[Label]((10d))`.",
    '- Pie values are numbers WITHOUT % and labels MUST be quoted: "Coding" : 40',
    '- XY charts use x-axis [..] y-axis "Label" 0 --> N and bar [1,2,3] — never "xaxis label" or "bar Jan: 1".',
    "- Use safe node ids (letters, numbers, underscore).",
  ].filter(Boolean);

  if (wantsPie) {
    return [
      ...rules,
      "This is a pie chart. Use EXACTLY this shape (no % signs):",
      "```mermaid",
      "pie showData",
      "  title Team time",
      '  "Coding" : 40',
      '  "Meetings" : 25',
      '  "Reviews" : 20',
      '  "Docs" : 15',
      "```",
      "Broken source to fix:",
      "```",
      brokenSource.trim().slice(0, 3500),
      "```",
    ].join("\n");
  }

  if (wantsXy) {
    return [
      ...rules,
      "This is an XY / bar chart. Use EXACTLY this shape:",
      "```mermaid",
      "xychart-beta",
      '  title "Monthly Deploys"',
      "  x-axis [Jan, Feb, Mar, Apr]",
      '  y-axis "Deployments" 0 --> 5',
      "  bar [1, 2, 3, 4]",
      "```",
      "Broken source to fix:",
      "```",
      brokenSource.trim().slice(0, 3500),
      "```",
    ].join("\n");
  }

  if (wantsGantt) {
    return [
      ...rules,
      "This looks like a Gantt / sprint schedule. Use EXACTLY this shape:",
      "```mermaid",
      "gantt",
      "  title 2-Week Sprint",
      "  dateFormat YYYY-MM-DD",
      "  section Sprint",
      "  Design :a1, 2024-01-01, 5d",
      "  Build  :a2, after a1, 5d",
      "  Test   :a3, after a2, 4d",
      "```",
      "Broken source to fix:",
      "```",
      brokenSource.trim().slice(0, 3500),
      "```",
    ].join("\n");
  }

  return [
    ...rules,
    "If the user asked for a mindmap, use mindmap syntax:",
    "```mermaid",
    "mindmap",
    "  root((Topic))",
    "    Branch_A",
    "      Leaf_1",
    "    Branch_B",
    "```",
    "Broken source to fix:",
    "```",
    brokenSource.trim().slice(0, 3500),
    "```",
  ].join("\n");
}
