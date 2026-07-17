"""Native RAG — Qdrant + Ollama embeddings for the AIPiloty agent.

Phase 1 (2026-07-17): Cross-encoder reranker, query rewriter,
multi-query expansion, and HyDE added.
Phase 2 (2026-07-17): CRAG corrective retriever added.
"""

from .chunker import TextChunker
from .corrective import CorrectiveRetriever, RetrievalBundle
from .embeddings import EmbeddingService
from .ingest import IngestService
from .query_expander import HyDEExpander, QueryExpander
from .query_rewriter import QueryRewriter
from .reranker import Reranker
from .retriever import RetrieverService, RetrievalResult
from .vector_store import QdrantStore

__all__ = [
    "CorrectiveRetriever",
    "EmbeddingService",
    "HyDEExpander",
    "IngestService",
    "QdrantStore",
    "QueryExpander",
    "QueryRewriter",
    "RetrievalBundle",
    "RetrievalResult",
    "Reranker",
    "RetrieverService",
    "TextChunker",
]
