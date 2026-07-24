"""Phase B message router — classify before answering.

Professional pattern (2026): hardcode *routes*, not giant reply tables.

Routes:
  SMALLTALK     — exact greetings only → optional static reply
  GENERAL_QA    — questions / acknowledgements → LLM, no tools
  AGENT_TASK    — DevOps / tools work → ReAct agent (curated tools)
  CONFIRMATION  — yes/no after a pending high-risk action
  CLARIFY       — vague / low-confidence → one clarifying question

UI modes (Ask / Agent / Auto) bias the classifier; they do not replace it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Literal, Optional

from .intent_classifier import Intent, IntentClassifier
from .pending_actions import pending_actions
from .diagram_reply import (
    MERMAID_STRUCTURAL_RE,
    RESEARCH_TABLE_RE,
    try_synthesize_mermaid_reply,
)

ChatMode = Literal["ask", "agent", "auto"]

# Categories that imply tool use when the classifier matched them.
_AGENT_CATEGORIES = frozenset({
    "vm",
    "deployment",
    "devops",
    "code",
    "document",
    "image",
    "planning",
    "stats",
    "knowledge",
    "search",
})

# Exact greetings only — NOT yes/no/ok (those need conversation context).
_GREETINGS: dict[str, str] = {
    "hello": "Hello! How can I help you today?",
    "hi": "Hi there! What can I do for you?",
    "hey": "Hey! What can I help you with?",
    "hiya": "Hiya! Ready to help — what do you need?",
    "howdy": "Howdy! What can I do for you?",
    "yo": "Hey! What's up? How can I help?",
    "sup": "Not much! What can I help you with?",
    "greetings": "Greetings! How can I assist you today?",
    "good morning": "Good morning! How can I help you today?",
    "good afternoon": "Good afternoon! What can I do for you?",
    "good evening": "Good evening! How can I help?",
    "good night": "Good night! Let me know if you need anything.",
    "thanks": "You're welcome! Let me know if there's anything else I can help with.",
    "thank you": "You're welcome! Feel free to ask if you need anything else.",
    "thx": "You're welcome!",
    "ty": "You're welcome!",
    "bye": "Goodbye! Feel free to come back anytime.",
    "goodbye": "Goodbye! Have a great day!",
    "see you": "See you! Come back anytime.",
    "what's up": "Not much! What can I help you with?",
    "whats up": "Not much! What can I help you with?",
}

# Short acknowledgements — may bind to pending action or reach LLM.
_ACKNOWLEDGEMENTS = frozenset({
    "ok", "okay", "k", "cool", "great", "nice", "awesome",
    "got it", "understood", "sounds good", "sure", "alright",
    "fine", "yep", "yes", "no", "later", "y", "n", "nope",
    "go", "do it", "proceed", "confirm", "approved", "cancel", "stop",
})

_AFFIRM = frozenset({
    "yes", "y", "yep", "sure", "ok", "okay", "k", "go", "do it",
    "proceed", "confirm", "approved", "sounds good", "alright",
})

_DENY = frozenset({
    "no", "n", "nope", "cancel", "stop", "don't", "dont", "never",
})

# Too vague to act — ask one clarifying question.
_VAGUE = frozenset({
    "do it", "fix", "help", "please", "go", "continue", "proceed",
    "something", "anything", "whatever", "idk", "huh", "?",
})

_TASK_VERBS = re.compile(
    r"\b(list|run|check|deploy|generate|create|show|get|find|ssh|"
    r"install|restart|build|write|execute|diagnose|monitor|search|"
    r"fetch|browse|open|delete|remove|update|patch|test)\b",
    re.I,
)

# Conceptual / explanatory questions should stay GENERAL_QA even if a domain
# keyword (deploy, ssh, docker) appears in the sentence.
_CONCEPTUAL_RE = re.compile(
    r"\b(what is|what are|what's|whats|who is|who are|explain|how does|how do|"
    r"conceptually|in general|meaning of|difference between|why is|why do)\b",
    re.I,
)
_MUTATE_TASK_RE = re.compile(
    r"\b(deploy now|ssh into|run |execute |generate a|create a file|write a file|"
    r"apply patch|delete |remove |restart |install )\b",
    re.I,
)

_CLARIFY_REPLY = (
    "I want to help — could you give a bit more detail? "
    "For example: what should I check, deploy, generate, or look up?"
)


def _is_conceptual_qa(message: str) -> bool:
    if not _CONCEPTUAL_RE.search(message or ""):
        return False
    return not bool(_MUTATE_TASK_RE.search(message or ""))


class MessageRoute(str, Enum):
    SMALLTALK = "smalltalk"
    GENERAL_QA = "general_qa"
    AGENT_TASK = "agent_task"
    CONFIRMATION = "confirmation"
    CLARIFY = "clarify"


@dataclass(frozen=True)
class RoutedMessage:
    route: MessageRoute
    normalized: str
    intent: Optional[Intent] = None
    static_reply: Optional[str] = None
    reason: str = ""
    confirmation: Optional[str] = None  # "affirm" | "deny" | None
    mode: str = "auto"


def normalize_user_message(message: str) -> str:
    """Lowercase + strip common trailing punctuation for exact greeting match."""
    return (message or "").strip().lower().rstrip("!?.,")


def route_message(
    message: str,
    *,
    classifier: Optional[IntentClassifier] = None,
    mode: ChatMode | str = "auto",
    session_key: Optional[str] = None,
    has_pending_action: bool | None = None,
) -> RoutedMessage:
    """Decide route for a user turn, optionally biased by UI chat mode."""
    normalized = normalize_user_message(message)
    chat_mode: str = (mode or "auto").lower()
    # plan/debug are UI modes (Cursor-like); both may use tools like agent
    if chat_mode in ("plan", "debug"):
        pass
    elif chat_mode not in ("ask", "agent", "auto"):
        chat_mode = "auto"

    pending = (
        has_pending_action
        if has_pending_action is not None
        else pending_actions.has(session_key)
    )

    # ── 1. Exact greetings (always) ──────────────────────────────────
    if normalized in _GREETINGS:
        return RoutedMessage(
            route=MessageRoute.SMALLTALK,
            normalized=normalized,
            static_reply=_GREETINGS[normalized],
            reason="exact_greeting",
            mode=chat_mode,
        )

    # ── 2. Pending confirmation binds yes/no ─────────────────────────
    if pending and (
        normalized in _AFFIRM
        or normalized in _DENY
        or normalized in _ACKNOWLEDGEMENTS
    ):
        if normalized in _DENY:
            return RoutedMessage(
                route=MessageRoute.CONFIRMATION,
                normalized=normalized,
                reason="pending_deny",
                confirmation="deny",
                mode=chat_mode,
                static_reply="Cancelled — I won't run that action.",
            )
        if normalized in _AFFIRM or normalized in {"sure", "sounds good", "alright", "fine"}:
            return RoutedMessage(
                route=MessageRoute.CONFIRMATION,
                normalized=normalized,
                reason="pending_affirm",
                confirmation="affirm",
                mode=chat_mode,
            )
        # Other acks with pending still go to LLM with context
        return RoutedMessage(
            route=MessageRoute.GENERAL_QA,
            normalized=normalized,
            reason="acknowledgement_with_pending",
            mode=chat_mode,
        )

    # ── 3. Ask mode → never tools (except greetings already handled) ─
    if chat_mode == "ask":
        # Ask mode cannot web_search — still answer as Markdown (no static KB)
        mermaid = bool(MERMAID_STRUCTURAL_RE.search(message or ""))
        table = bool(RESEARCH_TABLE_RE.search(message or ""))
        return RoutedMessage(
            route=MessageRoute.GENERAL_QA,
            normalized=normalized,
            intent=_classify(message, classifier),
            static_reply=try_synthesize_mermaid_reply(message or "") if mermaid else None,
            reason=(
                "mode_ask_diagram"
                if mermaid
                else ("mode_ask_table" if table else "mode_ask")
            ),
            mode=chat_mode,
        )

    # ── 3a. Plan mode → agent tools, but prefer planning (create_plan) ─
    if chat_mode == "plan":
        return RoutedMessage(
            route=MessageRoute.AGENT_TASK,
            normalized=normalized,
            intent=_classify(message, classifier),
            reason="mode_plan",
            mode="plan",
        )

    # ── 3b. Debug mode → agent tools focused on diagnosis ─
    if chat_mode == "debug":
        return RoutedMessage(
            route=MessageRoute.AGENT_TASK,
            normalized=normalized,
            intent=_classify(message, classifier),
            reason="mode_debug",
            mode="debug",
        )

    # ── 3b. Mermaid diagrams (user-provided structure/numbers) → no tools ─
    # Prefer Mermaid over research unless the user explicitly asked for a table.
    _wants_table = bool(
        re.search(r"\b(markdown\s+)?table\b", message or "", re.I)
    )
    if MERMAID_STRUCTURAL_RE.search(message or "") and not _wants_table:
        return RoutedMessage(
            route=MessageRoute.GENERAL_QA,
            normalized=normalized,
            intent=_classify(message, classifier),
            static_reply=try_synthesize_mermaid_reply(message or ""),
            reason="structured_diagram",
            mode=chat_mode,
        )

    # ── 3c. Research / comparison → AGENT + web_search (live info, never static KB) ─
    if RESEARCH_TABLE_RE.search(message or ""):
        intent = _classify(message, classifier)
        intent = Intent(
            category="search",
            confidence=max(intent.confidence, 0.85),
            suggested_tools=["web_search", "fetch_url", "kb_search"],
            context_hints={**(intent.context_hints or {}), "rich_visual": "research_table"},
        )
        return RoutedMessage(
            route=MessageRoute.AGENT_TASK,
            normalized=normalized,
            intent=intent,
            reason="research_table",
            mode=chat_mode,
        )

    clf = classifier or IntentClassifier()
    intent = clf.classify(message or "")

    # ── 4. Vague short prompts → clarify (agent/auto) ────────────────
    if normalized in _VAGUE or (len(normalized.split()) <= 2 and normalized in _ACKNOWLEDGEMENTS):
        # bare yes/no without pending → GENERAL_QA (conversation context)
        if normalized in _ACKNOWLEDGEMENTS and normalized not in _VAGUE:
            return RoutedMessage(
                route=MessageRoute.GENERAL_QA,
                normalized=normalized,
                intent=intent,
                reason="acknowledgement",
                mode=chat_mode,
            )
        if normalized in _VAGUE:
            return RoutedMessage(
                route=MessageRoute.CLARIFY,
                normalized=normalized,
                intent=intent,
                static_reply=_CLARIFY_REPLY,
                reason="vague_prompt",
                mode=chat_mode,
            )

    # ── 5. Acknowledgements without pending → GENERAL_QA ─────────────
    if normalized in _ACKNOWLEDGEMENTS:
        return RoutedMessage(
            route=MessageRoute.GENERAL_QA,
            normalized=normalized,
            intent=intent,
            reason="acknowledgement",
            mode=chat_mode,
        )

    # ── 6. Agent / Auto task detection ───────────────────────────────
    has_tools = bool(
        intent.category in _AGENT_CATEGORIES
        and intent.suggested_tools
        and intent.confidence >= 0.2
    )
    looks_like_task = bool(_TASK_VERBS.search(message or ""))
    conceptual = _is_conceptual_qa(message or "")

    # Phase C: lexical semantic refine for borderline cases
    from .semantic_router import lexical_match

    def _maybe_semantic(default: RoutedMessage) -> RoutedMessage:
        # Only refine when keyword path is ambiguous / low confidence
        if default.route in (MessageRoute.SMALLTALK, MessageRoute.CONFIRMATION, MessageRoute.CLARIFY):
            return default
        if intent.confidence >= 0.45 and not conceptual:
            return default
        hit = lexical_match(message or "")
        if hit.score < 0.35:
            return default
        label = hit.label
        if label == "clarify" and default.route != MessageRoute.CLARIFY:
            return RoutedMessage(
                route=MessageRoute.CLARIFY,
                normalized=normalized,
                intent=intent,
                static_reply=_CLARIFY_REPLY,
                reason=f"semantic_clarify:{hit.method}:{hit.score}",
                mode=chat_mode,
            )
        if label == "general_qa" and default.route == MessageRoute.AGENT_TASK and conceptual:
            return RoutedMessage(
                route=MessageRoute.GENERAL_QA,
                normalized=normalized,
                intent=intent,
                reason=f"semantic_qa:{hit.method}:{hit.score}",
                mode=chat_mode,
            )
        if label == "agent_task" and default.route == MessageRoute.GENERAL_QA and looks_like_task:
            return RoutedMessage(
                route=MessageRoute.AGENT_TASK,
                normalized=normalized,
                intent=intent,
                reason=f"semantic_agent:{hit.method}:{hit.score}",
                mode=chat_mode,
            )
        return default

    if chat_mode == "agent":
        if conceptual and not looks_like_task:
            return _maybe_semantic(
                RoutedMessage(
                    route=MessageRoute.GENERAL_QA,
                    normalized=normalized,
                    intent=intent,
                    reason="mode_agent_conceptual",
                    mode=chat_mode,
                )
            )
        if has_tools or looks_like_task:
            return _maybe_semantic(
                RoutedMessage(
                    route=MessageRoute.AGENT_TASK,
                    normalized=normalized,
                    intent=intent,
                    reason=f"mode_agent:{intent.category}:{intent.confidence}",
                    mode=chat_mode,
                )
            )
        # Ambiguous imperative-ish short prompts → clarify once (not questions)
        is_question = ("?" in (message or "")) or bool(
            re.match(r"^(who|what|why|how|when|where|which|are|is|can|do|does)\b", normalized)
        )
        if (
            intent.category == "general"
            and len((message or "").split()) <= 4
            and not is_question
        ):
            return RoutedMessage(
                route=MessageRoute.CLARIFY,
                normalized=normalized,
                intent=intent,
                static_reply=_CLARIFY_REPLY,
                reason="mode_agent_ambiguous",
                mode=chat_mode,
            )
        return _maybe_semantic(
            RoutedMessage(
                route=MessageRoute.GENERAL_QA,
                normalized=normalized,
                intent=intent,
                reason="mode_agent_qa",
                mode=chat_mode,
            )
        )

    # auto mode — conceptual domain questions → QA (not tools)
    if conceptual and has_tools:
        return _maybe_semantic(
            RoutedMessage(
                route=MessageRoute.GENERAL_QA,
                normalized=normalized,
                intent=intent,
                reason=f"conceptual_override:{intent.category}",
                mode=chat_mode,
            )
        )

    if has_tools:
        return _maybe_semantic(
            RoutedMessage(
                route=MessageRoute.AGENT_TASK,
                normalized=normalized,
                intent=intent,
                reason=f"intent:{intent.category}:{intent.confidence}",
                mode=chat_mode,
            )
        )

    # Low-confidence domain keyword with no tools → clarify
    if (
        intent.category in _AGENT_CATEGORIES
        and intent.confidence < 0.2
        and looks_like_task
    ):
        return RoutedMessage(
            route=MessageRoute.CLARIFY,
            normalized=normalized,
            intent=intent,
            static_reply=_CLARIFY_REPLY,
            reason="low_confidence_task",
            mode=chat_mode,
        )

    # Fail open to answering (QUERY), not agent — Scapia/production default
    return _maybe_semantic(
        RoutedMessage(
            route=MessageRoute.GENERAL_QA,
            normalized=normalized,
            intent=intent,
            reason="default_general_qa",
            mode=chat_mode,
        )
    )


def _classify(message: str, classifier: Optional[IntentClassifier]) -> Intent:
    return (classifier or IntentClassifier()).classify(message or "")


_CHAT_SYSTEM_PROMPT = """You are AIPiloty — a friendly AI DevOps and document assistant.
Answer clearly and helpfully in plain language.
Do NOT call tools, emit JSON tool blocks, or invent tool results.
If the user says yes/no/ok with little context, give a short acknowledgement and ask what they want next — do NOT invent a deployment or unrelated plan.
If they ask to put deployments / containers / "everything" on the **Mission Board**, explain that Ask mode cannot write Missions — they should switch to **Agent** (or Auto) and say: "put all deployments on the mission board" (that runs ensure_missions). Do NOT pretend you don't know what Mission Board is.
If you need tools to complete a task, briefly say what you would need to do and ask them to switch to Agent mode or rephrase as a concrete task.
"""


def chat_system_prompt(*, diagram: bool = False, table: bool = False) -> str:
    from .diagram_reply import DIAGRAM_CHAT_ADDENDUM, RESEARCH_TABLE_ADDENDUM

    prompt = _CHAT_SYSTEM_PROMPT
    if diagram:
        prompt += "\n" + DIAGRAM_CHAT_ADDENDUM
    if table:
        prompt += (
            "\n"
            + RESEARCH_TABLE_ADDENDUM
            + "\n(Ask mode: you cannot call tools. Use best-known current facts, "
            "be honest about uncertainty, and still produce a full Markdown table "
            "with every item/column the user named. Suggest Auto/Agent mode for live web research.)\n"
        )
    return prompt
