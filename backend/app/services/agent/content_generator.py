"""ContentGenerator — uses LLM to produce rich document content before tool execution."""

from __future__ import annotations

import logging
from typing import Optional

from ..llm.ollama_service import OllamaService

logger = logging.getLogger(__name__)

_CONTENT_SYSTEM_PROMPT = """You are a professional content writer. Generate well-structured, detailed content for documents.
Output ONLY the content — no meta-commentary, no "here is the content", no preamble.
Use markdown headings (## for main sections, ### for subsections).
Each section should have 2-4 paragraphs of substantive content.
Minimum 5 sections for any document."""


class ContentGenerator:
    """Generate rich document content via LLM before calling document tools."""

    def __init__(self, llm: OllamaService):
        self._llm = llm

    async def generate_content(self, topic: str, format_type: str = "pdf") -> str:
        format_hints = {
            "pdf": "Use ## headings for sections. Include detailed body text under each heading.",
            "docx": "Use ## headings for sections. Include paragraphs and bullet points.",
            "pptx": "Use # headings for slide titles. Keep content concise per slide (3-5 bullet points).",
            "xlsx": "Structure as headers and data rows. Use | for column separation.",
        }
        hint = format_hints.get(format_type, format_hints["pdf"])

        prompt = f"""Generate comprehensive, professional content about: {topic}

Format requirements: {hint}

Generate at least 5 well-developed sections with detailed, informative content."""

        content = await self._llm.generate(prompt, system=_CONTENT_SYSTEM_PROMPT)
        return content.strip()
