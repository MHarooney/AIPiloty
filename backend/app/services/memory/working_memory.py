"""Working Memory — structured in-context scratchpad for the AIPiloty agent.

The working memory is the agent's "short-term memory" for the current
conversation.  It aggregates:

  • ``objective``       — what the user ultimately wants (extracted from first msg)
  • ``key_facts``       — important facts discovered via tools so far
  • ``episodic_recalls`` — semantically relevant past episodes from EpisodicStore
  • ``tool_summaries``  — condensed outputs from the most impactful tool calls

The `format_for_prompt()` method serialises the working memory into a compact
system-prompt section, respecting a configurable token budget so it never
consumes too much of the LLM's context window.

Token estimation: 1 token ≈ 4 chars (GPT/Llama approximation).  We use
character counts for speed since exact tokenisation isn't available locally.

This is NOT persisted across conversations (that's EpisodicStore's job).
WorkingMemory is ephemeral — one instance per chat request.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────
_DEFAULT_TOKEN_BUDGET = 2048   # characters (≈512 tokens) reserved for WM in prompt
_CHARS_PER_TOKEN = 4           # conservative approximation


@dataclass
class FactSlot:
    """A key fact stored in working memory."""
    fact: str
    source: str    # "tool:<name>" | "kb" | "user" | "episodic"
    confidence: float = 1.0


@dataclass
class ToolSummary:
    """Condensed tool output stored in working memory."""
    tool_name: str
    summary: str   # truncated output (≤300 chars)
    success: bool = True


class WorkingMemory:
    """Ephemeral structured scratchpad for one agent conversation turn.

    Args:
        token_budget: Maximum characters to use in the formatted prompt section.
    """

    def __init__(self, token_budget: int = _DEFAULT_TOKEN_BUDGET) -> None:
        self._budget = token_budget
        self.objective: str = ""
        self.facts: List[FactSlot] = []
        self.tool_summaries: List[ToolSummary] = []
        self.episodic_recalls: List[str] = []   # pre-formatted strings from EpisodicStore

    # ── Write API ─────────────────────────────────────────────────────────

    def set_objective(self, text: str) -> None:
        """Set the high-level task objective from the user's first message."""
        self.objective = text[:200].strip()

    def add_fact(self, fact: str, source: str = "tool", confidence: float = 1.0) -> None:
        """Add a key fact discovered during the conversation."""
        if not fact.strip():
            return
        self.facts.append(FactSlot(fact=fact[:300].strip(), source=source, confidence=confidence))
        # Cap at 12 facts — evict lowest confidence first
        if len(self.facts) > 12:
            self.facts.sort(key=lambda f: f.confidence, reverse=True)
            self.facts = self.facts[:12]

    def add_tool_summary(self, tool_name: str, output: str, success: bool = True) -> None:
        """Summarise and store a tool result."""
        summary = output.strip()[:300]
        self.tool_summaries.append(ToolSummary(tool_name=tool_name, summary=summary, success=success))
        # Keep only last 6 tool summaries
        if len(self.tool_summaries) > 6:
            self.tool_summaries = self.tool_summaries[-6:]

    def add_episodic_recall(self, formatted: str) -> None:
        """Add a pre-formatted episodic memory string."""
        if formatted.strip():
            self.episodic_recalls.append(formatted.strip())

    # ── Read API ──────────────────────────────────────────────────────────

    def format_for_prompt(self) -> str:
        """Serialise working memory into a compact system-prompt section.

        Respects the token budget — sections are dropped (lowest priority first)
        if the total character count would exceed the budget:

        Priority order (highest → lowest):
          1. Episodic recalls (past learning)
          2. Objective
          3. Key facts
          4. Tool summaries (already in conversation history; lowest priority)
        """
        if not self._has_content():
            return ""

        sections: list[str] = []
        char_count = 0
        header = "═══ AGENT WORKING MEMORY ═══\n"
        char_count += len(header)

        # 1. Episodic recalls
        if self.episodic_recalls:
            block = "📚 Relevant past experiences:\n" + "\n".join(
                f"  {r}" for r in self.episodic_recalls[:4]
            )
            if char_count + len(block) <= self._budget:
                sections.append(block)
                char_count += len(block)

        # 2. Objective
        if self.objective:
            block = f"🎯 Current objective: {self.objective}"
            if char_count + len(block) <= self._budget:
                sections.append(block)
                char_count += len(block)

        # 3. Key facts
        if self.facts:
            high_conf = [f for f in self.facts if f.confidence >= 0.7]
            if high_conf:
                lines = "\n".join(f"  • [{f.source}] {f.fact}" for f in high_conf[:6])
                block = f"💡 Key facts discovered:\n{lines}"
                if char_count + len(block) <= self._budget:
                    sections.append(block)
                    char_count += len(block)

        # 4. Tool summaries (last 3 only)
        if self.tool_summaries:
            success_tools = [t for t in self.tool_summaries if t.success][-3:]
            if success_tools:
                lines = "\n".join(
                    f"  • {t.tool_name}: {t.summary[:150]}" for t in success_tools
                )
                block = f"🔧 Recent tool results:\n{lines}"
                if char_count + len(block) <= self._budget:
                    sections.append(block)

        if not sections:
            return ""

        return header + "\n".join(sections) + "\n═══ END WORKING MEMORY ═══"

    def _has_content(self) -> bool:
        return bool(
            self.objective
            or self.facts
            or self.tool_summaries
            or self.episodic_recalls
        )

    def to_episode_summary(self) -> str:
        """Compress working memory into a short episode summary for EpisodicStore.

        Called at the end of a conversation to create the episodic memory entry.
        """
        parts: list[str] = []
        if self.objective:
            parts.append(f"Task: {self.objective}")
        if self.facts:
            top_facts = [f.fact for f in sorted(self.facts, key=lambda x: x.confidence, reverse=True)[:3]]
            parts.append("Facts: " + "; ".join(top_facts))
        if self.tool_summaries:
            successful = [t for t in self.tool_summaries if t.success]
            if successful:
                tools_used = ", ".join(t.tool_name for t in successful[-3:])
                parts.append(f"Tools: {tools_used}")
        return " | ".join(parts)[:600] if parts else ""

    def infer_category(self) -> str:
        """Infer episode category from tool usage patterns."""
        tool_names = {t.tool_name for t in self.tool_summaries}
        if tool_names & {"ssh_command", "vm_health_check", "diagnose_vm"}:
            return "incident"
        if tool_names & {"generate_pdf", "generate_docx", "generate_pptx", "generate_xlsx"}:
            return "discovery"
        if tool_names & {"web_search", "fetch_url"}:
            return "discovery"
        if "fix" in self.objective.lower() or "error" in self.objective.lower():
            return "fix"
        return "conversation"

    @property
    def token_estimate(self) -> int:
        """Rough token count of the formatted prompt section."""
        return len(self.format_for_prompt()) // _CHARS_PER_TOKEN
