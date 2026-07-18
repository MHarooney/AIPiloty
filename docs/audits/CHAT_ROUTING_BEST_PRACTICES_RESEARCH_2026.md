# Research: Professional Chat & Agent Routing for AIPiloty

**Date:** 2026-07-18  
**Purpose:** Latest industry practices (2025–2026) for improving greeting/smalltalk/static replies into a production-grade routing architecture.  
**Constraint:** Research & roadmap only — no product code changes in this document.

---

## 1. Executive verdict

| Current AIPiloty approach | Professional? | Improve to |
|---------------------------|---------------|------------|
| Giant static reply map (`hello`→string, `yes`→string, …) | Partial (demo-grade) | **Intent router + path selection** |
| Exact greeting short-circuit | Yes (tier‑1 keyword filter) | Keep, but **tiny set only** |
| Full ReAct loop for every other message | Heavy for Q&A | Split: **chat (no tools)** vs **agent (tools)** |
| Existing `IntentClassifier` + Ask/Agent/Auto UI | Strong foundation | **Wire classifier into orchestrator first** |

**One-line best practice:**  
*Classify first, answer second. Don’t hardcode answers — hardcode routes.*

---

## 2. What leading sources recommend (2026)

### 2.1 Cascading intent router (most cited)

[Tian Pan — Intent Classification Layer](https://tianpan.co/blog/2026-04-16-intent-classification-agent-routers)

```
1. Keyword / regex     (~1ms)     → unambiguous: hello, thanks, bye
2. Embedding router    (16–100ms) → majority of traffic
3. Fine-tuned classifier (optional)
4. LLM catch-all       (1–5s)     → novel / ambiguous only
```

Heuristic by tool count (AIPiloty ≈ **20 tools** today):
- &lt;15 tools → native function calling often enough  
- **15–50 tools → add embedding / intent router** ← **you are here**  
- &gt;50 → fine-tuned classifier required  

### 2.2 Tool selection = layered stack (not one God Agent)

[Machine Learning Mastery — Tool Selection Guide](https://machinelearningmastery.com/the-complete-guide-to-tool-selection-in-ai-agents/)

Six complementary layers:

1. **Gating** — detect turns that need **no tools** (smalltalk, simple Q&A)  
2. **Retrieval / routing** — narrow tool catalog to relevant subset  
3. **Planning** — multi-step tasks only  
4. **Fallback** — low confidence → clarify, don’t guess  
5. **Benchmarking** — measure routing accuracy/latency  
6. Avoid **God Agent** (all tools in context every turn)

### 2.3 Progressive / domain tool loading

[Progressive MCP Tool Routing](https://dev.to/robertpelloni/progressive-mcp-tool-routing-stop-drowning-your-agents-in-50k-tokens-5gh)

- Stage 1: classify domain (deployment / data / observability / …)  
- Stage 2: expose only **8–12 tools** for that domain  
- Confidence &lt; ~70% → semantic fallback over full catalog  

### 2.4 Support-bot production lesson: SMALLTALK enum

[Scapia — rebuilt support chatbot 3×](https://medium.com/miles-megabytes/we-rebuilt-our-support-chatbot-three-times-heres-what-finally-worked-ac0a38b5db5d)

Forced classification into:
- `QUERY` — needs a real answer  
- `SMALLTALK` — greetings/thanks  
- `HANDOFF` — human  

**On failure → default to QUERY** (better to answer than to misroute).

### 2.5 Cost router: skip ReAct when tools aren’t needed

[Agent Series — Cost & Performance](https://dev.to/wonderlab/agent-series-18-cost-performance-optimization-cheaper-and-faster-4611)

- Cheap classifier before agent loop  
- ROI positive when **&gt;~40%** of queries need no tools  
- Local Ollama: this is even more important (CPU/GPU + memory)

### 2.6 LangGraph / multi-agent routers

[LangChain Router docs](https://docs.langchain.com/oss/python/langchain/multi-agent/router)

- Dedicated router node → specialized handlers  
- Smalltalk / general_info is a **branch**, not a string table  
- Prefer clear paths over one mega-prompt with every tool

### 2.7 MCP as the tool standard (2026)

[EITT — AI Agents 2026](https://eitt.academy/knowledge-base/ai-agents-2026-guide-from-llm-to-multi-agent-systems/)

- MCP (Model Context Protocol) is the interoperability standard  
- AIPiloty already has MCP-oriented tooling — keep attaching/detaching tool sets **per route**, not all-at-once

---

## 3. Gap analysis: AIPiloty vs best practice

| Best practice | AIPiloty today | Gap |
|---------------|----------------|-----|
| Keyword filter for greetings | Static map + `_GREETINGS` | Overgrown; includes `yes`/`no`/`ok` |
| Intent → route | `IntentClassifier` exists (tool + RAG hints) | **Not driving reply path** (static map bypasses it) |
| `SMALLTALK` → no-tool LLM | Missing | Static strings instead |
| `GENERAL_QA` → LLM, no tools | Partially via Ask mode UI | Backend doesn’t auto-route |
| `TASK` → agent + curated tools | Full loop with many tools | No progressive tool subset |
| Default fail-open to QUERY | Fail-closed to canned “Got it” (old) / static yes | Risky confirmations |
| Eval suite for routing | Manual eval script added | Not in CI yet |
| Observability of route rates | Weak | Need `% smalltalk / chat / agent` metrics |
| Context budget for local LLM | Default `ollama_context_length=32768`, keep_alive forever | Hurts laptop UX |

You already have a strong building block: `intent_classifier.py` categories (`vm`, `deployment`, `knowledge`, `code`, `general`, …) + UI modes **Agent / Ask / Auto**. The professional move is to **unify** those into one backend router.

---

## 4. Target professional architecture (recommended)

```
                    ┌─────────────────────┐
  User message ───► │  Router (cascade)   │
                    └─────────┬───────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   SMALLTALK            GENERAL_QA              AGENT_TASK
   (hello/thanks)       (who are you,           (deploy, ssh,
                        what is X)               generate PDF)
         │                    │                    │
         ▼                    ▼                    ▼
   Optional static      LLM call                 Intent → tool subset
   OR 1 no-tool LLM     tools=[]                 (8–12 tools)
                        num_ctx=4096–8192        ReAct / function calling
                                                 risk guardrails
```

### Route definitions

| Route | Examples | Behavior |
|-------|----------|----------|
| `SMALLTALK` | hello, thanks, bye | Tiny keyword set; static OK **or** no-tool LLM |
| `GENERAL_QA` | who are you, explain X, what is docker conceptually | **LLM only**, `tools=None` |
| `AGENT_TASK` | list models, SSH, generate PDF, check VM | Curated tools from `IntentClassifier.suggested_tools` |
| `CONFIRMATION` | yes / no / ok **after** a pending plan | **Never** static — bind to pending action state |
| `CLARIFY` | low confidence | Ask one clarifying question |

### Critical rule for `yes` / `no` / `ok`

Industry and your own eval agree: these must **not** be global static replies.

- If there is a **pending approval / plan** → confirm or cancel that plan  
- Else → treat as `GENERAL_QA` / short context reply via LLM  

---

## 5. Prioritized improvement roadmap

### P0 — High impact, low risk (1–2 days)

1. **Shrink static set** to true greetings only: `hello`, `hi`, `hey`, `thanks`, `bye` (+ variants).  
2. **Remove** `yes`, `no`, `ok`, `sure`, `cool`, `great` from static replies.  
3. Wire existing **`IntentClassifier`** at the top of `orchestrator.run`:  
   - `general` + no tool keywords → `GENERAL_QA` path (LLM, no tools)  
   - domain categories → load **suggested_tools only**  
4. Cap local context: `ollama_context_length=8192`, `keep_alive=5m` (laptop profile).  
5. Promote routing eval (`scripts/manual_evals/chat_routing_deep_eval.py`) into CI.

### P1 — Professional UX (3–5 days)

6. Implement explicit routes: `SMALLTALK | GENERAL_QA | AGENT_TASK | CONFIRMATION`.  
7. Align UI **Ask / Agent / Auto** with backend routes (Auto = classifier).  
8. Progressive tool loading (8–12 tools per domain).  
9. Metrics: route distribution, p50/p95 latency per route, tool-call rate.  
10. Session-aware confirmations (pending action registry).

### P2 — Scale / polish

11. Embedding semantic router (nomic-embed already in stack) for fuzzy smalltalk / domain.  
12. MCP-gated tool packs per domain.  
13. Optional cloud fallback for hard reasoning; keep local for chat/tools.  
14. Golden-set eval of 100+ utterances with pass thresholds before release.

---

## 6. What “more useful” means for end users

| User need | Best-practice behavior |
|-----------|------------------------|
| Fast hello | Instant greeting (static or tiny LLM) |
| Identity / conceptual Q | Natural LLM answer, no fake “Got it” |
| DevOps task | Tools + progress (“Thinking”, tool timeline) |
| Confirm destructive action | Stateful yes/no, never canned |
| Ambiguous ask | Clarify once, then act |
| Laptop performance | Small ctx, unload model, don’t pin Forever |

---

## 7. Source list (latest topics)

1. https://tianpan.co/blog/2026-04-16-intent-classification-agent-routers  
2. https://machinelearningmastery.com/the-complete-guide-to-tool-selection-in-ai-agents/  
3. https://dev.to/robertpelloni/progressive-mcp-tool-routing-stop-drowning-your-agents-in-50k-tokens-5gh  
4. https://medium.com/miles-megabytes/we-rebuilt-our-support-chatbot-three-times-heres-what-finally-worked-ac0a38b5db5d  
5. https://dev.to/wonderlab/agent-series-18-cost-performance-optimization-cheaper-and-faster-4611  
6. https://docs.langchain.com/oss/python/langchain/multi-agent/router  
7. https://jatinbansal.com/ai-engineering/tool-selection-at-scale/  
8. https://eitt.academy/knowledge-base/ai-agents-2026-guide-from-llm-to-multi-agent-systems/  
9. Related prior audit: `docs/audits/CHAT_ROUTING_STATIC_REPLY_AUDIT.md`

---

## 8. Recommendation for AIPiloty (decision)

**Do this next (when you approve implementation):**

1. Stop growing the static reply dictionary.  
2. Treat routing as a first-class module: `classify → route → execute`.  
3. Reuse `IntentClassifier` + Ask/Agent/Auto — don’t invent a parallel system.  
4. Measure with the deep eval suite before/after.

That is the correct professional path used by production agent teams in 2026: **gate → route → curated tools → evaluate**, not **string → canned English**.
