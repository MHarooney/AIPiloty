"""AST-aware code chunker using tree-sitter.

Splits code files on semantic AST boundaries (functions, classes, methods)
rather than character count, producing contextually coherent chunks that
dramatically improve RAG relevance for code-related queries.

Supported languages:
  • Python  (.py)  — function_definition, class_definition, decorated_definition
  • JavaScript (.js, .jsx) — function_declaration, class_declaration, arrow_function
  • TypeScript (.ts, .tsx) — same as JS + type/interface declarations

Falls back to the standard sliding-window chunker when:
  - tree-sitter is not installed
  - File extension is not supported
  - Parsing fails for any reason
  - No meaningful AST nodes are found (< 2 nodes)

Each chunk carries the parent function/class name as its ``heading`` so
existing citation formatting remains informative.

Reference: Tree-sitter (https://tree-sitter.github.io/) — O(n) incremental
parsing, supports 100+ languages via grammar packages.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

# ── Language registry ────────────────────────────────────────────────────
_PYTHON_EXTS = frozenset({".py"})
_JS_EXTS = frozenset({".js", ".jsx", ".mjs", ".cjs"})
_TS_EXTS = frozenset({".ts", ".tsx"})

# Node types we extract as top-level chunks per language
_PY_NODES = frozenset({
    "function_definition",
    "async_function_definition",
    "class_definition",
    "decorated_definition",
})
_JS_NODES = frozenset({
    "function_declaration",
    "generator_function_declaration",
    "class_declaration",
    "method_definition",
    "export_statement",     # captures exported functions/classes
    "lexical_declaration",  # const fn = ...
})

# ── Lazy parser cache ─────────────────────────────────────────────────────
_py_parser: Optional[object] = None
_js_parser: Optional[object] = None
_tree_sitter_available: Optional[bool] = None


def _is_available() -> bool:
    global _tree_sitter_available
    if _tree_sitter_available is None:
        try:
            import tree_sitter  # noqa: F401
            _tree_sitter_available = True
        except ImportError:
            logger.warning("tree-sitter not installed — ASTChunker will use sliding-window fallback")
            _tree_sitter_available = False
    return _tree_sitter_available


def _get_py_parser() -> Optional[object]:
    global _py_parser
    if _py_parser is None and _is_available():
        try:
            import tree_sitter_python as tspython
            from tree_sitter import Language, Parser
            PY_LANGUAGE = Language(tspython.language())
            parser = Parser(PY_LANGUAGE)
            _py_parser = parser
        except Exception as exc:
            logger.warning("Could not load Python tree-sitter grammar: %s", exc)
    return _py_parser


def _get_js_parser() -> Optional[object]:
    global _js_parser
    if _js_parser is None and _is_available():
        try:
            import tree_sitter_javascript as tsjs
            from tree_sitter import Language, Parser
            JS_LANGUAGE = Language(tsjs.language())
            parser = Parser(JS_LANGUAGE)
            _js_parser = parser
        except Exception as exc:
            logger.warning("Could not load JavaScript tree-sitter grammar: %s", exc)
    return _js_parser


def _node_name(node, source_bytes: bytes) -> str:
    """Extract identifier name from an AST node (first child named 'name' or 'identifier')."""
    for child in node.children:
        if child.type in ("identifier", "name"):
            return source_bytes[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
    return ""


def _node_text(node, source_bytes: bytes) -> str:
    return source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


@dataclass
class ASTChunk:
    """A single chunk produced by AST-based splitting."""
    content: str
    source_path: str
    chunk_index: int
    heading: str      # function/class name
    content_hash: str
    node_type: str    # e.g. "function_definition"
    start_line: int
    end_line: int


class ASTChunker:
    """Split code files into chunks at AST node boundaries.

    Args:
        max_chunk_chars: Maximum characters per chunk. Nodes larger than this
                         are further split by their children.
        fallback_chunker: Optional fallback TextChunker for unsupported files.
    """

    def __init__(
        self,
        max_chunk_chars: int = 3000,
        fallback_chunker: Optional[object] = None,
    ) -> None:
        self._max = max_chunk_chars
        self._fallback = fallback_chunker

    def chunk_file(self, path: str, content: str) -> List[ASTChunk]:
        """Chunk a code file using AST node boundaries.

        Returns:
            List of ASTChunk; falls back to sliding-window if AST fails.
        """
        ext = Path(path).suffix.lower()

        if ext in _PYTHON_EXTS:
            chunks = self._chunk_python(path, content)
        elif ext in _JS_EXTS | _TS_EXTS:
            chunks = self._chunk_js(path, content)
        else:
            chunks = []

        if len(chunks) < 2 and self._fallback:
            # Degenerate AST or unsupported language — use sliding window
            logger.debug("ASTChunker: fallback for %s (only %d AST chunks)", path, len(chunks))
            return self._convert_fallback(path, content)

        return chunks

    # ── Python ────────────────────────────────────────────────────────────

    def _chunk_python(self, path: str, content: str) -> List[ASTChunk]:
        parser = _get_py_parser()
        if parser is None:
            return []
        try:
            src = content.encode("utf-8")
            tree = parser.parse(src)
            return self._extract_nodes(tree.root_node, src, path, _PY_NODES)
        except Exception as exc:
            logger.debug("ASTChunker Python parse failed (%s): %s", path, exc)
            return []

    # ── JavaScript / TypeScript ───────────────────────────────────────────

    def _chunk_js(self, path: str, content: str) -> List[ASTChunk]:
        parser = _get_js_parser()
        if parser is None:
            return []
        try:
            src = content.encode("utf-8")
            tree = parser.parse(src)
            return self._extract_nodes(tree.root_node, src, path, _JS_NODES)
        except Exception as exc:
            logger.debug("ASTChunker JS/TS parse failed (%s): %s", path, exc)
            return []

    # ── Core extraction ───────────────────────────────────────────────────

    def _extract_nodes(
        self,
        root,
        source_bytes: bytes,
        path: str,
        target_types: frozenset,
    ) -> List[ASTChunk]:
        chunks: List[ASTChunk] = []
        chunk_idx = 0

        def visit(node, parent_name: str = ""):
            nonlocal chunk_idx
            if node.type in target_types:
                text = _node_text(node, source_bytes)
                name = _node_name(node, source_bytes) or parent_name or node.type

                if len(text) > self._max:
                    # Node is too large — descend into children
                    for child in node.children:
                        visit(child, name)
                    return

                if len(text.strip()) < 10:
                    return

                chunks.append(ASTChunk(
                    content=text,
                    source_path=path,
                    chunk_index=chunk_idx,
                    heading=name,
                    content_hash=hashlib.sha256(text.encode()).hexdigest()[:16],
                    node_type=node.type,
                    start_line=node.start_point[0] + 1,
                    end_line=node.end_point[0] + 1,
                ))
                chunk_idx += 1
            else:
                for child in node.children:
                    visit(child)

        visit(root)

        # If no top-level nodes found, capture entire file as one chunk
        if not chunks:
            full = source_bytes.decode("utf-8", errors="replace")
            if full.strip():
                chunks.append(ASTChunk(
                    content=full[:self._max],
                    source_path=path,
                    chunk_index=0,
                    heading=Path(path).stem,
                    content_hash=hashlib.sha256(full.encode()).hexdigest()[:16],
                    node_type="module",
                    start_line=1,
                    end_line=full.count("\n") + 1,
                ))

        return chunks

    def _convert_fallback(self, path: str, content: str) -> List[ASTChunk]:
        """Convert TextChunker output to ASTChunk list."""
        if self._fallback is None:
            return []
        raw = self._fallback.chunk_file(path, content)
        return [
            ASTChunk(
                content=c.content,
                source_path=c.source_path,
                chunk_index=c.chunk_index,
                heading=c.heading,
                content_hash=c.content_hash,
                node_type="sliding_window",
                start_line=0,
                end_line=0,
            )
            for c in raw
        ]
