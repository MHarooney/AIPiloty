"""Plan creation tool — structured task decomposition for complex requests."""

from __future__ import annotations

import json
from typing import Any

from ..base import BaseTool, Param, ToolResult


class CreatePlanTool(BaseTool):
    """Create a structured execution plan with steps, dependencies, and risk levels."""

    name = "create_plan"
    description = (
        "Create a structured execution plan for complex multi-step tasks. "
        "Returns a plan with ordered steps, estimated effort, risk level, and "
        "dependencies. Use when the user asks for deployment plans, migration "
        "strategies, setup guides, or any multi-step workflow."
    )
    parameters = [
        Param("goal", "string", "High-level goal or objective"),
        Param("context", "string", "Current environment/situation context", required=False),
        Param("steps", "string",
              "JSON array of step objects: [{\"title\":\"...\",\"description\":\"...\",\"risk\":\"low|medium|high\",\"commands\":[\"...\"]}]"),
        Param("notes", "string", "Additional notes or considerations", required=False),
    ]
    risk_level = "low"
    category = "planning"
    rate_limit_per_minute = 30

    async def execute(self, **kw: Any) -> ToolResult:
        goal = kw.get("goal", "").strip()
        if not goal:
            return ToolResult(error="Goal is required")

        context = kw.get("context", "")
        notes = kw.get("notes", "")
        steps_raw = kw.get("steps", "[]")

        try:
            steps = json.loads(steps_raw) if isinstance(steps_raw, str) else steps_raw
        except json.JSONDecodeError:
            steps = []

        # Build structured plan
        plan_lines = [f"# Execution Plan: {goal}", ""]

        if context:
            plan_lines += [f"**Context:** {context}", ""]

        if steps:
            plan_lines.append("## Steps")
            for i, step in enumerate(steps, 1):
                title = step.get("title", f"Step {i}")
                desc = step.get("description", "")
                risk = step.get("risk", "low")
                commands = step.get("commands", [])

                risk_emoji = {"low": "🟢", "medium": "🟡", "high": "🔴"}.get(risk, "⚪")
                plan_lines.append(f"\n### {i}. {title} {risk_emoji} {risk}")
                if desc:
                    plan_lines.append(f"   {desc}")
                if commands:
                    plan_lines.append("   ```bash")
                    for cmd in commands:
                        plan_lines.append(f"   {cmd}")
                    plan_lines.append("   ```")
        else:
            plan_lines.append("_(No steps defined yet — this is a goal outline.)_")

        if notes:
            plan_lines += ["", f"**Notes:** {notes}"]

        # Summary metadata
        total = len(steps)
        high_risk = sum(1 for s in steps if s.get("risk") == "high")
        total_commands = sum(len(s.get("commands", [])) for s in steps)

        plan_lines += [
            "",
            "---",
            f"**Summary:** {total} steps, {total_commands} commands, {high_risk} high-risk steps",
        ]

        return ToolResult(
            output="\n".join(plan_lines),
            metadata={
                "goal": goal,
                "total_steps": total,
                "high_risk_steps": high_risk,
                "total_commands": total_commands,
            },
        )
