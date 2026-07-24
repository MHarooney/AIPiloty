"""Agent tool: ensure Missions are seeded in AIPiloty DB when the user asks."""

from __future__ import annotations

from typing import Any

from .base import BaseTool, Param, ToolResult


class EnsureMissionsTool(BaseTool):
    """Idempotently register Missions so Flight Deck / chat can scope to them.

    Never SSHes to mutate containers — DB metadata + read-only discovery only.
    """

    name = "ensure_missions"
    description = (
        "Register Missions on the Mission Board (AIPiloty DB). Call this when the "
        "user says ensure/seed/register/add deployments or put them on the mission "
        "board — including follow-ups like 'add it', 'everything', 'all of them' "
        "after a VM health check. Pass host= the VM IP from conversation when known. "
        "Pass seed_all=true to sync containers (+ nginx public URLs) from that VM, "
        "or from all registered VMs if host omitted. "
        "Does NOT restart or deploy. Pass list_only=true to list DB Missions only."
    )
    parameters = [
        Param(
            "query",
            "string",
            "User ask text; may include a host IP or 'all deployments on mission board'",
            required=False,
            default="all deployments on mission board",
        ),
        Param(
            "host",
            "string",
            "Optional VM IP to sync (from conversation / registered VMs). Prefer after a health check on that host.",
            required=False,
        ),
        Param(
            "seed_all",
            "boolean",
            "If true, register stacks/containers from the target VM(s) (inspect_only)",
            required=False,
            default=True,
        ),
        Param(
            "discover_all",
            "boolean",
            "Alias of seed_all",
            required=False,
            default=False,
        ),
        Param(
            "list_only",
            "boolean",
            "If true, only list currently seeded Missions — no writes",
            required=False,
            default=False,
        ),
        Param(
            "force_update",
            "boolean",
            "Refresh fields (including discovered public URLs) on existing Missions",
            required=False,
            default=True,
        ),
    ]
    risk_level = "low"
    category = "devops"
    rate_limit_per_minute = 20

    def __init__(self, db_session_factory=None):
        self._db_factory = db_session_factory

    async def execute(self, **kw: Any) -> ToolResult:
        if not self._db_factory:
            return ToolResult(error="Database session factory not configured")

        query = kw.get("query") or "all deployments on mission board"
        host = (kw.get("host") or "").strip() or None
        seed_all = bool(kw.get("seed_all", True))
        discover_all = bool(kw.get("discover_all", False))
        list_only = bool(kw.get("list_only", False))
        force_update = bool(kw.get("force_update", True))

        q_norm = str(query).strip().lower()
        if q_norm in {
            "everything",
            "all",
            "all of them",
            "all of it",
            "them all",
            "yes all",
            "all deployments",
            "ensure_missions",
            "add it",
            "add them",
        }:
            discover_all = True
            seed_all = True
            if q_norm in {"ensure_missions", "add it", "add them"}:
                query = "add deployments to mission board"
            else:
                query = "all deployments on mission board"

        try:
            from ..mission.catalog import catalog_summary
            from ..mission.ensure import (
                ensure_missions_for_query,
                extract_host_hint,
                list_seeded_missions,
            )

            if not host:
                host = extract_host_hint(str(query))

            async with self._db_factory() as session:
                current = await list_seeded_missions(session)
                if list_only:
                    cat = await catalog_summary(session)
                    lines = [
                        "# Missions in AIPiloty DB (Mission Board source of truth)",
                        "",
                    ]
                    if not current:
                        lines.append(
                            "_None yet — call ensure_missions with seed_all=true "
                            "or a host IP to discover from a registered VM._"
                        )
                    for m in current:
                        lines.append(
                            f"- **{m.get('name')}** (id={m.get('id')}) · "
                            f"{m.get('pipeline_profile')} · "
                            f"{m.get('public_url') or 'no url'}"
                        )
                    lines.append("")
                    lines.append(f"_Catalog = database ({len(cat)} row(s))._")
                    return ToolResult(
                        output="\n".join(lines),
                        metadata={
                            "seeded_count": len(current),
                            "missions": current,
                            "catalog": cat,
                            "vm_mutated": False,
                        },
                    )

                result = await ensure_missions_for_query(
                    session,
                    query if not host else f"{query} {host}",
                    seed_all=seed_all,
                    discover_all=discover_all,
                    force_update=force_update,
                    host_hint=host,
                )
                after = await list_seeded_missions(session)

            lines = [
                "# Ensure Missions",
                "",
                result["message"],
                "",
                f"**Matched / discovered:** {', '.join(result['matched'][:30]) or 'none'}"
                + ("…" if len(result.get('matched') or []) > 30 else ""),
                f"**Missions now on Mission Board:** {len(after)}",
                f"**With public URL:** {sum(1 for m in after if m.get('public_url'))}",
            ]
            for m in after[:40]:
                url = m.get("public_url") or "no url"
                lines.append(
                    f"- {m.get('name')} (id={m.get('id')}) · "
                    f"vm={((m.get('vm') or {}).get('host_ip'))} · {url}"
                )
            if len(after) > 40:
                lines.append(f"- … and {len(after) - 40} more")
            lines.append("")
            lines.append(
                "Open Mission Board / Flight Deck to see the cards. "
                "No containers were changed (inspect_only + DB writes only)."
            )
            return ToolResult(
                output="\n".join(lines),
                metadata={
                    **{
                        k: result[k]
                        for k in ("matched", "message", "safe", "vm_mutated", "urls_found")
                        if k in result
                    },
                    "seeded_count": len(result.get("seeded") or []),
                    "skipped_count": len(result.get("skipped") or []),
                    "missions": after,
                },
            )
        except Exception as e:
            return ToolResult(error=f"Failed to ensure missions: {e}")
