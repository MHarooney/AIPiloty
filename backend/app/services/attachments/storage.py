"""UUID-based attachment file storage with MIME validation."""

from __future__ import annotations

import base64
import logging
import mimetypes
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ...core.config import get_settings

logger = logging.getLogger(__name__)

# Allowed MIME types → category mapping
ALLOWED_TYPES: dict[str, str] = {
    # Images (sent as base64 to vision model)
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/webp": "image",
    # Documents (text extracted)
    "application/pdf": "document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
}

# Extension → MIME fallback
_EXT_MAP: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


@dataclass
class AttachmentMeta:
    """Metadata for a stored attachment."""

    id: str
    filename: str
    mime_type: str
    category: str  # "image" | "document"
    size_bytes: int
    path: str  # relative to upload_dir
    extracted_text: Optional[str] = None


class AttachmentStorage:
    """Manages file uploads: validate, store, retrieve."""

    def __init__(self, upload_dir: Optional[str] = None):
        settings = get_settings()
        base = Path(str(settings.resolved_workspace))
        self._dir = base / (upload_dir or settings.upload_dir)
        self._max_bytes = settings.upload_max_size_mb * 1024 * 1024
        self._dir.mkdir(parents=True, exist_ok=True)
        # In-memory index (keyed by attachment ID); a production system would use DB
        self._meta: dict[str, AttachmentMeta] = {}

    # ── Public API ────────────────────────────────────────────

    def validate_mime(self, filename: str, content_type: Optional[str]) -> str:
        """Return validated MIME type or raise ValueError."""
        ext = Path(filename).suffix.lower()
        mime = content_type or mimetypes.guess_type(filename)[0] or _EXT_MAP.get(ext)
        if not mime or mime not in ALLOWED_TYPES:
            raise ValueError(
                f"Unsupported file type '{mime or ext}'. "
                f"Allowed: images (png/jpg/gif/webp), documents (pdf/docx/xlsx/pptx)."
            )
        return mime

    async def save(self, filename: str, data: bytes, content_type: Optional[str] = None) -> AttachmentMeta:
        """Validate and persist an uploaded file. Returns metadata."""
        mime = self.validate_mime(filename, content_type)
        if len(data) > self._max_bytes:
            max_mb = self._max_bytes / (1024 * 1024)
            raise ValueError(f"File too large ({len(data)/(1024*1024):.1f} MB). Max: {max_mb:.0f} MB.")

        attachment_id = uuid.uuid4().hex
        ext = Path(filename).suffix.lower() or ""
        safe_name = f"{attachment_id}{ext}"
        dest = self._dir / safe_name

        dest.write_bytes(data)
        logger.info("Saved attachment %s (%s, %d bytes)", attachment_id, mime, len(data))

        meta = AttachmentMeta(
            id=attachment_id,
            filename=filename,
            mime_type=mime,
            category=ALLOWED_TYPES[mime],
            size_bytes=len(data),
            path=safe_name,
        )
        self._meta[attachment_id] = meta
        return meta

    def get(self, attachment_id: str) -> Optional[AttachmentMeta]:
        """Look up metadata by ID."""
        return self._meta.get(attachment_id)

    def get_path(self, attachment_id: str) -> Optional[Path]:
        """Return the absolute path for an attachment (if it exists)."""
        meta = self._meta.get(attachment_id)
        if not meta:
            return None
        p = self._dir / meta.path
        return p if p.is_file() else None

    def get_base64(self, attachment_id: str) -> Optional[str]:
        """Read an attachment and return its base64-encoded content."""
        p = self.get_path(attachment_id)
        if not p:
            return None
        return base64.b64encode(p.read_bytes()).decode("ascii")

    def resolve_many(self, attachment_ids: list[str]) -> list[AttachmentMeta]:
        """Resolve a list of IDs to metadata. Skips unknown IDs."""
        result = []
        for aid in attachment_ids:
            m = self._meta.get(aid)
            if m:
                result.append(m)
            else:
                logger.warning("Unknown attachment ID: %s", aid)
        return result
