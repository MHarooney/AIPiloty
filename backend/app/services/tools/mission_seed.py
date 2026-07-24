"""Agent tool: ensure Missions are seeded in AIPiloty DB when the user asks."""

from __future__ import annotations

from typing import Any

from .base import BaseTool, Param, ToolResult


class EnsureMissionsTool(BaseTool):
    """Idempotently register known Missions so Flight Deck / chat can scope to them.

    Never SSHes to mutate containers — DB metadata only.
    """

    name = "ensure_missions"
    description = (
        "Register Missions on the Mission Board (AIPiloty DB). Use when the user "
        "says ensure/seed/register missions, put deployments on the mission board, "
        "or 'everything' / 'all of them' after a docker/VM listing. "
        "Flow: docker ps on a registered VM (read-only) → save Mission rows. "
        "Pass seed_all=true or discover_all=true (or query containing "
        "'all deployments' / 'mission board' / 'everything') to create one Mission "
        "card per running container. Does NOT restart or deploy. "
        "Pass list_only=true to list DB Missions only."
    )
    parameters = [
        Param(
            "query",
            "string",
            "What to seed/match, or phrases like 'all on mission board' / 'everything'",
            required=False,
            default="lms-test",
        ),
        Param(
            "seed_all",
            "boolean",
            "If true, register every running container on the VM as a Mission (inspect_only)",
            required=False,
            default=False,
        ),
        Param(
            "discover_all",
            "boolean",
            "Alias of seed_all — docker ps → Mission Board for all containers",
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
            "Refresh fields on already-seeded Missions from discovery",
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

        query = kw.get("query") or "lms-test"
        seed_all = bool(kw.get("seed_all", False))
        discover_all = bool(kw.get("discover_all", False))
        list_only = bool(kw.get("list_only", False))
        force_update = bool(kw.get("force_update", True))

        # Short follow-ups after a docker/VM listing
        q_norm = str(query).strip().lower()
        if q_norm in {
            "everything",
            "all",
            "all of them",
            "all of it",
            "them all",
            "yes all",
            "all deployments",
        }:
            discover_all = True
            query = "all deployments on mission board"

        try:
            from ..mission.catalog import catalog_summary
            from ..mission.ensure import ensure_missions_for_query, list_seeded_missions

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
                            "or a URL/name to discover from a registered VM._"
                        )
                    for m in current:
                        lines.append(
                            f"- **{m.get('name')}** (id={m.get('id')}) · "
                            f"{m.get('pipeline_profile')} · "
                            f"{m.get('public_url') or 'no url'}"
                        )
                    lines.extend(
                        [
                            "",
                            f"_Catalog = database ({len(cat)} row(s)). "
                            "No static tenant list in git._",
                        ]
                    )
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
                    query,
                    seed_all=seed_all,
                    discover_all=discover_all,
                    force_update=force_update,
                )
                after = await list_seeded_missions(session)

            lines = [
                "# Ensure Missions",
                "",
                result["message"],
                "",
                f"**Matched / discovered:** {', '.join(result['matched'][:30]) or 'none'}"
                + ("…" if len(result.get("matched") or []) > 30 else ""),
                f"**Missions now on Mission Board:** {len(after)}",
            ]
            for m in after[:40]:
                lines.append(
                    f"- {m.get('name')} (id={m.get('id')}) · "
                    f"profile={m.get('pipeline_profile')} · "
                    f"vm={((m.get('vm') or {}).get('host_ip'))}"
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
                    **{k: result[k] for k in ("matched", "message", "safe", "vm_mutated") if k in result},
                    "seeded_count": len(result.get("seeded") or []),
                    "skipped_count": len(result.get("skipped") or []),
                    "missions": after,
                },
            )
        except Exception as e:
            return ToolResult(error=f"Failed to ensure missions: {e}")
