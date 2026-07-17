# AIPiloty — Deep AI & RAG Enhancement Research
> Full architecture audit + fused three-paradigm roadmap (Classic → Graph → Agentic RAG)
> Hardware: Apple M2, 24 GB unified, macOS 26.1, Ollama 0.18.3
> Date: 2026-07-17

---

## Executive Summary

AIPiloty already has a **solid RAG foundation**: Qdrant + `nomic-embed-text` embeddings, RRF-fused hybrid search (vector + keyword), heading-aware chunking, a ReAct-style agent loop with 40+ tools, and SSE streaming. The system is **production-hardened** (29 tests, audit logging, PII redaction, guardrails).

However, it only covers **Classic RAG** — the left pillar of the attached image. The **Graph RAG** and **Agentic RAG** pillars are entirely absent. This document maps every gap, explains the science, and gives a **concrete phased roadmap** with exact files to create/modify.

The three-paradigm fusion is:

```
Classic RAG   →   high recall, fast retrieval
    +
Graph RAG     →   entity relationships, "why" context, reasoning chains
    +
Agentic RAG   →   self-correction, multi-hop, tool-augmented retrieval, evaluaton
    =
Professional-grade RAG that can answer like Claude on your own knowledge
```

---

## 1. Current State Audit

### 1.1 What's Already Built (Strong)

| Component | File | Quality |
|-----------|------|---------|
| Qdrant vector store | `rag/vector_store.py` | ✅ Production-ready, lazy-init race fixed |
| Ollama embeddings (nomic-embed-text, 768d) | `rag/embeddings.py` | ✅ Batch 32, error handling |
| Heading-aware Markdown chunker + sliding window | `rag/chunker.py` | ✅ Good |
| Hybrid search (vector + keyword via RRF) | `rag/retriever.py` | ✅ RRF-60, fallback on failure |
| Hash-cached incremental ingest | `rag/ingest.py` | ✅ SHA-256, disk-persisted |
| `kb_search` tool in agent | `tools/knowledge_search.py` | ✅ Registered, citations |
| ReAct multi-turn agent loop | `agent/orchestrator.py` | ✅ 15 max iterations, 300s budget |
| File-backed agent memory | `agent/memory.py` | ✅ JSON, asyncio.Lock |
| Rule-based intent classifier | `agent/intent_classifier.py` | ⚠️ Pattern regex, no ML |
| Guardrails (commands, PII, SSRF) | `agent/guardrails.py` | ✅ Good |
| MCP protocol integration | `services/mcp/` | ✅ Present |

### 1.2 Critical Gaps (The Three Pillars)

#### Classic RAG Gaps (Retrieval Quality)
- ❌ No **HyDE** (Hypothetical Document Embeddings) — query expansion before embedding
- ❌ No **multi-query expansion** — single embedding misses lexical variants
- ❌ No **cross-encoder reranker** — cosine similarity ≠ relevance; BGE-reranker-v2 is free
- ❌ No **contextual compression** — top-k chunks may be noisy; need summarize-then-retrieve
- ❌ No **RAPTOR** (recursive abstractive summaries for hierarchical retrieval)
- ❌ No **late-chunking / token-level retrieval** (ColBERT/PLAID approach)
- ❌ Chunk metadata sparse (no tags, timestamps, entity mentions, access counts per chunk)
- ❌ No **query routing** — all queries go to same collection

#### Graph RAG Gaps (Relationship & Reasoning)
- ❌ No entity extraction pipeline (no NER on ingested docs)
- ❌ No knowledge graph (no nodes, edges, community detection)
- ❌ No relationship-aware retrieval (can't answer "who worked with X on Y")
- ❌ No Microsoft LazyGraphRAG pattern (builds graph lazily on query, 99% cheaper than full)

#### Agentic RAG Gaps (Self-Correction & Evaluation)
- ❌ No **CRAG** (Corrective RAG) — no relevance assessment → web fallback loop
- ❌ No **Self-RAG** — LLM doesn't decide when to retrieve vs answer from memory
- ❌ No **self-evaluation step** — LLM outputs unchecked for factual grounding
- ❌ No **RAGAS-style metrics** (faithfulness, answer relevancy, context precision)
- ❌ No **multi-hop reasoning** — can't chain "find A → use A to find B → use B to answer"
- ❌ No **conversation-aware query rewriting** — in multi-turn, stale queries degrade retrieval
- ❌ Memory is file JSON — not semantically searchable, no episodic vector index

---

## 2. The Three-Paradigm Deep Dive

### 2.1 Classic RAG — Upgrade Path

#### 2.1.1 HyDE — Hypothetical Document Embeddings

**Science:** Instead of embedding the raw user query (which is short and lexically sparse), ask the LLM to generate a *hypothetical* ideal answer document, then embed *that*. The synthetic answer lives in the same embedding space as real document chunks. Improves recall by 15-30% on knowledge-intensive tasks (Gao et al., 2022).

**Implementation in AIPiloty:**
```python
# NEW: rag/hyde.py
class HyDEExpander:
    async def expand(self, query: str, llm: OllamaService) -> str:
        """Generate a hypothetical answer to the query for richer embedding."""
        prompt = f"""Generate a short paragraph (3-5 sentences) that would be the ideal 
answer to the following question, using precise technical language:

Question: {query}

Write only the answer paragraph, no preamble:"""
        hyp = await llm.generate(prompt, max_tokens=200, temperature=0.1)
        return f"{query}\n\n{hyp}"  # fuse original + hypothetical
```

**Wire into:** `retriever.py` `search()` method — call expander before `embed_one()`.

---

#### 2.1.2 Multi-Query Expansion

**Science:** A single query phrasing misses documents indexed under synonyms or different linguistic frames. Generate 3-5 alternative phrasings → run parallel searches → deduplicate via RRF. Popularized by LangChain's MultiQueryRetriever; confirmed by Ragas benchmarks.

```python
# NEW: rag/query_expander.py
class QueryExpander:
    _PROMPT = """Generate {n} alternative phrasings of this question for document retrieval.
Output one per line, no numbering:
Question: {q}"""

    async def expand(self, query: str, n: int = 3) -> list[str]:
        raw = await self._llm.generate(self._PROMPT.format(n=n, q=query), max_tokens=150)
        variants = [l.strip() for l in raw.splitlines() if l.strip()]
        return [query] + variants[:n]
```

**Result:** `_hybrid_search()` in retriever runs `len(variants)` parallel searches and fuses all via RRF.

---

#### 2.1.3 Cross-Encoder Reranker (The Biggest Bang)

**Science:** Bi-encoder (query vs chunk, separately embedded) is fast but inaccurate. Cross-encoder (query + chunk input together) is accurate but slow. The pro pattern: retrieve top-20 with bi-encoder, rerank with cross-encoder, keep top-5. Typical improvement: +8-15 NDCG@5.

**Best free option for M2 Mac:** `BAAI/bge-reranker-v2-m3` via Ollama or `cross-encoder/ms-marco-MiniLM-L-6-v2` via sentence-transformers.

```python
# NEW: rag/reranker.py
from sentence_transformers import CrossEncoder

class BGEReranker:
    def __init__(self):
        # ~90MB on disk, fast on M2 CPU
        self._model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

    def rerank(self, query: str, results: list[RetrievalResult], top_k: int = 5) -> list[RetrievalResult]:
        pairs = [(query, r.content) for r in results]
        scores = self._model.predict(pairs)
        ranked = sorted(zip(scores, results), key=lambda x: x[0], reverse=True)
        return [r for _, r in ranked[:top_k]]
```

**Wire into:** `RetrieverService.search()` — retrieve top-20, rerank to top-5 before returning.

**M2 impact:** 90MB model, ~30ms per 20 pairs on CPU — negligible.

---

#### 2.1.4 RAPTOR — Recursive Summarization Tree

**Science:** "Recursive Abstractive Processing for Tree-Organized Retrieval" (Sarthi et al., 2024). Build a tree of summaries over clusters of chunks. Enables retrieval at multiple abstraction levels — specific facts AND broad themes. Best for long document sets.

```
Level 0: raw chunks (dense)
Level 1: paragraph summaries (1 per 5 chunks)
Level 2: section summaries (1 per 5 L1)
Level 3: document summary (1 per document)
```

**Implementation approach for AIPiloty:**
- Add `tree_level` metadata field to chunks in Qdrant
- During ingest: after chunking, run async summarization passes, store each level as new chunks
- At retrieval time: use a `level` filter based on query complexity (simple → L0, broad → L2/L3)

**Complexity:** Medium. Store all tree nodes in same Qdrant collection with `tree_level` payload filter.

---

#### 2.1.5 Contextual Chunk Headers

**Science:** A chunk saying "The default port is 8080" has no context. A chunk with "FastAPI config → server settings — The default port is 8080" has full context. Anthropic's "Contextual Retrieval" (2024) prepends a generated context sentence per chunk. Improves retrieval by 35-49%.

```python
# In chunker.py, add contextualization step:
async def _contextualize_chunk(self, doc_title: str, chunk: Chunk, llm) -> Chunk:
    prompt = f"""Document: {doc_title}
Chunk: {chunk.content[:500]}

Write ONE sentence giving this chunk context within the document:"""
    ctx = await llm.generate(prompt, max_tokens=60)
    return Chunk(content=f"{ctx}\n\n{chunk.content}", ...)
```

---

### 2.2 Graph RAG — The Relationship Layer

The image shows **Microsoft's GraphRAG (2024)** and **LazyGraphRAG (2025)**, which cuts cost by 99% (graph built lazily on queries, not upfront). This is the most transformative upgrade path.

#### Why Graph RAG Matters

Classic RAG retrieves *what*. Graph RAG can answer *why*, *how they relate*, and *what patterns connect X and Y*. For AIPiloty's DevOps use case:
- "What services depend on the authentication module?" → requires relationship graph
- "What changed between deploy X and deploy Y that caused this error?" → requires temporal graph
- "Which runbooks fix errors similar to this stack trace?" → requires semantic entity graph

#### 2.2.1 LazyGraphRAG Architecture (Microsoft, Jan 2025)

**Key insight:** Don't build the full KG upfront (expensive). Instead:
1. During ingest: extract entities + relations per chunk → store as node metadata (cheap)
2. At query time: extract entities from query → find matching chunks → traverse local graph around those entities → assemble "connected context"
3. Only build full community summaries if query needs it

**Cost:** 0.1% of full GraphRAG (Microsoft's claim). On local Ollama: nearly free.

```
NEW FILES to create:
  rag/graph/
    __init__.py
    entity_extractor.py    ← NER on chunks at ingest time
    graph_store.py         ← SQLite graph (nodes + edges tables)
    graph_retriever.py     ← entity-aware search + neighborhood expansion
    community_detector.py  ← Louvain clustering for community summaries (lazy)
```

#### 2.2.2 Entity Extraction Pipeline

```python
# rag/graph/entity_extractor.py
class EntityExtractor:
    """Extract entities and relationships from text using Ollama (no external API)."""

    _PROMPT = """Extract all named entities and relationships from this text.
Output JSON only:
{
  "entities": [{"name": "...", "type": "person|org|tool|concept|file|host|service", "mentions": ["..."]}],
  "relations": [{"from": "entity1", "relation": "verb phrase", "to": "entity2"}]
}

Text: {text}"""

    async def extract(self, text: str) -> dict:
        raw = await self._llm.generate(self._PROMPT.format(text=text[:2000]))
        return json.loads(raw)  # with fallback to empty
```

#### 2.2.3 Graph Store (SQLite, Zero Dependencies)

```python
# rag/graph/graph_store.py
# Minimal KG on top of existing SQLite — no new service needed

CREATE TABLE kg_nodes (
    id TEXT PRIMARY KEY,        -- normalized entity name
    type TEXT,                  -- person|org|tool|concept|...
    chunk_ids JSON,             -- which chunks mention this entity
    properties JSON,
    created_at TIMESTAMP
);

CREATE TABLE kg_edges (
    id TEXT PRIMARY KEY,
    from_node TEXT REFERENCES kg_nodes(id),
    to_node TEXT REFERENCES kg_nodes(id),
    relation TEXT,              -- "depends_on", "deployed_on", "caused_by"
    chunk_id TEXT,              -- evidence chunk
    weight REAL DEFAULT 1.0,
    created_at TIMESTAMP
);
```

**No new Docker service** — runs on top of existing SQLite. Option to migrate to Neo4j or Memgraph later.

#### 2.2.4 Graph-Enhanced Retrieval (LazyGraphRAG Pattern)

```python
# rag/graph/graph_retriever.py
class GraphRetriever:
    async def search(self, query: str, top_k: int = 5) -> list[RetrievalResult]:
        # Step 1: Extract query entities
        query_entities = await self._extractor.extract(query)
        
        # Step 2: Find matching nodes + their chunk_ids
        seed_chunks = self._store.find_chunks_for_entities(query_entities["entities"])
        
        # Step 3: Expand 1-hop neighborhood (related chunks via edges)
        expanded_chunks = self._store.expand_neighborhood(seed_chunks, hops=1)
        
        # Step 4: Re-embed + score expanded set
        return await self._vector_retriever.search_by_ids(expanded_chunks, query, top_k)
```

**Fusion:** In `RetrieverService._hybrid_search()`, add a third lane:
```python
graph_task = asyncio.create_task(self._graph_retriever.search(query, top_k))
vector_task = ...
keyword_task = ...
# Triple RRF fusion
```

---

### 2.3 Agentic RAG — The Self-Correction Layer

The right pillar of the image: the **Reasoning Agent** loops back through **Vector DB + Knowledge Graph + Tools**, then runs **Self-Evaluation** before emitting the final answer.

#### 2.3.1 Corrective RAG (CRAG)

**Science (Shi et al., 2024):** After retrieval, score each chunk's relevance to the query. If relevance < threshold → trigger a web search fallback. Three states: correct → use directly; incorrect → discard, use web; ambiguous → blend both.

```python
# rag/corrective.py
class CorrectiveRAG:
    RELEVANCE_THRESHOLD = 0.5  # score from 0.0-1.0

    async def assess_and_correct(
        self, query: str, chunks: list[RetrievalResult]
    ) -> list[RetrievalResult]:
        scored = await self._score_relevance(query, chunks)
        
        correct = [c for c, s in scored if s >= self.RELEVANCE_THRESHOLD]
        incorrect = [c for c, s in scored if s < 0.3]
        ambiguous = [c for c, s in scored if 0.3 <= s < self.RELEVANCE_THRESHOLD]
        
        if not correct and not ambiguous:
            # Full fallback: web search
            web_results = await self._web_search_fallback(query)
            return web_results
        
        return correct + ambiguous  # blend

    async def _score_relevance(self, query: str, chunks) -> list[tuple]:
        # Use cross-encoder scores (reranker scores ≈ relevance)
        pairs = [(query, c.content) for c in chunks]
        scores = self._reranker.predict_scores(pairs)
        return list(zip(chunks, scores))
```

#### 2.3.2 Self-RAG — Retrieval-on-Demand

**Science (Asai et al., 2023):** The LLM learns to decide *when* to retrieve. Instead of always retrieving, emit a special `[Retrieve]` token when needed. For AIPiloty, simulate this via **intent-gated retrieval**:

- Factual questions → always retrieve
- Conversational acknowledgments → skip retrieval
- Code generation → retrieve relevant code snippets first
- Reasoning chains → multi-hop retrieve

```python
# Enhanced intent_classifier.py
class IntentClassifier:
    def classify(self, message: str) -> Intent:
        ...

    def needs_retrieval(self, message: str, intent: Intent) -> bool:
        """Decide if RAG retrieval is needed before calling LLM."""
        skip_categories = {"general", "greeting", "conversational"}
        high_recall_categories = {"knowledge", "vm", "deployment", "planning"}
        
        if intent.category in skip_categories and intent.confidence > 0.8:
            return False  # Skip RAG for clear conversational messages
        if intent.category in high_recall_categories:
            return True
        return intent.confidence < 0.6  # Uncertain → retrieve to ground
```

#### 2.3.3 Conversation-Aware Query Rewriting

**Science:** In a multi-turn chat, the user says "Can you fix that?" — "that" refers to context from 3 messages ago. Sending "Can you fix that?" to the embedding model returns garbage. Rewrite the query with full context first.

```python
# rag/query_rewriter.py
class ConversationalQueryRewriter:
    _PROMPT = """Given the conversation history below, rewrite the LAST user message as a 
standalone, self-contained search query that includes all necessary context.

History:
{history}

Last message: {query}

Rewritten query (one sentence, no preamble):"""

    async def rewrite(self, query: str, history: list[dict]) -> str:
        if not history or self._is_standalone(query):
            return query
        recent = history[-6:]  # last 3 turns
        formatted = "\n".join(f"{m['role']}: {m['content'][:200]}" for m in recent)
        return await self._llm.generate(
            self._PROMPT.format(history=formatted, query=query), max_tokens=100
        )

    def _is_standalone(self, query: str) -> bool:
        pronouns = {"it", "that", "this", "they", "those", "them", "there"}
        words = set(query.lower().split())
        return len(words & pronouns) == 0
```

#### 2.3.4 Self-Evaluation — The Missing Loop

The image shows **Self-Evaluation** as the defining feature of Agentic RAG. The agent assesses its own answer quality and iterates.

```python
# agent/self_evaluator.py
class SelfEvaluator:
    """Assess answer quality against retrieved context. Trigger retry if poor."""

    QUALITY_THRESHOLD = 0.7  # 0.0-1.0

    _PROMPT = """You are a quality evaluator. Score this answer on three criteria (0.0-1.0 each):

Question: {question}
Context chunks used: {context}
Answer: {answer}

Score JSON only:
{{"faithfulness": 0.0-1.0, "relevance": 0.0-1.0, "completeness": 0.0-1.0, "issues": ["..."]}}

faithfulness: Is every claim in the answer supported by the context?
relevance: Does the answer address the question?
completeness: Does the answer cover all key points in the context?"""

    async def evaluate(self, question: str, context: str, answer: str) -> dict:
        raw = await self._llm.generate(
            self._PROMPT.format(question=question, context=context, answer=answer),
            max_tokens=150, temperature=0.0
        )
        try:
            scores = json.loads(raw)
            scores["overall"] = (
                scores["faithfulness"] * 0.5 +
                scores["relevance"] * 0.3 +
                scores["completeness"] * 0.2
            )
            return scores
        except Exception:
            return {"overall": 0.5, "faithfulness": 0.5, "relevance": 0.5, "completeness": 0.5}

    async def should_retry(self, scores: dict) -> bool:
        return scores["overall"] < self.QUALITY_THRESHOLD
```

**Wire into orchestrator:** After LLM generates final answer, call evaluator. If score < 0.7, trigger a second retrieval with expanded queries and regenerate. Max 2 retries.

---

## 3. Semantic Memory Upgrade

Current `AgentMemory` is flat JSON — not semantically searchable. The professional upgrade:

### 3.1 Episodic Memory with Vector Index

```
NEW: services/memory/
  episodic_store.py    ← memories stored in Qdrant (separate collection "agent_memory")
  working_memory.py    ← in-context sliding window of recent conversation
  semantic_memory.py   ← factual knowledge extracted from conversations
  procedural_memory.py ← learned tool usage patterns
```

**Episodic Memory Flow:**
1. Every tool result + reasoning step → embed + store in Qdrant `agent_memory` collection
2. At start of each conversation → `k-NN search` for relevant past episodes
3. Inject top-3 as system context: "In a previous session, you solved X by doing Y"

**This is how Claude Projects + Memory works** — AIPiloty can replicate this locally.

### 3.2 Working Memory — Structured Context Window

```python
# memory/working_memory.py
@dataclass
class WorkingMemorySlot:
    slot_id: str
    content: str
    source: str          # "user" | "tool_result" | "kb_retrieval" | "graph_node"
    relevance_score: float
    expires_at: datetime | None

class WorkingMemory:
    """Structured in-context memory with relevance-based eviction."""
    MAX_TOKENS = 8192  # Reserve for working memory in context window

    def compress_for_context(self) -> str:
        """Return most relevant slots within token budget."""
        slots = sorted(self._slots, key=lambda s: s.relevance_score, reverse=True)
        result, budget = [], self.MAX_TOKENS
        for s in slots:
            tokens = len(s.content.split()) * 1.3  # rough token estimate
            if tokens > budget:
                continue
            result.append(s)
            budget -= tokens
        return self._format_slots(result)
```

---

## 4. Advanced Chunking Strategies

Current chunker: sliding window (800 chars, 200 overlap) + Markdown heading awareness.

### 4.1 Code-Aware Chunking (Tree-Sitter)

For Python/TypeScript/JS files, split on AST boundaries (function → class → module), not character count. This is tracked as TODO B2 in the RAG tracker.

```python
# rag/chunker_code.py
import tree_sitter_python as tspython
from tree_sitter import Language, Parser

class ASTChunker:
    """Split code files on AST node boundaries."""

    def chunk_python(self, path: str, source: str) -> list[Chunk]:
        tree = self._parser.parse(source.encode())
        # Extract: function_definition, class_definition, decorated_definition
        return self._extract_nodes(tree.root_node, source, path)
```

**M2 impact:** `tree-sitter` is fast, ~1MB, zero GPU. Install: `pip install tree-sitter tree-sitter-python tree-sitter-javascript`.

### 4.2 Semantic Chunking

Instead of fixed size, split where semantic similarity drops between consecutive sentences. More expensive but produces coherent chunks.

```python
# rag/chunker_semantic.py
class SemanticChunker:
    """Split text at semantic breakpoints (cosine similarity drops)."""
    SIMILARITY_THRESHOLD = 0.7

    async def chunk(self, path: str, text: str) -> list[Chunk]:
        sentences = self._split_sentences(text)
        embeddings = await self._embeddings.embed_batch(sentences)
        breakpoints = self._find_breakpoints(embeddings)
        return self._assemble_chunks(sentences, breakpoints, path)

    def _find_breakpoints(self, embeddings: list[list[float]]) -> list[int]:
        """Find indices where cosine similarity to next sentence drops below threshold."""
        breakpoints = []
        for i in range(len(embeddings) - 1):
            sim = cosine_similarity(embeddings[i], embeddings[i+1])
            if sim < self.SIMILARITY_THRESHOLD:
                breakpoints.append(i + 1)
        return breakpoints
```

### 4.3 Enriched Chunk Metadata

Add to every chunk stored in Qdrant:
```json
{
  "content": "...",
  "source_path": "docs/runbook.md",
  "heading": "Docker Setup",
  "chunk_index": 4,
  "tree_level": 0,
  "doc_title": "...",
  "entities": ["Docker", "Nginx", "port 80"],
  "created_at": "2026-07-17T...",
  "content_hash": "abc123",
  "language": "markdown",
  "access_count": 0,
  "notebook_id": null
}
```

---

## 5. LLM Upgrade Path (M2, 24 GB)

### 5.1 Model Tiers for AIPiloty

| Tier | Model | VRAM | Use Case | Quality |
|------|-------|------|----------|---------|
| Fast (default) | `qwen2.5:7b-instruct-q4_K_M` | ~5 GB | Most queries, tool calling | ★★★★ |
| Smart | `qwen2.5:14b-instruct-q4_K_M` | ~9 GB | Complex reasoning, planning | ★★★★★ |
| Coder | `qwen2.5-coder:7b-q4_K_M` | ~5 GB | Code generation, review | ★★★★★ |
| Embeddings | `nomic-embed-text` (current) | <1 GB | RAG retrieval | ★★★★ |
| Better embeddings | `mxbai-embed-large` (335M) | ~0.7 GB | Higher quality, 1024d | ★★★★★ |
| Reranker | `ms-marco-MiniLM-L-6-v2` | ~90 MB CPU | Post-retrieval rerank | ★★★★★ |

**Recommended combination for 24 GB unified:**
```
Qwen2.5:14b (active, ~9 GB) 
+ nomic-embed-text (~0.5 GB)
+ BGE-reranker (~0.09 GB CPU)
+ Qdrant (~0.2 GB)
+ FastAPI + Next.js (~0.5 GB)
─────────────────────────────
Total: ~10.3 GB → comfortable headroom
```

### 5.2 Model Router (Smart ↔ Fast)

```python
# llm/model_router.py
class ModelRouter:
    """Route queries to fast or smart model based on complexity."""

    def select_model(self, query: str, intent: Intent) -> str:
        complex_signals = {
            "plan", "design", "architecture", "explain why", "compare",
            "strategy", "roadmap", "analyze", "optimize"
        }
        q_lower = query.lower()
        if any(s in q_lower for s in complex_signals) or len(query) > 500:
            return "qwen2.5:14b-instruct-q4_K_M"  # slow but smart
        return "qwen2.5:7b-instruct-q4_K_M"        # fast default
```

### 5.3 DeepSeek-R1 for Chain-of-Thought

For planning tasks, `deepseek-r1:7b` on Ollama (fits in 6GB) gives structured reasoning traces. Wire as an optional "think" step before agent execution for complex multi-step tasks.

---

## 6. Professional UI Enhancements

### 6.1 RAG Transparency Panel

Show users what was retrieved and why (like Perplexity's citations):

```tsx
// components/rag-sources-panel.tsx
// Accordion showing:
// - Each retrieved chunk with source path, heading, relevance score
// - Entity graph nodes that expanded the search
// - Self-evaluation scores (faithfulness, relevance, completeness)
// - Retrieval mode used (hybrid / graph / corrective fallback)
```

### 6.2 Thinking Visualizer Upgrade

Current `thinking-visualizer.tsx` shows tool calls. Enhance to show:
- RAG retrieval steps (embed → search → rerank)
- Entity extraction hits from graph
- Self-evaluation loop if triggered
- Memory recall indicators ("I remember from a previous session...")

### 6.3 Knowledge Graph Visualizer

```tsx
// components/knowledge-graph-viz.tsx (react-force-graph or d3)
// Show entity nodes and relationships from the KG
// Color-coded by entity type (service=blue, person=green, error=red)
// Filterable by document source
// Click node → filter chat to that entity
```

### 6.4 Memory Browser

```tsx
// components/memory-browser.tsx
// List all episodic memories with timestamps
// Semantic search across memories
// Manual pin/delete
// Shows which memories were used in current conversation
```

---

## 7. Phased Implementation Roadmap

### Phase 1 — RAG Quality (2-3 days, highest ROI)

**Priority: Critical. No new services needed.**

| Task | File | Est. |
|------|------|------|
| Add cross-encoder reranker | `rag/reranker.py` (NEW) | 2h |
| Wire reranker into retriever | `rag/retriever.py` | 30min |
| Conversation-aware query rewriting | `rag/query_rewriter.py` (NEW) | 2h |
| Multi-query expansion | `rag/query_expander.py` (NEW) | 2h |
| HyDE for factual queries | `rag/hyde.py` (NEW) | 1.5h |
| Enriched chunk metadata | `rag/chunker.py`, `rag/ingest.py` | 1h |
| `pip install sentence-transformers` | `requirements.txt` | 5min |

**Expected improvement:** +20-35% retrieval relevance measured by manual judgment.

### Phase 2 — Agentic Self-Correction (3-4 days)

**Priority: High. Pure Python, no new infra.**

| Task | File | Est. |
|------|------|------|
| CRAG corrective retrieval | `rag/corrective.py` (NEW) | 3h |
| Self-evaluation after LLM | `agent/self_evaluator.py` (NEW) | 2h |
| Wire evaluator into orchestrator loop | `agent/orchestrator.py` | 1.5h |
| Self-RAG intent-gated retrieval | `agent/intent_classifier.py` | 1h |
| Orchestrator retry on low quality | `agent/orchestrator.py` | 1h |

**Expected improvement:** Hallucinations drop, factual grounding improves significantly.

### Phase 3 — Semantic Memory Upgrade (2-3 days)

**Priority: High. Qdrant already running.**

| Task | File | Est. |
|------|------|------|
| Episodic memory in Qdrant | `services/memory/episodic_store.py` (NEW) | 4h |
| Working memory with eviction | `services/memory/working_memory.py` (NEW) | 3h |
| Memory injection in orchestrator | `agent/orchestrator.py` | 1h |
| Memory browser UI | `frontend/src/components/memory-browser.tsx` (NEW) | 3h |

### Phase 4 — Graph RAG (LazyGraphRAG) (4-5 days)

**Priority: Medium-High. Biggest architectural leap.**

| Task | File | Est. |
|------|------|------|
| Entity extractor (Ollama NER) | `rag/graph/entity_extractor.py` (NEW) | 4h |
| SQLite KG store | `rag/graph/graph_store.py` (NEW) | 3h |
| Alembic migration for KG tables | `alembic/versions/xxx_add_kg.py` (NEW) | 1h |
| Graph-aware retrieval | `rag/graph/graph_retriever.py` (NEW) | 4h |
| Triple RRF fusion (vector+keyword+graph) | `rag/retriever.py` | 1h |
| KG visualizer component | `frontend/src/components/knowledge-graph-viz.tsx` (NEW) | 5h |

### Phase 5 — Advanced Chunking + RAPTOR (3-4 days)

**Priority: Medium.**

| Task | File | Est. |
|------|------|------|
| Tree-sitter code chunker | `rag/chunker_code.py` (NEW) | 3h |
| Semantic chunker | `rag/chunker_semantic.py` (NEW) | 2h |
| RAPTOR summary tree | `rag/raptor.py` (NEW) | 5h |
| Model router (fast ↔ smart) | `llm/model_router.py` (NEW) | 2h |

### Phase 6 — Evaluation & Observability (2-3 days)

**Priority: Medium. Measures all above improvements.**

| Task | File | Est. |
|------|------|------|
| RAGAS-style metrics logging | `services/evaluation/ragas.py` (NEW) | 3h |
| RAG transparency UI panel | `frontend/src/components/rag-sources-panel.tsx` (NEW) | 3h |
| Thinking visualizer upgrade | `frontend/src/components/thinking-visualizer.tsx` | 2h |
| Golden test set for regression | `backend/tests/golden/` | 3h |

---

## 8. Full Target Architecture Diagram

```
                        USER QUERY
                            │
                   ┌────────▼────────┐
                   │ Query Rewriter  │  ← conversation-aware rewriting
                   └────────┬────────┘
                            │ rewritten query
              ┌─────────────▼─────────────┐
              │      Query Expander        │  ← 3-5 phrasings (multi-query)
              └─────────────┬─────────────┘
                    HyDE ───┤              ← hypothetical doc for factual q
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
  Vector Search       Keyword Search      Graph Search
  (Qdrant cosine)     (BM25 sparse)    (Entity → KG → expand)
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                    ┌───────▼───────┐
                    │  RRF Fusion   │  ← triple fusion
                    │   (top-20)    │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  Reranker     │  ← cross-encoder BGE → top-5
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  CRAG Check   │  ← relevance score < 0.5?
                    │               │     → web search fallback
                    └───────┬───────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
        KB Context     Episodic         Tool Results
        (top-5)       Memory (k-NN)    (from agent)
            │               │               │
            └───────────────┼───────────────┘
                            │
                    ┌───────▼───────┐
                    │   LLM (Qwen)  │  ← enriched context
                    │  ReAct Loop   │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │ Self-Evaluator│  ← faithfulness + relevance scores
                    │               │     < threshold? → retry with expanded q
                    └───────┬───────┘
                            │ score OK
                    ┌───────▼───────┐
                    │ Final Answer  │  ← with inline citations
                    └───────────────┘
```

---

## 9. Concrete Next Steps (Start Monday)

### Step 1 — Install Dependencies (5 min)
```bash
pip install sentence-transformers tree-sitter tree-sitter-python tree-sitter-javascript
ollama pull mxbai-embed-large  # optional upgrade from nomic-embed-text
```

### Step 2 — Create the Reranker (Highest ROI, 2 hours)
Create `backend/app/services/rag/reranker.py` with `BGEReranker` class.
Wire into `RetrieverService.search()` — retrieve 20, rerank to 5.

### Step 3 — Create Query Rewriter (2 hours)
Create `backend/app/services/rag/query_rewriter.py`.
Wire into `kb_search` tool before retrieval.

### Step 4 — Create Self-Evaluator (2 hours)
Create `backend/app/services/agent/self_evaluator.py`.
Wire into `orchestrator.py` after final answer generation.

### Step 5 — Create Entity Extractor (4 hours)
Create `backend/app/services/rag/graph/entity_extractor.py`.
Add to ingest pipeline in `ingest.py`.

---

## 10. Security Additions

| Risk | Mitigation |
|------|-----------|
| Graph traversal loops | Max hop limit (hops=2), visited node set |
| Entity extraction prompt injection | Same segregation markers as existing guardrails |
| Reranker model loading from HuggingFace | Pin model hash in config, use `local_files_only=True` after first download |
| Self-evaluation prompt injection | User context wrapped in `[USER_CONTENT]` tags |
| Episodic memory PII | Same PII redactor as existing `GuardrailService` before storage |
| Web search SSRF (CRAG fallback) | Same SSRF protection as `ResearchToolService.fetch_url()` |

---

## 11. Tools & Libraries Reference

| Tool | Use | License | M2 Size |
|------|-----|---------|---------|
| `sentence-transformers` | BGE cross-encoder reranker | Apache 2.0 | ~500MB (models) |
| `tree-sitter` | AST-based code chunking | MIT | ~1MB |
| `networkx` | In-memory graph algorithms (Louvain, BFS) | BSD | ~5MB |
| `spacy` (optional) | Fast CPU NER (alt to LLM extraction) | MIT | ~50-200MB |
| `ragas` | RAG evaluation framework | Apache 2.0 | ~50MB |
| `mxbai-embed-large` (Ollama) | Better embeddings (1024d) | Apache 2.0 | ~700MB |
| `react-force-graph` | KG visualization in Next.js | MIT | ~50KB |
| `qwen2.5:14b-q4` | Smart model for complex tasks | Qwen License | ~9GB |

---

## 12. Competitive Benchmark

| Feature | AIPiloty Today | After Roadmap | Perplexity | Claude |
|---------|----------------|---------------|------------|--------|
| RAG retrieval | Hybrid (vector+BM25) | +Graph+Rerank+CRAG | Hybrid+web | RAG+memory |
| Self-correction | None | CRAG + Self-Eval | None | CoT |
| Knowledge graph | None | LazyGraphRAG | None | Unknown |
| Memory | File JSON | Episodic vectors | None | Projects memory |
| Multi-query | None | Yes (3-5 variants) | Unknown | Unknown |
| Reranking | None | BGE cross-encoder | Unknown | Unknown |
| Evaluation | None | RAGAS metrics | Unknown | Unknown |
| Cost | Free (local) | Free (local) | $20/mo | $20/mo |

---

*Research compiled by GitHub Copilot (Claude Sonnet 4.6) — 2026-07-17*
*Based on: Gao et al. 2022 (HyDE), Sarthi et al. 2024 (RAPTOR), Shi et al. 2024 (CRAG), Asai et al. 2023 (Self-RAG), Microsoft GraphRAG 2024, LazyGraphRAG Jan 2025, Anthropic Contextual Retrieval 2024*
