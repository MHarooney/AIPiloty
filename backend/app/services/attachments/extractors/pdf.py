"""PDF text extraction using pypdf."""

from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader


def extract(file_path: Path) -> str:
    """Extract all text from a PDF file."""
    reader = PdfReader(str(file_path))
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if text.strip():
            pages.append(f"[Page {i + 1}]\n{text.strip()}")
    return "\n\n".join(pages)
