"""Database browser API — read-only introspection of AIPiloty's SQLite DB.

WARNING: This router exposes raw schema and row data. It is disabled in
production unless ``ENABLE_DB_BROWSER=true`` is explicitly set in the
environment.
"""

from __future__ import annotations

import os
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...core.config import get_settings

router = APIRouter(prefix="/database", tags=["Database"])

_TABLE_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_MAX_ROWS = 100


def _validate_table_name(name: str) -> str:
    if not _TABLE_NAME_RE.match(name):
        raise HTTPException(400, "Invalid table name")
    return name


def _require_db_browser_enabled() -> None:
    """Raise 403 if the DB browser is not explicitly enabled in production."""
    settings = get_settings()
    if settings.is_production and os.environ.get("ENABLE_DB_BROWSER", "").lower() != "true":
        raise HTTPException(
            403,
            "The database browser is disabled in production. "
            "Set ENABLE_DB_BROWSER=true to enable it (not recommended).",
        )


@router.get("/tables")
async def list_tables(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List all table names in the database."""
    _require_db_browser_enabled()
    def _inspect(conn):
        inspector = inspect(conn)
        return inspector.get_table_names()

    table_names = await db.run_sync(lambda sess: _inspect(sess.get_bind()))
    return {"tables": table_names}


@router.get("/tables/{name}/schema")
async def get_table_schema(
    name: str,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get column definitions for a table."""
    _require_db_browser_enabled()
    name = _validate_table_name(name)

    def _get_cols(conn):
        inspector = inspect(conn)
        tables = inspector.get_table_names()
        if name not in tables:
            return None
        columns = inspector.get_columns(name)
        pk = inspector.get_pk_constraint(name)
        return {"columns": columns, "pk": pk}

    result = await db.run_sync(lambda sess: _get_cols(sess.get_bind()))
    if result is None:
        raise HTTPException(404, "Table not found")

    columns = [
        {
            "name": c["name"],
            "type": str(c["type"]),
            "nullable": c.get("nullable", True),
            "default": str(c["default"]) if c.get("default") is not None else None,
        }
        for c in result["columns"]
    ]
    pk_cols = result["pk"].get("constrained_columns", []) if result["pk"] else []

    return {"table": name, "columns": columns, "primary_key": pk_cols}


@router.get("/tables/{name}")
async def get_table_rows(
    name: str,
    limit: int = Query(50, ge=1, le=_MAX_ROWS),
    offset: int = Query(0, ge=0),
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get paginated rows from a table (read-only)."""
    _require_db_browser_enabled()
    name = _validate_table_name(name)

    # Verify table exists
    def _check(conn):
        inspector = inspect(conn)
        return name in inspector.get_table_names()

    exists = await db.run_sync(lambda sess: _check(sess.get_bind()))
    if not exists:
        raise HTTPException(404, "Table not found")

    # Count
    count_result = await db.execute(text(f'SELECT COUNT(*) FROM "{name}"'))
    total = count_result.scalar() or 0

    # Fetch rows — table name is validated by regex, safe to interpolate
    result = await db.execute(
        text(f'SELECT * FROM "{name}" LIMIT :lim OFFSET :off'),
        {"lim": limit, "off": offset},
    )
    rows = [dict(row._mapping) for row in result.fetchall()]

    # Get column names
    col_result = await db.execute(text(f'SELECT * FROM "{name}" LIMIT 0'))
    columns = list(col_result.keys()) if col_result.keys() else []

    return {"table": name, "columns": columns, "rows": rows, "total": total, "limit": limit, "offset": offset}
