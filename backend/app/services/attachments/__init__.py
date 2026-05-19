"""Multimodal attachment services — storage, extraction, resolution."""

from .storage import AttachmentStorage, AttachmentMeta
from .extractors import extract_text

__all__ = ["AttachmentStorage", "AttachmentMeta", "extract_text"]
