"""Platform stats tool — aggregate statistics across all AIPiloty services."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select, func

from .base import BaseTool, Param, ToolResult


class GetPlatformStatsTool(BaseTool):
    """Collect aggregate platform statistics from the database and services."""

    name = "get_platform_stats"
    description = (
        "Get aggregated platform statistics: total VMs, deployments by status, "
        "chat sessions, knowledge documents, recent activity. Use when the user "
        "asks for a platform overview, dashboard summary, or status report."
    )
    parameters = [
        Param("include_details", "boolean", "Include per-item breakdowns", required=False, default=False),
    ]
    risk_level = "low"
    category = "observability"
    rate_limit_per_minute = 20

    def __init__(self, db_session_factory=None, scheduler=None):
        self._db_factory = db_session_factory
        self._scheduler = scheduler

    async def execute(self, **kw: Any) -> ToolResult:
        if not self._db_factory:
            return ToolResult(error="Database session factory not configured")

        include_details = kw.get("include_details", False)

        try:
            from ...models.vm import VMCredential
            from ...models.deployment import Deployment, DeploymentStatus
            from ...models.chat import ChatSession

            async with self._db_factory() as session:
                # VM stats
                vm_result = await session.execute(select(func.count(VMCredential.id)))
                total_vms = vm_result.scalar() or 0

                active_vms_result = await session.execute(
                    select(func.count(VMCredential.id)).where(VMCredential.is_active == True)
                )
                active_vms = active_vms_result.scalar() or 0

                # Deployment stats
                dep_result = await session.execute(select(func.count(Deployment.id)))
                total_deployments = dep_result.scalar() or 0

                status_counts = {}
                for status in DeploymentStatus:
                    cnt_result = await session.execute(
                        select(func.count(Deployment.id)).where(Deployment.status == status)
                    )
                    cnt = cnt_result.scalar() or 0
                    if cnt > 0:
                        status_counts[status.value] = cnt

                # Chat session stats
                chat_result = await session.execute(select(func.count(ChatSession.id)))
                total_sessions = chat_result.scalar() or 0

            lines = [
                "# Platform Statistics",
                "",
                f"**Virtual Machines:** {total_vms} total ({active_vms} active)",
                f"**Deployments:** {total_deployments} total",
            ]

            if status_counts:
                lines.append("  Status breakdown:")
                for status, count in status_counts.items():
                    lines.append(f"    • {status}: {count}")

            lines.append(f"**Chat Sessions:** {total_sessions}")

            if total_deployments == 0:
                lines.extend(
                    [
                        "",
                        "_No Missions in the database yet._ Call **ensure_missions** "
                        "with the tenant URL/name — it discovers via read-only "
                        "docker ps on a registered VM and saves to DB (nothing "
                        "static from git).",
                    ]
                )
            else:
                lines.extend(
                    [
                        "",
                        "_Tip:_ Catalog = database. If a tenant is missing, call "
                        "**ensure_missions** with URL/name to discover & save, "
                        "then Probe.",
                    ]
                )

            # Scheduler stats
            if self._scheduler:
                sched_status = self._scheduler.status()
                lines.append(f"**Scheduler Tasks:** {len(sched_status)}")
                if include_details:
                    for task in sched_status:
                        lines.append(
                            f"    • {task['name']}: {task['run_count']} runs, "
                            f"{task['error_count']} errors"
                        )

            return ToolResult(
                output="\n".join(lines),
                metadata={
                    "total_vms": total_vms,
                    "active_vms": active_vms,
                    "total_deployments": total_deployments,
                    "deployment_status": status_counts,
                    "total_sessions": total_sessions,
                },
            )
        except Exception as e:
            return ToolResult(error=f"Failed to collect platform stats: {e}")
