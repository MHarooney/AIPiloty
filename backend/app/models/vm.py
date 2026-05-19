"""VM credential model with encrypted fields."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.orm import relationship

from ..core.database import Base
from ..core.encryption import decrypt, encrypt


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class VMCredential(Base):
    __tablename__ = "vm_credentials"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False)
    provider = Column(String(64), nullable=False)
    host_ip = Column(String(255), nullable=False)
    hostname = Column(String(255))
    region = Column(String(255))
    ssh_username = Column(String(255), nullable=False)
    ssh_password = Column(String(1024))  # encrypted
    ssh_private_key = Column(String(4096))  # encrypted
    ssh_port = Column(Integer, default=22)
    is_active = Column(Boolean, default=True)
    ssh_host_key_fingerprint = Column(String(512), nullable=True)
    vm_metadata_encrypted = Column(String(2048), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    last_used = Column(DateTime, nullable=True)

    deployments = relationship("Deployment", back_populates="vm_credential")

    # --- Encryption helpers ---

    @property
    def decrypted_password(self) -> Optional[str]:
        return decrypt(self.ssh_password) if self.ssh_password else None

    @decrypted_password.setter
    def decrypted_password(self, value: str) -> None:
        self.ssh_password = encrypt(value) if value else None

    @property
    def decrypted_private_key(self) -> Optional[str]:
        return decrypt(self.ssh_private_key) if self.ssh_private_key else None

    @decrypted_private_key.setter
    def decrypted_private_key(self, value: str) -> None:
        self.ssh_private_key = encrypt(value) if value else None

    @property
    def vm_metadata(self) -> dict:
        if not self.vm_metadata_encrypted:
            return {}
        return json.loads(decrypt(self.vm_metadata_encrypted))

    @vm_metadata.setter
    def vm_metadata(self, value: dict) -> None:
        self.vm_metadata_encrypted = encrypt(json.dumps(value)) if value else None

    def to_dict(self, include_sensitive: bool = False) -> dict:
        d = {
            "id": self.id,
            "name": self.name,
            "provider": self.provider,
            "host_ip": self.host_ip,
            "hostname": self.hostname,
            "region": self.region,
            "ssh_username": self.ssh_username,
            "ssh_port": self.ssh_port,
            "is_active": self.is_active,
            "ssh_host_key_fingerprint": self.ssh_host_key_fingerprint,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_used": self.last_used.isoformat() if self.last_used else None,
        }
        if include_sensitive:
            d["ssh_password"] = self.decrypted_password
            d["ssh_private_key"] = self.decrypted_private_key
        return d
