"""Application configuration via pydantic-settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    app_name: str = "AIPiloty"
    app_env: str = "development"
    debug: bool = True

    # Database
    database_url: str = "sqlite+aiosqlite:///./aipiloty.db"

    # Auth
    api_key: str = "aipiloty-dev-key-change-in-production"
    jwt_secret: str = "change-this-to-a-random-secret-min-32-chars"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    # Ollama
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "deepseek-coder-v2:16b"
    # 8192 was the previous default — dangerously small for multi-turn agent
    # loops with tool results.  32768 fits a full ReAct session comfortably.
    # Do not set below 4096 or the agent will silently truncate context.
    ollama_context_length: int = 32768
    ollama_temperature: float = 0.3
    # Cap the number of tokens the model generates per call.  Ollama default is
    # -1 (unlimited), which lets a verbose model produce 8 KB+ responses and
    # dramatically inflate per-iteration latency.  4096 is generous for a
    # single agent thought/tool-call turn while keeping responses fast.
    ollama_num_predict: int = 4096

    # Encryption
    encryption_key: Optional[str] = None

    # Image Generation
    image_gen_api_url: Optional[str] = None
    image_provider: str = ""  # "sdxl_turbo" for local SDXL Turbo, "" for auto
    sdxl_model_id: str = "stabilityai/sdxl-turbo"

    # Workspace
    workspace_root: Optional[str] = None

    # Knowledge base bridge (DeployPilot)
    deploypilot_kb_url: Optional[str] = None
    deploypilot_kb_api_key: Optional[str] = None

    # Native RAG (Qdrant + Ollama embeddings)
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: Optional[str] = None
    qdrant_collection: str = "aipiloty_kb"
    embedding_model: str = "nomic-embed-text"
    kb_allowed_roots: str = ""
    kb_chunk_size: int = 512
    kb_chunk_overlap: int = 64

    # CORS
    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    # HTTP fetch tool (set false only in dev if system SSL certs are broken)
    fetch_url_verify_ssl: bool = True

    # Container sandbox for terminal commands
    sandbox_enabled: bool = False
    sandbox_image: str = "aipiloty-sandbox:latest"
    sandbox_memory_limit: str = "512m"
    sandbox_cpu_limit: float = 1.0
    sandbox_network_disabled: bool = True
    sandbox_timeout: int = 60

    # Attachments (multimodal)
    attachments_enabled: bool = True
    upload_dir: str = "uploads"
    upload_max_size_mb: int = 25
    vision_model: str = "gemma4:e4b"

    @field_validator("ollama_context_length")
    @classmethod
    def _validate_context_length(cls, v: int) -> int:
        if v < 4096:
            raise ValueError(
                f"ollama_context_length must be at least 4096 (got {v}). "
                "Values below 4096 cause silent context truncation in multi-turn agent loops."
            )
        return v

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def resolved_workspace(self) -> Path:
        if self.workspace_root:
            return Path(self.workspace_root).resolve()
        return Path(__file__).resolve().parent.parent.parent

    def validate_production_settings(self) -> None:
        """Raise RuntimeError if insecure defaults are present in production.

        Call this during application startup so misconfigured deployments
        fail immediately instead of silently running with known-public
        credentials.
        """
        if not self.is_production:
            return

        _INSECURE_SECRETS = {
            "jwt_secret": (
                self.jwt_secret,
                {"change-this-to-a-random-secret-min-32-chars"},
            ),
            "api_key": (
                self.api_key,
                {"aipiloty-dev-key-change-in-production", "aipiloty-dev-key"},
            ),
        }
        errors: list[str] = []
        for field, (value, bad_values) in _INSECURE_SECRETS.items():
            if not value or value in bad_values:
                errors.append(
                    f"  '{field}' is set to an insecure default value."
                    f" Set a strong secret via environment variable before deploying."
                )
        # encryption_key is used to protect credential secrets stored in the DB.
        # Without it, sensitive SSH passwords are stored unencrypted at rest.
        if not self.encryption_key:
            errors.append(
                "  'encryption_key' is not set. SSH credentials and other secrets "
                "stored in the database will not be encrypted at rest. "
                "Generate a Fernet key with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            )
        if errors:
            raise RuntimeError(
                "AIPiloty refused to start in production with insecure configuration:\n"
                + "\n".join(errors)
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
