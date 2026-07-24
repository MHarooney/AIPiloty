"""Smoke-test get_platform_stats after import fix."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import async_session_factory
from app.services.tools.platform_stats import GetPlatformStatsTool


async def main() -> None:
    tool = GetPlatformStatsTool(db_session_factory=async_session_factory)
    result = await tool.execute()
    if result.error:
        print("FAIL:", result.error)
        sys.exit(1)
    print("OK")
    print(result.output)
    print("metadata:", result.metadata)


if __name__ == "__main__":
    asyncio.run(main())
