# Handoff prompt: In-chat terminal + “background process” UX (AIPiloty)

Copy everything below the line into a new AI session. Repo path: `aipiloty/` (Next.js frontend + FastAPI backend).

---

## Context (why it doesn’t work today)

- The **browser cannot run the user’s shell**. Only the **machine where the FastAPI backend runs** can execute commands.
- Current tools (`get_host_environment`, `list_host_path`) are **read-only, non-streaming** JSON — there is **no** generic `run_terminal_command` tool and **no** SSE stream of command stdout/stderr into the chat UI.
- Chat UI renders **markdown + tool badges + expandable `<details>`** — there is **no** dedicated terminal panel, progress pipeline, or live log component wired to a long-running process.
- Models may **hallucinate** OS/disk facts unless the UI/agent **forces** answers to come only from tool JSON (already partially addressed in `orchestrator.py`).

---

## Product goal

When the user asks to “run a command”, “show terminal output”, or “watch a background process”, the app should:

1. **Execute** a bounded shell command on the **API host** (with strict safety), or refuse with a clear reason.
2. **Stream** stdout/stderr (and exit code) to the client in **real time** (SSE or WebSocket).
3. Show a **beautiful, readable** in-chat UX:
   - Dark terminal-style panel (monospace, ANSI-safe or stripped).
   - Optional **collapsible** “Process” card with status: `running` → `success` / `failed`, duration, exit code.
   - Optional **spinner / stepper** for multi-step agent loops (reuse patterns from `deployment-platform` if useful).
4. Never claim to run on “the user’s laptop” if the API runs in **Docker/Linux** — show a **banner**: “Commands run on: &lt;hostname&gt; / &lt;container?&gt;”.

---

## Premium UI/UX vision — avatar, interactivity, “out of the box” polish

The product owner wants **more interactivity** and **interesting usage** of the **AI avatar** and the **overall chat shell** — not generic SaaS, but something that feels **crafted** and **alive**. Treat this as a first-class goal alongside terminal streaming.

### Avatar & agent state (must feel connected to what the AI is doing)

- Define an explicit **avatar state machine** driven by **real app state**, not random animation:
  - `idle` — user not streaming, no tools.
  - `thinking` — LLM generating (match existing `isThinking` / streaming).
  - `tool_running` — a tool is in flight (`tool_start` seen, no `tool_output` yet).
  - `success` — last tool succeeded (short celebratory micro-animation, then back to idle).
  - `error` — tool error or API error (subtle shake / color shift, then idle).
- **Wire SSE → avatar:** extend event handling so the 3D (or 2D fallback) avatar **reacts** to `thinking`, `tool_start`, `tool_output`, `tool_error`, `done` — e.g. antenna pulse speed, eye color (already partially in `robot-3d-canvas.tsx` — **extend** this contract).
- **Single hero avatar option:** consider **one** large “companion” avatar in the chat column (welcome + active reply lane) vs many tiny canvases — multiple WebGL contexts caused **context lost** before; a **single shared Canvas** or **force2D** for sidebar + **3D only for main** is a valid tradeoff for stability + wow factor.

### Visual language & motion (delight without clutter)

- **Page background:** keep/enhance ambient layers (gradient mesh, subtle grain, very slow parallax or CSS-only motion). No heavy full-screen Three.js unless perf-budgeted.
- **Message transitions:** staggered fade/slide for new bubbles; respect `prefers-reduced-motion`.
- **Tool / terminal cards:** glassmorphism or soft elevation, clear hierarchy — **terminal output** should look like a **product feature**, not a debug dump.
- **Progress & “background work”:** when the agent runs multiple steps, show a **compact timeline** or **step chips** (reuse ideas from `deployment-platform` pipeline UI if helpful): e.g. “Planning → Running command → Summarizing”.
- **Micro-copy:** short status lines near the avatar (“Reading your request…”, “Running on server…”) driven by state — **optional**, toggleable, never blocking.

### Sound & haptics (optional, off by default)

- Optional **subtle UI sounds** on send / tool complete (user setting, default **off**).
- Mobile: light haptic on long-press copy — optional.

### Accessibility & performance

- **Keyboard:** focus rings, shortcuts to send / stop / new chat.
- **Performance:** cap simultaneous WebGL; lazy-load heavy components; test on M1 Mac + low-power GPU.
- **Dark mode** as default; ensure contrast for badges and terminal text.

### Files to extend (frontend)

- `aipiloty/frontend/src/components/ai-avatar.tsx`, `robot-3d-canvas.tsx`
- `aipiloty/frontend/src/stores/chat-store.ts` — derive `avatarPhase` or reuse streaming + last tool status
- `aipiloty/frontend/src/components/chat-messages.tsx` — layout for hero avatar + messages
- `aipiloty/frontend/src/app/globals.css` — tokens, motion utilities

### Acceptance criteria (UI/UX — add to checklist)

- [ ] Avatar **clearly changes** when streaming vs tool-running vs error (visual feedback in &lt; 200ms of state change).
- [ ] No blank “dead” chat when the agent is working — always a visible **status** or **skeleton** near the avatar or last message.
- [ ] `prefers-reduced-motion` respected; core flows still usable.
- [ ] Overall look feels **intentional** (spacing, typography, motion) — not default Tailwind-only.

---

## Security (non-negotiable)

- **No** arbitrary `eval` or unconstrained `bash -c` from user text without an allowlist or approval flow.
- Prefer: **allowlisted prefixes** (e.g. `df`, `ls`, `uname`, `sw_vers`) OR **user-confirmed** “Run this exact command?” for one-off.
- Hard limits: **timeout** (e.g. 30s default, 120s max), **max output bytes** (truncate with notice), **no network** by default (optional flag for admin).
- Paths: reuse `list_host_path` rules (under home) or workspace-only for project commands.

---

## Backend implementation outline

1. **New endpoint** (e.g. `POST /api/v1/terminal/run` or extend `/chat/stream` with a new event type):
   - Accept: `{ "command": ["ls", "-la", "~/Desktop"], "cwd"?: "...", "timeout_sec"?: 30 }` — prefer **argv array**, not a single string, to avoid injection.
   - Use `asyncio.create_subprocess_exec` (or sync `subprocess` in thread) and stream lines to the client.
2. **SSE events** (align with existing `AgentOrchestrator` / `chat.py` patterns):
   - `terminal_start`, `terminal_line` (text chunk), `terminal_end` `{ exit_code, truncated: bool }`
3. **Agent tool** (optional but recommended):
   - `run_terminal_command` that triggers the same runner and returns summary + path to full log in DB or last N lines.
4. **Orchestrator prompt**: When user asks for terminal output, **call the tool**; forbid inventing command output in prose.

**Files to study:**  
`aipiloty/backend/app/api/v1/chat.py`, `aipiloty/backend/app/services/agent/orchestrator.py`, `aipiloty/backend/app/services/tools/host/`.

---

## Frontend implementation outline

1. **Component** `TerminalPanel.tsx` or `CommandOutputCard.tsx`:
   - Props: `lines: string[]`, `status`, `exitCode`, `hostnameHint`.
   - Style: rounded border, `font-mono text-xs`, ANSI-to-safe HTML or plain text.
2. **Wire streaming**: extend `streamChat` / `handleSSEEvent` in `aipiloty/frontend/src/stores/chat-store.ts` to append terminal lines to the **current assistant message** or a dedicated `terminalSession` slice.
3. **UX polish**: shimmer while running; green/red badge on end; “Copy output” button.
4. **Empty response bug**: ensure `thinking` → `token` → `terminal_*` ordering never leaves an **empty** assistant bubble without a placeholder line (“Running command…”).

**Files to study:**  
`aipiloty/frontend/src/lib/api.ts`, `aipiloty/frontend/src/stores/chat-store.ts`, `aipiloty/frontend/src/components/chat-messages.tsx`.

---

## Acceptance criteria

**Terminal / agent**
- [ ] User: “Run `df -h` and show output here” → streamed output appears in a terminal card, **no** hallucinated numbers.
- [ ] User on Docker backend sees **Linux** `df` — UI shows **where** commands run.
- [ ] Long output is truncated safely with “output truncated” message.
- [ ] Malicious command rejected or blocked by allowlist.
- [ ] `npm run build` passes; backend starts without errors.

**Avatar & premium UX** (see section above)
- [ ] Avatar states wired to streaming + tool lifecycle; user can **tell** when the agent is thinking vs executing vs done.
- [ ] Polished chat shell (background, motion, cards) — **demo-worthy** in a 30s screen recording.

---

## Out of scope (unless explicitly requested)

- Full PTY interactive terminal (vim, ssh session) — much larger scope.
- Running commands on **remote VMs** — already partially covered by SSH tools; keep separate from “local API host terminal.”

---

## One-paragraph prompt (minimal, for quick paste)

“Implement **in-chat terminal output** for AIPiloty (`aipiloty/`): FastAPI endpoint that runs **bounded** shell commands on the **backend host**, streams **stdout/stderr** to the Next.js client via **SSE** (new event types), and a **terminal-style UI component** in the chat thread with running/success/failed states, copy button, and a **banner** showing whether the API runs on the user’s machine vs Docker. Add agent tool `run_terminal_command` and orchestrator instructions to **never fabricate** command output. Reuse patterns from `chat.py` and `chat-store.ts`. Security: argv-based exec, timeouts, output caps, allowlist or approval.

**Also ship a premium UI/UX pass:** wire the **3D avatar** (`robot-3d-canvas.tsx`) to a clear **state machine** (idle / thinking / tool_running / success / error) driven by SSE + chat store; reduce WebGL churn (e.g. one hero canvas or 2D in sidebar); add **ambient background**, **message motion**, and **tool/terminal cards** that feel crafted — not generic; respect `prefers-reduced-motion`; goal is an **out-of-the-box impressive** chat experience in a short demo.”

---

## Extended one-paragraph prompt (terminal + avatar + polish)

Use this when the other AI should optimize for **maximum UI/UX impact**:

“On `aipiloty/`, implement **streaming terminal/command output** in chat (bounded backend exec → SSE → `TerminalPanel` + host banner Docker vs native). In parallel, redesign **interactivity** around the **AI avatar**: derive **avatar phase** from real events (`thinking`, `tool_start`, `tool_output`, `tool_error`, `done`), extend `Robot3DCanvas` expressions or add a **single shared** WebGL canvas to avoid context loss, polish the **chat shell** (background layers, staggered message animation, tool timeline / step chips), and ensure **no empty dead states** while the agent works. Follow accessibility (reduced motion) and performance (limit concurrent canvases). Document new components and update acceptance criteria in `docs/PROMPT_TERMINAL_AND_PROCESS_UI_FOR_NEXT_AI.md`.”
