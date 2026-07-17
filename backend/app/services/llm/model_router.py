"""Model Router — route queries to fast or smart LLM based on complexity.

Eliminates the false choice of "always use the big model" vs "always use
the small model" by detecting query complexity at runtime.

Routing signals (heuristic, no ML needed):
  • Word count > 50             → smart model
  • Complex vocabulary detected → smart model
  • Code generation requested   → coder model (if configured)
  • Simple factual / lookup     → fast model

The router reads from settings so models are configurable without code changes.
It never blocks the request — if the smart model is unavailable it falls back
to the default model gracefully.

For M2 Mac 24 GB:
  fast model:  qwen2.5:7b-q4 or deepseek-coder-v2:16b (if that's what's set)
  smart model: same or a more capable variant configured via OLLAMA_SMART_MODEL
  coder model: configured via OLLAMA_CODER_MODEL (optional)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

from ...core.config import get_settings

logger = logging.getLogger(__name__)

# ── Complexity detection patterns ─────────────────────────────────────────

# Signals that strongly indicate a complex, multi-step reasoning request
_COMPLEX_RE = re.compile(
    r"\b("
    r"plan|design|architect|strategy|roadmap|migration|compare|analyse|analyze|"
    r"explain why|reason|because|cause|impact|trade.?off|pros?.? and cons?|"
    r"best practice|optimis|optimiz|refactor|redesign|evaluate|assessment|"
    r"comprehensive|step.?by.?step|walk me through|in.?depth"
    r")\b",
    re.IGNORECASE,
)

# Code generation / review signals
_CODE_RE = re.compile(
    r"\b("
    r"write (a |the )?code|implement|generate (a |the )?function|"
    r"create (a |the )?(class|module|api|endpoint|component)|"
    r"fix (this |the )?bug|debug|refactor|review (this |the )?code|"
    r"unit test|pytest|typescript interface|sql query"
    r")\b",
    re.IGNORECASE,
)

# Fast/simple lookups that don't need a big model
_FAST_RE = re.compile(
    r"^("
    r"what is|what are|what's|who is|where is|when did|how many|which|"
    r"list (all |the )?"
    r").{0,80}$",
    re.IGNORECASE,
)


@dataclass
class RoutingDecision:
    """Result of model routing."""
    model: str
    reason: str
    complexity: str    # "fast" | "medium" | "complex" | "code"


class ModelRouter:
    """Route queries to the appropriate LLM based on complexity.

    All model names are read from settings so the operator can change them
    without modifying code.
    """

    def route(self, query: str, force: Optional[str] = None) -> RoutingDecision:
        """Select the appropriate model for a given query.

        Args:
            query: The user's message.
            force: Override routing (e.g. "smart", "fast", "coder").

        Returns:
            RoutingDecision with model name and reason.
        """
        settings = get_settings()
        default_model = settings.ollama_model
        smart_model = settings.ollama_smart_model or default_model
        coder_model = settings.ollama_coder_model or default_model

        # Manual override
        if force == "smart":
            return RoutingDecision(model=smart_model, reason="forced", complexity="complex")
        if force == "fast":
            return RoutingDecision(model=default_model, reason="forced", complexity="fast")
        if force == "coder":
            return RoutingDecision(model=coder_model, reason="forced", complexity="code")

        # Heuristic routing
        q = query.strip()
        word_count = len(q.split())

        # Code generation → coder model
        if coder_model != default_model and _CODE_RE.search(q):
            logger.info("ModelRouter: code query → coder model (%s)", coder_model)
            return RoutingDecision(
                model=coder_model,
                reason="code generation detected",
                complexity="code",
            )

        # Complex reasoning → smart model
        if smart_model != default_model and (
            word_count > 50 or _COMPLEX_RE.search(q)
        ):
            logger.info("ModelRouter: complex query → smart model (%s)", smart_model)
            return RoutingDecision(
                model=smart_model,
                reason="complex vocabulary or length > 50 words",
                complexity="complex",
            )

        # Simple lookup → fast model
        if word_count <= 15 and _FAST_RE.match(q):
            logger.debug("ModelRouter: simple lookup → default model (%s)", default_model)
            return RoutingDecision(
                model=default_model,
                reason="simple factual query",
                complexity="fast",
            )

        # Default: medium complexity → default model
        return RoutingDecision(
            model=default_model,
            reason="medium complexity",
            complexity="medium",
        )

    def route_model_name(self, query: str, force: Optional[str] = None) -> str:
        """Convenience method returning just the model name string."""
        return self.route(query, force=force).model
