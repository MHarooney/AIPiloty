"""Dynamic Mission catalog — DB + discovery, never tenant topology in git.

Public repos must not ship customer/tenant inventories. The source of truth is:
1. Missions already saved in AIPiloty DB
2. Optional read-only discovery from registered VMs (docker ps)
3. Hints from the user query (URL / name tokens) persisted on first ensure

No hardcoded hosts, URLs, or container names live here.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models.deployment import Deployment


_URL_RE = re.compile(r"https?://[^\s]+", re.I)
_SLUG_RE = re.compile(r"[a-z0-9][a-z0-9._-]{1,64}", re.I)


def _tokens(query: str) -> list[str]:
    q = (query or "").strip().lower()
    if not q:
        return []
    urls = _URL_RE.findall(q)
    parts = re.split(r"[\s,/|]+", q)
    out: list[str] = []
    for p in parts:
        p = p.strip(".,;:()[]{}\"'")
        if len(p) >= 2:
            out.append(p)
    for u in urls:
        out.append(u.lower().rstrip("/"))
        host = urlparse(u).hostname or ""
        if host:
            out.append(host.lower())
            # example.com → example (first label)
            out.append(host.split(".")[0].lower())
    # dedupe
    seen: set[str] = set()
    uniq: list[str] = []
    for t in out:
        if t not in seen:
            seen.add(t)
            uniq.append(t)
    return uniq


def extract_url(query: str | None) -> Optional[str]:
    if not query:
        return None
    m = _URL_RE.search(query)
    if not m:
        return None
    return m.group(0).rstrip("/") + "/"


def mission_search_blob(dep: Deployment) -> str:
    """Flat string used for token matching against a saved Mission."""
    meta = {}
    if dep.mission_meta:
        try:
            meta = json.loads(dep.mission_meta) or {}
        except Exception:
            meta = {}
    bits = [
        dep.name or "",
        dep.project_name or "",
        dep.environment or "",
        dep.public_url or "",
        dep.api_url or "",
        dep.container_name or "",
        dep.backend_container or "",
        dep.dockerhub_image or "",
        dep.branch or "",
        str(meta.get("notes") or ""),
    ]
    return " ".join(bits).lower()


async def catalog_from_db(db: AsyncSession) -> list[Deployment]:
    result = await db.execute(select(Deployment).order_by(Deployment.id.asc()))
    return list(result.scalars().all())


async def catalog_summary(db: AsyncSession) -> list[dict[str, Any]]:
    deps = await catalog_from_db(db)
    return [
        {
            "id": d.id,
            "name": d.name,
            "project_name": d.project_name,
            "public_url": d.public_url or "",
            "pipeline_profile": d.pipeline_profile or "",
            "container_name": d.container_name or "",
            "backend_container": d.backend_container or "",
            "source": "database",
        }
        for d in deps
    ]


async def match_missions_in_db(
    db: AsyncSession,
    query: str | None,
    *,
    seed_all: bool = False,
) -> list[Deployment]:
    """Return already-saved Missions that match the query (or all if seed_all)."""
    deps = await catalog_from_db(db)
    if seed_all or not (query or "").strip():
        return deps
    tokens = _tokens(query or "")
    if not tokens:
        return deps
    hits: list[Deployment] = []
    for d in deps:
        blob = mission_search_blob(d)
        if any(t in blob for t in tokens):
            hits.append(d)
    return hits


def candidate_from_query(query: str | None) -> Optional[dict[str, Any]]:
    """Build a minimal Mission candidate from user text alone (no git hardcoding).

    Persisted only when ensure decides to create. Safe defaults: inspect_only.
    """
    q = (query or "").strip()
    if not q:
        return None
    url = extract_url(q)
    tokens = [t for t in _tokens(q) if not t.startswith("http") and "." not in t or t.count(".") == 0]
    # Prefer a slug-like token
    slug = None
    for t in _tokens(q):
        if t.startswith("http"):
            continue
        hostish = t.split(".")[0] if "." in t else t
        if _SLUG_RE.fullmatch(hostish) and hostish not in {"www", "com", "net", "org", "https", "http"}:
            slug = hostish
            break
    if not slug and url:
        host = urlparse(url).hostname or ""
        slug = host.split(".")[0] if host else None
    if not slug and not url:
        return None

    name = (slug or "mission").replace("-", " ").title()
    if url and "lms" in (slug or "").lower():
        name = f"{name} (Mission Control)"

    return {
        "id": slug or "query",
        "source": "query",
        "fields": {
            "name": name if not url else f"{name}",
            "project_name": slug or "mission",
            "environment": "test" if slug and "test" in slug else "production",
            "public_url": url,
            "api_url": None,
            "pipeline_profile": "inspect_only",
            "branch": "main",
        },
        "match_tokens": tokens,
    }


def _relevance(row: dict[str, str], tokens: list[str], slug: str) -> int:
    """Score how well a docker row matches the user ask (name + image)."""
    name = (row.get("name") or "").lower()
    img = (row.get("image") or "").lower()
    blob = f"{name} {img}"
    score = 0
    if slug and len(slug) >= 3 and slug in blob:
        score += 10
    for t in tokens:
        if len(t) < 3:
            continue
        if t in blob:
            score += 5
        for part in t.split("-"):
            if len(part) >= 4 and part in blob:
                score += 1
    return score


def merge_discovery_into_candidate(
    candidate: dict[str, Any],
    *,
    containers: list[dict[str, str]],
    vm_host: str | None = None,
) -> dict[str, Any]:
    """Enrich a query candidate with read-only docker discovery facts."""
    fields = dict(candidate.get("fields") or {})
    tokens = [t.lower() for t in (candidate.get("match_tokens") or [])]
    slug = (fields.get("project_name") or "").lower()
    if slug and slug not in tokens:
        tokens.append(slug)

    scored = [( _relevance(row, tokens, slug), row) for row in containers]
    scored = [(s, r) for s, r in scored if s > 0]
    scored.sort(key=lambda x: x[0], reverse=True)

    fe = None
    be = None
    image = None
    ports = None
    for _score, row in scored:
        name = (row.get("name") or "").lower()
        img = row.get("image") or ""
        if any(x in name for x in ("frontend", "vue", "fe-")) and not fe:
            fe = row.get("name")
            image = img or image
            ports = row.get("ports") or ports
        if any(x in name for x in ("backend", "laravel", "api", "be-")) and not be:
            be = row.get("name")

    if fe:
        fields["container_name"] = fe
    if be:
        fields["backend_container"] = be
    if image and "/" in image:
        if ":" in image:
            repo, tag = image.rsplit(":", 1)
            fields["dockerhub_image"] = repo
            fields["dockerhub_tag"] = tag
            fields.setdefault("docker_image", repo)
        else:
            fields["dockerhub_image"] = image
    if ports:
        m = re.search(r":(\d+)->(\d+)", ports)
        if m:
            fields["port_mapping"] = f"{m.group(1)}:{m.group(2)}"

    out = dict(candidate)
    out["fields"] = fields
    out["source"] = "discovery" if (fe or be) else candidate.get("source")
    if vm_host:
        out["vm_host_hint"] = vm_host
    out["meta"] = {
        "notes": "Registered from live discovery / user query — not from git catalog.",
        "discovered_containers": [c.get("name") for c in containers if c.get("name")],
        "matched_containers": [r.get("name") for _, r in scored[:8]],
    }
    return out


def parse_docker_ps(stdout: str) -> list[dict[str, str]]:
    """Parse `docker ps` TSV: name, status, image, ports."""
    rows: list[dict[str, str]] = []
    for line in (stdout or "").splitlines():
        parts = line.split("\t")
        if not parts or not parts[0].strip():
            continue
        rows.append(
            {
                "name": parts[0].strip(),
                "status": parts[1].strip() if len(parts) > 1 else "",
                "image": parts[2].strip() if len(parts) > 2 else "",
                "ports": parts[3].strip() if len(parts) > 3 else "",
            }
        )
    return rows
