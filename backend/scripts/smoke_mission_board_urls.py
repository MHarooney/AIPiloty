#!/usr/bin/env python3
"""Smoke: Mission Board sync + URL discovery for all active VMs in local DB.

Never hardcodes public IPs or tenant hostnames — uses registered VM credentials only.
"""

from __future__ import annotations

import asyncio

from app.core.database import async_session_factory
from app.services.mission.ensure import (
    _discover_nginx_urls,
    _discover_on_vm,
    ensure_missions_for_query,
    list_seeded_missions,
)
from sqlalchemy import select

from app.models.vm import VMCredential


async def main() -> None:
    async with async_session_factory() as s:
        vms = (
            await s.execute(
                select(VMCredential).where(VMCredential.is_active == True)  # noqa: E712
            )
        ).scalars().all()
        print("active_vms", len(vms))
        for vm in vms:
            print("=== vm_id", vm.id)
            urls = await _discover_nginx_urls(vm)
            cons = await _discover_on_vm(vm)
            print("url_ports", len(urls), "containers", len(cons))

        result = await ensure_missions_for_query(
            s,
            "all deployments on mission board",
            seed_all=True,
            force_update=True,
        )
        print("MSG:", result.get("message"))
        print("URLS_FOUND:", result.get("urls_found"))
        after = await list_seeded_missions(s)
        with_url = sum(1 for m in after if m.get("public_url"))
        print("TOTAL", len(after), "WITH_URL", with_url)
        for m in after:
            # Print ids/names only — omit raw public URLs from default smoke output
            has_url = "yes" if m.get("public_url") else "no"
            print(
                f"{m.get('id'):3} | vm_id={(m.get('vm') or {}).get('id')} | "
                f"{(m.get('name') or '')[:42]:42} | url={has_url}"
            )


if __name__ == "__main__":
    asyncio.run(main())
