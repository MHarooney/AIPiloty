"""Text extraction from uploaded attachments."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


async def extract_text(file_path: Path, mime_type: str) -> Optional[str]:
    """Dispatch to the appropriate extractor based on MIME type. Returns extracted text or None."""
    try:
        if mime_type == "application/pdf":
            from .pdf import extract as _pdf
            return _pdf(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            from .docx import extract as _docx
            return _docx(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            from .xlsx import extract as _xlsx
            return _xlsx(file_path)
        elif mime_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            from .pptx import extract as _pptx
            return _pptx(file_path)
        elif mime_type.startswith("image/"):
            return None  # Images go to vision model, no text extraction
        else:
            logger.warning("No extractor for MIME type: %s", mime_type)
            return None
    except Exception as e:
        logger.error("Extraction failed for %s (%s): %s", file_path.name, mime_type, e)
        return None
