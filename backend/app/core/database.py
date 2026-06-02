"""Async SQLAlchemy engine and session factory."""

from __future__ import annotations

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    pass


_settings = get_settings()

# SQLite uses StaticPool (not a real connection pool) so pool_* args are not
# applicable.  For PostgreSQL, use sensible defaults to prevent connection
# exhaustion under concurrent load.
_is_sqlite = "sqlite" in _settings.database_url
_engine_kwargs: dict = {
    "echo": _settings.debug,
    "future": True,
}
if not _is_sqlite:
    _engine_kwargs.update(
        {
            "pool_size": 10,           # keep 10 connections warm
            "max_overflow": 20,        # allow 20 extra burst connections
            "pool_timeout": 30,        # wait max 30 s for a free connection
            "pool_recycle": 1800,      # recycle stale connections every 30 min
            "pool_pre_ping": True,     # evict dead connections proactively
        }
    )

engine = create_async_engine(_settings.database_url, **_engine_kwargs)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _connection_record):
    """Enable WAL journal mode and foreign keys for every new SQLite connection.

    WAL (Write-Ahead Logging) allows concurrent reads during writes, which
    significantly reduces "database is locked" errors under concurrent load.
    This listener is a no-op for non-SQLite databases.
    """
    if "sqlite" not in _settings.database_url:
        return
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")  # safe with WAL, faster than FULL
    cursor.close()

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    # Import all models so Base.metadata knows about them
    from ..models import chat, vm, image, audit_log, testing, doc_studio  # noqa: F401
    from ..models import deployment, webhook  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # SQLite: add new columns if DB existed before model changes
    if "sqlite" in str(_settings.database_url):

        def _ensure_chat_columns(sync_conn):
            from sqlalchemy import text

            r = sync_conn.execute(text("PRAGMA table_info(chat_messages)"))
            cols = [row[1] for row in r.fetchall()]
            if "final_report_json" not in cols:
                sync_conn.execute(text("ALTER TABLE chat_messages ADD COLUMN final_report_json TEXT"))
            if "attachments_json" not in cols:
                sync_conn.execute(text("ALTER TABLE chat_messages ADD COLUMN attachments_json TEXT"))

        def _ensure_deployment_columns(sync_conn):
            from sqlalchemy import text

            r = sync_conn.execute(text("PRAGMA table_info(deployments)"))
            existing = {row[1] for row in r.fetchall()}
            new_cols = [
                ("docker_image",          "VARCHAR(512)"),
                ("dockerhub_image",       "VARCHAR(512)"),
                ("dockerhub_tag",         "VARCHAR(256)"),
                ("container_name",        "VARCHAR(256)"),
                ("port_mapping",          "VARCHAR(64)"),
                ("build_platform",        "VARCHAR(64)"),
                ("dockerfile",            "VARCHAR(256)"),
                ("docker_network",        "VARCHAR(256)"),
                ("docker_run_extra_args", "VARCHAR(512)"),
                ("trigger_type",          "VARCHAR(20)"),
                ("cron_expression",       "VARCHAR(64)"),
                ("webhook_secret",        "VARCHAR(64)"),
            ]
            for col_name, col_type in new_cols:
                if col_name not in existing:
                    sync_conn.execute(text(f"ALTER TABLE deployments ADD COLUMN {col_name} {col_type}"))

        async with engine.begin() as conn:
            await conn.run_sync(_ensure_chat_columns)
            await conn.run_sync(_ensure_deployment_columns)
