"""DocStudioService — stream document generation grounded on notebook sources.

Workflow:
  1. Retrieve relevant chunks from the notebook's Qdrant namespace
  2. Build the template prompt with those chunks as context
  3. Stream tokens from OllamaService, accumulating the full markdown
  4. Persist the result as a NotebookArtifact (Markdown + optional DOCX/PDF)
  5. Yield SSE events: status → token → done
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, AsyncGenerator, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models.doc_studio import NotebookArtifact, NotebookSource
from ..llm.ollama_service import OllamaService
from ..rag.retriever import RetrieverService
from ..tools.documents.generator_service import DocumentGeneratorService
from .templates import get_template

logger = logging.getLogger(__name__)

_MAX_CONTEXT_CHARS = 12_000  # approx 3k tokens — keep well within context window


def _sse(type_: str, data: dict[str, Any]) -> str:
    return f"data: {json.dumps({'type': type_, 'data': data})}\n\n"


def _markdown_to_sections(content_md: str) -> list[dict[str, Any]]:
    """Convert flat Markdown into the [{heading, body}] list expected by DocumentGeneratorService."""
    sections: list[dict[str, Any]] = []
    current_heading = ""
    current_lines: list[str] = []

    for line in content_md.splitlines():
        if line.startswith("## "):
            if current_lines:
                sections.append({"heading": current_heading, "body": "\n".join(current_lines).strip(), "level": 1})
            current_heading = line[3:].strip()
            current_lines = []
        elif line.startswith("### "):
            if current_lines:
                sections.append({"heading": current_heading, "body": "\n".join(current_lines).strip(), "level": 2})
            current_heading = line[4:].strip()
            current_lines = []
        elif line.startswith("# "):
            # top-level heading — treat as section title without pushing previous
            pass
        else:
            current_lines.append(line)

    if current_lines:
        sections.append({"heading": current_heading, "body": "\n".join(current_lines).strip(), "level": 1})

    return sections or [{"heading": "", "body": content_md, "level": 1}]


class DocStudioService:
    """Stream AI-generated project documents grounded on notebook sources."""

    def __init__(
        self,
        retriever: RetrieverService,
        llm: OllamaService,
        doc_generator: DocumentGeneratorService,
    ) -> None:
        self._retriever = retriever
        self._llm = llm
        self._doc_generator = doc_generator

    async def run_studio_stream(
        self,
        notebook_id: str,
        template_id: str,
        extra_context: str,
        db: AsyncSession,
        *,
        model_override: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Generate a document and stream progress back as SSE strings."""
        template = get_template(template_id)

        # ── Phase 1: check enabled sources ───────────────────────────────────
        yield _sse("status", {"phase": "checking", "message": "Checking sources…"})

        enabled_stmt = (
            select(NotebookSource)
            .where(
                NotebookSource.notebook_id == notebook_id,
                NotebookSource.is_enabled.is_(True),
                NotebookSource.status == "ready",
            )
        )
        result = await db.execute(enabled_stmt)
        enabled_sources = result.scalars().all()

        if not enabled_sources:
            yield _sse("error", {"message": "No enabled, ready sources in this notebook. Add and index sources first."})
            return

        # ── Phase 2: retrieve context ─────────────────────────────────────────
        yield _sse("status", {"phase": "retrieving", "message": "Retrieving relevant context…"})

        query_text = f"{template.name} {' '.join(template.sections)}"
        chunks = await self._retriever.search(
            query=query_text,
            top_k=20,
            min_score=0.1,
            mode="hybrid",
            notebook_id=notebook_id,
        )

        context_parts: list[str] = []
        total_chars = 0
        for chunk in chunks:
            snippet = chunk.content.strip()
            if not snippet:
                continue
            total_chars += len(snippet)
            context_parts.append(snippet)
            if total_chars >= _MAX_CONTEXT_CHARS:
                break

        context_text = "\n\n---\n\n".join(context_parts) if context_parts else "(No context retrieved — answer based on general knowledge)"

        # ── Phase 3: build prompt + stream generation ─────────────────────────
        yield _sse("status", {"phase": "generating", "message": f"Generating {template.name}…"})

        sections_list = "\n".join(f"- {s}" for s in template.sections)
        prompt = template.system_prompt_template.format(
            sections_list=sections_list,
            context=context_text,
            extra_context=extra_context or "(none)",
        )

        messages: list[dict[str, Any]] = [
            {"role": "user", "content": prompt},
        ]

        accumulated = ""
        try:
            async for chunk_data in self._llm.chat_stream(messages, tools=None, model_override=model_override):
                token = chunk_data.get("message", {}).get("content", "")
                if token:
                    accumulated += token
                    yield _sse("token", {"content": token})
                if chunk_data.get("done"):
                    break
        except Exception as exc:
            logger.error("Studio generation failed for notebook %s: %s", notebook_id, exc)
            yield _sse("error", {"message": f"Generation failed: {exc}"})
            return

        if not accumulated.strip():
            yield _sse("error", {"message": "Model returned empty content."})
            return

        # ── Phase 4: persist artifact ──────────────────────────────────────────
        yield _sse("status", {"phase": "saving", "message": "Saving artifact…"})

        # Derive a title from the first H1/H2 heading in the output, or default
        first_heading = re.search(r"^#{1,2}\s+(.+)$", accumulated, re.MULTILINE)
        title = first_heading.group(1).strip() if first_heading else f"{template.name} — {notebook_id[:8]}"

        artifact = NotebookArtifact(
            id=str(uuid.uuid4()),
            notebook_id=notebook_id,
            template=template_id,
            title=title,
            content_md=accumulated,
        )

        # Generate DOCX eagerly (PDF is on-demand to avoid wkhtmltopdf dep)
        try:
            sections_payload = json.dumps(_markdown_to_sections(accumulated))
            docx_result = await self._doc_generator.generate_docx(
                title=title,
                sections=sections_payload,
                filename=f"ds_{artifact.id[:8]}_{template_id}.docx",
            )
            artifact.docx_path = docx_result.get("path", "")
        except Exception as exc:
            logger.warning("DOCX generation failed: %s", exc)

        db.add(artifact)
        await db.commit()
        await db.refresh(artifact)

        yield _sse("done", {
            "artifact_id": artifact.id,
            "title": artifact.title,
            "template": template_id,
            "has_docx": bool(artifact.docx_path),
        })
