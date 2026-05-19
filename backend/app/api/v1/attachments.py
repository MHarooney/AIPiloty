"""Attachment upload API — multipart file upload with MIME validation."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from ...core.auth import require_auth
from ...core.config import get_settings
from ...main import app_state

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/attachments", tags=["Attachments"])


class AttachmentOut(BaseModel):
    id: str
    filename: str
    mime_type: str
    category: str
    size_bytes: int
    extracted_text: str | None = None


@router.post("/upload", response_model=AttachmentOut, dependencies=[Depends(require_auth)])
async def upload_attachment(file: UploadFile = File(...)):
    """Upload a file attachment (image or document).

    Returns attachment metadata including an `id` to reference in chat messages.
    For documents (PDF/DOCX/XLSX/PPTX), text is extracted automatically.
    For images, the file is stored for vision-model processing.
    """
    settings = get_settings()
    if not settings.attachments_enabled:
        raise HTTPException(503, "Attachments feature is disabled.")

    storage = app_state.get("attachment_storage")
    if not storage:
        raise HTTPException(503, "Attachment storage not initialized.")

    # Read file content (with size guard)
    max_bytes = settings.upload_max_size_mb * 1024 * 1024
    data = await file.read()
    if len(data) > max_bytes:
        raise HTTPException(
            413,
            f"File too large ({len(data) / (1024 * 1024):.1f} MB). Max: {settings.upload_max_size_mb} MB.",
        )

    # Validate MIME type
    try:
        storage.validate_mime(file.filename or "unknown", file.content_type)
    except ValueError as e:
        raise HTTPException(415, str(e))

    # Save
    try:
        meta = await storage.save(file.filename or "unknown", data, file.content_type)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Extract text for documents
    if meta.category == "document":
        from ...services.attachments.extractors import extract_text

        file_path = storage.get_path(meta.id)
        if file_path:
            extracted = await extract_text(file_path, meta.mime_type)
            if extracted:
                meta.extracted_text = extracted
                logger.info(
                    "Extracted %d chars from %s (%s)",
                    len(extracted),
                    meta.filename,
                    meta.mime_type,
                )

    return AttachmentOut(
        id=meta.id,
        filename=meta.filename,
        mime_type=meta.mime_type,
        category=meta.category,
        size_bytes=meta.size_bytes,
        extracted_text=meta.extracted_text,
    )
