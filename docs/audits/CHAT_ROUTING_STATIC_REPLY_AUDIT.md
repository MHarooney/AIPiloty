# AIPiloty Chat Routing — Deep Audit & Test Report

**Date:** 2026-07-18  
**Scope:** Static greeting / smalltalk short-circuit in `AgentOrchestrator`  
**Constraint:** No changes to production app code or deployments in this audit pass  
**Artifacts:**
- Eval runner: `scripts/manual_evals/chat_routing_deep_eval.py`
- API results: `docs/audits/chat_routing_deep_eval_results.json`

---

## 1. Verdict (short)

**Having a fast path for greetings is professional and normal.**  
**Hardcoding a large dictionary of reply strings for `yes` / `no` / `ok` / `cool` is not the best long-term approach.**

Industry practice (2025–2026): use a **tiered router**:

1. **Keyword / regex filter** (~1ms) — only for unambiguous intents (hello, thanks, bye)
2. **Optional embedding / small classifier** — smalltalk vs task
3. **LLM (no tools or with tools)** — everything else, including identity Q&A

Static **replies** for every acknowledgement are a product smell; static **classification** of smalltalk is fine.

---

## 2. What the code does today

Location: `backend/app/services/agent/orchestrator.py` (greeting short-circuit before the ReAct loop).

| Layer | Behavior |
|--------|----------|
| Exact match set `_GREETINGS` | If message (lowercased, stripped punctuation) is in the set → skip tools/LLM agent loop |
| Reply map `_greeting_replies` | Return a fixed English string immediately |
| Everything else | Full agent loop (thinking → LLM → tools) |

**Why it exists (valid):** local small models (`llama3.2:3b`) often call diagnostic tools on `"hello"`. Short-circuiting pure greetings saves RAM/latency and avoids silly tool use.

**Why the big static map feels wrong:** it conflates *routing* with *answering*. Production systems usually:

- Classify: `SMALLTALK | QUERY | TASK`
- For `SMALLTALK`: either one generic template **or** a **tool-free LLM call**
- For `QUERY`/`TASK`: full agent

---

## 3. Industry research (sources)

| Source | Relevant takeaway |
|--------|-------------------|
| [Intent Classification Layer for Agent Routers](https://tianpan.co/blog/2026-04-16-intent-classification-agent-routers) | Cascade: keyword → embedding → fine-tune → LLM catch-all |
| [AI Agents in Production](https://treeshainfotech.com/blog/ai-agents-in-production-architecture-tools-lessons-learned) | Deterministic keyword/regex first; 70–80% of traffic can be classified without LLM |
| [Support chatbot rebuild (Scapia)](https://medium.com/miles-megabytes/we-rebuilt-our-support-chatbot-three-times-heres-what-finally-worked-ac0a38b5db5d) | Enum intents: `QUERY` / `SMALLTALK` / `HANDOFF`; default to QUERY on failure |
| [Cost & Performance Optimization (DEV)](https://dev.to/wonderlab/agent-series-18-cost-performance-optimization-cheaper-and-faster-4611) | Router before ReAct: skip agent loop when no tools needed |
| [ReAct prompting guide](https://sureprompts.com/blog/react-prompting-guide) | Do not wrap pure Q&A in ReAct ceremony |

**Professional pattern for AIPiloty:**

```
User message
  → exact greeting?  → static OR fast no-tool LLM reply  (OK)
  → smalltalk/ack?   → no-tool LLM (preferred) or single template
  → question/task?   → agent loop with tools
```

Not:

```
User message → giant dict of 40 canned strings → return
```

---

## 4. Audit findings (severity)

### Critical / High

1. **`yes` / `no` / `ok` / `sure` as static replies**  
   Mid-conversation confirmations (“yes, delete that VM”) never reach the LLM. Confirmed in eval: `STATIC_SHORTCUT` for yes/no/ok.

2. **Exact-string only**  
   Misses: “Hello there”, “Hellooo”, Arabic greetings, typos (“helo”). Over-matches only exact keys after light normalize.

### Medium

3. **Duplicated responsibility**  
   `_GREETINGS` set + `_greeting_replies` dict (many keys duplicated). Maintenance burden; easy to drift.

4. **No telemetry on short-circuit rate**  
   Production systems log `% smalltalk` vs `% agent` for ROI of the router.

5. **Context window still 32768 + keep_alive forever** (config/runtime)  
   Orthogonal but impacts “feel” of non-static paths (slow Thinking UI).

### Low / Acceptable

6. **Static hello/thanks/bye** — industry-standard fast path for local agents.  
7. **Post-fix identity questions** — now correctly hit LLM (was broken before by ≤3-word heuristic).

---

## 5. Deep test results

### 5.1 API black-box eval (15 cases)

Command:

```bash
cd aipiloty && python3 scripts/manual_evals/chat_routing_deep_eval.py
```

**Result: 15/15 passed (0 failed)** — see `docs/audits/chat_routing_deep_eval_results.json`

| ID | Input | Expectation | Observed | Latency |
|----|--------|-------------|----------|---------|
| g1–g4 | hello/hi/thanks/bye | static greeting | canned templates | ~10–21ms |
| q1 | who are you? | LLM | “I'm AIPiloty…” | ~3.3s + thinking |
| q2 | are you a robot | LLM | real AI answer | ~2.8s |
| q3 | what is AIPiloty | LLM | real answer | ~3.3s |
| q4 | what is docker? | LLM/agent | used tools (docker version) | ~10s |
| v1–v2 | Hello!!! / Hi | static | OK after normalize | ~10–17ms |
| v3 | Who are YOU??? | LLM | real answer | ~3.0s |
| r1–r3 | yes / no / ok | document risk | **STATIC_SHORTCUT** | ~10–12ms |
| t1 | list my ollama models | agent | tool + answer | ~15.6s |

### 5.2 Browser end-user test (Chrome DevTools MCP)

| Step | Result |
|------|--------|
| Open `http://localhost:3000` | Login page OK |
| Sign in `admin` / `admin` | Dashboard/Chat OK |
| New chat → send `who are you?` | Streamed LLM reply: “I'm AIPiloty, your friendly AI DevOps…” with Thinking (1) — **not** canned “Got it!” |
| UI modes Agent / Ask / Auto visible | Present |

*(Browser MCP `user-browsermcp` timed out; used `user-chrome-devtools` successfully.)*

---

## 6. Recommended target architecture (do not implement here)

When you choose to change product code later:

1. Keep **exact** greeting short-circuit for: hello, hi, hey, thanks, bye (small set).
2. Remove `yes`/`no`/`ok`/`sure`/`cool` from static path — send to **tool-free LLM**.
3. Prefer intent enum: `SMALLTALK | GENERAL_QA | AGENT_TASK` (you already have `intent_classifier.py` — wire it as the router).
4. Add eval suite to CI (`chat_routing_deep_eval.py` or pytest wrappers).
5. Lower default `ollama_context_length` to 8192 for laptop UX; keep_alive finite (e.g. 5m).

---

## 7. Answer to “is static like this normal / best?”

| Approach | Normal? | Best? |
|----------|---------|-------|
| Static **filter** for greetings | Yes | Yes (tier 1) |
| Static **reply map** for hello/thanks | Acceptable for local agents | OK short-term |
| Static replies for yes/no/ok/cool + 30 variants | Common in demos | **No** — prefer classify → LLM without tools |
| ≤3-word catch-all (removed) | Anti-pattern | Already fixed |

**Bottom line:** The screenshot’s large static map is a **pragmatic latency hack**, not the gold standard. The professional approach is **intent routing + LLM for answers**, with keywords only for unambiguous smalltalk *classification*, not for every reply string.
