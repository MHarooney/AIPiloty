"""Document generation tools — PDF, XLSX, DOCX, PPTX, Image."""

from __future__ import annotations

import json
import re
from typing import Any, List

from ..base import BaseTool, Param, ToolResult
from .generator_service import DocumentGeneratorService


class GeneratePDF(BaseTool):
    name = "generate_pdf"
    description = (
        "Generate a professional PDF file when the user explicitly wants a downloadable PDF (report, course, handout). "
        "Not for answering 'which model should I use?' or other advice-only questions — reply in chat instead. "
        "Sections: heading, body, bullets, code, diagram, table as needed."
    )
    parameters = [
        Param("title", "string", "Document title"),
        Param(
            "sections",
            "string",
            'JSON array of objects: {"heading","body","bullets"?:[],"code"?:str,"diagram"?:str,"table"?:[][]}',
            required=False,
        ),
        Param("content", "string", "Plain text/markdown content (used if sections omitted)", required=False),
        Param("filename", "string", "Output filename (auto from title if omitted)", required=False),
    ]
    risk_level = "medium"
    category = "generation"
    rate_limit_per_minute = 10

    def __init__(self, svc: DocumentGeneratorService):
        self._svc = svc

    async def execute(self, **kw: Any) -> ToolResult:
        try:
            kw = _build_sections(kw)
            r = await self._svc.generate_pdf(**kw)
            return ToolResult(output=r)
        except Exception as e:
            return ToolResult(error=f"PDF generation failed: {e}")


class GenerateXLSX(BaseTool):
    name = "generate_xlsx"
    description = "Generate an Excel spreadsheet (.xlsx)."
    parameters = [
        Param("title", "string", "Workbook title"),
        Param("sheets", "string", 'JSON array of {"name": ..., "headers": [...], "rows": [[...]]}', required=False),
        Param("content", "string", "Plain text content for a simple sheet", required=False),
        Param("filename", "string", "Output filename", required=False),
    ]
    risk_level = "medium"
    category = "generation"
    rate_limit_per_minute = 10

    def __init__(self, svc: DocumentGeneratorService):
        self._svc = svc

    async def execute(self, **kw: Any) -> ToolResult:
        try:
            if not kw.get("sheets") and kw.get("content"):
                content = kw.pop("content")
                lines = [ln.strip() for ln in content.split("\n") if ln.strip()]
                kw["sheets"] = json.dumps([{"name": "Sheet1", "headers": ["Content"], "rows": [[l] for l in lines]}])
            elif not kw.get("sheets"):
                kw["sheets"] = json.dumps([{"name": "Sheet1", "headers": ["Data"], "rows": []}])
            kw.pop("content", None)
            r = await self._svc.generate_xlsx(**kw)
            return ToolResult(output=r)
        except Exception as e:
            return ToolResult(error=f"Excel generation failed: {e}")


class GenerateDOCX(BaseTool):
    name = "generate_docx"
    description = "Generate a Word document (.docx)."
    parameters = [
        Param("title", "string", "Document title"),
        Param("sections", "string", 'JSON array of {"heading": ..., "body": ...}', required=False),
        Param("content", "string", "Plain text/markdown content", required=False),
        Param("filename", "string", "Output filename", required=False),
    ]
    risk_level = "medium"
    category = "generation"
    rate_limit_per_minute = 10

    def __init__(self, svc: DocumentGeneratorService):
        self._svc = svc

    async def execute(self, **kw: Any) -> ToolResult:
        try:
            kw = _build_sections(kw)
            r = await self._svc.generate_docx(**kw)
            return ToolResult(output=r)
        except Exception as e:
            return ToolResult(error=f"Word generation failed: {e}")


class GeneratePPTX(BaseTool):
    name = "generate_pptx"
    description = "Generate a PowerPoint presentation (.pptx)."
    parameters = [
        Param("title", "string", "Presentation title"),
        Param("slides", "string", 'JSON array of {"title": ..., "content": ...}', required=False),
        Param("content", "string", "Plain text content (auto-split into slides)", required=False),
        Param("filename", "string", "Output filename", required=False),
    ]
    risk_level = "medium"
    category = "generation"
    rate_limit_per_minute = 10

    def __init__(self, svc: DocumentGeneratorService):
        self._svc = svc

    async def execute(self, **kw: Any) -> ToolResult:
        try:
            if not kw.get("slides") and kw.get("content"):
                content = kw.pop("content")
                heading_re = re.compile(r"^#\s+(.+)$", re.MULTILINE)
                parts = heading_re.split(content)
                slides: list[dict] = []
                if len(parts) >= 3:
                    for i in range(1, len(parts), 2):
                        slides.append({"title": parts[i].strip(), "content": parts[i + 1].strip() if i + 1 < len(parts) else ""})
                else:
                    slides = [{"title": kw.get("title", "Slide"), "content": content}]
                kw["slides"] = json.dumps(slides)
            elif not kw.get("slides"):
                kw["slides"] = json.dumps([{"title": kw.get("title", "Slide"), "content": ""}])
            kw.pop("content", None)
            r = await self._svc.generate_pptx(**kw)
            return ToolResult(output=r)
        except Exception as e:
            return ToolResult(error=f"PowerPoint generation failed: {e}")


class GenerateImage(BaseTool):
    name = "generate_image"
    description = (
        "Generate an image from a detailed text prompt (course covers, UI mockups, illustrations). "
        "Call WITHOUT model first unless the user already named one. "
        "If the tool returns status=needs_model_choice, reply with ONE short line only "
        "(e.g. 'Choose an image model below.') — do NOT list models in chat text; the UI shows "
        "clickable options. Never invent API keys."
    )
    parameters = [
        Param("prompt", "string", "Detailed description of the image to generate"),
        Param(
            "model",
            "string",
            "Image model id or alias: dall-e-3, gpt-image-1, gemini-2.5-flash-image, "
            "gemini-3.1-flash-image, nano-banana",
            required=False,
        ),
        Param(
            "provider",
            "string",
            "Optional provider shortcut: openai | gemini",
            required=False,
        ),
        Param("negative_prompt", "string", "What to avoid in the image", required=False),
        Param("width", "integer", "Image width in pixels (default 1024)", required=False),
        Param("height", "integer", "Image height in pixels (default 1024)", required=False),
        Param("steps", "integer", "Number of generation steps for local models (default 20)", required=False),
        Param("filename", "string", "Output filename", required=False),
    ]
    risk_level = "medium"
    category = "image"
    rate_limit_per_minute = 5

    def __init__(self, svc: DocumentGeneratorService):
        self._svc = svc

    async def execute(self, **kw: Any) -> ToolResult:
        try:
            from ....main import app_state

            image_service = app_state.get("image_service")
            if image_service:
                result = await image_service.generate(
                    prompt=kw.get("prompt", ""),
                    negative_prompt=kw.get("negative_prompt", ""),
                    width=int(kw.get("width", 1024)),
                    height=int(kw.get("height", 1024)),
                    steps=int(kw.get("steps", 20)),
                    model=kw.get("model"),
                    provider=kw.get("provider"),
                )
                if result.needs_input:
                    return ToolResult(
                        output={
                            **result.needs_input,
                            "hint": (
                                "The UI shows clickable model buttons. Reply with one short line only "
                                "(e.g. 'Choose an image model below.') — do not list ids in chat."
                            ),
                        }
                    )
                if result.success:
                    return ToolResult(
                        output={
                            "success": True,
                            "relative_path": result.relative_path,
                            "seed": result.seed,
                            "model": result.model,
                            "provider": result.provider,
                            "generation_time_ms": result.generation_time_ms,
                            "download_url": (
                                "/api/v1/files/generated/"
                                + result.relative_path.replace("\\", "/").removeprefix("generated/")
                            ),
                        }
                    )
                return ToolResult(error=result.error)

            r = await self._svc.generate_image(**kw)
            if r.get("success"):
                return ToolResult(output=r)
            return ToolResult(error=r.get("error", "Image generation failed"))
        except Exception as e:
            return ToolResult(error=f"Image generation failed: {e}")


def _build_sections(kw: dict) -> dict:
    """Convert content param to sections JSON if sections not provided."""
    if not kw.get("sections") and kw.get("content"):
        content = kw.pop("content")
        sections: List[dict] = []
        heading_re = re.compile(r"^#{1,3}\s+(.+)$", re.MULTILINE)
        parts = heading_re.split(content)
        if len(parts) >= 3:
            if parts[0].strip():
                sections.append({"heading": kw.get("title", "Document"), "body": parts[0].strip()})
            for i in range(1, len(parts), 2):
                heading = parts[i].strip()
                body = parts[i + 1].strip() if i + 1 < len(parts) else ""
                if heading:
                    sections.append({"heading": heading, "body": body})
        else:
            paragraphs = [p.strip() for p in content.split("\n") if p.strip()]
            sections = [{"heading": kw.get("title", "Document"), "body": "\n".join(paragraphs)}]
        kw["sections"] = json.dumps(sections)
    elif not kw.get("sections"):
        kw["sections"] = json.dumps([{"heading": kw.get("title", "Document"), "body": ""}])
    kw.pop("content", None)
    return kw
