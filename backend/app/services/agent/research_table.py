"""Research comparison tables — general path for ANY compare question.

No domain KB, no Docker/image/DB hardcoding. Pipeline is always:
1) Parse entities (+ optional columns the user named)
2) web_search with focused queries
3) One LLM format turn that chooses aspects for *this* topic
"""

from __future__ import annotations

import re
from typing import Any, Optional

from .diagram_reply import (
    looks_like_markdown_pipe_table,
    strip_mermaid_fence_around_pipe_tables,
)

_COMPARE_SPLIT_RE = re.compile(
    r"\s*(?:,|/|\band\b|\bvs\.?\b|\bversus\b|\bwith\b)\s*",
    re.I,
)
# Strip prompt scaffolding so we keep entity names only
_PREFIX_RE = re.compile(
    r"^(?:please\s+)?"
    r"(?:create|make|show|render|build|write|give\s+me|generate)\s+"
    r"(?:a\s+|an\s+|me\s+a\s+)?"
    r"(?:markdown\s+)?"
    r"(?:comparison\s+)?(?:table|chart)?\s*"
    r"(?:of\s+|for\s+|between\s+)?"
    r"|^(?:compare|comparison\s+of|comparison)\s+",
    re.I,
)
_TABLE_TAIL_RE = re.compile(
    r"\s+in\s+a\s+(?:markdown\s+)?table\b.*$"
    r"|\s*\([^)]*\)\s*$"
    r"|\s+comparison\s+table\s*$",
    re.I,
)
_JUNK_ENTITY_RE = re.compile(
    r"^(?:a|an|the|table|markdown|comparison|compare|of|for|between|"
    r"speed|quality|best|notes|pros|cons|aspects?)$",
    re.I,
)
_FENCE_RE = re.compile(
    r"```(?:markdown|md|gfm|text)?\s*\n([\s\S]*?)```",
    re.I,
)
_SINGLE_CELL_LINE_RE = re.compile(r"^\|\s*([^|\n]*?)\s*$")
_SEP_CELL_RE = re.compile(r"^:?-{2,}:?$")
_PIPE_TABLE_SEP_RE = re.compile(
    r"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$",
)
# User-named columns: "(speed, quality, best for, notes)" or "by X, Y, Z"
_PAREN_COLS_RE = re.compile(r"\(([^)]{3,120})\)")
_BY_COLS_RE = re.compile(
    r"\b(?:by|across|on|columns?|criteria)\s*:\s*([^\n.(]{3,120})",
    re.I,
)


def extract_comparison_entities(message: str, *, max_entities: int = 4) -> list[str]:
    """Extract clean product/tech names from a compare prompt (any domain)."""
    msg = (message or "").strip()
    if not msg:
        return []

    head = _TABLE_TAIL_RE.sub("", msg)
    head = _PREFIX_RE.sub("", head).strip(" .:")
    head = re.sub(
        r"^(?:a\s+|an\s+)?(?:markdown\s+)?(?:comparison\s+)?(?:table\s+)?(?:of\s+|for\s+)?",
        "",
        head,
        flags=re.I,
    ).strip(" .:")

    parts = [p.strip(" .:\"'") for p in _COMPARE_SPLIT_RE.split(head) if p and p.strip()]
    entities: list[str] = []
    for p in parts:
        p = re.sub(
            r"^(?:a\s+|an\s+)?(?:comparison\s+)?(?:table\s+)?(?:of\s+)?",
            "",
            p,
            flags=re.I,
        ).strip(" .:")
        if len(p) < 2 or _JUNK_ENTITY_RE.match(p):
            continue
        if p.lower() in {e.lower() for e in entities}:
            continue
        entities.append(p[:64])
        if len(entities) >= max_entities:
            break
    return entities


def extract_requested_columns(message: str) -> list[str]:
    """If the user named criteria/columns, return them; otherwise []."""
    msg = message or ""
    raw = ""
    m = _PAREN_COLS_RE.search(msg)
    if m:
        raw = m.group(1)
    else:
        m2 = _BY_COLS_RE.search(msg)
        if m2:
            raw = m2.group(1)
    if not raw:
        return []

    parts = re.split(r"\s*[,;/|]\s*|\s+and\s+", raw, flags=re.I)
    cols: list[str] = []
    for p in parts:
        c = p.strip(" .:")
        if len(c) < 2 or len(c) > 40:
            continue
        if c.lower() in {x.lower() for x in cols}:
            continue
        # Skip pure scaffolding words
        if _JUNK_ENTITY_RE.match(c) and c.lower() not in {
            "speed",
            "quality",
            "notes",
            "pros",
            "cons",
        }:
            continue
        cols.append(c[:40])
        if len(cols) >= 8:
            break
    # Need at least 2 named criteria to treat as explicit columns
    return cols if len(cols) >= 2 else []


def extract_comparison_queries(message: str, *, max_queries: int = 4) -> list[str]:
    """Build focused web_search queries from entities (domain-agnostic)."""
    entities = extract_comparison_entities(message, max_entities=3)
    if not entities:
        fallback = (message or "").strip()[:80] or "comparison"
        return [fallback]

    queries: list[str] = []
    if len(entities) >= 2:
        queries.append((" vs ".join(entities) + " comparison")[:100])
    for e in entities:
        q = f"{e} overview"
        if q.lower() not in {x.lower() for x in queries}:
            queries.append(q[:80])
        if len(queries) >= max_queries:
            break
    return queries[:max_queries]


RESEARCH_TABLE_FORMAT_SYSTEM = """You are an expert writer producing ChatGPT-quality comparison answers for ANY topic.

OUTPUT SHAPE (strict order):
1) One short intro line ONLY (no H1/H2), naming the items compared.
2) ONE GitHub-flavored Markdown pipe table — include the `|---|` separator row.
3) ### When to choose which — 3–5 actionable decision bullets.

TABLE RULES (general — work for any domain):
- Default to an **aspect-oriented** table:
  | Aspect | ItemA | ItemB | ItemC |
  |---|---|---|---|
  | <dimension that matters for THIS topic> | … | … | … |
  First column = comparison dimension. Other columns = the items being compared.
- YOU invent the aspect rows from the user request + research (architecture, pricing,
  DX, accuracy, latency, ethics, taste, whatever fits THIS topic). Do not reuse a
  fixed schema from unrelated domains.
- If the user explicitly named columns/criteria, honor those (as aspect rows OR as
  product-row headers — whichever fits better). Example: user said "(speed, quality,
  best for, notes)" → include those dimensions.
- Cells must be specific and **different across columns** when facts differ. No copy-paste.
- Optional Unicode stars for subjective scores: ★★★★☆ short phrase
- Bold key terms with **markdown** inside cells when helpful.
- NEVER put each cell on its own line. NEVER wrap the table in ``` fences. NEVER use ```mermaid.
- NEVER invent tools/JSON. NEVER write "No information available".
- If research is thin, use trained knowledge; mark soft spots briefly.
- Keep the whole reply under ~450 words. Dense > long. No duplicate headings.
"""


def repair_vertical_pipe_table(text: str) -> str:
    """Rebuild GFM tables when the model emits one cell per line."""
    if not text or "|" not in text:
        return text

    if re.search(r"^\|[^|\n]+\|[^|\n]+\|", text, re.M) and looks_like_markdown_pipe_table(
        text
    ):
        return text

    lines = text.replace("\r\n", "\n").split("\n")
    cells: list[str] = []
    prose_before: list[str] = []
    prose_after: list[str] = []
    in_table = False
    saw_table = False

    for line in lines:
        t = line.strip()
        if t == "|":
            in_table = True
            saw_table = True
            continue
        m = _SINGLE_CELL_LINE_RE.match(t)
        if m is not None and "|" not in m.group(1):
            in_table = True
            saw_table = True
            cells.append(m.group(1).strip())
            continue
        if in_table and not t:
            continue
        if saw_table and t and not t.startswith("|"):
            in_table = False
            prose_after.append(line)
            continue
        if not saw_table:
            prose_before.append(line)
        else:
            prose_after.append(line)

    if len(cells) < 4:
        return text

    sep_idx: Optional[int] = None
    for i, c in enumerate(cells):
        if _SEP_CELL_RE.match(c.replace(" ", "")) or c.replace(" ", "") in {
            "---",
            ":---",
            "---:",
            ":---:",
        }:
            sep_idx = i
            break
    if sep_idx is None or sep_idx < 2:
        return text

    headers = [h for h in cells[:sep_idx] if h]
    data = cells[sep_idx + 1 :]
    ncols = len(headers)
    if ncols < 2:
        return text

    rows: list[list[str]] = []
    for i in range(0, len(data), ncols):
        chunk = data[i : i + ncols]
        if not any(chunk):
            continue
        if len(chunk) < ncols:
            chunk = chunk + [""] * (ncols - len(chunk))
        rows.append(chunk)

    table_lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * ncols) + " |",
    ]
    for r in rows:
        table_lines.append("| " + " | ".join(r) + " |")

    parts: list[str] = []
    before = "\n".join(prose_before).strip()
    after = "\n".join(prose_after).strip()
    if before:
        parts.append(before)
    parts.append("\n".join(table_lines))
    if after:
        parts.append(after)
    return "\n\n".join(parts).strip()


def unwrap_markdown_table_fences(text: str) -> str:
    """Remove ```markdown / ```md fences around pipe tables (or vertical tables)."""
    if not text or "```" not in text:
        return text

    def _repl(match: re.Match[str]) -> str:
        body = match.group(1).strip()
        if looks_like_markdown_pipe_table(body) or _looks_vertical_table(body):
            return body
        if body.count("|") >= 4 and "flowchart" not in body.lower():
            return body
        return match.group(0)

    return _FENCE_RE.sub(_repl, text)


def _looks_vertical_table(body: str) -> bool:
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if len(lines) < 6:
        return False
    single = sum(1 for ln in lines if _SINGLE_CELL_LINE_RE.match(ln) or ln == "|")
    return single >= max(6, int(len(lines) * 0.7))


def ensure_gfm_table_separator(text: str) -> str:
    """Insert a `|---|` separator when the model emits header+rows without one."""
    if not text or "|" not in text:
        return text
    lines = text.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0
    inserted_for_block = False
    while i < len(lines):
        line = lines[i]
        t = line.strip()
        if not t.startswith("|"):
            inserted_for_block = False
            out.append(line)
            i += 1
            continue

        if _PIPE_TABLE_SEP_RE.match(t):
            inserted_for_block = True
            out.append(line)
            i += 1
            continue

        if (
            not inserted_for_block
            and t.count("|") >= 3
            and i + 1 < len(lines)
        ):
            nxt = lines[i + 1].strip()
            if (
                nxt.startswith("|")
                and nxt.count("|") >= 3
                and not _PIPE_TABLE_SEP_RE.match(nxt)
            ):
                ncols = max(1, t.count("|") - 1)
                sep = "| " + " | ".join(["---"] * ncols) + " |"
                out.append(line)
                out.append(sep)
                inserted_for_block = True
                i += 1
                continue
        out.append(line)
        i += 1
    return "\n".join(out)


def normalize_research_table_markdown(text: str) -> str:
    """Final cleanup for research-table answers before emit/store."""
    out = (text or "").strip()
    if not out:
        return out
    out = strip_mermaid_fence_around_pipe_tables(out)
    out = unwrap_markdown_table_fences(out)
    out = repair_vertical_pipe_table(out)
    out = ensure_gfm_table_separator(out)
    out = unwrap_markdown_table_fences(out)
    return out.strip()


def build_format_user_prompt(user_message: str, search_blocks: list[dict[str, Any]]) -> str:
    """Compose format-turn prompt — entities/columns from the user only, no domain KB."""
    entities = extract_comparison_entities(user_message)
    columns = extract_requested_columns(user_message)
    entity_line = ", ".join(entities) if entities else "(infer from the user request)"

    parts = [
        f"User request:\n{user_message.strip()}\n",
        f"Items to compare: {entity_line}",
    ]
    if columns:
        parts.append(
            "User-requested criteria/columns (must appear in the table): "
            + ", ".join(columns)
        )
    else:
        parts.append(
            "No explicit columns named — choose 6–8 high-signal aspects that fit "
            "THIS topic (do not reuse unrelated schemas)."
        )

    parts.append("\nResearch snippets (prefer these facts; fill gaps from knowledge):")
    if not search_blocks:
        parts.append(
            "(No web snippets — answer from trained knowledge like a strong general assistant.)"
        )
    else:
        for block in search_blocks:
            q = block.get("query") or "query"
            body = (block.get("output") or block.get("error") or "").strip()
            parts.append(f"\n### Search: {q}\n{body[:2200]}")

    parts.append(
        "\nWrite the intro + Markdown table + When to choose which. "
        "Aspects must fit this topic. One row per line. No code fences. No tools."
    )
    return "\n".join(parts)
