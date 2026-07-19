"""Rich-visual helpers: Mermaid salvage from user-provided data + anti-hallucinated tools.

Comparison / research tables are NOT static — those go through search + LLM.
Only synthesize Mermaid when the user already supplied the numbers in the prompt.
"""

from __future__ import annotations

import re
from typing import Optional

_MONTHS = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
_MONTH_RE = re.compile(
    r"\b("
    + "|".join(_MONTHS)
    + r")[a-z]*\.?\s*[,\-–]?\s*(\d+(?:\.\d+)?)\b",
    re.I,
)
_PIE_PAIR_RE = re.compile(
    r"\b([A-Za-z][A-Za-z0-9/_-]{1,32})\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%",
    re.I,
)
_XY_HINT = re.compile(
    r"\b(xychart|bar\s*chart|line\s*chart|monthly\s+deploy|deploys?)\b",
    re.I,
)
_PIE_HINT = re.compile(r"\bpie\b", re.I)

# Structural Mermaid in chat (user wants a diagram, often with data already given)
MERMAID_STRUCTURAL_RE = re.compile(
    r"\b(mermaid|flowchart|mindmap|mind\s*map|gantt|xychart(-beta)?|"
    r"pie\s*chart|bar\s*chart|line\s*chart|xy\s*chart|sequence\s*diagram|"
    r"er\s*diagram|architecture\s*diagram)\b"
    r"|\b(show|draw|make|render|create)\s+(a\s+|an\s+)?(mermaid\s+)?"
    r"(pie|bar|line|gantt|flow|mind\s*map|chart|diagram)\b",
    re.I,
)

# Research / comparison questions — need live info, not a hardcoded reply.
# Keep this tight: conceptual "difference between X and Y" stays GENERAL_QA.
RESEARCH_TABLE_RE = re.compile(
    r"\b(markdown\s+table|pipe\s+table|comparison\s+table)\b"
    r"|\bcompar(?:e|ison)\b.*\btable\b"
    r"|\btable\b.*\bcompar(?:e|ison)\b"
    r"|\bin\s+a\s+(markdown\s+)?table\b"
    r"|\b(show|make|create|render)\s+(a\s+|an\s+)?(comparison\s+)?table\b"
    # Product/model compares (not abstract "difference between TCP and UDP")
    r"|\bcompar(?:e|ison)\b.+\b(vs\.?|versus|,|and|with)\b"
    r"|\bwhich\s+is\s+better\b.+\b(vs\.?|or|and)\b"
    r"|\b(pros?\s*(?:&|and)\s*cons?)\b.+\b(of|for|vs\.?|versus)\b",
    re.I,
)

# Tools small models invent — never exist; answer in Markdown instead.
MARKDOWN_ONLY_TOOL_ALIASES: dict[str, str] = {
    "generate_table": (
        "There is no generate_table tool. After you finish research with web_search/fetch_url, "
        "reply with a GitHub-flavored Markdown pipe table in the chat. Do not invent tools."
    ),
    "create_table": (
        "There is no create_table tool. Reply with a Markdown pipe table after researching."
    ),
    "make_table": (
        "There is no make_table tool. Reply with a Markdown pipe table after researching."
    ),
    "generate_chart": (
        "There is no generate_chart tool. Use ```mermaid for charts, or a Markdown table."
    ),
    "generate_diagram": (
        "There is no generate_diagram tool. Reply with a ```mermaid fence."
    ),
    "generate_mermaid": (
        "There is no generate_mermaid tool. Reply with a ```mermaid fence."
    ),
    "create_diagram": (
        "There is no create_diagram tool. Reply with a ```mermaid fence."
    ),
    "draw_chart": (
        "There is no draw_chart tool. Use ```mermaid or a Markdown table."
    ),
    "create_chart": (
        "There is no create_chart tool. Use ```mermaid or a Markdown table."
    ),
}

# Real tools that must NOT run when the user only asked for an in-chat Markdown table.
DOCUMENT_FILE_TOOLS: frozenset[str] = frozenset({
    "generate_pdf",
    "generate_docx",
    "generate_pptx",
    "generate_xlsx",
})


def is_markdown_only_tool(name: str) -> bool:
    return (name or "").strip().lower() in MARKDOWN_ONLY_TOOL_ALIASES


def is_document_file_tool(name: str) -> bool:
    return (name or "").strip().lower() in DOCUMENT_FILE_TOOLS


def markdown_only_tool_nudge(name: str) -> str:
    key = (name or "").strip().lower()
    return MARKDOWN_ONLY_TOOL_ALIASES.get(
        key,
        f"Tool '{name}' does not exist. Answer in Markdown (table or ```mermaid). "
        "Use web_search/fetch_url if you need current facts.",
    )


def research_table_document_nudge(name: str) -> str:
    return (
        f"Do NOT call {name}. The user asked for an in-chat Markdown comparison table, "
        "not a downloadable file. Using the web_search results you already have, reply NOW "
        "with a complete GitHub-flavored Markdown pipe table (every cell filled) plus "
        "Quick takeaways. No more tools. Never wrap the table in a ```mermaid fence."
    )


_PIPE_TABLE_SEP_RE = re.compile(
    r"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$",
    re.M,
)
_MERMAID_FENCE_RE = re.compile(
    r"```mermaid[^\n]*\n([\s\S]*?)```",
    re.I,
)


def looks_like_markdown_pipe_table(body: str) -> bool:
    """True when fenced body is a GFM pipe table (mis-labeled as mermaid)."""
    text = (body or "").strip()
    if not text or "|" not in text:
        return False
    lines = [
        ln.strip()
        for ln in text.splitlines()
        if ln.strip() and not re.match(r"^(flowchart|graph)\b", ln.strip(), re.I)
        and not ln.strip().startswith("%%")
    ]
    if len(lines) < 2:
        return False
    for i in range(len(lines) - 1):
        header, sep = lines[i], lines[i + 1]
        if not _PIPE_TABLE_SEP_RE.match(sep):
            continue
        if header.count("|") >= 1 and len([c for c in header.split("|") if c.strip()]) >= 2:
            return True
    return False


def strip_mermaid_fence_around_pipe_tables(markdown: str) -> str:
    """Unwrap ```mermaid fences that actually contain Markdown pipe tables."""
    if not markdown or "```mermaid" not in markdown.lower():
        return markdown

    def _repl(match: re.Match[str]) -> str:
        body = match.group(1)
        if not looks_like_markdown_pipe_table(body):
            return match.group(0)
        lines = [
            ln
            for ln in body.splitlines()
            if not re.match(r"^\s*(flowchart|graph)\b", ln, re.I)
            and not ln.strip().startswith("%%")
        ]
        return "\n".join(lines).strip()

    return _MERMAID_FENCE_RE.sub(_repl, markdown)


def try_synthesize_mermaid_reply(message: str) -> Optional[str]:
    """Only when the user already pasted numbers — format them as valid Mermaid.

    This is NOT a knowledge base. Comparison / research questions must search live.
    """
    msg = (message or "").strip()
    if not msg:
        return None

    if _XY_HINT.search(msg) or (
        re.search(r"\bmermaid\b", msg, re.I) and _MONTH_RE.search(msg)
    ):
        pairs = _MONTH_RE.findall(msg)
        if len(pairs) >= 2:
            labels = [p[0][:3].title() for p in pairs]
            values = [float(p[1]) for p in pairs]
            vals_fmt = [str(int(v)) if v == int(v) else str(v) for v in values]
            ymax = max(int(max(values) * 1.25) + 1, int(max(values)) + 1)
            chart = "\n".join(
                [
                    "xychart-beta",
                    '  title "Monthly Deploys"',
                    f"  x-axis [{', '.join(labels)}]",
                    f'  y-axis "Deployments" 0 --> {ymax}',
                    f"  bar [{', '.join(vals_fmt)}]",
                ]
            )
            return (
                "Here’s a Mermaid bar chart from the numbers you provided:\n\n"
                f"```mermaid\n{chart}\n```"
            )

    if _PIE_HINT.search(msg):
        pairs = _PIE_PAIR_RE.findall(msg)
        cleaned: list[tuple[str, str]] = []
        skip = {"mermaid", "pie", "chart", "show", "create", "make", "team", "time"}
        for label, val in pairs:
            lab = label.strip().rstrip(":")
            if lab.lower() in skip or len(lab) > 32:
                continue
            cleaned.append((lab.title() if lab.islower() else lab, val))
        if len(cleaned) >= 2:
            lines = ["pie showData", '  title "Distribution"']
            for lab, val in cleaned[:12]:
                lines.append(f'  "{lab}" : {val}')
            return (
                "Here’s a Mermaid pie chart from your percentages:\n\n"
                f"```mermaid\n" + "\n".join(lines) + "\n```"
            )

    return None


# Back-compat name used by older imports/tests
def try_synthesize_rich_visual_reply(message: str) -> Optional[str]:
    """Mermaid-from-user-data only. Never invent comparison tables."""
    return try_synthesize_mermaid_reply(message)


DIAGRAM_CHAT_ADDENDUM = """
═══ MERMAID / DIAGRAMS (CRITICAL) ═══
The user asked for a Mermaid diagram/chart in chat. You MUST:
1. Reply with a valid ```mermaid fence using data they already gave.
2. NEVER call generate_table / generate_chart / generate_image.
3. Syntax: pie uses "Label" : 40 (no %); xychart uses x-axis [...] / bar [...]; never style A --> B.
"""

RESEARCH_TABLE_ADDENDUM = """
═══ RESEARCH COMPARISON TABLES (CRITICAL) ═══
Answer like ChatGPT: engineering-useful, aspect-oriented, decision-ready.

You MUST:
1. Call web_search with SHORT entity queries (e.g. "Docker vs Podman vs containerd comparison").
   After search, STOP tools and write the answer.
2. Prefer an **aspect table**: first column Aspect, other columns = items compared
   (Architecture, Security, Ease of use, Best fit…). Do NOT default to Model/Speed/Quality
   unless the user asked about generative image models.
3. Short intro + filled Markdown pipe table + "When to choose which" bullets.
4. NEVER write "No information available". Use knowledge if search is thin.
5. NEVER call generate_table / generate_pdf / generate_image for an in-chat table.
6. NEVER wrap the table in ```mermaid. Plain Markdown pipes only.
"""
