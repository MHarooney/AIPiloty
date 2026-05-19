"""API testing tools — probe, run automated checks, and analyse failures against a remote API target.

These tools are wired exclusively to the TestingOrchestrator and are NOT exposed
to the main chat agent.
"""

from __future__ import annotations

import json
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from ..base import BaseTool, Param, ToolResult


class ProbeApiTargetTool(BaseTool):
    """Send a quick connectivity probe to a remote API to verify it is reachable."""

    name = "probe_api_target"
    description = (
        "Sends an HTTP GET to the root or health endpoint of a target API URL and "
        "reports reachability, response time, and server headers. Use this first before "
        "running any tests to confirm the target is accessible."
    )
    category = "testing"
    risk_level = "low"
    parameters = [
        Param(
            name="url",
            type="string",
            description="Base URL of the API to probe (e.g. https://api.example.com).",
            required=True,
        ),
        Param(
            name="health_path",
            type="string",
            description="Path to the health/ready endpoint (default: '/').",
            required=False,
            default="/",
        ),
        Param(
            name="auth_header",
            type="string",
            description="Optional Authorization header value (e.g. 'Bearer <token>' or 'Basic <b64>').",
            required=False,
            default=None,
        ),
        Param(
            name="timeout_seconds",
            type="number",
            description="Request timeout in seconds (default: 10).",
            required=False,
            default=10,
        ),
    ]

    async def execute(self, **kwargs: Any) -> ToolResult:  # type: ignore[override]
        url: str = kwargs["url"].rstrip("/")
        path: str = kwargs.get("health_path") or "/"
        auth_header: str | None = kwargs.get("auth_header")
        timeout: float = float(kwargs.get("timeout_seconds") or 10)

        # Validate URL scheme to prevent SSRF to internal metadata endpoints
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return ToolResult(error=f"Unsupported scheme '{parsed.scheme}'. Only http/https allowed.")

        probe_url = f"{url}{path}"
        headers: dict[str, str] = {}
        if auth_header:
            headers["Authorization"] = auth_header

        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                resp = await client.get(probe_url, headers=headers)
            elapsed_ms = round((time.perf_counter() - start) * 1000, 1)

            return ToolResult(
                output={
                    "reachable": True,
                    "status_code": resp.status_code,
                    "response_time_ms": elapsed_ms,
                    "server": resp.headers.get("server", "unknown"),
                    "content_type": resp.headers.get("content-type", ""),
                    "url": probe_url,
                },
                metadata={"response_headers": dict(resp.headers)},
            )
        except httpx.TimeoutException:
            elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
            return ToolResult(
                error=f"Request timed out after {timeout}s ({elapsed_ms} ms elapsed)",
                output={"reachable": False, "url": probe_url},
            )
        except httpx.RequestError as exc:
            return ToolResult(
                error=f"Connection error: {exc}",
                output={"reachable": False, "url": probe_url},
            )


class RunApiTestsTool(BaseTool):
    """Execute a set of API test cases against a target and report pass/fail results."""

    name = "run_api_tests"
    description = (
        "Runs a list of HTTP API test cases (each specifying method, path, expected status, "
        "and optional request body/headers). Returns per-test results with actual vs expected "
        "status, response body snippet, and latency. Ideal for smoke tests and regression checks."
    )
    category = "testing"
    risk_level = "medium"
    parameters = [
        Param(
            name="base_url",
            type="string",
            description="Base URL of the API under test (e.g. https://api.example.com).",
            required=True,
        ),
        Param(
            name="tests",
            type="string",
            description=(
                "JSON array of test case objects. Each object must have: "
                "name (string), method (GET/POST/PUT/DELETE/PATCH), path (string), "
                "expected_status (integer). Optional: body (object), headers (object), "
                "expected_body_contains (string)."
            ),
            required=True,
        ),
        Param(
            name="auth_header",
            type="string",
            description="Default Authorization header applied to all requests unless overridden per-test.",
            required=False,
            default=None,
        ),
        Param(
            name="timeout_seconds",
            type="number",
            description="Per-request timeout in seconds (default: 15).",
            required=False,
            default=15,
        ),
    ]

    async def execute(self, **kwargs: Any) -> ToolResult:  # type: ignore[override]
        base_url: str = kwargs["base_url"].rstrip("/")
        tests_json: str = kwargs["tests"]
        auth_header: str | None = kwargs.get("auth_header")
        timeout: float = float(kwargs.get("timeout_seconds") or 15)

        # Parse and validate the test cases
        try:
            test_cases: list[dict] = json.loads(tests_json) if isinstance(tests_json, str) else tests_json
        except json.JSONDecodeError as exc:
            return ToolResult(error=f"Invalid JSON in 'tests' parameter: {exc}")

        if not isinstance(test_cases, list) or not test_cases:
            return ToolResult(error="'tests' must be a non-empty JSON array.")

        # Validate URL scheme
        parsed = urlparse(base_url)
        if parsed.scheme not in ("http", "https"):
            return ToolResult(error=f"Unsupported scheme '{parsed.scheme}'.")

        results: list[dict] = []
        default_headers: dict[str, str] = {}
        if auth_header:
            default_headers["Authorization"] = auth_header

        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            for tc in test_cases:
                name = tc.get("name", "unnamed")
                method = (tc.get("method") or "GET").upper()
                path = tc.get("path", "/")
                expected_status = tc.get("expected_status", 200)
                body = tc.get("body")
                extra_headers = tc.get("headers", {})
                expected_contains: str | None = tc.get("expected_body_contains")

                headers = {**default_headers, **extra_headers}
                start = time.perf_counter()
                try:
                    resp = await client.request(
                        method,
                        path,
                        json=body if body else None,
                        headers=headers,
                    )
                    elapsed_ms = round((time.perf_counter() - start) * 1000, 1)

                    # Truncate response body for safety/token limits
                    try:
                        body_preview = resp.text[:500]
                    except Exception:
                        body_preview = "<unreadable>"

                    passed = resp.status_code == expected_status
                    if passed and expected_contains:
                        passed = expected_contains in resp.text

                    results.append(
                        {
                            "name": name,
                            "passed": passed,
                            "method": method,
                            "path": path,
                            "expected_status": expected_status,
                            "actual_status": resp.status_code,
                            "response_time_ms": elapsed_ms,
                            "body_preview": body_preview,
                            "failure_reason": (
                                None
                                if passed
                                else (
                                    f"Status mismatch: expected {expected_status}, got {resp.status_code}"
                                    if resp.status_code != expected_status
                                    else f"Body does not contain: {expected_contains!r}"
                                )
                            ),
                        }
                    )
                except httpx.TimeoutException:
                    results.append(
                        {
                            "name": name,
                            "passed": False,
                            "method": method,
                            "path": path,
                            "expected_status": expected_status,
                            "actual_status": None,
                            "response_time_ms": None,
                            "body_preview": None,
                            "failure_reason": f"Timeout after {timeout}s",
                        }
                    )
                except httpx.RequestError as exc:
                    results.append(
                        {
                            "name": name,
                            "passed": False,
                            "method": method,
                            "path": path,
                            "expected_status": expected_status,
                            "actual_status": None,
                            "response_time_ms": None,
                            "body_preview": None,
                            "failure_reason": f"Request error: {exc}",
                        }
                    )

        passed_count = sum(1 for r in results if r["passed"])
        failed_count = len(results) - passed_count

        return ToolResult(
            output={
                "summary": {
                    "total": len(results),
                    "passed": passed_count,
                    "failed": failed_count,
                    "pass_rate": f"{round(passed_count / len(results) * 100, 1)}%",
                },
                "results": results,
            }
        )


class AnalyzeTestFailuresTool(BaseTool):
    """Analyse test failure output and produce a prioritised list of fixes with root-cause analysis."""

    name = "analyze_test_failures"
    description = (
        "Accepts raw test failure output (JSON, JUnit XML snippet, or plain text) and "
        "produces a structured root-cause analysis with prioritised fix suggestions. "
        "Use this after run_api_tests or run_local_pytest to explain failures to the user."
    )
    category = "testing"
    risk_level = "low"
    parameters = [
        Param(
            name="failure_output",
            type="string",
            description="Raw failure output from the test run (pytest output, API test result JSON, etc.).",
            required=True,
        ),
        Param(
            name="context",
            type="string",
            description="Optional extra context about the API/codebase to guide analysis.",
            required=False,
            default=None,
        ),
    ]

    async def execute(self, **kwargs: Any) -> ToolResult:  # type: ignore[override]
        failure_output: str = kwargs["failure_output"]
        context: str | None = kwargs.get("context")

        if not failure_output.strip():
            return ToolResult(error="'failure_output' is empty — nothing to analyse.")

        # This tool returns a structured prompt for the LLM to use in its next turn.
        # The orchestrator will see this result and generate the actual analysis.
        analysis_prompt = (
            "Analyse the following test failures. For each failure:\n"
            "1. Identify the root cause.\n"
            "2. Classify severity (critical/high/medium/low).\n"
            "3. Suggest a concrete fix.\n"
            "4. Indicate if it is likely a test issue or an application bug.\n\n"
            f"--- FAILURE OUTPUT ---\n{failure_output[:3000]}\n"
        )
        if context:
            analysis_prompt += f"\n--- CONTEXT ---\n{context[:1000]}\n"

        return ToolResult(
            output={"analysis_request": analysis_prompt, "raw_input_length": len(failure_output)},
            metadata={"note": "Feed 'analysis_request' back to the LLM for the actual analysis text."},
        )
