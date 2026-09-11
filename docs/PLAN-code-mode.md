# Plan: code mode

**Goal.** A switch that turns JARVIS from the research console into a
developer at your side: in **code mode** he works on a project folder through a
coding agent — the Claude Agent SDK or the OpenAI Codex SDK — reading, planning,
editing and running things, with you approving what matters, by voice or by
tap. The console's colour turns from ice blue to amber so you always know which
mode you're in.

An earlier version had a built-in code agent; it was removed (conversations
from it survive as "Previous conversation" threads). This is its return, done
differently: a mode rather than a special thread, a proper agent SDK rather than
a home-made loop, and approvals that can never be skipped.

---

## Where it runs: the PC only

The console now runs two ways (README → *Two ways to run it*): on the PC with
its own server, and as a serverless web page. A coding agent needs the project's
files and a shell, which only the PC's server has — so **code mode is a PC
feature**. In the web version the switch is shown but says "Code mode runs on
your PC" instead of turning amber; nothing tries to reach the PC from the web
(the page-to-server bridge was removed on purpose).

## What it should feel like

- **One toggle.** A mode switch in the title row (next to Configuration), and by
  voice: "switch to code mode" / "back to normal". The choice persists.
- **Amber, not blue.** In code mode the shared tokens (`--ice`, the glass tint,
  JARVIS's rings and glow, the veil) shift to the amber family already used for
  his "thinking" arc and triangle (`#ffb648`). One class on `<body>` swaps the
  palette; the canvas reads the same palette. Nothing else changes shape.
- **Code threads.** In code mode a new thread is a *code session* against a
  project. Its window shows the agent's running commentary, collapsed diffs,
  commands with their output, and **approval cards** (Approve / Deny; "yes" /
  "no" by voice). Groups, the web, stacking and the phone list work as today.
- **Spoken summaries, never diffs.** He says what he's about to do and what he
  did; the detail stays on screen.
- **Stop is always one tap away.** A stop button on the session and "stop" by
  voice cancel the agent immediately.

## Architecture

### Server — `src/server/code/`

One interface, two adapters, so the console never cares which agent runs:

```ts
interface CodeAgent {
  start(session: CodeSession, prompt: string): AsyncIterable<CodeEvent>;
  answer(session: CodeSession, approvalId: string, allow: boolean): void;
  stop(session: CodeSession): void;
}
type CodeEvent =
  | { t: "text"; delta: string }
  | { t: "plan"; steps: string[] }
  | { t: "edit"; file: string; diff: string }
  | { t: "command"; cmd: string; output?: string; exit?: number }
  | { t: "approval"; id: string; kind: "edit" | "command" | "network"; summary: string }
  | { t: "done"; summary: string }
  | { t: "error"; message: string };
```

- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`): `query()` with
  `permissionMode: "default"` and a `canUseTool` callback that turns every
  edit/command request into an `approval` event and waits for the answer.
  Start read-only (plan mode) in phase 2.
- **OpenAI Codex SDK** (`@openai/codex-sdk`): a Codex thread run with streamed
  events and a sandbox policy; the same approval gate in front of writes and
  commands.
- Sessions stream to the client over the same newline-delimited JSON as
  `/api/ask`; approvals come back as small POSTs.

### Safety — the rules that don't bend

- A session only ever works inside a **project folder you've added** in
  Configuration (an allowlist saved in `config.json`), never outside it.
- **Every edit and every command needs approval** unless it is on a short
  read-only list (listing, reading, `git status`, `git diff`, running tests).
  There is no "approve everything" — it was removed on purpose and stays gone.
- The model can never approve, deny or change its own permissions (as today,
  the directive whitelist can't confirm anything).
- Code mode endpoints are refused unless the request comes from the console
  (as now) **and**, when the console is reached through a tunnel, from behind
  the access check. No code mode on an exposed server without it.
- A dirty git tree is shown before a session starts; work happens on a branch
  the session creates, so undo is a branch delete.
- Keys stay on the server. Claude uses `ANTHROPIC_API_KEY` (or a Claude login
  on the machine); Codex uses the OpenAI key (or a ChatGPT login).

### Client

- `body.mode-code` and a `--mode-hue` token; the glass, veil, deck and core
  palette derive from it (the core's colours are hard-coded in `core-draw.ts`
  `drawCore`/`drawAurora` — move them into the `CoreLook` it already takes, as a
  palette, first).
- A code thread renderer: commentary, diff blocks (collapsed, expandable),
  command blocks, approval cards; phone layout as a normal thread.
- Voice commands: "switch to code mode", "back to normal", "approve", "deny",
  "stop", "show me the diff", "what are you doing".

## Order of work (tomorrow)

1. **The switch and the colour** — no agent yet. Palette tokens, `body.mode-code`,
   core recolour, the toggle in the title row, voice commands, persistence.
   QA both modes at every size, in both builds (the web build shows the switch
   disabled, with the reason).
2. **Server skeleton + Claude Agent SDK, read-only.** Project allowlist in
   Configuration; a code session that can read and plan, streaming into a code
   thread.
3. **Edits and commands with approvals.** `canUseTool` → approval cards →
   answers; diffs and command output rendered; stop.
4. **Codex SDK adapter** behind the same interface; choose the agent per project.
5. **Safety pass.** Branch per session, dirty-tree warning, read-only list, the
   tunnel/access rule, and tests for the approval gate with fake adapters.
6. **Docs and QA.** README section, a code-mode section in `docs/QA.md`.

## Decisions to make first

- Which agent first: Claude Agent SDK (richer tool permissions) or Codex SDK?
- Which project folders to allow at the start — just this repo?
- On a phone: full code mode, or read-and-approve only?
- Billing: API keys (pay per token) or the machine's Claude / ChatGPT logins.
  OpenRouter's free models answer ordinary questions but can't drive these
  agents: the Claude Agent SDK wants an Anthropic key or Claude login, the Codex
  SDK an OpenAI key or ChatGPT login.

## Before any of this

- A key with credit for the agent chosen: Anthropic for the Claude Agent SDK,
  OpenAI for the Codex SDK — or the matching login on the PC. The OpenAI key
  created on 2026-09-12 sits in an organisation with no credit; the Windows
  `OPENAI_API_KEY` belongs to one that has some, and JARVIS is set to ignore
  it (Disconnect), so choose deliberately.
- Nothing else: the subdomain no longer needs a tunnel — the web version is
  static. Point `jarvis.edgarasneverdauskas.com` at GitHub Pages and set the
  repository variable `JARVIS_SITE_URL` whenever convenient.
