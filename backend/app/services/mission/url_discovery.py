"""Read-only public URL discovery from nginx (and similar) on a VM.

Never hardcodes tenant hostnames in git — only parses live server config.
"""

from __future__ import annotations

import re
from typing import Any


_UPSTREAM_RE = re.compile(
    r"upstream\s+(\S+)\s*\{[^}]*?server\s+(?:127\.0\.0\.1|localhost):(\d+)",
    re.I | re.S,
)
_SERVER_NAME_RE = re.compile(r"server_name\s+([^;]+);", re.I)
_PROXY_PASS_IP_RE = re.compile(
    r"proxy_pass\s+https?://(?:127\.0\.0\.1|localhost):(\d+)",
    re.I,
)
_PROXY_PASS_UP_RE = re.compile(r"proxy_pass\s+https?://([A-Za-z0-9_.-]+)\b", re.I)
_FASTCGI_UP_RE = re.compile(r"fastcgi_pass\s+([A-Za-z0-9_.-]+)\b", re.I)
_LISTEN_SSL_RE = re.compile(r"listen\s+[^\n;]*443", re.I)


def parse_nginx_port_to_urls(nginx_text: str) -> dict[str, str]:
    """Map host port (str) → preferred public https?://host/ URL."""
    upstream_port: dict[str, str] = {}
    for m in _UPSTREAM_RE.finditer(nginx_text or ""):
        upstream_port[m.group(1)] = m.group(2)

    # Split into rough server { } blocks
    blocks = re.split(r"(?=^\s*server\s*\{)", nginx_text or "", flags=re.M)
    port_to_urls: dict[str, list[str]] = {}

    for block in blocks:
        if "server_name" not in block:
            continue
        names = []
        for m in _SERVER_NAME_RE.finditer(block):
            for part in m.group(1).split():
                host = part.strip().lower()
                if host and host != "_":
                    names.append(host)
        if not names:
            continue
        # Prefer non-www primary
        primary = next((n for n in names if not n.startswith("www.")), names[0])
        scheme = "https" if _LISTEN_SSL_RE.search(block) else "http"
        url = f"{scheme}://{primary}/"

        ports: set[str] = set()
        for m in _PROXY_PASS_IP_RE.finditer(block):
            ports.add(m.group(1))
        for m in _PROXY_PASS_UP_RE.finditer(block):
            up = m.group(1)
            if up in upstream_port:
                ports.add(upstream_port[up])
        for m in _FASTCGI_UP_RE.finditer(block):
            up = m.group(1)
            if up in upstream_port:
                ports.add(upstream_port[up])

        for port in ports:
            port_to_urls.setdefault(port, [])
            if url not in port_to_urls[port]:
                # Prefer https entries first
                if scheme == "https":
                    port_to_urls[port].insert(0, url)
                else:
                    port_to_urls[port].append(url)

    return {p: urls[0] for p, urls in port_to_urls.items() if urls}


def host_port_from_docker_ports(ports_field: str) -> list[str]:
    """Extract published host ports from docker ps Ports column."""
    found: list[str] = []
    for m in re.finditer(r"(?:[\d.:\[\]]+)?:(\d+)->(\d+)", ports_field or ""):
        found.append(m.group(1))
    return found


def infer_urls_for_container(
    *,
    container_name: str,
    ports_field: str,
    port_to_url: dict[str, str],
) -> dict[str, Any]:
    """Pick public_url / api_url hints for one container from port map."""
    out: dict[str, Any] = {}
    host_ports = host_port_from_docker_ports(ports_field)
    urls = [port_to_url[p] for p in host_ports if p in port_to_url]
    if not urls:
        return out
    # Deduplicate preserving order
    seen: set[str] = set()
    uniq = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    primary = uniq[0]
    low = (container_name or "").lower()
    if any(x in low for x in ("backend", "laravel", "api", "php")):
        out["api_url"] = primary
        # Same-origin API sites often share the public URL
        out["public_url"] = primary
    elif any(x in low for x in ("soketi", "ws", "websocket")):
        out.setdefault("notes_url", primary)
    else:
        out["public_url"] = primary
    return out


def group_key_for_container(name: str) -> str:
    """Collapse frontend-/backend-/soketi- prefixes into a shared stack key."""
    n = (name or "").strip().lower()
    for prefix in (
        "frontend-",
        "frontend_",
        "backend-",
        "backend_",
        "fe-",
        "be-",
        "vue-app-",
        "soketi-",
        "nginx-",
    ):
        if n.startswith(prefix):
            return n[len(prefix) :]
    return n


def build_stack_groups(containers: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Group related FE/BE/soketi containers into one Mission stack when possible."""
    buckets: dict[str, list[dict[str, str]]] = {}
    for row in containers:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        key = group_key_for_container(name)
        buckets.setdefault(key, []).append(row)

    groups: list[dict[str, Any]] = []
    for key, rows in buckets.items():
        fe = None
        be = None
        other: list[dict[str, str]] = []
        for row in rows:
            n = (row.get("name") or "").lower()
            if any(x in n for x in ("frontend", "vue-app", "fe-")) and "backend" not in n:
                fe = row
            elif any(x in n for x in ("backend", "laravel", "api")):
                be = row
            else:
                other.append(row)

        # Only group when we have FE and/or BE sharing a slug; lone infra stays alone
        if fe or be:
            members = [r for r in [fe, be, *other] if r]
            pretty = key.replace("-", " ").replace("_", " ").title()
            groups.append(
                {
                    "key": key,
                    "name": pretty,
                    "frontend": fe,
                    "backend": be,
                    "others": other,
                    "members": members,
                }
            )
        else:
            for row in rows:
                cname = row.get("name") or ""
                groups.append(
                    {
                        "key": cname,
                        "name": cname.replace("-", " ").replace("_", " ").title(),
                        "frontend": None,
                        "backend": None,
                        "others": [row],
                        "members": [row],
                        "solo": True,
                    }
                )
    return groups
