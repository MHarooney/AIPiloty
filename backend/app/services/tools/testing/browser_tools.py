"""Browser automation tools — powered by Playwright.

These tools give the TestingOrchestrator real browser control:
- Navigate to pages
- Take screenshots (returned as base64 JPEG for SSE streaming)
- Fill and submit forms
- Click elements
- Run JavaScript
- Discover a platform (login + crawl all nav links, forms, API endpoints)

All browser sessions are scoped to a session_key and auto-closed after
SESSION_TIMEOUT_SECONDS of inactivity to prevent memory leaks.

SECURITY: Only http/https URLs are allowed; no local file:// or data: schemes.
Screenshots are base64 JPEG and never written to disk.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from typing import Any
from urllib.parse import urlparse, urljoin

from ..base import BaseTool, Param, ToolResult

logger = logging.getLogger(__name__)

SESSION_TIMEOUT_SECONDS = 300  # 5 minutes
DEFAULT_VIEWPORT = {"width": 1440, "height": 900}
DEFAULT_CLICK_TIMEOUT_MS = 25_000
DEFAULT_FILL_TIMEOUT_MS = 20_000

# ── Module-level session store ────────────────────────────────────────────────
# Maps session_key → {"context": BrowserContext, "page": Page, "last_used": float}
_sessions: dict[str, dict] = {}
_cleanup_task: asyncio.Task | None = None


async def _start_cleanup_loop() -> None:
    """Background task that closes idle browser sessions."""
    global _cleanup_task
    while True:
        await asyncio.sleep(60)
        now = time.monotonic()
        dead = [k for k, v in _sessions.items() if now - v["last_used"] > SESSION_TIMEOUT_SECONDS]
        for key in dead:
            try:
                await _sessions[key]["context"].close()
            except Exception:
                pass
            del _sessions[key]
            logger.info("Closed idle browser session: %s", key)


def ensure_cleanup_loop() -> None:
    """Start the cleanup task once when the first browser tool is instantiated."""
    global _cleanup_task
    if _cleanup_task is None or _cleanup_task.done():
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                _cleanup_task = loop.create_task(_start_cleanup_loop())
        except RuntimeError:
            pass  # no event loop yet — started later by FastAPI


def _validate_url(url: str) -> str | None:
    """Return an error string if the URL is not safe, else None."""
    try:
        parsed = urlparse(url)
    except Exception:
        return "Invalid URL"
    if parsed.scheme not in ("http", "https"):
        return f"Unsupported URL scheme '{parsed.scheme}'. Only http/https is allowed."
    return None


async def _get_or_create_page(browser: Any, session_key: str) -> tuple[Any, Any]:
    """Return (context, page) for the given session_key, creating if needed."""
    if session_key in _sessions:
        entry = _sessions[session_key]
        entry["last_used"] = time.monotonic()
        return entry["context"], entry["page"]

    context = await browser.new_context(
        viewport=DEFAULT_VIEWPORT,
        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/124.0.0.0 Safari/537.36",
    )
    page = await context.new_page()
    _sessions[session_key] = {"context": context, "page": page, "last_used": time.monotonic()}
    ensure_cleanup_loop()
    return context, page


async def _screenshot_b64(page: Any, *, full_page: bool = False) -> str:
    """Take a JPEG screenshot and return as base64 string."""
    raw = await page.screenshot(type="jpeg", quality=85, full_page=full_page)
    return base64.b64encode(raw).decode("utf-8")


async def _wait_spa_settle(page: Any, extra_ms: int = 1500) -> None:
    """Wait for SPA (Vue/Vuetify) to finish rendering after navigation or click."""
    try:
        await page.wait_for_load_state("networkidle", timeout=8_000)
    except Exception:
        pass
    await page.wait_for_timeout(extra_ms)


async def _smart_locator(
    page: Any,
    *,
    selector: str | None = None,
    text: str | None = None,
    role: str | None = None,
) -> tuple[Any | None, str | None]:
    """Resolve a visible element via selector, ARIA role+name, or link/button/text fallbacks."""
    candidates: list[tuple[str, Any]] = []

    if selector:
        sel = _normalize_selector(selector)
        candidates.append(("selector", page.locator(sel)))

    if text:
        t = text.strip()
        if role:
            candidates.append((f"role:{role}", page.get_by_role(role, name=t)))  # type: ignore[arg-type]
        else:
            for r in ("link", "button", "menuitem", "tab"):
                candidates.append((f"role:{r}", page.get_by_role(r, name=t)))  # type: ignore[arg-type]
            candidates.append(("label", page.get_by_label(t)))
            candidates.append(("placeholder", page.get_by_placeholder(t)))
            candidates.append(("text", page.get_by_text(t, exact=False)))

    for strategy, loc in candidates:
        try:
            target = loc.first
            if await target.count() == 0:
                continue
            await target.scroll_into_view_if_needed(timeout=8_000)
            await target.wait_for(state="visible", timeout=5_000)
            return target, strategy
        except Exception:
            continue
    return None, None


async def _fill_field_smart(page: Any, selector: str, value: str) -> str:
    """Fill one field; try label/placeholder derived from selector hints."""
    loc, strategy = await _smart_locator(page, selector=selector)
    if loc is not None:
        await loc.fill(value, timeout=DEFAULT_FILL_TIMEOUT_MS)
        return strategy or "selector"

    # Heuristic: [aria-label='X'] or bare name → try get_by_label
    import re
    m = re.search(r"aria-label=['\"]([^'\"]+)['\"]", selector)
    label_text = m.group(1) if m else None
    if label_text:
        loc, strategy = await _smart_locator(page, text=label_text)
        if loc is not None:
            await loc.fill(value, timeout=DEFAULT_FILL_TIMEOUT_MS)
            return strategy or "label"

    raise TimeoutError(f"No visible field for selector: {selector}")


async def _extract_interactive_elements(page: Any) -> list[dict]:
    """Buttons, links, and Vuetify controls visible on the current page."""
    try:
        return await page.evaluate("""
            () => {
                const out = [];
                const seen = new Set();
                const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    if (r.width < 2 || r.height < 2) return false;
                    const s = window.getComputedStyle(el);
                    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
                };
                const add = (el, kind) => {
                    const text = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
                    const href = el.href || el.getAttribute('href') || '';
                    const key = kind + '|' + text + '|' + href;
                    if (!text || seen.has(key)) return;
                    seen.add(key);
                    out.push({ kind, text, href: href.slice(0, 200), tag: el.tagName.toLowerCase() });
                };
                document.querySelectorAll('a[href], button, [role="button"], .v-btn, .v-list-item').forEach(el => {
                    if (!visible(el)) return;
                    if (el.tagName === 'A') add(el, 'link');
                    else add(el, 'button');
                });
                return out.slice(0, 60);
            }
        """)
    except Exception:
        return []


def _format_click_failure_help(page_url: str, elements: list[dict], selector: str, text: str | None) -> str:
    """Actionable error text for the LLM when a click times out."""
    lines = [
        f"Click failed: no matching element for selector={selector!r}"
        + (f" text={text!r}" if text else ""),
        f"Current URL: {page_url}",
        "Recovery tips:",
        "- Vue/Vuetify LMS: use get_by_label text from visible labels, not guessed aria-label.",
        "- 'Create Course' is often on /courses list as 'Add Course' or navigate directly to /courses/add.",
        "- Use browser_navigate to the target path, then browser_page_map to list clickable items.",
        "- Chain the same session_key after discover_platform.",
    ]
    if elements:
        sample = elements[:15]
        lines.append("Visible controls (sample):")
        for el in sample:
            lines.append(f"  - [{el.get('kind')}] {el.get('text')!r} href={el.get('href', '')}")
    return "\n".join(lines)


def _parse_fields_json(raw: Any) -> list[dict]:
    """Parse the 'fields' parameter for browser_fill_form.

    Handles two common LLM mistakes:
    1. Already a list (model passed a real array, not a string).
    2. JSON string where CSS attribute selectors use double quotes
       e.g. [aria-label="Title"] which breaks JSON escaping.
       We repair by converting attribute selector quotes to single quotes.
    """
    import re

    if not isinstance(raw, str):
        return list(raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Repair: replace [attr="value"] with [attr='value'] inside the JSON string
    repaired = re.sub(
        r'\[([a-zA-Z][a-zA-Z0-9_\-]*)="([^"]+)"\]',
        r"[\1='\2']",
        raw,
    )
    return json.loads(repaired)  # raises if still broken


# ── Tool 1: browser_navigate ──────────────────────────────────────────────────

class BrowserNavigateTool(BaseTool):
    """Navigate a headless browser to a URL and return the page title and a screenshot."""

    name = "browser_navigate"
    description = (
        "Opens a headless Chromium browser, navigates to the given URL, waits for the page "
        "to fully load, and returns the page title, final URL (after redirects), and a JPEG "
        "screenshot encoded as base64. Use this to visually inspect a web page, verify login "
        "pages, confirm redirects, or see the current UI state."
    )
    category = "testing"
    risk_level = "low"
    parameters = [
        Param("url", "string", "Full URL to navigate to (e.g. https://example.com/login).", required=True),
        Param("session_key", "string", "Reuse an existing browser session by key. Leave blank for a new session.", required=False, default="default"),
        Param("wait_for", "string", "Playwright wait condition: 'load' (default), 'networkidle', or 'domcontentloaded'.", required=False, default="load"),
    ]

    def __init__(self, browser: Any) -> None:
        self._browser = browser

    async def execute(self, **kwargs: Any) -> ToolResult:
        url: str = kwargs["url"].strip()
        session_key: str = kwargs.get("session_key") or "default"
        wait_for: str = kwargs.get("wait_for") or "load"

        err = _validate_url(url)
        if err:
            return ToolResult(error=err)

        try:
            _, page = await _get_or_create_page(self._browser, session_key)
            await page.goto(url, wait_until=wait_for, timeout=30_000)
            title = await page.title()
            final_url = page.url
            shot = await _screenshot_b64(page)

            return ToolResult(output={
                "url": final_url,
                "title": title,
                "screenshot_b64": shot,
                "session_key": session_key,
            })
        except Exception as exc:
            return ToolResult(error=f"Navigation failed: {exc}")


# ── Tool 2: browser_screenshot ────────────────────────────────────────────────

class BrowserScreenshotTool(BaseTool):
    """Take a screenshot of the current browser page without navigating."""

    name = "browser_screenshot"
    description = (
        "Takes a JPEG screenshot of the current state of the browser page for an existing "
        "session. Use this after interacting with a page (clicking, scrolling, filling forms) "
        "to see the result without navigating away."
    )
    category = "testing"
    risk_level = "low"
    parameters = [
        Param("session_key", "string", "Browser session to screenshot.", required=False, default="default"),
    ]

    def __init__(self, browser: Any) -> None:
        self._browser = browser

    async def execute(self, **kwargs: Any) -> ToolResult:
        session_key: str = kwargs.get("session_key") or "default"

        if session_key not in _sessions:
            return ToolResult(error=f"No active browser session '{session_key}'. Use browser_navigate first.")

        try:
            _, page = await _get_or_create_page(self._browser, session_key)
            shot = await _screenshot_b64(page)
            return ToolResult(output={
                "screenshot_b64": shot,
                "url": page.url,
                "session_key": session_key,
            })
        except Exception as exc:
            return ToolResult(error=f"Screenshot failed: {exc}")


# ── Tool 3: browser_fill_form ─────────────────────────────────────────────────

class BrowserFillFormTool(BaseTool):
    """Fill one or more form fields in the current browser page and optionally submit."""

    name = "browser_fill_form"
    description = (
        "Fills form input fields with the given values and optionally clicks a submit button. "
        "Returns a screenshot after the action. "
        "CRITICAL: 'fields' must be valid JSON. Use single quotes inside CSS attribute selectors "
        "to avoid escaping issues: [aria-label='Course Title'] NOT [aria-label=\"Course Title\"]. "
        "Example: [{\"selector\": \"[aria-label='Title']\", \"value\": \"My Course\"}]"
    )
    category = "testing"
    risk_level = "medium"
    parameters = [
        Param("fields", "string", "JSON array of {selector, value} pairs. Use single quotes in CSS attribute selectors.", required=True),
        Param("submit_selector", "string", "CSS selector of the button to click after filling (optional).", required=False, default=None),
        Param("wait_for_navigation", "boolean", "Wait for page navigation after submit (default: true).", required=False, default=True),
        Param("session_key", "string", "Browser session to use.", required=False, default="default"),
    ]

    def __init__(self, browser: Any) -> None:
        self._browser = browser

    async def execute(self, **kwargs: Any) -> ToolResult:
        fields_raw: str = kwargs["fields"]
        submit_sel: str | None = kwargs.get("submit_selector")
        wait_nav: bool = bool(kwargs.get("wait_for_navigation", True))
        session_key: str = kwargs.get("session_key") or "default"

        try:
            fields: list[dict] = _parse_fields_json(fields_raw)
        except (json.JSONDecodeError, ValueError) as exc:
            return ToolResult(error=f"Invalid JSON in 'fields': {exc}")

        if session_key not in _sessions:
            return ToolResult(error=f"No active browser session '{session_key}'. Use browser_navigate first.")

        try:
            _, page = await _get_or_create_page(self._browser, session_key)

            filled = []
            for f in fields:
                sel = f.get("selector", "")
                val = str(f.get("value", ""))
                label_hint = f.get("label") or f.get("text")
                if label_hint and not sel:
                    loc, strat = await _smart_locator(page, text=str(label_hint))
                    if loc is not None:
                        await loc.fill(val, timeout=DEFAULT_FILL_TIMEOUT_MS)
                        filled.append(f"label:{label_hint} ({strat})")
                        continue
                strategy = await _fill_field_smart(page, sel, val)
                filled.append(f"{sel} ({strategy})")

            submitted = False
            new_url = page.url
            if submit_sel:
                if wait_nav:
                    async with page.expect_navigation(timeout=15_000):
                        await page.click(submit_sel)
                else:
                    await page.click(submit_sel)
                submitted = True
                new_url = page.url

            shot = await _screenshot_b64(page)
            return ToolResult(output={
                "filled": filled,
                "submitted": submitted,
                "new_url": new_url,
                "screenshot_b64": shot,
                "session_key": session_key,
            })
        except Exception as exc:
            elements = await _extract_interactive_elements(page)
            hints = _format_click_failure_help(page.url, elements, "form fields", None)
            return ToolResult(error=f"Form fill failed: {exc}\n\n{hints}")


# ── Tool 4: browser_click ─────────────────────────────────────────────────────

def _normalize_selector(selector: str) -> str:
    """Convert jQuery-style :contains() pseudo-class to Playwright :has-text().

    e.g. button:contains('Create Course') → button:has-text("Create Course")
    Playwright supports :has-text() but NOT :contains().
    """
    import re
    return re.sub(
        r":contains\(['\"]([^'\"]+)['\"]\)",
        lambda m: f':has-text("{m.group(1)}")',
        selector,
    )


class BrowserClickTool(BaseTool):
    """Click an element on the current browser page."""

    name = "browser_click"
    description = (
        "Clicks a DOM element on the current browser page. "
        "Use standard CSS selectors or Playwright text selectors. "
        "IMPORTANT: Do NOT use :contains() — it is invalid CSS. "
        "Instead use :has-text() e.g. \"button:has-text('Create Course')\". "
        "Or use attribute selectors: \"button[data-action='create']\". "
        "Optionally waits for navigation after the click. Returns the new URL and a screenshot."
    )
    category = "testing"
    risk_level = "medium"
    parameters = [
        Param("selector", "string", "CSS / Playwright selector. Use :has-text('text') NOT :contains().", required=False, default=None),
        Param("text", "string", "Visible link/button label (preferred for Vue/Vuetify). e.g. 'Add Course', 'All Courses'.", required=False, default=None),
        Param("role", "string", "ARIA role when using text: link, button, tab, menuitem.", required=False, default=None),
        Param("wait_for_navigation", "boolean", "Wait for page navigation after click (default: false).", required=False, default=False),
        Param("session_key", "string", "Browser session to use.", required=False, default="default"),
    ]

    def __init__(self, browser: Any) -> None:
        self._browser = browser

    async def execute(self, **kwargs: Any) -> ToolResult:
        selector_raw: str | None = kwargs.get("selector")
        text_hint: str | None = kwargs.get("text")
        role_hint: str | None = kwargs.get("role")
        wait_nav: bool = bool(kwargs.get("wait_for_navigation", False))
        session_key: str = kwargs.get("session_key") or "default"

        if not selector_raw and not text_hint:
            return ToolResult(error="Provide 'selector' and/or 'text' for browser_click.")

        selector: str = _normalize_selector(selector_raw) if selector_raw else ""

        if session_key not in _sessions:
            return ToolResult(error=f"No active browser session '{session_key}'. Use browser_navigate first.")

        try:
            _, page = await _get_or_create_page(self._browser, session_key)

            loc, strategy = await _smart_locator(
                page,
                selector=selector or None,
                text=text_hint,
                role=role_hint,
            )
            if loc is None:
                elements = await _extract_interactive_elements(page)
                msg = _format_click_failure_help(page.url, elements, selector, text_hint)
                return ToolResult(error=msg)

            click_timeout = DEFAULT_CLICK_TIMEOUT_MS
            if wait_nav:
                try:
                    async with page.expect_navigation(timeout=20_000):
                        await loc.click(timeout=click_timeout)
                except Exception:
                    await loc.click(timeout=click_timeout)
            else:
                await loc.click(timeout=click_timeout)

            await _wait_spa_settle(page)
            shot = await _screenshot_b64(page)
            return ToolResult(output={
                "clicked_selector": selector or text_hint,
                "resolution": strategy,
                "new_url": page.url,
                "screenshot_b64": shot,
                "session_key": session_key,
            })
        except Exception as exc:
            try:
                _, page = await _get_or_create_page(self._browser, session_key)
                elements = await _extract_interactive_elements(page)
                msg = _format_click_failure_help(page.url, elements, selector, text_hint)
                return ToolResult(error=f"{exc}\n\n{msg}")
            except Exception:
                return ToolResult(error=f"Click failed: {exc}")


# ── Tool 5: browser_evaluate ──────────────────────────────────────────────────

class BrowserEvaluateTool(BaseTool):
    """Run JavaScript on the current browser page and return the result."""

    name = "browser_evaluate"
    description = (
        "Executes an arbitrary JavaScript expression in the context of the current browser page "
        "and returns the result. Use this to inspect DOM state, extract text, read form values, "
        "or call page-level JS APIs. Returns the JS result and a screenshot."
    )
    category = "testing"
    risk_level = "medium"
    parameters = [
        Param("script", "string", "JavaScript expression to evaluate (e.g. 'document.title' or 'window.location.href').", required=True),
        Param("session_key", "string", "Browser session to use.", required=False, default="default"),
    ]

    def __init__(self, browser: Any) -> None:
        self._browser = browser

    async def execute(self, **kwargs: Any) -> ToolResult:
        script: str = kwargs["script"]
        session_key: str = kwargs.get("session_key") or "default"

        if session_key not in _sessions:
            return ToolResult(error=f"No active browser session '{session_key}'. Use browser_navigate first.")

        try:
            _, page = await _get_or_create_page(self._browser, session_key)
            result = await page.evaluate(script)
            shot = await _screenshot_b64(page)
            return ToolResult(output={
                "result": result,
                "screenshot_b64": shot,
                "url": page.url,
                "session_key": session_key,
            })
        except Exception as exc:
            return ToolResult(error=f"Evaluate failed: {exc}")


# ── Tool 6: discover_platform ─────────────────────────────────────────────────

class DiscoverPlatformTool(BaseTool):
    """Log into a web platform and automatically discover all pages, forms, and API endpoints."""

    name = "discover_platform"
    description = (
        "Performs automated platform discovery by: "
        "(1) Navigating to the login URL, "
        "(2) Filling in the username and password fields, "
        "(3) Submitting the login form, "
        "(4) Crawling all navigation links, "
        "(5) Extracting all HTML forms and their action URLs, "
        "(6) Intercepting network requests to detect API endpoints. "
        "Returns a structured site map with navigation links, forms, detected API calls, "
        "and a screenshot of the dashboard after login. "
        "Use this as the first step when testing a platform with user credentials."
    )
    category = "testing"
    risk_level = "medium"
    parameters = [
        Param("url", "string", "URL of the login page (e.g. https://app.example.com/login).", required=True),
        Param("username", "string", "Login username or email.", required=True),
        Param("password", "string", "Login password.", required=True),
        Param("username_selector", "string", "CSS selector for the username field (default: auto-detect).", required=False, default=None),
        Param("password_selector", "string", "CSS selector for the password field (default: auto-detect).", required=False, default=None),
        Param("submit_selector", "string", "CSS selector for the login submit button (default: auto-detect).", required=False, default=None),
        Param("session_key", "string", "Session key for this browser session.", required=False, default="discover"),
    ]

    def __init__(self, browser: Any) -> None:
        self._browser = browser

    async def execute(self, **kwargs: Any) -> ToolResult:
        url: str = kwargs["url"].strip()
        username: str = kwargs["username"]
        password: str = kwargs["password"]
        username_sel: str | None = kwargs.get("username_selector")
        password_sel: str | None = kwargs.get("password_selector")
        submit_sel: str | None = kwargs.get("submit_selector")
        session_key: str = kwargs.get("session_key") or "discover"

        err = _validate_url(url)
        if err:
            return ToolResult(error=err)

        # Track all network API calls
        api_calls: list[str] = []

        try:
            context, page = await _get_or_create_page(self._browser, session_key)

            # Intercept XHR/fetch calls to detect API endpoints
            async def on_request(request: Any) -> None:
                req_url: str = request.url
                parsed = urlparse(req_url)
                path = parsed.path
                # Only record paths that look like API calls (contain /api/, /v1/, /graphql, etc.)
                if any(seg in path for seg in ("/api/", "/v1/", "/v2/", "/v3/", "/graphql", "/rest/", "/rpc")):
                    entry = f"{request.method} {req_url}"
                    if entry not in api_calls:
                        api_calls.append(entry)

            page.on("request", on_request)

            # Navigate to login page
            await page.goto(url, wait_until="load", timeout=30_000)
            login_screenshot = await _screenshot_b64(page)

            # Auto-detect common login field selectors if not provided
            if not username_sel:
                username_sel = await _auto_detect_selector(page, [
                    "input[type='email']",
                    "input[name='email']",
                    "input[name='username']",
                    "input[id*='email']",
                    "input[id*='user']",
                    "input[placeholder*='email' i]",
                    "input[placeholder*='username' i]",
                ])
            if not password_sel:
                password_sel = await _auto_detect_selector(page, [
                    "input[type='password']",
                    "input[name='password']",
                    "input[id*='pass']",
                ])
            if not submit_sel:
                submit_sel = await _auto_detect_selector(page, [
                    "button[type='submit']",
                    "input[type='submit']",
                    "button:has-text('Login')",
                    "button:has-text('Sign in')",
                    "button:has-text('Log in')",
                    "button:has-text('Continue')",
                ])

            if not username_sel:
                return ToolResult(error="Could not find a username/email input field. Please provide 'username_selector'.")
            if not password_sel:
                return ToolResult(error="Could not find a password input field. Please provide 'password_selector'.")
            if not submit_sel:
                return ToolResult(error="Could not find a submit button. Please provide 'submit_selector'.")

            # Fill login form
            await page.fill(username_sel, username, timeout=10_000)
            await page.fill(password_sel, password, timeout=10_000)

            # Submit and wait for navigation
            try:
                async with page.expect_navigation(timeout=20_000):
                    await page.click(submit_sel)
            except Exception:
                # Navigation may not trigger (SPA) — just wait
                await page.wait_for_timeout(3000)

            # ── Wait for SPA to fully render before taking the screenshot ──
            # 1. Wait for networkidle so all XHR/fetch settle
            try:
                await page.wait_for_load_state("networkidle", timeout=8_000)
            except Exception:
                pass  # SPAs with long-polling will timeout here — that's fine

            # 2. Extra settle time for React/Vue/Angular hydration
            await page.wait_for_timeout(2000)

            dashboard_url = page.url
            logged_in = dashboard_url != url and "login" not in dashboard_url.lower()
            dashboard_title = await page.title()
            dashboard_screenshot = await _screenshot_b64(page)

            # Crawl navigation links and visible controls (Vue router-links + Vuetify buttons)
            nav_links = await _extract_nav_links(page, url)
            interactive_elements = await _extract_interactive_elements(page)

            # Extract forms
            forms = await _extract_forms(page, url)

            # Give the page a moment to fire XHR calls
            await page.wait_for_timeout(2000)

            page.remove_listener("request", on_request)

            platform_hints = _innovito_lms_hints(dashboard_url, nav_links, interactive_elements)

            return ToolResult(output={
                "logged_in": logged_in,
                "login_url": url,
                "dashboard_url": dashboard_url,
                "dashboard_title": dashboard_title,
                "nav_links": nav_links[:40],  # cap at 40
                "interactive_elements": interactive_elements[:40],
                "forms": forms[:20],           # cap at 20
                "api_endpoints_detected": api_calls[:30],
                "platform_hints": platform_hints,
                "screenshot_b64": dashboard_screenshot,
                "login_screenshot_b64": login_screenshot,
                "session_key": session_key,
            })
        except Exception as exc:
            logger.exception("discover_platform failed")
            return ToolResult(error=f"Platform discovery failed: {exc}")


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _auto_detect_selector(page: Any, candidates: list[str]) -> str | None:
    """Return the first candidate CSS selector that matches a visible element on the page."""
    for sel in candidates:
        try:
            el = page.locator(sel).first
            if await el.count() > 0 and await el.is_visible(timeout=1000):
                return sel
        except Exception:
            continue
    return None


async def _extract_nav_links(page: Any, base_url: str) -> list[dict]:
    """Extract all <a> links from the page, resolve relative URLs."""
    try:
        links = await page.evaluate("""
            () => {
                const seen = new Set();
                return Array.from(document.querySelectorAll('a[href]'))
                    .map(a => ({ text: a.innerText.trim().slice(0, 80), href: a.href }))
                    .filter(l => l.href && !seen.has(l.href) && seen.add(l.href))
                    .slice(0, 60);
            }
        """)
        return links
    except Exception:
        return []


async def _extract_forms(page: Any, base_url: str) -> list[dict]:
    """Extract all <form> elements with their inputs."""
    try:
        forms = await page.evaluate("""
            () => Array.from(document.querySelectorAll('form')).map(f => ({
                action: f.action || '',
                method: f.method || 'GET',
                fields: Array.from(f.querySelectorAll('input, select, textarea'))
                    .map(i => ({ name: i.name, type: i.type, id: i.id }))
                    .filter(i => i.name || i.id)
            }))
        """)
        return forms
    except Exception:
        return []


def _innovito_lms_hints(
    dashboard_url: str,
    nav_links: list[dict],
    elements: list[dict],
) -> list[str]:
    """Generate actionable navigation hints for Innovito / Vue-Vuetify LMS platforms."""
    hints: list[str] = []

    # Course-related nav links
    course_links = [
        l for l in nav_links
        if "course" in l.get("text", "").lower() or "course" in l.get("href", "").lower()
    ]
    if course_links:
        hints.append(f"Courses section found at: {course_links[0].get('href', '')}")

    # Add/Create buttons on the current page
    add_btns = [
        e for e in elements
        if any(kw in e.get("text", "").lower() for kw in ("add", "create", "new course", "+ course"))
    ]
    if add_btns:
        el = add_btns[0]
        hints.append(
            f"Add/Create button on page: text={el.get('text')!r} tag={el.get('tag')} "
            f"— use browser_click with text={el.get('text')!r}"
        )

    hints.append(
        "TIP: Use browser_page_map after every navigation to discover exact button "
        "text and form field labels before clicking or filling."
    )
    hints.append(
        "TIP: For Vue/Vuetify LMS, prefer browser_click with text= over CSS selectors."
    )
    hints.append(
        "TIP: Before filling a form, call browser_page_map to see all input labels "
        "and their actual placeholder/label text."
    )
    return hints


# ── Tool 7: browser_page_map ─────────────────────────────────────────────────

class BrowserPageMapTool(BaseTool):
    """List every interactive element and form field visible on the current page."""

    name = "browser_page_map"
    description = (
        "Returns a structured map of the current page: all clickable elements "
        "(buttons, links, tabs, menu items) with their visible text and tag, "
        "PLUS all form inputs with their label, placeholder, name, id, and type. "
        "ALWAYS call this after navigating to a new page, and BEFORE using "
        "browser_click or browser_fill_form, so you know the exact selectors "
        "and text labels that exist. Especially critical for Vue/Vuetify apps "
        "where aria-labels differ from visual text."
    )
    category = "testing"
    risk_level = "low"
    parameters = [
        Param("session_key", "string", "Browser session to inspect.", required=False, default="default"),
    ]

    def __init__(self, browser: Any) -> None:
        self._browser = browser

    async def execute(self, **kwargs: Any) -> ToolResult:
        session_key: str = kwargs.get("session_key") or "default"

        if session_key not in _sessions:
            return ToolResult(error=f"No active browser session '{session_key}'. Use browser_navigate first.")

        try:
            _, page = await _get_or_create_page(self._browser, session_key)

            # Collect clickable elements
            clickables = await _extract_interactive_elements(page)

            # Collect all form inputs with full label context
            form_fields = await page.evaluate("""
                () => {
                    const visible = el => {
                        const r = el.getBoundingClientRect();
                        if (r.width < 2 || r.height < 2) return false;
                        const s = window.getComputedStyle(el);
                        return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
                    };
                    const getLabel = el => {
                        // 1. aria-label
                        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
                        // 2. <label for="id">
                        if (el.id) {
                            const lbl = document.querySelector('label[for="' + el.id + '"]');
                            if (lbl) return lbl.innerText.trim();
                        }
                        // 3. Wrapping <label>
                        const parent = el.closest('label');
                        if (parent) return parent.innerText.replace(el.value || '', '').trim();
                        // 4. Closest .v-label or .label sibling (Vuetify)
                        const row = el.closest('.v-input, .v-field, .v-text-field, .form-group, .field');
                        if (row) {
                            const lbl2 = row.querySelector('label, .v-label, legend');
                            if (lbl2) return lbl2.innerText.trim();
                        }
                        // 5. placeholder
                        return el.placeholder || el.name || el.id || '';
                    };
                    return Array.from(document.querySelectorAll('input, textarea, select'))
                        .filter(visible)
                        .map(el => ({
                            tag: el.tagName.toLowerCase(),
                            type: el.type || '',
                            label: getLabel(el),
                            placeholder: el.placeholder || '',
                            name: el.name || '',
                            id: el.id || '',
                            required: el.required,
                        }))
                        .filter(f => f.label || f.placeholder || f.name || f.id)
                        .slice(0, 40);
                }
            """)

            current_url = page.url
            title = await page.title()

            return ToolResult(output={
                "url": current_url,
                "title": title,
                "session_key": session_key,
                "clickable_elements": clickables[:50],
                "form_fields": form_fields,
                "usage_tip": (
                    "To click: use browser_click with text= matching 'text' field above. "
                    "To fill: use browser_fill_form with selector matching label/placeholder "
                    "e.g. [aria-label='<label>'] or get_by_label. "
                    "For Vuetify inputs without aria-label, use the 'label' text as the text= hint."
                ),
            })
        except Exception as exc:
            return ToolResult(error=f"Page map failed: {exc}")
