"""Smoke-test ensure_missions tool (DB-only)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import async_session_factory
from app.services.tools.mission_seed import EnsureMissionsTool


async def main() -> None:
    tool = EnsureMissionsTool(db_session_factory=async_session_factory)
    listed = await tool.execute(list_only=True)
    if listed.error:
        print("LIST FAIL:", listed.error)
        sys.exit(1)
    print("--- list_only ---")
    print(listed.output)

    ensured = await tool.execute(query="lms-test", force_update=True)
    if ensured.error:
        print("ENSURE FAIL:", ensured.error)
        sys.exit(1)
    print("--- ensure lms-test ---")
    print(ensured.output)
    print("meta:", ensured.metadata)
    print("OK")


if __name__ == "__main__":
    asyncio.run(main())
