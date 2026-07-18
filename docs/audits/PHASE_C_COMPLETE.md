# Phase C Complete — Scale / Polish

**Date:** 2026-07-18  
**Scope:** AIPiloty routing — tool packs, semantic refine, cloud QA fallback, golden eval

## Shipped

| Item | Status |
|------|--------|
| Named MCP-style **tool packs** (no write tools on “list models”) | Done |
| **Conceptual QA override** (explain deploy ≠ run deploy) | Done |
| **Lexical semantic router** (+ optional nomic-embed refine) | Done |
| **Cloud LLM fallback** for hard GENERAL_QA (opt-in) | Done |
| **Golden set** ≥100 utterances, **≥92%** CI threshold | Done |
| Softer yes/no system prompt (less invented “deployment”) | Done |

## Tool packs (examples)

| Pack | Tools include | Never includes |
|------|---------------|----------------|
| `ollama` | `verify_ollama_models`, stats/host | `write_file`, `deploy`, `ssh_command` |
| `code_read` | `list_host_path` | write/patch unless write verbs |
| `code_write` | write/patch + list | — |
| `vm_read` / `vm_shell` | health vs SSH | — |
| `document` / `search` / … | domain-only | unrelated MCP categories |

## Cloud fallback (opt-in)

```env
CLOUD_LLM_ENABLED=true
OPENAI_API_KEY=sk-...
CLOUD_LLM_MODEL=gpt-4o-mini
CLOUD_LLM_FOR=complex_qa   # complex_qa | always_qa | never
```

Tools / agent loops stay on **local Ollama**. Cloud is GENERAL_QA only, with local fallback on error.

## Semantic router

1. Keyword / mode routes (Phase A/B)  
2. Lexical prototype Jaccard (always on, CI-safe)  
3. Embedding cosine via `nomic-embed-text` when available (`SEMANTIC_ROUTER_ENABLED=true`)

## Verify

```bash
cd aipiloty/backend
.venv/bin/pytest tests/test_message_router.py tests/test_routing_golden_set.py -q
```

## Next

Image quality / DALL·E wiring (paused earlier).
