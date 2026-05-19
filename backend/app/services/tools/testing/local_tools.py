"""Local testing tools — run pytest in a subprocess and generate test code stubs.

These tools operate on the local machine where the backend is running and are
intentionally sandboxed (pytest only, no arbitrary shell).
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from ..base import BaseTool, Param, ToolResult


class RunLocalPytestTool(BaseTool):
    """Run pytest in a sandboxed subprocess and return structured pass/fail results."""

    name = "run_local_pytest"
    description = (
        "Runs pytest on a specified test path inside the workspace and returns a "
        "structured report (pass/fail counts, failed test names, stdout). "
        "Only pytest is allowed — no arbitrary shell commands."
    )
    category = "testing"
    risk_level = "medium"
    requires_approval = False
    parameters = [
        Param(
            name="test_path",
            type="string",
            description=(
                "Relative path (from workspace root) to a test file or directory "
                "(e.g. 'tests/' or 'tests/integration/test_chat_api.py'). "
                "Must not contain '..' or absolute paths."
            ),
            required=True,
        ),
        Param(
            name="workspace_root",
            type="string",
            description="Absolute path to the workspace root containing the tests. Defaults to backend/.",
            required=False,
            default=None,
        ),
        Param(
            name="timeout_seconds",
            type="number",
            description="Maximum seconds to wait for pytest to finish (default: 120).",
            required=False,
            default=120,
        ),
        Param(
            name="extra_args",
            type="string",
            description="Additional pytest CLI args (e.g. '-x -k test_health'). No shell injection possible.",
            required=False,
            default=None,
        ),
    ]

    async def execute(self, **kwargs: Any) -> ToolResult:  # type: ignore[override]
        test_path: str = kwargs["test_path"]
        workspace_root: str | None = kwargs.get("workspace_root")
        timeout: float = float(kwargs.get("timeout_seconds") or 120)
        extra_args_str: str | None = kwargs.get("extra_args")

        # Security: prevent path traversal
        if ".." in test_path or test_path.startswith("/"):
            return ToolResult(error="'test_path' must be relative and must not contain '..'.")

        # Resolve workspace
        if workspace_root:
            root = Path(workspace_root).resolve()
        else:
            # Default: look for a backend/ dir next to the running script
            root = Path(__file__).parent.parent.parent.parent.parent.resolve()

        if not root.exists():
            return ToolResult(error=f"Workspace root does not exist: {root}")

        pytest_path = shutil.which("pytest")
        if not pytest_path:
            return ToolResult(error="pytest not found in PATH.")

        # Build safe argument list (no shell=True)
        report_file = root / "test-results-tmp.xml"
        cmd = [
            pytest_path,
            str(test_path),
            f"--junitxml={report_file}",
            "--tb=short",
            "-q",
        ]
        if extra_args_str:
            # Only allow safe flag-style args (no semicolons, pipes, etc.)
            safe_args = [a for a in extra_args_str.split() if re.match(r'^-[\w=./:*]+$', a)]
            cmd.extend(safe_args)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            stdout_bytes, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            stdout = stdout_bytes.decode("utf-8", errors="replace")
            return_code = proc.returncode
        except asyncio.TimeoutError:
            return ToolResult(error=f"pytest timed out after {timeout}s.")
        except Exception as exc:
            return ToolResult(error=f"Failed to run pytest: {exc}")

        # Parse JUnit XML if present
        results = _parse_junit_xml(report_file)
        if report_file.exists():
            report_file.unlink(missing_ok=True)

        return ToolResult(
            output={
                "return_code": return_code,
                "passed": results["passed"],
                "failed": results["failed"],
                "skipped": results["skipped"],
                "errors": results["errors"],
                "failed_tests": results["failed_tests"],
                "stdout_tail": stdout[-2000:],  # Last 2k chars to avoid token overflow
            }
        )


def _parse_junit_xml(xml_path: Path) -> dict:
    """Parse a JUnit XML file and return summary counts."""
    empty: dict = {"passed": 0, "failed": 0, "skipped": 0, "errors": 0, "failed_tests": []}
    if not xml_path.exists():
        return empty
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        suite = root if root.tag == "testsuite" else root.find("testsuite")
        if suite is None:
            return empty

        failed_tests = [
            tc.get("name", "unknown")
            for tc in suite.findall("testcase")
            if tc.find("failure") is not None or tc.find("error") is not None
        ]
        return {
            "passed": int(suite.get("tests", 0)) - int(suite.get("failures", 0)) - int(suite.get("errors", 0)) - int(suite.get("skipped", 0)),
            "failed": int(suite.get("failures", 0)),
            "skipped": int(suite.get("skipped", 0)),
            "errors": int(suite.get("errors", 0)),
            "failed_tests": failed_tests,
        }
    except Exception:
        return empty


class GenerateTestCodeTool(BaseTool):
    """Generate pytest test stubs or Postman collection JSON for a given API specification."""

    name = "generate_test_code"
    description = (
        "Generates ready-to-run pytest test stubs (or a Postman collection) from an OpenAPI spec "
        "URL, raw JSON schema, or a plain text description of API endpoints. "
        "Returns the generated code as a string for the user to review and save."
    )
    category = "testing"
    risk_level = "low"
    parameters = [
        Param(
            name="spec_input",
            type="string",
            description=(
                "The API specification to generate tests for. Can be: "
                "(1) A URL to an OpenAPI/Swagger JSON endpoint, "
                "(2) A raw OpenAPI JSON string, "
                "(3) A plain-text description of endpoints."
            ),
            required=True,
        ),
        Param(
            name="output_format",
            type="string",
            description="Output format: 'pytest' (default) or 'postman'.",
            required=False,
            default="pytest",
            enum=["pytest", "postman"],
        ),
        Param(
            name="base_url",
            type="string",
            description="Base URL to embed in generated tests (e.g. https://api.example.com).",
            required=False,
            default="http://localhost:8000",
        ),
    ]

    async def execute(self, **kwargs: Any) -> ToolResult:  # type: ignore[override]
        spec_input: str = kwargs["spec_input"]
        output_format: str = kwargs.get("output_format") or "pytest"
        base_url: str = kwargs.get("base_url") or "http://localhost:8000"

        if not spec_input.strip():
            return ToolResult(error="'spec_input' cannot be empty.")

        # If it looks like a URL, return a prompt telling the orchestrator to fetch + generate.
        if spec_input.strip().startswith("http"):
            return ToolResult(
                output={
                    "action": "fetch_and_generate",
                    "spec_url": spec_input.strip(),
                    "output_format": output_format,
                    "base_url": base_url,
                    "instruction": (
                        f"Fetch {spec_input.strip()} to get the OpenAPI spec, then generate "
                        f"{output_format} tests for each endpoint using {base_url} as the base URL."
                    ),
                }
            )

        # Build a generation prompt for the LLM
        if output_format == "postman":
            template = (
                f"Generate a Postman Collection v2.1 JSON for the following API. "
                f"Include at least one request per endpoint. Use {base_url} as the base URL.\n\n"
                f"API Spec:\n{spec_input[:3000]}"
            )
        else:
            template = (
                f"Generate pytest integration test stubs for the following API. "
                f"Use httpx.AsyncClient with base_url='{base_url}'. "
                f"Group tests by endpoint in classes. Include happy-path and error-case tests.\n\n"
                f"API Spec / Endpoints:\n{spec_input[:3000]}"
            )

        return ToolResult(
            output={
                "generation_prompt": template,
                "output_format": output_format,
                "note": "Feed 'generation_prompt' back to the LLM to produce the actual code.",
            }
        )
