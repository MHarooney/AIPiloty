"""AgentOrchestrator — ReAct-style agent loop with prompt-based tool calling.

DeepSeek-coder-v2:16b (and many Ollama models) do NOT support native tool calling.
Instead, we embed tool descriptions in the system prompt and parse the model's text
output for structured JSON tool-call blocks. This is the same approach used by
Agent Zero, LangChain ReAct, and similar frameworks.

Emits enriched SSE events for cinematic frontend rendering:
  - planning: step list before execution
  - risk_analysis: risk level + affected resources
  - confidence: score after tool result
  - final_report: structured summary at completion
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, AsyncGenerator, Optional

from ...core.config import get_settings
from ...core.metrics import metrics
from ..llm.ollama_service import OllamaService
from ..llm.provider_router import ProviderRouter
from ..tools.base import BaseTool, ToolResult
from ..tools.registry import ToolRegistry
from .guardrails import GuardrailService
from .message_router import MessageRoute, chat_system_prompt, route_message
from .pending_actions import pending_actions
from .tool_selector import select_progressive_tools, selected_pack_name
from .semantic_router import semantic_router
from ..llm.model_router import ModelRouter
from ..llm.cloud_llm import openai_chat_stream, should_use_cloud_for_qa
from ..memory.working_memory import WorkingMemory

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 15  # complex UI testing flows need 10-15 iterations (login→navigate→map→fill→submit→verify)
MAX_DURATION_SECONDS = 300

# ── System prompt cache ───────────────────────────────────────────────────
# Cache system prompts keyed by tool-name set (progressive loading).
_SYSTEM_PROMPT_CACHE: dict[str, str] = {}


def _get_cached_system_prompt(tools: list[BaseTool]) -> str:
    key = ",".join(sorted(t.name for t in tools))
    cached = _SYSTEM_PROMPT_CACHE.get(key)
    if cached is None:
        cached = _build_system_prompt(tools)
        _SYSTEM_PROMPT_CACHE[key] = cached
    return cached


def _load_project_rules(max_chars: int = 2000) -> str:
    """Read .aipiloty/rules or AGENTS.md from the current workspace root.

    Returns the first matching file's content (truncated to max_chars).
    Returns empty string if neither file exists or can be read.
    """
    from pathlib import Path as _Path
    from ...core.config import get_settings as _get_settings

    workspace = _get_settings().resolved_workspace
    candidates = [
        workspace / ".aipiloty" / "rules",
        workspace / "AGENTS.md",
        workspace / "agents.md",
        workspace / ".cursorrules",
        workspace / "CLAUDE.md",
    ]
    for path in candidates:
        try:
            if path.is_file():
                text = path.read_text(encoding="utf-8", errors="replace").strip()
                if text:
                    if len(text) > max_chars:
                        text = text[:max_chars] + "\n… (truncated)"
                    return text
        except OSError:
            continue
    return ""

# ── Tool-call parsing patterns (multi-layer, like the old platform) ──────

# Pattern 1: ```json\n{...}\n``` or ```tool_call\n{...}\n```
_JSON_BLOCK_RE = re.compile(
    r"```(?:json|tool_call)?\s*\n(\{.*?\})\s*\n```",
    re.DOTALL,
)

# Pattern 2: <tool_call>{...}</tool_call>
_XML_TAG_RE = re.compile(
    r"<tool_call>\s*(\{.*?\})\s*</tool_call>",
    re.DOTALL,
)

# Pattern 3: Bare JSON with "tool" and "arguments" keys on its own line
_BARE_JSON_RE = re.compile(
    r'(\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{.*?\}\s*\})',
    re.DOTALL,
)

_USER_URL_RE = re.compile(r"https?://[^\s\]>\"')\\]+", re.IGNORECASE)


def _first_https_url_from_messages(messages: list[dict[str, Any]]) -> Optional[str]:
    """Last user message wins (most recent ask); strip trailing punctuation from URL."""
    for m in reversed(messages):
        if m.get("role") != "user":
            continue
        text = str(m.get("content") or "")
        match = _USER_URL_RE.search(text)
        if match:
            return match.group(0).rstrip(".,);]\"')}")
    return None


# ── Report text cleaning (strip markdown / extract response) ──────────────

_CODE_FENCE_RE = re.compile(r"```[\w]*\s*\n?(.*?)\n?\s*```", re.DOTALL)


def _clean_report_text(text: str) -> str:
    """Strip markdown code fences and extract readable text from the model's output."""
    if not text:
        return ""
    # Remove markdown code fences: ```json ... ``` → inner content
    cleaned = _CODE_FENCE_RE.sub(r"\1", text).strip()
    # If the result looks like JSON, try to extract a 'response' or 'summary' field
    if cleaned.startswith("{"):
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                readable = (
                    parsed.get("response")
                    or parsed.get("summary")
                    or parsed.get("message")
                    or parsed.get("result")
                )
                if readable and isinstance(readable, str):
                    return readable.strip()
        except (json.JSONDecodeError, TypeError):
            pass
    return cleaned


def _normalize_llm_content(msg: dict[str, Any]) -> str:
    """Normalize Ollama `message`: content may be str, list of parts, or absent (use `thinking`)."""
    raw: Any = msg.get("content")
    if raw is None or raw == "":
        raw = msg.get("thinking") or ""
    if isinstance(raw, list):
        parts: list[str] = []
        for p in raw:
            if isinstance(p, dict):
                if p.get("type") == "text" and p.get("text") is not None:
                    parts.append(str(p["text"]))
                elif p.get("content") is not None:
                    parts.append(str(p["content"]))
            elif isinstance(p, str):
                parts.append(p)
        return "".join(parts)
    return str(raw)


def _build_system_prompt(tools: list[BaseTool]) -> str:
    """Build the system prompt with embedded tool descriptions for ReAct."""

    tool_docs = []
    for t in tools:
        params = []
        for p in t.parameters:
            req = " (required)" if p.required else f" (optional, default={p.default})"
            params.append(f"    - {p.name} ({p.type}): {p.description}{req}")
        params_str = "\n".join(params) if params else "    (no parameters)"
        tool_docs.append(
            f"  {t.name}: {t.description}\n"
            f"    Category: {t.category} | Risk: {t.risk_level}\n"
            f"    Parameters:\n{params_str}"
        )

    tools_section = "\n\n".join(tool_docs)

    return f"""You are AIPiloty, an expert AI DevOps & Document Generation agent.

You are a ReAct agent — you THINK, then ACT (call tools), then OBSERVE results, then continue until done.

═══ CONVERSATIONAL MESSAGES — NO TOOLS (HIGHEST PRIORITY) ═══
If the user's message is a greeting, pleasantry, or pure conversational exchange with NO technical request
(examples: "hello", "hi", "hey", "thanks", "thank you", "good morning", "how are you", "bye", "ok",
"cool", "great", "sounds good", or any message under ~5 words that is not a technical question):
- **NEVER call any tool.** Not get_host_environment, not verify_ollama_models, not any other tool.
- Respond warmly and BRIEFLY in plain text (1-3 sentences). Optionally offer to help.
- This rule overrides ALL other rules below.

═══ YOUR JOB ═══
- **Follow the user's request.** Depth, format, and which tools to use depend on what they asked — there is no fixed template or minimum section count.
- Use the **AVAILABLE TOOLS** below when they help fulfill the request; answer from your own knowledge when no tool is needed.
- **get_host_environment** = disk/OS/Python on the machine running this API (not the browser). **No** live RAM, CPU %, or fan metrics — tell the user to check **Activity Monitor** (macOS) or `htop` (Linux) on their own machine for those.
  If the API runs on the **same Mac** as the user (common in local dev), do NOT say "the remote backend server" — say "your machine" or "this Mac." Only say "the server" when the API actually runs on a separate host or inside Docker on Linux.
  SSH/deploy tools work with **registered VMs** (by vm_id) or **direct connections** (by host+username).
- **fetch_url** = the backend HTTP GETs a **full https URL** you provide. Not the user's browser. Use for pasted links **and** when you need **live web text** for research (see SEARCH & RECOMMENDATIONS).

═══ SEARCH & RECOMMENDATIONS (YOU MUST USE TOOLS, NOT ONLY MEMORY) ═══
- There is **no built-in web search engine**. To **search**, **look up**, **find the best**, **recommend** LLMs/Ollama models, or **what fits my machine**, combine tools across turns (one tool per turn):
  1. If tied to **their machine** (disk/OS): **get_host_environment** — disk and OS only, **not** live RAM or fan; for RAM/fan/CPU, tell them to use **Activity Monitor** on macOS or `htop`/`free` on Linux — AIPiloty's tools cannot provide those live metrics.
  2. **verify_ollama_models** — what is configured and what Ollama already has installed.
  3. **fetch_url** with a real public URL, e.g. `https://ollama.com/library` or `https://ollama.com/library/<model-name>` — pick pages that list models/specs. Summarize **only** `extracted_text` from the result; then blend with host + Ollama facts.
- Do **not** answer with a generic PDF/doc or a vague IDE list when they asked for **model** advice. Do **not** invent current model rankings without fetching or citing tool output.

═══ LLM vs HOST — READ THE USER'S WORDS ═══
- **LLM / chat model / DeepSeek / Ollama / \"what model does this app use\" / verify or double-check the model:** use **THIS DEPLOYMENT**; call **verify_ollama_models** when they want proof, live install list, or \"what's running\" in Ollama.
- **OS / macOS / Python / disk / \"my machine\" (hardware, not the AI):** **get_host_environment**; folders: **list_host_path**.
- If \"what model\" is ambiguous → default to **LLM/chat model** for AIPiloty, not the laptop OS.

═══ WEB PAGES & URLs (CRITICAL) ═══
1. If the user message contains a URL, your **first** assistant turn must call **fetch_url** with that URL (one ```json tool block only). Do **not** reply with only "please wait", "hold on", or long disclaimers without the tool block in the **same** turn.
2. Do **not** claim you cannot access third-party sites — **fetch_url** does access public URLs from the server (subject to normal network limits).
3. After you receive `[TOOL RESULT]` from fetch_url, summarize **only** what appears in `extracted_text` / JSON — do not invent product lists or page copy.
4. If fetch_url fails (blocked, 403, timeout), say so honestly and suggest what the user can try.
5. If the user asked to **search** or **find the best** but did not paste a URL, your job is still to call **fetch_url** with an **https** URL you choose (see SEARCH & RECOMMENDATIONS) — do not skip this and guess from memory alone.

═══ SSH DUAL MODE (IMPORTANT) ═══
SSH tools (ssh_command, vm_health_check) support TWO connection modes:
1. **Registered VM**: use "vm_id" when the VM is in the REGISTERED VMs list below.
2. **Direct connection**: use "host" + "username" when the user provides an IP or user@host (e.g. "root@24.144.80.17"). Parse the format:
   - "root@24.144.80.17" → host="24.144.80.17", username="root"
   - "ubuntu@myserver.com" → host="myserver.com", username="ubuntu"
   If the user provides a password, include it as "password". Port defaults to 22.
   Direct connections are auto-imported for future use — you do NOT need to register them first.
NEVER guess a vm_id. If the IP/host is NOT in the registered list, use direct mode with host+username.

═══ VM STATUS / HEALTH (CRITICAL) ═══
- If the user asks to **check status**, **health**, **how is the VM**, **diagnostics**, **resources**, **disk/memory**, or similar on a remote host, call **vm_health_check** (same host/username or vm_id as for SSH). It runs df, free, uptime, and docker ps — do **not** substitute a trivial command.
- Use **ssh_command** only when the user asks for a **specific** shell command or ad-hoc task — never use `echo`, `pwd`, or "hello world" as a stand-in for a health or status check.

═══ DOCUMENT GENERATION — NEVER AS A SUBSTITUTE FOR ADVICE ═══
- **generate_pdf**, **generate_docx**, **generate_pptx**, **generate_xlsx**, **generate_image** = produce **downloadable files** only when the user clearly wants an **artifact**: e.g. "make a PDF", "export a report", "save as docx", "create a slide deck".
- If the user asks for **recommendations**, **which model is best**, **what fits my machine**, **powerful for coding**, **search for**, or **look up** — use the **SEARCH & RECOMMENDATIONS** tool chain (host → verify_ollama → **fetch_url** to a real site like ollama.com/library), then answer in **plain chat** from tool outputs. **Do NOT** call document tools to "package" advice.

═══ AVAILABLE TOOLS ═══
{tools_section}

═══ HOW TO CALL A TOOL ═══
When you need to use a tool, output EXACTLY this format (inside a JSON code block):

```json
{{"tool": "tool_name", "arguments": {{"param1": "value1", "param2": "value2"}}}}
```

IMPORTANT RULES:
1. Output ONLY ONE tool call per response.
2. After calling a tool, STOP and wait for the result. Do NOT continue writing.
3. When you have the final answer (no more tools needed), respond normally WITHOUT any tool call block.
4. For **generate_pdf** / document tools: only when the user asked for a **file** (see DOCUMENT GENERATION section). Pass **sections** or **content** as the tool defines.
5. Prefer a clear assistant reply after tools (especially file paths); avoid empty replies.
6. For SSH / high-risk actions: be safe and explain intent.
7. Multi-step work: one tool per turn until done.

═══ TOOL CALL SHAPE (reference) ═══
```json
{{"tool": "generate_pdf", "arguments": {{"title": "...", "content": "# ..."}}}}
```

═══ GUIDELINES ═══
- Match the user's requested scope and tone.
- If you don't need a tool, answer directly.

═══ OUTPUT HYGIENE (CRITICAL) ═══
- Your reply is shown **directly** to the user. NEVER start with internal planning headers like "Analyze the request", "Plan:", "Step 1:", "Thought:", "Let me think…", "Here is my plan:", or similar meta-commentary.
- Jump straight to either a **tool call block** or a **direct, user-facing answer**.
- Do NOT echo the user's question back ("You asked me to…") — answer it instead.
- Do NOT enumerate your internal reasoning steps in the visible reply. Think silently, answer clearly.

═══ TRUTHFULNESS (CRITICAL) ═══
- Never print ChatML/control tokens like `<|...|>` in your reply.
- When summarizing **get_host_environment** or any tool: use **only** numbers/strings from the `[TOOL RESULT]` JSON. Do **not** invent OS names, macOS version numbers, or disk figures — quote `disk_df_h`, `macos_product_version`, `os` from JSON only.
- **verify_ollama_models**: quote `configured_chat_model`, `models_from_api`, `api_ps`, and CLI stdout only — never guess model names not present in the result.
- If the user wants files on their machine: use **list_host_path** with an absolute path (e.g. `/Users/name/Desktop`). Do **not** ask for a VM ID for local paths.

═══ SAFETY RULES ═══
1. NEVER use VM/SSH tools against localhost unless the user explicitly registered that host. For "my Mac" disk/OS when the API runs natively on Mac, use **get_host_environment**; for listing Desktop, use **list_host_path**.
2. Before executing any HIGH or CRITICAL risk tool, if the user's intent is ambiguous, ask a clarifying question FIRST. Do NOT guess — confirm target hosts, file paths, or destructive actions.
3. Never expose credentials, API keys, or passwords in your responses.
4. For shell commands on the backend host, ALWAYS use **run_terminal_command** — never fabricate or guess command output. Report exit_code, stdout, and stderr exactly as returned.
5. Questions like **which LLM**, **what AI model**, **DeepSeek or what**, **what model AIPiloty uses**: use **THIS DEPLOYMENT**; if they ask to **verify**, **double-check**, or **what is installed/running**, call **verify_ollama_models** once — **not** get_host_environment.

═══ IMAGE GENERATION ═══
- API keys for DALL·E / Gemini live in **Settings → Image Providers** (encrypted DB). Never ask the user to paste keys into chat.
- If the user asks for an image and did not name a model, call **generate_image** with the prompt only (omit model).
- If the tool returns ``needs_model_choice``: reply with **one short line** only, e.g. "Choose an image model below." Do **not** list model ids or ask them to type gpt-image-1 — the UI shows clickable choices.
- If ``needs_api_key``: tell them to open Settings → Image Providers (one short line).
- Aliases when the user names one: "dalle"/"dalle-3" → dall-e-3, "nano banana" → gemini flash image, "imagen" → imagen-3.

═══ RICH VISUALS IN CHAT (CRITICAL) ═══
The chat UI renders Markdown natively. Prefer these formats in the **final answer** (never inside a JSON tool block):

1. **Flowcharts / architecture / sequences / ER / mindmaps / gantt / simple charts**
   Use a fenced Mermaid block. Do NOT call generate_image for structured diagrams.
   Hard rules (invalid Mermaid breaks the UI):
   - Start with a diagram type: ``flowchart``, ``graph``, ``sequenceDiagram``, ``mindmap``, ``pie``, ``erDiagram``, ``gantt``, or ``xychart-beta``.
   - Node ids: letters/numbers/underscore only. Put labels in brackets: ``cicd[CI/CD]`` — never ``CI/CD[label]``.
   - Edges: ``A --> B`` or ``A -->|Yes| B``. NEVER write ``style A --> B`` (style is CSS only).
   - NEVER write ``title=Something`` inside ``graph``/``flowchart`` (causes a lexical error). For flowchart titles use YAML frontmatter; for schedules use a real ``gantt`` diagram with ``title My Title``.
   - NEVER mix shapes like ``Design[Design]((10d))``. Durations belong in ``gantt`` tasks (``Design :a1, 2024-01-01, 10d``).
   - Valid style line only: ``style nodeId fill:#312e81,stroke:#6366f1``.
   - Prefer ``mindmap`` for hierarchical topic maps (DevOps pillars, concept trees). Prefer ``flowchart`` for processes. Prefer ``gantt`` for sprints/schedules.

```mermaid
flowchart TD
  A[Start] --> B[Credentials]
  B --> C{{MFA OK?}}
  C -->|Yes| D[Session]
  C -->|No| B
  D --> E[Dashboard]
```

Mindmap example (use this shape for "mindmap of X"):

```mermaid
mindmap
  root((DevOps))
    CICD
      Pipelines
      GitHub_Actions
    Containers
      Docker
      Kubernetes
    Monitoring
      Prometheus
      Grafana
```

Sequence example:

```mermaid
sequenceDiagram
  User->>API: Login
  API-->>User: JWT
```

Simple pie / bar-style charts also use Mermaid (`pie` or `xychart-beta`).
   Pie values are plain numbers — NEVER append ``%``. Labels MUST be quoted:

```mermaid
pie showData
  title Team time
  "Coding" : 40
  "Meetings" : 25
  "Reviews" : 20
  "Docs" : 15
```

Bar / line charts MUST use ``xychart-beta`` with ``x-axis`` / ``y-axis`` (hyphenated) and array data.
NEVER write ``xaxis label`` or ``bar Jan: 1``. Correct shape:

```mermaid
xychart-beta
  title "Monthly Deploys"
  x-axis [Jan, Feb, Mar, Apr]
  y-axis "Deployments" 0 --> 5
  bar [1, 2, 3, 4]
```

 2. **Tables / comparisons**
    Use GitHub-flavored Markdown pipe tables in the chat reply (plain pipes — NEVER inside a ```mermaid fence).
    For product/model comparisons: call **web_search** with short per-item queries, then write a full useful table.
    After the first successful search, reply immediately — do not keep calling tools.
    If search is thin, still answer from knowledge like a normal assistant — NEVER fill cells with
    "No information available" or "No direct comparison available".
    NEVER invent tools like ``generate_table``, ``create_table``, or ``generate_chart``.
    NEVER call generate_pdf / generate_docx for an in-chat table.
    Tables are NOT Excel/PDF tools unless the user explicitly asked for a downloadable file.

 | Model | Speed | Best for |
 |---|---|---|
 | A | Fast | Drafts |
 | B | Slow | Final art |

3. **Math / formulas**
   Use `$inline$` or `$$display$$`, or a ```math fence with LaTeX.

4. **Freeform drawings / covers / photoreal art**
   Only then call **generate_image**. Structured flows → Mermaid; pretty pictures → image tool.

Keep Mermaid source valid and complete (matching start/end nodes, no tool JSON wrapped around it).

═══ TERMINAL OUTPUT (CRITICAL) ═══
- When summarizing **run_terminal_command** results: quote stdout/stderr faithfully. Never invent output.
- If the command fails (non-zero exit code), report the error and stderr — do not silently ignore it.
"""


def _deployment_llm_section(llm: OllamaService) -> str:
    """Facts about configured models so the agent can answer without wrong tools."""
    s = get_settings()
    return (
        "\n\n═══ THIS DEPLOYMENT (authoritative for \"what LLM/model does AIPiloty use\") ═══\n"
        f"- **Chat model** (Ollama): `{llm.model}` @ `{llm.base_url}` "
        f"(temperature={llm.temperature}, context_tokens≈{llm.context_length}).\n"
        f"- **RAG embedding model** (knowledge / kb_search): `{s.embedding_model}` (Ollama).\n"
        "When the user asks which LLM, AI model, or chat model this app uses, reply with the **Chat model** "
        "line above (and mention embeddings only if they ask about knowledge/RAG). "
        "If they want confirmation from Ollama itself, call **verify_ollama_models** and summarize API/CLI output. "
        "**get_host_environment** = OS/Python/disk only (not RAM pressure or fan) — not the chat model name.\n"
    )


def _extract_tool_call(text: str) -> Optional[dict]:
    """Extract a tool call from the model's text response using multi-layer parsing.
    
    Returns dict with 'tool' and 'arguments' keys, or None.
    """
    # Try patterns in order of specificity
    for pattern in [_JSON_BLOCK_RE, _XML_TAG_RE, _BARE_JSON_RE]:
        match = pattern.search(text)
        if match:
            try:
                parsed = json.loads(match.group(1))
                # Normalize: support both {"tool":..., "arguments":...} and {"name":..., "arguments":...}
                tool_name = parsed.get("tool") or parsed.get("name") or parsed.get("function")
                arguments = parsed.get("arguments") or parsed.get("params") or parsed.get("parameters") or {}
                if tool_name:
                    return {"tool": str(tool_name).strip(), "arguments": arguments}
            except (json.JSONDecodeError, AttributeError):
                continue

    return None


def _extract_text_before_tool_call(text: str) -> str:
    """Get the text content before the tool call block (the 'thinking' part)."""
    for pattern in [_JSON_BLOCK_RE, _XML_TAG_RE, _BARE_JSON_RE]:
        match = pattern.search(text)
        if match:
            before = text[: match.start()].strip()
            return before
    return text.strip()


def _strip_leaked_control_tokens(text: str) -> str:
    """Remove ChatML-style control tokens some models leak into visible text."""
    if not text:
        return text
    # <|tool_calls_begin|>, <|tool_sep|>, etc.
    t = re.sub(r"<\|.*?\|>", "", text, flags=re.DOTALL)
    t = t.replace("|>", "")
    return t.strip()


# Regex for internal planning headers that should never appear in user-visible output.
_PLANNER_LEAK_RE = re.compile(
    r"^(?:"
    r"(?:Analyze|Analyzing)\s+(?:the\s+)?request[:\.\s]*|"
    r"(?:Let\s+me\s+)?(?:think|plan|reason)[:\.\s]*|"
    r"Plan\s*:|"
    r"Thought\s*:|"
    r"Step\s+\d+\s*:|"
    r"My\s+plan\s*:|"
    r"Here(?:'s|\s+is)\s+(?:my|the)\s+plan\s*:|"
    r"I(?:'ll|\s+will)\s+(?:now\s+)?(?:analyze|assess|examine|review|check)\b[^.]*[.]\s*"
    r")+",
    re.IGNORECASE | re.MULTILINE,
)


def _strip_planner_leaks(text: str) -> str:
    """Strip internal planning preamble that models sometimes leak."""
    if not text:
        return text
    return _PLANNER_LEAK_RE.sub("", text, count=1).lstrip("\n ")


class SSEEvent:
    """Server-Sent Event payload."""

    def __init__(self, event: str, data: Any = None):
        self.event = event
        self.data = data or {}

    def to_sse(self) -> str:
        if isinstance(self.data, dict):
            payload = json.dumps({"type": self.event, "data": self.data})
        else:
            payload = json.dumps({"type": self.event, "data": self.data})
        return f"data: {payload}\n\n"


class AgentOrchestrator:
    """ReAct-style agent loop with prompt-based tool calling.

    Works with ANY Ollama model — no native tool support required.
    The model is instructed to output JSON tool-call blocks in its text,
    which we parse, execute, and feed results back as conversation messages.

    Phase 2: accepts optional ``evaluator`` (SelfEvaluator) for post-generation
    quality assessment and single-retry correction loop.
    """

    def __init__(
        self,
        llm: OllamaService,
        registry: ToolRegistry,
        guardrails: GuardrailService,
        get_all_vms_func=None,
        attachment_storage=None,
        memory=None,
        evaluator=None,         # Phase 2: SelfEvaluator | None
        episodic_store=None,    # Phase 3: EpisodicStore | None
        provider_router: "ProviderRouter | None" = None,  # Phase 3: multi-provider failover
    ):
        self._llm = llm
        self._router = provider_router  # ProviderRouter (optional; falls back to self._llm)
        self._registry = registry
        self._guardrails = guardrails
        self._get_all_vms = get_all_vms_func
        self._attachment_storage = attachment_storage
        self._memory = memory  # AgentMemory | None
        self._evaluator = evaluator  # SelfEvaluator | None
        self._episodic = episodic_store  # EpisodicStore | None

    def _chat_stream(self, messages, tools=None, model_override=None):
        """Unified stream call — uses ProviderRouter if configured, else OllamaService."""
        if self._router is not None:
            return self._router.chat_stream(messages, tools=tools, model_hint=model_override)
        return self._llm.chat_stream(messages, tools=tools, model_override=model_override)

    def _resolve_attachments(
        self, msg: dict[str, Any], attachment_ids: list[str]
    ) -> dict[str, Any]:
        """Enrich a user message with attachment data.

        - Images: adds ``images`` list (base64 strings) for Ollama vision API.
        - Documents: prepends extracted text to ``content``.
        """
        if not self._attachment_storage or not attachment_ids:
            return msg

        metas = self._attachment_storage.resolve_many(attachment_ids)
        images: list[str] = []
        doc_parts: list[str] = []

        for meta in metas:
            if meta.category == "image":
                b64 = self._attachment_storage.get_base64(meta.id)
                if b64:
                    images.append(b64)
            elif meta.category == "document" and meta.extracted_text:
                doc_parts.append(
                    f"[Attached file: {meta.filename}]\n{meta.extracted_text}"
                )

        result = dict(msg)
        if images:
            result["images"] = images
        if doc_parts:
            prefix = "\n\n".join(doc_parts)
            result["content"] = f"{prefix}\n\n---\n\n{result['content']}"
        return result

    async def _stream_research_table_fast(
        self,
        *,
        user_message: str,
        model: str | None,
        start_time: float,
    ) -> AsyncGenerator[SSEEvent, None]:
        """Search-first comparison table — no ReAct tool loop.

        1) Run 1–3 focused web_search calls server-side
        2) One short LLM format turn (capped tokens)
        3) Normalize broken vertical / fenced tables before final emit
        """
        from .research_table import (
            RESEARCH_TABLE_FORMAT_SYSTEM,
            build_format_user_prompt,
            extract_comparison_queries,
            normalize_research_table_markdown,
        )

        yield SSEEvent("thinking", {"iteration": 1, "mode": "research_table"})
        queries = extract_comparison_queries(user_message)
        yield SSEEvent(
            "log",
            {
                "level": "info",
                "message": (
                    f"RESEARCH_TABLE fast path — searching {len(queries)} quer"
                    f"{'ies' if len(queries) != 1 else 'y'}, then one format turn"
                ),
                "timestamp": time.monotonic() - start_time,
            },
        )

        search_tool = self._registry.get("web_search")
        search_blocks: list[dict[str, Any]] = []
        if search_tool:
            for q in queries:
                yield SSEEvent(
                    "planning",
                    {
                        "tool": "web_search",
                        "steps": ["Search", q, "Collect snippets"],
                    },
                )
                yield SSEEvent(
                    "tool_start",
                    {"tool": "web_search", "arguments": {"query": q, "max_results": 5}},
                )
                try:
                    result = await search_tool.execute(query=q, max_results=5)
                    result_dict = result.to_dict()
                except Exception as e:
                    logger.warning("research_table web_search failed for %r: %s", q, e)
                    result_dict = {"success": False, "error": str(e)}
                yield SSEEvent(
                    "tool_output",
                    {
                        "tool": "web_search",
                        "output": json.dumps(result_dict)
                        if isinstance(result_dict, dict)
                        else str(result_dict),
                    },
                )
                out = ""
                err = None
                if isinstance(result_dict, dict):
                    out = result_dict.get("output") or ""
                    err = result_dict.get("error")
                    if isinstance(out, dict):
                        out = json.dumps(out, default=str)
                search_blocks.append(
                    {"query": q, "output": str(out or ""), "error": err}
                )
                yield SSEEvent(
                    "log",
                    {
                        "level": "info" if not err else "warn",
                        "message": f"web_search '{q[:60]}' {'ok' if not err else 'failed'}",
                        "timestamp": time.monotonic() - start_time,
                    },
                )
        else:
            yield SSEEvent(
                "log",
                {
                    "level": "warn",
                    "message": "web_search unavailable — formatting from model knowledge",
                    "timestamp": time.monotonic() - start_time,
                },
            )

        format_msgs: list[dict[str, Any]] = [
            {"role": "system", "content": RESEARCH_TABLE_FORMAT_SYSTEM},
            {
                "role": "user",
                "content": build_format_user_prompt(user_message, search_blocks),
            },
        ]
        yield SSEEvent(
            "log",
            {
                "level": "info",
                "message": "RESEARCH_TABLE — formatting ChatGPT-style aspect table (num_predict=1400)",
                "timestamp": time.monotonic() - start_time,
            },
        )

        # Buffer the format turn, then emit ONE cleaned answer.
        # Streaming broken vertical pipes makes the UI look stuck/broken.
        _IDLE_TIMEOUT_S = 90.0
        _HARD_CAP_S = 150.0
        full = ""
        last_token_at = time.monotonic()
        format_started = time.monotonic()
        try:
            stream_it = self._chat_stream(
                format_msgs,
                tools=None,
                model_override=model,
            ).__aiter__()
            read_task: asyncio.Task = asyncio.create_task(stream_it.__anext__())
            while True:
                if time.monotonic() - format_started > _HARD_CAP_S:
                    yield SSEEvent(
                        "log",
                        {
                            "level": "warn",
                            "message": "RESEARCH_TABLE format turn hit hard time cap — finalizing",
                            "timestamp": time.monotonic() - start_time,
                        },
                    )
                    read_task.cancel()
                    break
                done, _ = await asyncio.wait(
                    {read_task},
                    timeout=2.5,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if read_task not in done:
                    idle = time.monotonic() - last_token_at
                    elapsed = round(time.monotonic() - start_time, 1)
                    yield SSEEvent(
                        "progress",
                        {
                            "phase": "llm_stream",
                            "iteration": 1,
                            "elapsed_s": elapsed,
                            "message": f"Formatting table… (~{elapsed}s elapsed)",
                        },
                    )
                    if idle > _IDLE_TIMEOUT_S and full.strip():
                        yield SSEEvent(
                            "log",
                            {
                                "level": "warn",
                                "message": (
                                    "RESEARCH_TABLE stream idle — using partial answer"
                                ),
                                "timestamp": time.monotonic() - start_time,
                            },
                        )
                        read_task.cancel()
                        break
                    continue
                try:
                    chunk = read_task.result()
                except StopAsyncIteration:
                    break
                except Exception as e:
                    logger.warning("research_table stream read error: %s", e)
                    break
                read_task = asyncio.create_task(stream_it.__anext__())
                msg_obj = chunk.get("message") or {}
                piece = _normalize_llm_content(msg_obj) if msg_obj else ""
                if not piece and isinstance(chunk.get("response"), str):
                    piece = chunk["response"]
                if piece:
                    last_token_at = time.monotonic()
                    full += piece
        except Exception as e:
            logger.exception("RESEARCH_TABLE format stream failed: %s", e)
            if not full.strip():
                yield SSEEvent("error", {"message": f"LLM error: {e}"})
                return

        cleaned = normalize_research_table_markdown(full)
        if not cleaned.strip():
            cleaned = (
                "I couldn't finish the comparison table. Please try again — "
                "or ask for the same compare in Ask mode for a quicker answer."
            )
        elif cleaned != full.strip():
            yield SSEEvent(
                "log",
                {
                    "level": "info",
                    "message": "RESEARCH_TABLE — normalized table Markdown for display",
                    "timestamp": time.monotonic() - start_time,
                },
            )

        yield SSEEvent("token", {"token": cleaned, "done": True})
        yield SSEEvent(
            "final_report",
            {
                "summary": "Comparison table ready",
                "tools_used": len(search_blocks),
                "success": True,
                "mode": "research_table_fast",
            },
        )

    async def run(
        self,
        messages: list[dict[str, Any]],
        auto_approve: bool = False,
        model: str | None = None,
        session_key: str | None = None,    # Phase 3: for episodic episode tagging
        mode: str = "auto",                # ask | agent | auto | plan | debug
    ) -> AsyncGenerator[SSEEvent, None]:
        """Execute the ReAct agent loop, yielding SSE events."""
        kwargs = {"session_key": session_key}

        # Extract latest user question early (routing + episodic recall)
        _latest_user_msg = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
            "",
        )

        # Cursor-like Plan / Debug: bias the user turn without changing ask semantics
        _mode_l = (mode or "auto").lower()
        if _mode_l == "plan" and _latest_user_msg:
            messages = list(messages)
            for i in range(len(messages) - 1, -1, -1):
                if messages[i].get("role") == "user":
                    messages[i] = {
                        **messages[i],
                        "content": (
                            "[PLAN MODE] Produce a concrete step-by-step plan. "
                            "Prefer the create_plan tool. Do NOT apply file edits or "
                            "run destructive commands until the user approves the plan.\n\n"
                            + str(messages[i].get("content", ""))
                        ),
                    }
                    break
            _latest_user_msg = next(
                (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
                "",
            )
        elif _mode_l == "debug" and _latest_user_msg:
            messages = list(messages)
            for i in range(len(messages) - 1, -1, -1):
                if messages[i].get("role") == "user":
                    messages[i] = {
                        **messages[i],
                        "content": (
                            "[DEBUG MODE] Investigate root cause. Check logs, reproduce "
                            "errors, propose a minimal fix. Prefer diagnostic tools "
                            "(terminal, list_host_path, health checks) before edits.\n\n"
                            + str(messages[i].get("content", ""))
                        ),
                    }
                    break
            _latest_user_msg = next(
                (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
                "",
            )

        # Wrap user messages through guardrails + attachments (all routes need this)
        safe_messages = []
        for m in messages:
            if m.get("role") == "user":
                enriched = {**m, "content": self._guardrails.wrap_user_content(str(m.get("content", "")))}
                att_ids = enriched.pop("attachment_ids", [])
                if att_ids:
                    enriched = self._resolve_attachments(enriched, att_ids)
                else:
                    enriched.pop("attachment_ids", None)
                safe_messages.append(enriched)
            else:
                clean = {k: v for k, v in m.items() if k != "attachment_ids"}
                safe_messages.append(clean)

        # Auto-select vision model when images are attached
        has_images = any("images" in m for m in safe_messages)
        if has_images and not model:
            settings = get_settings()
            vision_model = settings.vision_model
            if vision_model:
                model = vision_model
                logger.info("Auto-selecting vision model %s for image attachments", vision_model)

        start_time = time.monotonic()
        seen_tool_calls: list[str] = []
        last_tool_result_fallback: Optional[str] = None
        execution_steps: list[dict[str, Any]] = []
        tool_findings: list[dict[str, Any]] = []
        _eval_retry_done: bool = False
        _tool_context_parts: list[str] = []
        total_tools_run = 0
        url_fetch_nudge_sent = False
        research_table_nudge_sent = False
        research_table_rewrite_sent = False
        research_table_search_count = 0

        # UI Approve button re-submits with auto_approve — clear pending card state
        if auto_approve and session_key:
            pending_actions.clear(session_key)

        _routed = route_message(
            str(_latest_user_msg or ""),
            mode=mode or "auto",
            session_key=session_key,
        )

        # Phase C: optional embedding refine when Ollama nomic-embed is available
        try:
            settings = get_settings()
            if settings.semantic_router_enabled and _routed.route in (
                MessageRoute.GENERAL_QA,
                MessageRoute.AGENT_TASK,
            ):
                emb = getattr(self, "_embeddings", None)
                if emb is None:
                    try:
                        from ...main import app_state as _app_state
                        emb = _app_state.get("embedding_service")
                    except Exception:
                        emb = None
                if emb is not None:
                    hit = await semantic_router.match(str(_latest_user_msg or ""), emb)
                    if hit.method == "embedding" and hit.score >= 0.62:
                        # Never promote Mermaid/chart turns into the tool agent
                        # Never demote research tables away from search agent
                        if (_routed.reason or "").startswith(
                            ("structured_diagram", "mode_ask_diagram", "research_table")
                        ):
                            pass
                        elif hit.label == "general_qa" and _routed.route == MessageRoute.AGENT_TASK:
                            conf = _routed.intent.confidence if _routed.intent else 0.0
                            if conf < 0.45:
                                _routed = type(_routed)(
                                    route=MessageRoute.GENERAL_QA,
                                    normalized=_routed.normalized,
                                    intent=_routed.intent,
                                    static_reply=None,
                                    reason=f"embed_qa:{hit.score}",
                                    confirmation=_routed.confirmation,
                                    mode=_routed.mode,
                                )
                        elif hit.label == "agent_task" and _routed.route == MessageRoute.GENERAL_QA:
                            # Only promote when original looked task-like
                            if _routed.reason.startswith("default") is False:
                                pass
        except Exception as _sem_err:
            logger.debug("Semantic embed refine skipped: %s", _sem_err)

        yield SSEEvent(
            "route",
            {
                "route": _routed.route.value,
                "reason": _routed.reason,
                "intent": (_routed.intent.category if _routed.intent else None),
                "confidence": (_routed.intent.confidence if _routed.intent else None),
                "mode": _routed.mode,
                "confirmation": _routed.confirmation,
            },
        )
        try:
            await metrics.increment(f"route_{_routed.route.value}")
            await metrics.increment(f"chat_mode_{(_routed.mode or 'auto')}")
        except Exception:
            pass

        if _routed.route == MessageRoute.SMALLTALK:
            yield SSEEvent(
                "token",
                {"token": _routed.static_reply or "Hello! How can I help you today?", "done": True},
            )
            return

        if _routed.route == MessageRoute.CLARIFY:
            yield SSEEvent("thinking", {"iteration": 1, "mode": "clarify"})
            yield SSEEvent(
                "token",
                {
                    "token": _routed.static_reply
                    or "I want to help — could you give a bit more detail?",
                    "done": True,
                },
            )
            return

        if _routed.route == MessageRoute.CONFIRMATION:
            if _routed.confirmation == "deny":
                pending_actions.clear(session_key)
                yield SSEEvent(
                    "token",
                    {
                        "token": _routed.static_reply or "Cancelled — I won't run that action.",
                        "done": True,
                    },
                )
                return

            # Affirm — execute the stored pending tool
            action = pending_actions.pop(session_key)
            if not action:
                yield SSEEvent(
                    "token",
                    {
                        "token": "I don't have a pending action to confirm. What would you like me to do?",
                        "done": True,
                    },
                )
                return

            tool = self._registry.get(action.tool_name) or self._registry.get(action.tool_name.lower())
            if not tool:
                yield SSEEvent(
                    "error",
                    {"message": f"Pending tool '{action.tool_name}' is no longer available."},
                )
                return

            yield SSEEvent("thinking", {"iteration": 1, "mode": "confirmation"})
            yield SSEEvent(
                "log",
                {
                    "level": "info",
                    "message": f"CONFIRMATION — executing pending {action.tool_name}",
                    "timestamp": 0,
                },
            )
            yield SSEEvent("tool_start", {"tool": action.tool_name, "arguments": action.arguments})
            try:
                pending_args = action.arguments if isinstance(action.arguments, dict) else {}
                if action.tool_name == "generate_image":
                    from ..provider_secrets import apply_user_image_model_choice

                    pending_args = apply_user_image_model_choice(
                        pending_args, str(_latest_user_msg or "")
                    )
                result: ToolResult = await tool.execute(**pending_args)
                result_dict = result.to_dict()
            except Exception as e:
                logger.error("Pending tool %s failed: %s", action.tool_name, e)
                result_dict = {"success": False, "error": str(e)}

            yield SSEEvent(
                "tool_output",
                {
                    "tool": action.tool_name,
                    "output": json.dumps(result_dict) if isinstance(result_dict, dict) else str(result_dict),
                },
            )
            _ok = result_dict.get("success", True) if isinstance(result_dict, dict) else True
            summary = (
                f"Done — executed **{action.tool_name}** "
                f"({'succeeded' if _ok else 'failed'}).\n\n"
            )
            if isinstance(result_dict, dict):
                err = result_dict.get("error")
                out = result_dict.get("output") or result_dict.get("data")
                if err:
                    summary += f"Error: {err}"
                elif out is not None:
                    out_s = out if isinstance(out, str) else json.dumps(out, default=str)
                    if len(out_s) > 1200:
                        out_s = out_s[:1200] + "…"
                    summary += out_s
            yield SSEEvent("token", {"token": summary, "done": True})
            return

        if _routed.route == MessageRoute.GENERAL_QA:
            # Deterministic Mermaid when the user already supplied chart data
            if _routed.static_reply:
                yield SSEEvent("thinking", {"iteration": 1, "mode": "diagram_static"})
                yield SSEEvent(
                    "log",
                    {
                        "level": "info",
                        "message": "DIAGRAM — synthesized Mermaid (no tools)",
                        "timestamp": 0,
                    },
                )
                yield SSEEvent(
                    "token",
                    {"token": _routed.static_reply, "done": True},
                )
                return

            _is_diagram = (_routed.reason or "").startswith(
                ("structured_diagram", "mode_ask_diagram")
            )
            _is_table = (_routed.reason or "").startswith(("mode_ask_table", "research_table"))
            chat_prompt = chat_system_prompt(
                diagram=_is_diagram, table=_is_table
            ) + _deployment_llm_section(self._llm)
            if self._memory and self._memory.size > 0:
                mem_context = self._memory.get_context_summary(max_entries=5)
                if mem_context:
                    chat_prompt += f"\n\n{mem_context}"
            chat_conversation: list[dict[str, Any]] = [
                {"role": "system", "content": chat_prompt},
            ] + safe_messages
            yield SSEEvent("thinking", {"iteration": 1, "mode": "general_qa"})

            # Phase C: optional cloud LLM for hard reasoning (tools stay local)
            _complexity = "medium"
            try:
                _complexity = ModelRouter().route(str(_latest_user_msg or "")).complexity
            except Exception:
                pass
            use_cloud = should_use_cloud_for_qa(_complexity)
            yield SSEEvent(
                "log",
                {
                    "level": "info",
                    "message": (
                        f"GENERAL_QA — cloud LLM ({get_settings().cloud_llm_model})"
                        if use_cloud
                        else "GENERAL_QA — calling LLM without tools"
                    ),
                    "timestamp": 0,
                },
            )
            full_chat = ""
            try:
                # ProviderRouter handles cloud→local failover automatically;
                # only use legacy openai_chat_stream when router is not active.
                stream = (
                    openai_chat_stream(chat_conversation)
                    if (use_cloud and self._router is None)
                    else self._chat_stream(chat_conversation, tools=None, model_override=model)
                )
                async for chunk in stream:
                    # Skip router meta-events (provider_switched / provider_health)
                    if chunk.get("type") in ("provider_switched", "provider_health", "error"):
                        yield SSEEvent(chunk["type"], chunk.get("data", {}))
                        continue
                    msg_obj = chunk.get("message") or {}
                    piece = _normalize_llm_content(msg_obj) if msg_obj else ""
                    if not piece and isinstance(chunk.get("response"), str):
                        piece = chunk["response"]
                    if piece:
                        full_chat += piece
                        yield SSEEvent("token", {"token": piece, "done": False})
            except Exception as e:
                if use_cloud and self._router is None:
                    logger.warning("Cloud GENERAL_QA failed (%s) — falling back to local", e)
                    try:
                        async for chunk in self._llm.chat_stream(
                            chat_conversation, tools=None, model_override=model
                        ):
                            msg_obj = chunk.get("message") or {}
                            piece = _normalize_llm_content(msg_obj) if msg_obj else ""
                            if not piece and isinstance(chunk.get("response"), str):
                                piece = chunk["response"]
                            if piece:
                                full_chat += piece
                                yield SSEEvent("token", {"token": piece, "done": False})
                    except Exception as e2:
                        logger.exception("GENERAL_QA LLM stream failed: %s", e2)
                        yield SSEEvent("error", {"message": f"LLM error: {e2}"})
                        return
                else:
                    logger.exception("GENERAL_QA LLM stream failed: %s", e)
                    yield SSEEvent("error", {"message": f"LLM error: {e}"})
                    return
            if not full_chat.strip():
                yield SSEEvent(
                    "token",
                    {
                        "token": "I'm here — could you rephrase that or ask a more specific question?",
                        "done": True,
                    },
                )
            else:
                yield SSEEvent("token", {"token": "", "done": True})
            return

        # ── Research comparison tables: search-first, ONE format turn ─────────
        # Avoid ReAct freestyle (small Ollama models emit broken vertical tables
        # for minutes and never call tools). ChatGPT-style: research → answer.
        _is_research_table = (_routed.reason or "") == "research_table" or (
            _routed.intent
            and (_routed.intent.context_hints or {}).get("rich_visual") == "research_table"
        )
        if _is_research_table and _routed.route == MessageRoute.AGENT_TASK:
            async for ev in self._stream_research_table_fast(
                user_message=str(_latest_user_msg or ""),
                model=model,
                start_time=start_time,
            ):
                yield ev
            return

        # AGENT_TASK — progressive tool subset + ReAct loop
        _pack = selected_pack_name(_routed.intent, str(_latest_user_msg or ""))
        agent_tools = select_progressive_tools(
            self._registry,
            _routed.intent,
            message=str(_latest_user_msg or ""),
        )
        _allowed_tool_names = {t.name for t in agent_tools}
        system_prompt = _get_cached_system_prompt(agent_tools)
        _job = "═══ YOUR JOB ═══\n"
        _idx = system_prompt.find(_job)
        if _idx != -1:
            _ins = _idx + len(_job)
            system_prompt = (
                system_prompt[:_ins]
                + _deployment_llm_section(self._llm).lstrip("\n")
                + system_prompt[_ins:]
            )
        else:
            system_prompt += _deployment_llm_section(self._llm)

        if _is_research_table:
            from .diagram_reply import RESEARCH_TABLE_ADDENDUM

            system_prompt += "\n" + RESEARCH_TABLE_ADDENDUM

        if self._get_all_vms:
            try:
                vms = await self._get_all_vms()
                if vms:
                    vm_lines = []
                    for vm in vms:
                        vm_lines.append(
                            f"  - vm_id={vm.id}, name=\"{vm.name}\", ip={vm.host_ip}, "
                            f"user={vm.ssh_username}, provider={vm.provider}"
                        )
                    vm_section = (
                        "\n\n═══ REGISTERED VMs ═══\n"
                        "If the user mentions an IP or VM name from this list, use the vm_id.\n"
                        "If the IP/host is NOT in this list, use direct mode: host + username parameters.\n"
                        + "\n".join(vm_lines)
                        + "\n═══ END VMs ═══"
                    )
                    system_prompt += vm_section
            except Exception as e:
                logger.warning("Failed to fetch VM context: %s", e)

        if self._memory and self._memory.size > 0:
            mem_context = self._memory.get_context_summary(max_entries=10)
            if mem_context:
                system_prompt += f"\n\n{mem_context}"

        # ── Project rules (Phase 2) ────────────────────────────────────────
        # Read .aipiloty/rules or AGENTS.md from workspace root and inject as
        # project-specific system context (max 2 000 chars to avoid bloat).
        _project_rules = _load_project_rules()
        if _project_rules:
            system_prompt += (
                "\n\n═══ PROJECT RULES (from workspace AGENTS.md / .aipiloty/rules) ═══\n"
                + _project_rules
                + "\n═══ END PROJECT RULES ═══"
            )

        _working_mem = WorkingMemory()
        if self._episodic and _latest_user_msg:
            try:
                recalls = await self._episodic.recall(
                    query=str(_latest_user_msg)[:400], top_k=3, min_score=0.55
                )
                if recalls:
                    for i, ep in enumerate(recalls, 1):
                        _working_mem.add_episodic_recall(ep.format_for_prompt(i))
                    yield SSEEvent("log", {
                        "level": "info",
                        "message": f"Episodic memory: recalled {len(recalls)} relevant past episode(s)",
                        "timestamp": 0,
                    })
            except Exception as _ep_err:
                logger.debug("Episodic recall skipped: %s", _ep_err)

        _working_mem.set_objective(str(_latest_user_msg)[:200])
        wm_section = _working_mem.format_for_prompt()
        if wm_section:
            system_prompt += f"\n\n{wm_section}"

        conversation: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ] + safe_messages

        yield SSEEvent(
            "log",
            {
                "level": "info",
                "message": f"AGENT_TASK — pack={_pack} progressive tools ({len(agent_tools)}): {', '.join(t.name for t in agent_tools)}",
                "timestamp": 0,
            },
        )

        # AGENT_TASK — existing ReAct loop
        for iteration in range(1, MAX_ITERATIONS + 1):
            elapsed = time.monotonic() - start_time
            if elapsed > MAX_DURATION_SECONDS:
                yield SSEEvent("log", {"level": "warn", "message": "Agent loop timed out", "timestamp": time.monotonic() - start_time})
                yield SSEEvent("error", {"message": "Agent loop timed out"})
                return

            yield SSEEvent("thinking", {"iteration": iteration})
            yield SSEEvent("log", {"level": "info", "message": f"Iteration {iteration}/{MAX_ITERATIONS} — calling LLM", "timestamp": time.monotonic() - start_time})

            # ── Stream LLM response with live token emission ──────────
            # Markers that signal a tool-call JSON block is starting.
            _TOOL_MARKERS = ["```json", "```tool_call", '```\n{', '{"tool"', "<tool_call>"]
            _LOOK_AHEAD = 15  # chars kept un-emitted for partial-marker look-ahead

            full_content = ""
            emitted_up_to = 0
            tool_marker_found = False

            try:
                # IMPORTANT: Never use asyncio.wait_for() on __anext__() here — timeout *cancels*
                # the pending read and can drop Ollama chunks or break the stream iterator,
                # leaving full_content empty → bogus "I've completed the request."
                _PULSE_SEC = 2.5
                stream_it = self._chat_stream(conversation, tools=None, model_override=model).__aiter__()
                read_task: asyncio.Task = asyncio.create_task(stream_it.__anext__())

                while True:
                    done, _ = await asyncio.wait(
                        {read_task},
                        timeout=_PULSE_SEC,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if read_task not in done:
                        _elapsed = round(time.monotonic() - start_time, 1)
                        yield SSEEvent(
                            "progress",
                            {
                                "phase": "llm_stream",
                                "iteration": iteration,
                                "elapsed_s": _elapsed,
                                "message": f"Model still generating… (~{_elapsed}s elapsed)",
                            },
                        )
                        continue

                    try:
                        chunk = read_task.result()
                    except StopAsyncIteration:
                        break

                    read_task = asyncio.create_task(stream_it.__anext__())

                    msg_obj = chunk.get("message") or {}
                    token = _normalize_llm_content(msg_obj) if isinstance(msg_obj, dict) else ""
                    if not token:
                        continue
                    full_content += token

                    if not tool_marker_found:
                        # Scan un-emitted portion for a complete tool-call marker
                        unemitted = full_content[emitted_up_to:]
                        for marker in _TOOL_MARKERS:
                            idx = unemitted.find(marker)
                            if idx >= 0:
                                # Flush safe text before the marker
                                safe_text = unemitted[:idx].rstrip()
                                if safe_text:
                                    yield SSEEvent("token", {"token": safe_text, "done": False})
                                emitted_up_to = emitted_up_to + idx
                                tool_marker_found = True
                                break

                        if not tool_marker_found:
                            # Emit tokens with look-ahead buffer for partial markers
                            safe_end = max(emitted_up_to, len(full_content) - _LOOK_AHEAD)
                            if safe_end > emitted_up_to:
                                emit_text = full_content[emitted_up_to:safe_end]
                                yield SSEEvent("token", {"token": emit_text, "done": False})
                                emitted_up_to = safe_end
            except Exception as e:
                logger.error("LLM streaming failed: %s", e)
                yield SSEEvent("error", {"message": f"LLM error: {e}"})
                return

            content = _strip_planner_leaks(_strip_leaked_control_tokens(full_content))

            if not content.strip():
                fb = "I've completed the request."
                if last_tool_result_fallback:
                    fb = (
                        "Here is the structured output from the last tool run:\n\n"
                        f"```\n{last_tool_result_fallback[:8000]}\n```\n\n"
                        "Ask if you want a shorter summary or a different format."
                    )
                yield SSEEvent("token", {"token": fb, "done": True})
                return

            # Try to extract a tool call from the response
            tool_call = _extract_tool_call(content)

            if not tool_call:
                # User asked about a URL but model answered without tools — force one follow-up turn
                page_url = _first_https_url_from_messages(messages)
                if (
                    page_url
                    and total_tools_run == 0
                    and not url_fetch_nudge_sent
                    and self._registry.get("fetch_url")
                ):
                    url_fetch_nudge_sent = True
                    conversation.append({"role": "assistant", "content": content})
                    tool_line = json.dumps(
                        {"tool": "fetch_url", "arguments": {"url": page_url}},
                        ensure_ascii=False,
                    )
                    conversation.append(
                        {
                            "role": "user",
                            "content": (
                                "[SYSTEM] The user’s message includes a URL. You must fetch it before answering.\n"
                                "Output ONLY this block (no other text before or after):\n```json\n"
                                f"{tool_line}\n```"
                            ),
                        },
                    )
                    yield SSEEvent(
                        "log",
                        {
                            "level": "info",
                            "message": "URL detected — continuing so fetch_url runs (single follow-up turn)",
                            "timestamp": time.monotonic() - start_time,
                        },
                    )
                    continue

                # Research tables must search before answering — force one web_search turn
                if (
                    (_routed.reason or "") == "research_table"
                    and total_tools_run == 0
                    and not research_table_nudge_sent
                    and self._registry.get("web_search")
                ):
                    research_table_nudge_sent = True
                    # Prefer a short focused query (first named item), not the whole prompt
                    _msg = str(_latest_user_msg or "")
                    _first = re.split(r"\b(?:vs\.?|versus|,|and)\b", _msg, maxsplit=1, flags=re.I)[0]
                    _first = re.sub(
                        r"^(?:compare|comparison|show|make|create|render)\s+",
                        "",
                        _first.strip(),
                        flags=re.I,
                    )
                    q = (_first or _msg)[:80].strip() or _msg[:80]
                    conversation.append({"role": "assistant", "content": content})
                    tool_line = json.dumps(
                        {
                            "tool": "web_search",
                            "arguments": {"query": q},
                        },
                        ensure_ascii=False,
                    )
                    conversation.append(
                        {
                            "role": "user",
                            "content": (
                                "[SYSTEM] Comparison/research table request.\n"
                                "1) Call web_search with SHORT queries (one product/model at a time).\n"
                                "2) Then reply with a COMPLETE Markdown pipe table — every cell filled with useful content.\n"
                                "3) NEVER write 'No information available' or 'No direct comparison available'.\n"
                                "4) If search is thin, still answer from knowledge like ChatGPT would, with brief Notes caveats.\n"
                                "5) NEVER wrap the table in a ```mermaid fence — plain Markdown pipes only.\n"
                                "6) Do NOT call generate_pdf or any document tool.\n"
                                "Output ONLY this block first:\n```json\n"
                                f"{tool_line}\n```"
                            ),
                        },
                    )
                    yield SSEEvent(
                        "log",
                        {
                            "level": "info",
                            "message": "Research table — forcing web_search before final answer",
                            "timestamp": time.monotonic() - start_time,
                        },
                    )
                    continue

                # Empty placeholder tables after search — force a normal useful rewrite
                if (
                    (_routed.reason or "") == "research_table"
                    and not research_table_rewrite_sent
                    and re.search(
                        r"no\s+(direct\s+)?(comparison|information)\s+available"
                        r"|not\s+enough\s+information"
                        r"|unable\s+to\s+(find|provide)\s+(a\s+)?(direct\s+)?comparison",
                        content,
                        re.I,
                    )
                ):
                    research_table_rewrite_sent = True
                    conversation.append({"role": "assistant", "content": content})
                    conversation.append(
                        {
                            "role": "user",
                            "content": (
                                "[SYSTEM] Your last reply used empty placeholders. Rewrite NOW as a normal "
                                "assistant comparison: a full Markdown pipe table with every row/column filled "
                                "(speed, quality, best for, notes as requested). Use search snippets if any; "
                                "otherwise use trained knowledge with short caveats. "
                                "Do NOT call tools. Do NOT say 'No information available'. "
                                "Do NOT wrap the table in a ```mermaid fence."
                            ),
                        },
                    )
                    yield SSEEvent(
                        "log",
                        {
                            "level": "warn",
                            "message": "Research table — rewriting empty placeholder answer",
                            "timestamp": time.monotonic() - start_time,
                        },
                    )
                    continue

                # Mis-labeled pipe table inside ```mermaid — unwrap for stored answer.
                # Do NOT re-emit the full cleaned body (would duplicate streamed tokens);
                # the frontend also unwraps fences for display.
                if (_routed.reason or "") == "research_table" and "```mermaid" in content.lower():
                    from .diagram_reply import (
                        looks_like_markdown_pipe_table,
                        strip_mermaid_fence_around_pipe_tables,
                    )

                    _needs_strip = any(
                        looks_like_markdown_pipe_table(m.group(1))
                        for m in re.finditer(
                            r"```mermaid[^\n]*\n([\s\S]*?)```", content, re.I
                        )
                    )
                    if _needs_strip:
                        content = strip_mermaid_fence_around_pipe_tables(content)
                        yield SSEEvent(
                            "log",
                            {
                                "level": "info",
                                "message": (
                                    "Research table — stripped mermaid fence around pipe table"
                                ),
                                "timestamp": time.monotonic() - start_time,
                            },
                        )

                # Final answer — flush any remaining un-streamed text
                remaining = _strip_planner_leaks(_strip_leaked_control_tokens(full_content[emitted_up_to:])).strip()
                if remaining:
                    yield SSEEvent("token", {"token": remaining, "done": True})
                elif emitted_up_to == 0:
                    # Nothing was streamed (shouldn't happen, but guard)
                    out = content.strip() or "I've completed the request."
                    yield SSEEvent("token", {"token": out, "done": True})

                # ── Phase 2: Self-Evaluator ──────────────────────────────
                final_answer_text = content.strip()
                settings = get_settings()

                if (
                    self._evaluator is not None
                    and settings.agent_self_eval_enabled
                    and not _eval_retry_done
                    and final_answer_text
                    and _tool_context_parts  # only evaluate when tools were used
                ):
                    user_question = next(
                        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
                        "",
                    )
                    eval_context = "\n\n---\n\n".join(_tool_context_parts[-6:])  # last 6 tool outputs
                    eval_result = await self._evaluator.evaluate(
                        question=str(user_question)[:400],
                        context=eval_context[:2000],
                        answer=final_answer_text[:1200],
                    )
                    yield SSEEvent("evaluation", eval_result.to_sse_payload())

                    if eval_result.eval_ok and eval_result.should_retry:
                        _eval_retry_done = True
                        correction_msg = eval_result.correction_hint(str(user_question)[:200])
                        conversation.append({"role": "assistant", "content": content})
                        conversation.append({"role": "user", "content": correction_msg})
                        yield SSEEvent("log", {
                            "level": "warn",
                            "message": (
                                f"Self-eval score={eval_result.overall:.0%} < threshold "
                                f"({settings.agent_self_eval_threshold:.0%}) — running correction turn"
                            ),
                            "timestamp": time.monotonic() - start_time,
                        })
                        continue  # one more LLM pass with the correction prompt
                # ── End Phase 2 ──────────────────────────────────────────

                # Emit final report if tools were used
                if total_tools_run > 0:
                    elapsed_final = time.monotonic() - start_time
                    out_text = content.strip() or "Completed successfully."
                    # Confidence = weighted by tool success rate, not just iteration count
                    success_count = sum(1 for s in execution_steps if s.get("success"))
                    success_rate = success_count / max(total_tools_run, 1)
                    confidence = min(98, max(55, int(70 + success_rate * 25 - max(0, iteration - 3) * 3)))
                    clean_summary = _clean_report_text(out_text[:800])
                    clean_findings = [
                        {"tool": f["tool"], "summary": _clean_report_text(f["summary"])}
                        for f in tool_findings
                    ]
                    yield SSEEvent("final_report", {
                        "summary": clean_summary,
                        "steps": execution_steps,
                        "findings": clean_findings,
                        "confidence": confidence,
                        "duration_ms": int(elapsed_final * 1000),
                        "tools_used": total_tools_run,
                        "iterations": iteration,
                    })

                # ── Phase 3: Store episode in episodic memory ─────────────
                if self._episodic and total_tools_run > 0:
                    episode_summary = _working_mem.to_episode_summary()
                    if episode_summary:
                        category = _working_mem.infer_category()
                        session_id = kwargs.get("session_key") or "unknown"
                        try:
                            await self._episodic.remember(
                                summary=episode_summary,
                                category=category,
                                session_id=str(session_id),
                                importance=min(0.9, 0.4 + success_rate * 0.5),
                            )
                            logger.debug("Stored episode: %s (category=%s)", episode_summary[:60], category)
                        except Exception as _ep_store_err:
                            logger.debug("Episode storage skipped: %s", _ep_store_err)
                # ── End Phase 3 episode storage ───────────────────────────

                return

            # Tool call — thinking text was mostly streamed live above;
            # flush any small remainder that was inside the look-ahead buffer.
            thinking_text = _strip_leaked_control_tokens(_extract_text_before_tool_call(content))
            if thinking_text and len(thinking_text) > emitted_up_to:
                leftover = thinking_text[emitted_up_to:].strip()
                if leftover:
                    yield SSEEvent("token", {"token": leftover, "done": False})

            tool_name = tool_call["tool"]
            tool_args = tool_call["arguments"]

            # Small models invent Markdown-only tools (generate_table, etc.)
            from .diagram_reply import (
                is_document_file_tool,
                is_markdown_only_tool,
                markdown_only_tool_nudge,
                research_table_document_nudge,
            )

            if is_markdown_only_tool(str(tool_name or "")):
                nudge = markdown_only_tool_nudge(str(tool_name))
                yield SSEEvent(
                    "log",
                    {
                        "level": "warn",
                        "message": f"Ignored hallucinated tool '{tool_name}' — answering in Markdown",
                        "timestamp": time.monotonic() - start_time,
                    },
                )
                conversation.append({"role": "assistant", "content": content})
                conversation.append({
                    "role": "user",
                    "content": f"[SYSTEM] {nudge}",
                })
                continue

            # Comparison tables are in-chat Markdown — never open PDF/DOCX/etc.
            if (_routed.reason or "") == "research_table" and is_document_file_tool(
                str(tool_name or "")
            ):
                nudge = research_table_document_nudge(str(tool_name))
                yield SSEEvent(
                    "log",
                    {
                        "level": "warn",
                        "message": (
                            f"Ignored {tool_name} on research_table — Markdown table only"
                        ),
                        "timestamp": time.monotonic() - start_time,
                    },
                )
                conversation.append({"role": "assistant", "content": content})
                conversation.append({"role": "user", "content": f"[SYSTEM] {nudge}"})
                continue

            # After first successful search on research_table: refuse more tools (latency)
            if (
                (_routed.reason or "") == "research_table"
                and research_table_search_count >= 1
                and str(tool_name or "").lower()
                in ("web_search", "fetch_url", "kb_search")
            ):
                yield SSEEvent(
                    "log",
                    {
                        "level": "info",
                        "message": (
                            f"Ignored extra {tool_name} on research_table — finalize Markdown answer"
                        ),
                        "timestamp": time.monotonic() - start_time,
                    },
                )
                conversation.append({"role": "assistant", "content": content})
                conversation.append(
                    {
                        "role": "user",
                        "content": (
                            "[SYSTEM] You already searched. Reply NOW with a complete "
                            "GitHub-flavored Markdown pipe table (every cell filled) plus "
                            "Quick takeaways. Do NOT call any more tools. "
                            "Do NOT use a ```mermaid fence. Do NOT call generate_pdf."
                        ),
                    }
                )
                continue

            if tool_name == "generate_image" and isinstance(tool_args, dict):
                from ..provider_secrets import apply_user_image_model_choice

                tool_args = apply_user_image_model_choice(
                    tool_args, str(_latest_user_msg or "")
                )

            # Stuck detection — same tool+args seen 3 times = break
            fingerprint = json.dumps({"t": tool_name, "a": tool_args}, sort_keys=True)
            seen_tool_calls.append(fingerprint)
            if seen_tool_calls.count(fingerprint) >= 3:
                logger.warning("Agent stuck in loop calling %s — breaking", tool_name)
                yield SSEEvent("token", {
                    "token": "\n\nI notice I'm repeating the same action. Let me provide my answer based on what I have so far.",
                    "done": True,
                })
                return

            # Normalize tool name (case-insensitive); prefer progressive subset
            tool = self._registry.get(tool_name) or self._registry.get(tool_name.lower())
            if tool and tool_name not in _allowed_tool_names and tool.name not in _allowed_tool_names:
                # Research tables: soft-nudge away from PDF/DOCX without scary toast
                if (_routed.reason or "") == "research_table" and is_document_file_tool(
                    str(tool_name or "")
                ):
                    nudge = research_table_document_nudge(str(tool_name))
                    yield SSEEvent(
                        "log",
                        {
                            "level": "warn",
                            "message": f"Ignored out-of-pack {tool_name} on research_table",
                            "timestamp": time.monotonic() - start_time,
                        },
                    )
                    conversation.append({"role": "assistant", "content": content})
                    conversation.append({"role": "user", "content": f"[SYSTEM] {nudge}"})
                    continue
                error_msg = (
                    f"Tool '{tool_name}' is outside the active tool set for this task. "
                    f"Available: {', '.join(sorted(_allowed_tool_names))}"
                )
                yield SSEEvent("tool_error", {"tool": tool_name, "error": error_msg})
                conversation.append({
                    "role": "user",
                    "content": f"[SYSTEM] Tool error: {error_msg}. Please use one of the available tools or respond directly.",
                })
                continue
            if not tool:
                from .diagram_reply import is_markdown_only_tool, markdown_only_tool_nudge

                if is_markdown_only_tool(str(tool_name or "")):
                    nudge = markdown_only_tool_nudge(str(tool_name))
                    yield SSEEvent(
                        "log",
                        {
                            "level": "warn",
                            "message": f"Ignored unknown Markdown-only tool '{tool_name}'",
                            "timestamp": time.monotonic() - start_time,
                        },
                    )
                    conversation.append({"role": "assistant", "content": content})
                    conversation.append({"role": "user", "content": f"[SYSTEM] {nudge}"})
                    continue
                error_msg = f"Tool '{tool_name}' not found. Available: {', '.join(sorted(_allowed_tool_names) or self._registry.tool_names)}"
                yield SSEEvent("tool_error", {"tool": tool_name, "error": error_msg})
                # Tell the model the tool doesn't exist
                conversation.append({"role": "assistant", "content": content})
                conversation.append({
                    "role": "user",
                    "content": f"[SYSTEM] Tool error: {error_msg}. If the user wanted a table/chart/diagram, reply with Markdown or ```mermaid — do not invent tools. Otherwise use an available tool or respond directly.",
                })
                continue

            # Emit planning event (shows step list on frontend)
            plan_steps = ["Analyze request", f"Select tool: {tool_name}", "Prepare arguments", "Execute", "Parse result"]
            yield SSEEvent("planning", {"tool": tool_name, "steps": plan_steps})

            # Determine affected resources for risk analysis
            affected_resources = []
            if tool_name in ("ssh_command", "vm_health_check", "deploy"):
                affected_resources = ["VM", "network"]
            elif tool_name in ("run_terminal_command", "list_host_path", "get_host_environment"):
                affected_resources = ["filesystem"]
            elif tool_name == "verify_ollama_models":
                affected_resources = ["local Ollama service", "network"]
            elif tool_name == "fetch_url":
                affected_resources = ["network", "external website"]
            elif tool_name.startswith("generate_"):
                affected_resources = ["filesystem"]

            # Check approval for high-risk tools
            if tool.risk_level in ("high", "critical") and not auto_approve:
                yield SSEEvent("risk_analysis", {
                    "tool": tool_name,
                    "risk_level": tool.risk_level,
                    "affected_resources": affected_resources,
                    "explanation": f"This {tool.risk_level}-risk operation will use {tool_name.replace('_', ' ')} on {', '.join(affected_resources) or 'the system'}.",
                })
                yield SSEEvent("approval_required", {
                    "tool": tool_name,
                    "arguments": tool_args,
                    "risk_level": tool.risk_level,
                    "explanation": f"Requesting permission to execute {tool_name.replace('_', ' ')}",
                    "affected_resources": affected_resources,
                })
                if session_key:
                    pending_actions.set(
                        session_key,
                        tool_name=tool_name,
                        arguments=tool_args if isinstance(tool_args, dict) else {},
                        risk_level=str(tool.risk_level),
                        summary=f"Execute {tool_name}",
                    )
                conversation.append({"role": "assistant", "content": content})
                conversation.append({
                    "role": "user",
                    "content": f"[SYSTEM] Tool '{tool_name}' requires user approval before execution. The user has been asked for approval.",
                })
                return  # Wait for re-submission with approval

            yield SSEEvent("tool_start", {"tool": tool_name, "arguments": tool_args})
            yield SSEEvent("log", {"level": "info", "message": f"Executing tool: {tool_name}", "timestamp": time.monotonic() - start_time})

            # Execute the tool
            try:
                result: ToolResult = await tool.execute(**tool_args)
                result_dict = result.to_dict()
            except Exception as e:
                logger.error("Tool %s failed: %s", tool_name, e)
                result_dict = {"success": False, "error": str(e)}

            yield SSEEvent("tool_output", {
                "tool": tool_name,
                "output": json.dumps(result_dict) if isinstance(result_dict, dict) else str(result_dict),
            })
            _success = result_dict.get("success", True) if isinstance(result_dict, dict) else True
            # Nested tool payload may set success:false while ToolResult.success is True
            if _success and isinstance(result_dict, dict):
                _out = result_dict.get("output")
                if isinstance(_out, dict) and _out.get("success") is False:
                    _success = False
                if result_dict.get("error"):
                    _success = False
            yield SSEEvent("log", {
                "level": "info" if _success else "error",
                "message": f"Tool {tool_name} {'completed' if _success else 'failed'}",
                "timestamp": time.monotonic() - start_time,
            })

            # User must pick an image model / add a key — stop the loop (UI shows clickable card)
            _needs_status = None
            if isinstance(result_dict, dict):
                _out = result_dict.get("output")
                if isinstance(_out, dict):
                    _needs_status = _out.get("status")
                elif isinstance(_out, str):
                    try:
                        _parsed = json.loads(_out)
                        if isinstance(_parsed, dict):
                            _needs_status = _parsed.get("status")
                    except (json.JSONDecodeError, TypeError):
                        pass
            if tool_name == "generate_image" and _needs_status in (
                "needs_model_choice",
                "needs_api_key",
            ):
                yield SSEEvent(
                    "token",
                    {
                        "token": (
                            "Choose an image model below to continue."
                            if _needs_status == "needs_model_choice"
                            else "Add an image API key in Settings to continue."
                        ),
                        "done": True,
                    },
                )
                return

            # Track for final report
            total_tools_run += 1
            execution_steps.append({
                "tool": tool_name,
                "success": _success,
                "duration_ms": int((time.monotonic() - start_time) * 1000),
            })
            if _success and isinstance(result_dict, dict):
                # Extract key findings — prefer response text, fall back to output
                output_data = result_dict.get("output", "")
                if isinstance(output_data, dict):
                    # Structured output — try to get a human-readable piece
                    finding_text = output_data.get("response") or output_data.get("summary") or output_data.get("message") or str(output_data)[:300]
                elif isinstance(output_data, str) and len(output_data) > 0:
                    # Try parsing as JSON to extract meaningful text
                    try:
                        parsed_out = json.loads(output_data)
                        if isinstance(parsed_out, dict):
                            finding_text = parsed_out.get("response") or parsed_out.get("summary") or parsed_out.get("message") or output_data[:300]
                        else:
                            finding_text = output_data[:300]
                    except (json.JSONDecodeError, TypeError):
                        finding_text = output_data[:300]
                else:
                    finding_text = None
                if finding_text and isinstance(finding_text, str) and len(finding_text.strip()) > 0:
                    tool_findings.append({"tool": tool_name, "summary": finding_text[:500]})
                    # Persist interesting tool findings to agent memory for cross-session recall
                    if self._memory and _success:
                        try:
                            mem_key = f"last_{tool_name}_result"
                            await self._memory.remember(
                                mem_key,
                                finding_text[:500],
                                category="tool_result",
                                importance=0.6,
                            )
                        except Exception as _mem_err:
                            logger.debug("Agent memory write skipped: %s", _mem_err)

            # Emit confidence event after each tool
            step_confidence = 90 if _success else 50
            yield SSEEvent("confidence", {
                "score": step_confidence,
                "tool": tool_name,
                "success": _success,
            })

            # Emit structured terminal_output for run_terminal_command
            if tool_name == "run_terminal_command":
                meta = result_dict.get("metadata") or {}
                terminal_payload = {
                    "command": meta.get("command") or tool_args.get("command", ""),
                    "exit_code": meta.get("exit_code", -1),
                    "stdout": meta.get("stdout", ""),
                    "stderr": meta.get("stderr", ""),
                    "truncated": meta.get("truncated", False),
                    "hostname": meta.get("hostname", "localhost"),
                    "duration_ms": meta.get("duration_ms", 0),
                }
                yield SSEEvent("terminal_output", terminal_payload)

            # Emit terminal_output for host diagnostic tools too
            elif tool_name in ("get_host_environment", "list_host_path", "verify_ollama_models"):
                import platform as _plat
                _output_str = ""
                _is_error = not result_dict.get("success", True) or result_dict.get("error")
                if result_dict.get("output"):
                    _output_str = result_dict["output"] if isinstance(result_dict["output"], str) else json.dumps(result_dict["output"], indent=2)
                terminal_payload = {
                    "command": tool_name.replace("_", " "),
                    "exit_code": 1 if _is_error else 0,
                    "stdout": _output_str if not _is_error else "",
                    "stderr": result_dict.get("error", "") if _is_error else "",
                    "truncated": False,
                    "hostname": _plat.node() or "localhost",
                    "duration_ms": 0,
                }
                yield SSEEvent("terminal_output", terminal_payload)

            # Emit terminal_output for SSH/VM tools
            elif tool_name in ("ssh_command", "vm_health_check"):
                _ssh_output = result_dict.get("output", "")
                _ssh_meta = result_dict.get("metadata") or {}
                _ssh_error = result_dict.get("error", "")
                _ssh_hostname = tool_args.get("host", "remote")
                # Try to get a better hostname from the VM context
                if "vm_id" in tool_args:
                    _ssh_hostname = f"vm-{tool_args['vm_id']}"
                terminal_payload = {
                    "command": tool_args.get("command", tool_name.replace("_", " ")),
                    "exit_code": _ssh_meta.get("return_code", 1 if _ssh_error else 0),
                    "stdout": _ssh_output if isinstance(_ssh_output, str) else json.dumps(_ssh_output, indent=2),
                    "stderr": _ssh_meta.get("stderr", _ssh_error),
                    "truncated": False,
                    "hostname": _ssh_hostname,
                    "duration_ms": _ssh_meta.get("duration_ms", 0),
                }
                yield SSEEvent("terminal_output", terminal_payload)

            last_tool_result_fallback = json.dumps(result_dict, indent=2)
            # Phase 2: accumulate tool output for self-evaluator context
            if _success and isinstance(result_dict, dict):
                _out = result_dict.get("output", "")
                if _out and isinstance(_out, str):
                    _tool_context_parts.append(f"[{tool_name}]: {_out[:600]}")
                    # Phase 3: feed tool result into working memory
                    _working_mem.add_tool_summary(tool_name, _out[:300], success=True)
            elif isinstance(result_dict, dict) and result_dict.get("error"):
                _working_mem.add_tool_summary(tool_name, result_dict["error"][:200], success=False)

            # Add assistant message + tool result to conversation
            conversation.append({"role": "assistant", "content": content})
            # Wrap tool output through guardrails before feeding back to model
            raw_tool_output = json.dumps(result_dict, indent=2)
            safe_tool_output = self._guardrails.wrap_tool_output(tool_name, raw_tool_output)
            if (_routed.reason or "") == "research_table" and tool_name in (
                "web_search",
                "fetch_url",
                "kb_search",
            ):
                if _success:
                    research_table_search_count += 1
                follow_up = (
                    f"[TOOL RESULT for {tool_name}]:\n{safe_tool_output}\n\n"
                    "[SYSTEM] You have enough research. Reply NOW like ChatGPT would:\n"
                    "1) A complete GitHub-flavored Markdown pipe table (every cell filled).\n"
                    "2) A short Quick takeaways section.\n"
                    "Do NOT call generate_pdf / generate_docx / generate_table / web_search / any other tool.\n"
                    "Do NOT wrap the table in a ```mermaid fence — plain Markdown pipes only.\n"
                    "Do NOT write 'No information available'."
                )
            else:
                follow_up = (
                    f"[TOOL RESULT for {tool_name}]:\n{safe_tool_output}\n\n"
                    "Now provide a helpful response to the user based on this result. "
                    "If you need to call another tool, do so. Otherwise, give your final answer."
                )
            conversation.append({"role": "user", "content": follow_up})

            # Continue loop — model sees tool result and decides what to do next

        yield SSEEvent("error", {"message": "Reached maximum iterations"})
