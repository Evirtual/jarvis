# Plan: code mode

**Goal.** A switch that turns JARVIS from the research console into a
developer at your side: in **code mode** he works on a project folder through
**Claude Code, installed and signed in on the PC** — reading, planning, editing
and running things, with you approving what matters, by voice or by tap.

**Decided (2026-09-12):** no extra cost. The agent is the Claude Code CLI on
the PC, driven headless (`claude -p --output-format stream-json`), signed in
with the user's own **Max plan**. Not the Agent SDK with that login — its docs
say third-party products may not offer claude.ai login, and point SDK users to
API keys — and not Managed Agents or a cloud sandbox, which are API-billed.
JARVIS is only the screen and the voice for the user's own Claude Code; anyone
else running JARVIS uses their own Claude Code and login. In the product it is
"Code mode, powered by Claude" — never branded as Claude Code. The console's colour turns from ice blue to amber so you always know which
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

The server starts `claude -p` in the project folder with
`--output-format stream-json` (and `--input-format stream-json` to keep a
session open for follow-ups, `--resume` to continue one), and turns its JSON
events into the console's own. Approvals: `--permission-prompt-tool` names a
small MCP tool the server provides; Claude Code calls it before any edit or
command, the server shows an approval card and answers with what the user chose.
Behind one interface, so another agent could be added later:

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

- **Claude Code CLI (first, and for now only)**: headless, as above. Start
  read-only (`--permission-mode plan`) in phase 2.
- Later, if ever wanted: the Agent SDK or the Codex SDK with an API key, behind
  the same interface.
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
- No keys at all: Claude Code uses the login already on the PC. JARVIS never
  reads or stores it. If Claude Code isn't installed or signed in, code mode
  says so and how to fix it (install Claude Code, run `claude` once, sign in).

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
2. **Server skeleton + the Claude Code CLI, read-only.** Project allowlist in
   Configuration; a code session that can read and plan, streaming into a code
   thread.
3. **Edits and commands with approvals.** `canUseTool` → approval cards →
   answers; diffs and command output rendered; stop.
4. **Sessions:** follow-ups in the same session, resume one later, and a list of
   past sessions per project.
5. **Safety pass.** Branch per session, dirty-tree warning, read-only list, the
   tunnel/access rule, and tests for the approval gate with fake adapters.
6. **Docs and QA.** README section, a code-mode section in `docs/QA.md`.

## Decisions to make first

- ~~Which agent~~ — decided: Claude Code on the PC, Max plan.
- Which project folders to allow at the start — just this repo?
- On a phone (through the PC's address on the home network): full code mode,
  or read-and-approve only?
- ~~Billing~~ — decided: the Max plan, through Claude Code's own login.

## Before any of this

- Claude Code installed on the PC and signed in with the Max account (`claude`
  in a terminal once). Check `claude -p "say hello" --output-format json` works.
- Nothing else: no API key, no tunnel. The subdomain for the web version can be
  pointed at GitHub Pages whenever convenient (`JARVIS_SITE_URL`).
