"""Entity extractor — NER for Knowledge Graph construction.

Extracts named entities and their relationships from chunk text using two
strategies in order of preference:

1. **LLM extraction** (preferred): calls the local Ollama model with a focused
   prompt that returns JSON.  Accurate but adds ~200–400 ms per chunk.

2. **Regex fallback** (fast): pattern-matching for common tech entities
   (tools, services, file paths, ports, docker images, etc.).  Always runs
   when the LLM fails or produces malformed output.

The two strategies are merged and deduplicated so that regex catches what the
LLM misses for common tech terms, while the LLM catches semantic entities
(concepts, roles, error names) that regex cannot.

LazyGraphRAG key: extraction is **deferred to ingest time** — not query time —
so there is zero extra latency per user request.  Each chunk gets its entity
list stored alongside the vector payload in Qdrant, enabling fast graph-aware
expansion at retrieval time.

Reference: Microsoft LazyGraphRAG (Jan 2025) — lazy KG, O(0.1%) of full GraphRAG.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Entity types ──────────────────────────────────────────────────────────
ENTITY_TYPES = frozenset({
    "service",    # web servers, databases, message queues
    "tool",       # CLI tools, frameworks, libraries
    "concept",    # architectural concepts, patterns
    "host",       # servers, IP addresses, domains
    "file",       # config files, scripts, paths
    "error",      # error codes, exception types
    "person",     # people mentioned in docs
    "org",        # companies, teams
    "version",    # version numbers, semver strings
    "other",      # catch-all
})

# ── LLM prompt ───────────────────────────────────────────────────────────
_EXTRACT_SYSTEM = (
    "You are a technical knowledge graph builder. "
    "Extract named entities and relationships from technical documentation. "
    "Output ONLY valid JSON — no explanations, no markdown fences."
)

_EXTRACT_PROMPT = """\
Extract entities and relationships from the technical text below.

Respond with ONLY this JSON structure (no extra keys, no prose):
{{
  "entities": [
    {{"name": "<entity name>", "type": "<{types}>", "aliases": []}}
  ],
  "relations": [
    {{"from": "<entity1>", "relation": "<verb phrase>", "to": "<entity2>"}}
  ]
}}

Rules:
- Max 10 entities, max 8 relations per chunk
- Entity names: short, specific, Title Case for proper nouns
- Prefer specific types: Docker=service, Nginx=service, Python=tool, /etc/nginx=file
- Omit entities with fewer than 2 characters
- Only extract relations you are confident about

Text (first 800 chars):
{text}""".format(
    types="|".join(sorted(ENTITY_TYPES)),
    text="{text}",
)

# ── Regex patterns for common tech entities (fallback) ────────────────────
_TECH_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Services / servers
    (re.compile(r"\b(nginx|apache|haproxy|traefik|caddy|envoy)\b", re.I), "service"),
    (re.compile(r"\b(postgres|postgresql|mysql|mariadb|mongodb|redis|elasticsearch|kafka|rabbitmq)\b", re.I), "service"),
    (re.compile(r"\b(docker|kubernetes|k8s|helm|podman|containerd)\b", re.I), "service"),
    # Tools / languages / frameworks
    (re.compile(r"\b(python|javascript|typescript|golang|rust|java|php|ruby)\b", re.I), "tool"),
    (re.compile(r"\b(fastapi|django|flask|express|nextjs|react|vue|angular)\b", re.I), "tool"),
    (re.compile(r"\b(git|ansible|terraform|puppet|chef|jenkins|github.?actions|gitlab.?ci)\b", re.I), "tool"),
    # File paths
    (re.compile(r"(/etc/[\w./\-]+|/var/[\w./\-]+|/opt/[\w./\-]+|/home/[\w./\-]+)", re.I), "file"),
    (re.compile(r"\b[\w.-]+\.(conf|cfg|yaml|yml|json|toml|env|sh|py|js|ts)\b", re.I), "file"),
    # Ports
    (re.compile(r"\bport\s+(\d{2,5})\b|\b:(\d{2,5})\b", re.I), "service"),
    # Error codes / HTTP status
    (re.compile(r"\b(4\d{2}|5\d{2})\s+(?:error|status|code)\b|\b(?:HTTP|error)\s+(4\d{2}|5\d{2})\b", re.I), "error"),
    (re.compile(r"\b(?:Exception|Error|Timeout|Refused|Forbidden|Unauthorized):?\s+[\w.]+", re.I), "error"),
    # Version strings
    (re.compile(r"\bv?(\d+\.\d+(?:\.\d+)?(?:-\w+)?)\b"), "version"),
]


@dataclass
class ExtractedEntity:
    """A single entity extracted from text."""
    name: str
    type: str
    aliases: List[str] = field(default_factory=list)

    def __post_init__(self):
        self.name = self.name.strip()[:100]
        self.type = self.type if self.type in ENTITY_TYPES else "other"


@dataclass
class ExtractedRelation:
    """A directed relation between two entities."""
    from_entity: str
    relation: str
    to_entity: str


@dataclass
class ExtractionResult:
    """Full extraction output for one chunk."""
    entities: List[ExtractedEntity]
    relations: List[ExtractedRelation]
    via_llm: bool = False    # True if LLM extraction succeeded


class EntityExtractor:
    """Extract entities from chunk text using LLM + regex fallback.

    Args:
        llm: Optional OllamaService.  When None, only regex extraction runs.
    """

    def __init__(self, llm: Optional[Any] = None) -> None:
        self._llm = llm

    async def extract(self, text: str, source_path: str = "") -> ExtractionResult:
        """Extract entities and relations from text.

        Args:
            text:        Chunk content (first 800 chars used).
            source_path: Source file path for context (not used in extraction).

        Returns:
            ExtractionResult with merged LLM + regex entities.
        """
        if not text.strip():
            return ExtractionResult(entities=[], relations=[])

        truncated = text.strip()[:800]
        llm_result: Optional[ExtractionResult] = None
        via_llm = False

        # ── Strategy 1: LLM extraction ────────────────────────────────────
        if self._llm is not None:
            try:
                import asyncio
                raw = await asyncio.wait_for(
                    self._llm.generate(
                        _EXTRACT_PROMPT.format(text=truncated),
                        system=_EXTRACT_SYSTEM,
                    ),
                    timeout=15.0,
                )
                llm_result = self._parse_llm_output(raw)
                if llm_result and llm_result.entities:
                    via_llm = True
            except Exception as exc:
                logger.debug("Entity LLM extraction failed (%s) — using regex only", exc)

        # ── Strategy 2: Regex extraction (always runs) ─────────────────────
        regex_entities = self._regex_extract(truncated)

        # ── Merge: LLM primary, regex fills gaps ──────────────────────────
        if llm_result:
            # Add regex entities not already captured by LLM
            llm_names_lower = {e.name.lower() for e in llm_result.entities}
            for re_ent in regex_entities:
                if re_ent.name.lower() not in llm_names_lower:
                    llm_result.entities.append(re_ent)
            return ExtractionResult(
                entities=llm_result.entities[:12],
                relations=llm_result.relations[:10],
                via_llm=via_llm,
            )

        return ExtractionResult(
            entities=regex_entities[:12],
            relations=[],
            via_llm=False,
        )

    # ── Parsers ───────────────────────────────────────────────────────────

    def _parse_llm_output(self, raw: str) -> Optional[ExtractionResult]:
        """Parse LLM JSON output into ExtractionResult."""
        raw = raw.strip()
        # Strip markdown fences
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip("`").strip()
        # Find first { ... }
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None

        entities = []
        for e in (data.get("entities") or []):
            if not isinstance(e, dict) or not e.get("name"):
                continue
            entities.append(ExtractedEntity(
                name=str(e["name"]),
                type=str(e.get("type", "other")),
                aliases=[str(a) for a in (e.get("aliases") or [])],
            ))

        relations = []
        for r in (data.get("relations") or []):
            if not isinstance(r, dict):
                continue
            f = str(r.get("from", "") or "").strip()
            rel = str(r.get("relation", "") or "").strip()
            t = str(r.get("to", "") or "").strip()
            if f and t and rel:
                relations.append(ExtractedRelation(from_entity=f, relation=rel, to_entity=t))

        return ExtractionResult(entities=entities, relations=relations, via_llm=True)

    def _regex_extract(self, text: str) -> List[ExtractedEntity]:
        """Extract tech entities via regex patterns."""
        found: Dict[str, str] = {}  # name → type

        for pattern, etype in _TECH_PATTERNS:
            for m in pattern.finditer(text):
                # Prefer the first capturing group if present, else full match
                name = next((g for g in m.groups() if g), m.group(0)).strip()
                if len(name) < 2:
                    continue
                # Normalise: lowercase services/tools, keep paths as-is
                if etype in ("service", "tool"):
                    name = name.lower()
                key = name.lower()
                if key not in found:
                    found[key] = etype

        return [ExtractedEntity(name=name, type=etype) for name, etype in found.items()]
