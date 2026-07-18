"""Semantic router (Phase C) — lexical prototypes + optional embedding refine.

Cascade:
  1. Keyword / exact routes (message_router) — primary
  2. Lexical prototype similarity — always available (CI-safe)
  3. Embedding cosine (nomic-embed) — when Ollama embeddings are up

Does not replace CONFIRMATION / Ask-mode forcing; only refines ambiguous
GENERAL_QA ↔ AGENT_TASK / CLARIFY decisions.
"""

from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Route label → prototype utterances
_PROTOTYPES: dict[str, list[str]] = {
    "smalltalk": [
        "hello",
        "hi there",
        "thanks a lot",
        "thank you",
        "goodbye",
        "good morning",
    ],
    "general_qa": [
        "who are you",
        "what is AIPiloty",
        "explain docker conceptually",
        "what is ssh used for in general",
        "how does blue green deployment work conceptually",
        "are you a robot",
        "what does recursion mean",
    ],
    "agent_task": [
        "list my ollama models",
        "ssh into the server and check disk",
        "deploy the frontend",
        "generate a pdf about taxes",
        "run docker ps on the host",
        "search the knowledge base for nginx",
        "write a file in the workspace",
    ],
    "clarify": [
        "help",
        "fix",
        "do it",
        "stuff",
        "something",
        "continue",
    ],
}


@dataclass(frozen=True)
class SemanticHit:
    label: str
    score: float
    method: str  # lexical | embedding


def _tokenize(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(t) > 1}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def lexical_match(message: str) -> SemanticHit:
    """Best prototype label via token Jaccard (no network)."""
    tokens = _tokenize(message)
    best_label = "general_qa"
    best_score = 0.0
    for label, protos in _PROTOTYPES.items():
        for p in protos:
            score = _jaccard(tokens, _tokenize(p))
            # Boost exact-ish containment
            pl = p.lower()
            ml = (message or "").lower()
            if pl in ml or ml in pl:
                score = max(score, 0.85)
            if score > best_score:
                best_score = score
                best_label = label
    return SemanticHit(label=best_label, score=round(best_score, 3), method="lexical")


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class SemanticRouter:
    """Optional embedding-backed refine on top of lexical prototypes."""

    def __init__(self) -> None:
        self._proto_vectors: dict[str, list[list[float]]] = {}
        self._ready = False

    async def ensure_prototypes(self, embedding_service) -> bool:
        if self._ready:
            return True
        if embedding_service is None:
            return False
        try:
            if not await embedding_service.is_available():
                return False
            for label, protos in _PROTOTYPES.items():
                vecs = []
                for p in protos:
                    vecs.append(await embedding_service.embed_one(p))
                self._proto_vectors[label] = vecs
            self._ready = True
            logger.info("SemanticRouter: embedded %d prototype labels", len(self._proto_vectors))
            return True
        except Exception as e:
            logger.debug("SemanticRouter prototype embed failed: %s", e)
            return False

    async def match(self, message: str, embedding_service=None) -> SemanticHit:
        lex = lexical_match(message)
        if embedding_service is None:
            return lex
        ok = await self.ensure_prototypes(embedding_service)
        if not ok:
            return lex
        try:
            q = await embedding_service.embed_one(message or "")
            best_label = lex.label
            best_score = 0.0
            for label, vecs in self._proto_vectors.items():
                for v in vecs:
                    score = _cosine(q, v)
                    if score > best_score:
                        best_score = score
                        best_label = label
            # Prefer embedding only when clearly stronger than weak lexical
            if best_score >= 0.55:
                return SemanticHit(label=best_label, score=round(best_score, 3), method="embedding")
        except Exception as e:
            logger.debug("SemanticRouter embed match failed: %s", e)
        return lex


# Process singleton
semantic_router = SemanticRouter()
