#!/usr/bin/env python3
"""Debug nginx→URL discovery using VMs already stored in the local DB.

Never hardcodes hosts — reads active VM credentials from AIPiloty DB only.
"""

from __future__ import annotations

import asyncio

from app.core.database import async_session_factory
from app.services.mission.ensure import _discover_nginx_urls, _resolve_vm, _ssh_readonly
from app.services.mission.url_discovery import parse_nginx_port_to_urls
from sqlalchemy import select

from app.models.vm import VMCredential


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                select(VMCredential).where(VMCredential.is_active == True)  # noqa: E712
            )
        ).scalars().all()
        if not rows:
            print("No active VMs in DB — add one on the VMs page first.")
            return
        for vm in rows:
            host = vm.host_ip
            print("=== vm_id", vm.id, "host", host)
            raw = await _ssh_readonly(
                host,
                vm.ssh_username or "root",
                "bash -lc 'cat /etc/nginx/sites-enabled/* /etc/nginx/conf.d/* 2>/dev/null; true'",
                vm.ssh_port or 22,
            )
            text = raw.get("stdout") or ""
            print("ok", raw["ok"], "len", len(text))
            urls = parse_nginx_port_to_urls(text)
            print("parsed", len(urls), "port→url mappings")
            # Do not print full public hostnames in CI logs by default
            print("sample ports", sorted(urls.keys())[:12])
            live = await _discover_nginx_urls(vm)
            print("discover_nginx_urls ports", sorted(live.keys())[:12])


if __name__ == "__main__":
    asyncio.run(main())
