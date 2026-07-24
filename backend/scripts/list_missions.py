#!/usr/bin/env python3
"""List Missions from local DB (names/ids only — no URL dump by default)."""

from __future__ import annotations

import asyncio
import os

from app.core.database import async_session_factory
from app.services.mission.ensure import list_seeded_missions


async def main() -> None:
    show_urls = os.environ.get("SHOW_URLS") == "1"
    async with async_session_factory() as s:
        after = await list_seeded_missions(s)
        print("TOTAL", len(after), "WITH_URL", sum(1 for m in after if m.get("public_url")))
        for m in after:
            url = m.get("public_url") if show_urls else ("yes" if m.get("public_url") else "no")
            print(
                f"{m.get('id'):3} | vm_id={(m.get('vm') or {}).get('id')} | "
                f"{(m.get('name') or '')[:42]:42} | {url}"
            )


if __name__ == "__main__":
    asyncio.run(main())
