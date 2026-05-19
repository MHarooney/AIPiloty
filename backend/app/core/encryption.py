"""Fernet encryption service for sensitive credential storage."""

from __future__ import annotations

import logging
import os
from typing import Optional

from cryptography.fernet import Fernet

from .config import get_settings

logger = logging.getLogger(__name__)

_fernet_instance: Optional[Fernet] = None


def get_fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is not None:
        return _fernet_instance

    settings = get_settings()
    key = settings.encryption_key or os.getenv("ENCRYPTION_KEY")

    if not key:
        key = Fernet.generate_key().decode()
        os.environ["ENCRYPTION_KEY"] = key
        logger.warning(
            "No ENCRYPTION_KEY found — generated ephemeral key. "
            "Set ENCRYPTION_KEY in .env for production."
        )

    if isinstance(key, str):
        key = key.encode()

    _fernet_instance = Fernet(key)
    return _fernet_instance


def encrypt(value: str) -> str:
    if not value:
        return value
    return get_fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not value:
        return value
    return get_fernet().decrypt(value.encode()).decode()
