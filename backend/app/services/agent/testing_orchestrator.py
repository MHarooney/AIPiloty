"""TestingOrchestrator — specialised ReAct agent for API & code testing.

Subclasses AgentOrchestrator with:
- A QA Expert system prompt (never cached — testing_context changes per call)
- Ephemeral injection of auth credentials into the system prompt
- Stripping of auth_header before yielding events or writing to the DB
"""

from __future__ import annotations

import logging
from typing import Any, AsyncGenerator

from ..tools.registry import ToolRegistry
from ..llm.ollama_service import OllamaService
from .guardrails import GuardrailService
from .orchestrator import AgentOrchestrator, SSEEvent, _build_system_prompt

logger = logging.getLogger(__name__)

_QA_SYSTEM_PROMPT_TEMPLATE = """You are AIPiloty QA Agent, an expert AI software tester and quality engineer with full browser automation capabilities.

You are a ReAct agent — you THINK, then ACT (call tools), then OBSERVE results, then continue until done.

═══ YOUR MISSION ═══
Help the user test their platform — UI, API, and full end-to-end flows. You can:
- Control a real headless browser (Chromium) to interact with any web UI
- Log into platforms and explore their full interface
- Fill forms, click buttons, and navigate pages just like a real user
- Take screenshots at every step so the user can see exactly what you see
- Probe API connectivity and run automated HTTP test suites
- Run local pytest suites and report results
- Discover all pages, forms, and API endpoints in a platform automatically
- Analyse failures with root-cause analysis and suggest concrete fixes

You are operating against: **{env_label}** environment{target_url_section}

{auth_section}

{credentials_section}

═══ AVAILABLE TOOLS ═══
{tools_section}

═══ BROWSER TESTING — CRITICAL RULES ═══
- When the user provides login credentials (username/password), ALWAYS start with `discover_platform`.
  It logs in automatically, maps the full site, and returns a screenshot of the dashboard.
- Use `browser_navigate` to open any page and see it visually.
- Use `browser_fill_form` to fill and submit login or any other form.
- Use `browser_click` to click navigation links, buttons, or menu items.
- Use `browser_screenshot` to capture the current state after any interaction.
- After EVERY browser action, describe briefly what you see in the screenshot.
- `session_key` chains browser actions — use the same key across a conversation to keep the session alive.

═══ DOM-FIRST NAVIGATION STRATEGY (MANDATORY) ═══
BEFORE clicking any button or filling any form that you have not already seen in a tool result:
1. Call `browser_page_map` first to get the REAL button text, link text, and form field labels.
2. Use the EXACT text values from `browser_page_map` results — never guess selector text.
3. For clicking: use `browser_click` with `text=` matching the exact text from `browser_page_map`.
4. For forms: use `browser_fill_form` with selectors based on the `label` or `placeholder` from `browser_page_map`.
5. If a click or fill fails, IMMEDIATELY call `browser_page_map` again to re-inspect the current state, then retry.

WRONG: browser_click selector="a:has-text('Create Course')" (guessing)
RIGHT: call browser_page_map first → find actual button text "Add Course" → browser_click text="Add Course"

WRONG: browser_fill_form fields=[{{"selector": "[aria-label='Course Title']", "value": "..."}}] (guessing)
RIGHT: call browser_page_map first → find actual label "Title" → browser_fill_form fields=[{{"selector": "[aria-label='Title']", "value": "..."}}]

For Vuetify/Vue apps: inputs often have no aria-label. Use the label text as the `text=` value in browser_fill_form.

═══ HOW TO CALL A TOOL ═══
When you need to use a tool, output EXACTLY this format (inside a JSON code block):

```json
{{"tool": "tool_name", "arguments": {{"param1": "value1", "param2": "value2"}}}}
```

IMPORTANT RULES:
1. Output ONLY ONE tool call per response.
2. After calling a tool, STOP and wait for the result before continuing.
3. When you have the final answer, respond normally WITHOUT any tool call block.
4. Automatically include auth_header in any tool that accepts it.
5. When probe_api_target confirms the target is reachable, proceed with test execution.
6. After test execution, always analyse and summarise failures clearly.
7. For browser sessions, always pass the same session_key to chain interactions.
8. Never stop mid-task — continue all steps until the full flow is verified.

═══ GUIDELINES ═══
- For UI testing: start with `discover_platform` or `browser_navigate`, then interact step by step.
- For API testing: start with `probe_api_target`, then `run_api_tests`.
- Report pass/fail counts prominently in your summary.
- Highlight critical failures that indicate broken functionality.
- Never expose credentials or auth_header in your visible response text.

═══ OUTPUT HYGIENE ═══
- Never start with planning headers like "Plan:", "Step 1:", "Thought:" etc.
- Jump straight to a tool call or a direct user-facing answer.
- After each browser screenshot result, describe what you see: page title, visible elements, any errors.
"""


class TestingOrchestrator(AgentOrchestrator):
    """ReAct agent specialised for API and code testing.

    Key differences from the base AgentOrchestrator:
    1. System prompt is QA-focused and NOT cached (testing_context differs per run).
    2. `run_testing()` injects auth_header as an ephemeral system message and
       strips it from all SSE events before yielding to the caller.
    """

    def __init__(
        self,
        llm: OllamaService,
        registry: ToolRegistry,
        guardrails: GuardrailService,
    ):
        super().__init__(llm, registry, guardrails)

    def _build_testing_system_prompt(
        self,
        tools: list,
        target_url: str,
        env_label: str,
        auth_header: str | None,
        username: str | None = None,
        password: str | None = None,
    ) -> str:
        """Build a per-call system prompt. Never cached — context changes every call."""
        tool_docs = []
        for t in tools:
            params = []
            for p in t.parameters:
                req = " (required)" if p.required else f" (optional, default={p.default})"
                params.append(f"    - {p.name} ({p.type}): {p.description}{req}")
            params_str = "\n".join(params) if params else "    (no parameters)"
            tool_docs.append(
                f"  {t.name}: {t.description}\n"
                f"    Category: {t.category} | Risk: {t.risk_level}\n"
                f"    Parameters:\n{params_str}"
            )
        tools_section = "\n\n".join(tool_docs)

        auth_section = ""
        if auth_header:
            auth_section = (
                "═══ AUTHENTICATION (CONFIDENTIAL — DO NOT ECHO) ═══\n"
                f"Authorization: {auth_header}\n"
                "Use this value as the 'auth_header' argument in any tool that accepts it. "
                "Never reproduce this value in your visible response text."
            )

        # Separate credentials section for browser login tools
        credentials_section = ""
        if username and password:
            credentials_section = (
                "═══ LOGIN CREDENTIALS (CONFIDENTIAL — DO NOT ECHO) ═══\n"
                f"Username: {username}\n"
                f"Password: {password}\n"
                "Use these as the 'username' and 'password' arguments in browser tools (e.g. discover_platform). "
                "Never reproduce these values in your visible response text."
            )

        if target_url:
            target_url_section = f" at **{target_url}**"
        else:
            target_url_section = (
                "\n\n> **No target URL provided yet.** "
                "Read the user\'s message carefully — extract any URL they mention. "
                "If the message contains a URL, use it as the target. "
                "If not, ask the user politely: \'What URL would you like me to test, and do you need to pass any auth credentials?\'"
            )

        return _QA_SYSTEM_PROMPT_TEMPLATE.format(
            env_label=env_label or "unspecified",
            target_url_section=target_url_section,
            tools_section=tools_section,
            auth_section=auth_section,
            credentials_section=credentials_section,
        )

    async def run_testing(
        self,
        messages: list[dict[str, Any]],
        testing_context: dict[str, Any],
        auto_approve: bool = False,
        model: str | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """Run the testing agent with an ephemeral testing context.

        The `testing_context` dict must contain:
          - url (str): target API base URL
          - auth_header (str | None): Authorization header value — stripped before yielding
          - env_label (str): human label for the environment

        The auth_header is injected into the system prompt only and is
        NEVER written to the database (stripping is the caller's responsibility).
        """
        target_url: str = testing_context.get("url", "")
        auth_header: str | None = testing_context.get("auth_header")
        env_label: str = testing_context.get("env_label", "")
        username: str | None = testing_context.get("username")
        password: str | None = testing_context.get("password")

        all_tools = self._registry.all_tools()
        system_prompt = self._build_testing_system_prompt(
            all_tools, target_url, env_label, auth_header,
            username=username, password=password,
        )

        # Prepend the system prompt as the first message (Ollama format)
        full_messages = [{"role": "system", "content": system_prompt}] + list(messages)

        # Use the base orchestrator's internal loop, overriding the message list.
        # We call _run_loop directly to bypass the base class's system-prompt logic.
        async for event in self._run_loop(full_messages, auto_approve=auto_approve, model=model):
            # Strip auth_header from any token or text events before yielding
            event = _strip_auth_from_event(event, auth_header)
            yield event

    async def _run_loop(
        self,
        messages: list[dict[str, Any]],
        auto_approve: bool = False,
        model: str | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """Delegate to the base class run() but pass messages with system already injected."""
        # Override: base run() prepends its own system prompt; we patch it out by
        # calling the LLM directly with our pre-built message list.
        from .orchestrator import (
            MAX_ITERATIONS,
            MAX_DURATION_SECONDS,
            _extract_tool_call,
            _extract_text_before_tool_call,
            _strip_leaked_control_tokens,
            _strip_planner_leaks,
            _normalize_llm_content,
        )
        import time

        all_tools = self._registry.all_tools()
        tool_map = {t.name: t for t in all_tools}

        conversation = list(messages)
        iteration = 0
        t_start = time.monotonic()

        yield SSEEvent("planning", {"steps": ["Initialising testing agent..."]})

        while iteration < MAX_ITERATIONS:
            iteration += 1
            elapsed = time.monotonic() - t_start
            if elapsed > MAX_DURATION_SECONDS:
                yield SSEEvent("error", {"message": "Agent timeout — testing session exceeded limit."})
                return

            try:
                response_text = ""
                async for chunk in self._llm.chat_stream(conversation, model_override=model):
                    msg_obj = chunk.get("message") or {}
                    token = _normalize_llm_content(msg_obj) if isinstance(msg_obj, dict) else ""
                    if token:
                        response_text += token
                        yield SSEEvent("token", {"token": token})
            except Exception as exc:
                logger.error("LLM streaming error in testing orchestrator: %s", exc)
                yield SSEEvent("error", {"message": f"LLM error: {exc}"})
                return

            response_text = _strip_leaked_control_tokens(response_text)
            response_text = _strip_planner_leaks(response_text)

            tool_call = _extract_tool_call(response_text)

            if tool_call is None:
                # No tool call — final answer
                conversation.append({"role": "assistant", "content": response_text})
                yield SSEEvent("done", {"iterations": iteration})
                return

            # Tool call extracted — execute it
            tool_name = tool_call["tool"]
            arguments = tool_call.get("arguments", {})
            thinking = _extract_text_before_tool_call(response_text)

            yield SSEEvent("tool_start", {"tool": tool_name, "arguments": arguments, "thinking": thinking})

            tool = tool_map.get(tool_name)
            if tool is None:
                tool_result_text = f"Error: tool '{tool_name}' not found."
                yield SSEEvent("tool_end", {"tool": tool_name, "result": tool_result_text, "success": False})
            else:
                try:
                    result = await tool.execute(**arguments)
                    import json as _json
                    if result.success:
                        if isinstance(result.output, (dict, list)):
                            # Extract and emit screenshot before stripping it from tool_end
                            output_for_llm = result.output
                            if isinstance(result.output, dict) and "screenshot_b64" in result.output:
                                screenshot_b64 = result.output["screenshot_b64"]
                                friendly_names = {
                                    "browser_navigate": "Page loaded",
                                    "browser_screenshot": "Screenshot",
                                    "browser_fill_form": "Form filled",
                                    "browser_click": "Clicked element",
                                    "browser_evaluate": "JS evaluated",
                                    "discover_platform": "Platform discovery",
                                }
                                caption = friendly_names.get(tool_name, tool_name.replace("_", " ").title())
                                if result.output.get("title"):
                                    caption = f"{caption}: {result.output['title']}"
                                elif result.output.get("dashboard_title"):
                                    raw_title = result.output["dashboard_title"]
                                    # Avoid "Logged in — Loading <url>" when SPA was still loading
                                    if raw_title and not raw_title.lower().startswith("loading"):
                                        caption = f"Dashboard — {raw_title}"
                                    else:
                                        caption = f"Dashboard — {result.output.get('dashboard_url', '')}"

                                # For discover_platform: emit the login page screenshot first
                                if tool_name == "discover_platform" and result.output.get("login_screenshot_b64"):
                                    yield SSEEvent("screenshot", {
                                        "image_b64": result.output["login_screenshot_b64"],
                                        "caption": f"Login page — {result.output.get('login_url', '')}",
                                        "step": iteration,
                                        "url": result.output.get("login_url", ""),
                                    })

                                yield SSEEvent("screenshot", {
                                    "image_b64": screenshot_b64,
                                    "caption": caption,
                                    "step": iteration,
                                    "url": result.output.get("url") or result.output.get("dashboard_url") or "",
                                })
                                # Strip large base64 fields from what we pass to LLM context
                                output_for_llm = {
                                    k: v for k, v in result.output.items()
                                    if k not in ("screenshot_b64", "login_screenshot_b64")
                                }
                            tool_result_text = _json.dumps(output_for_llm, ensure_ascii=False)
                        else:
                            tool_result_text = str(result.output)
                    else:
                        tool_result_text = f"Tool error: {result.error}"
                    yield SSEEvent("tool_end", {"tool": tool_name, "result": tool_result_text, "success": result.success})
                except Exception as exc:
                    tool_result_text = f"Execution error: {exc}"
                    yield SSEEvent("tool_end", {"tool": tool_name, "result": tool_result_text, "success": False})

            conversation.append({"role": "assistant", "content": response_text})
            conversation.append({"role": "tool", "content": f"[TOOL RESULT for {tool_name}]\n{tool_result_text}"})

        yield SSEEvent("done", {"iterations": iteration, "hit_limit": True})


def _strip_auth_from_event(event: SSEEvent, auth_header: str | None) -> SSEEvent:
    """Remove auth_header value from event data to prevent leaking credentials."""
    if not auth_header:
        return event
    import json as _json
    import dataclasses

    data = event.data
    if isinstance(data, dict):
        # Serialise, redact, deserialise
        raw = _json.dumps(data)
        if auth_header in raw:
            raw = raw.replace(auth_header, "[REDACTED]")
            data = _json.loads(raw)
            return SSEEvent(event=event.event, data=data)
    return event
