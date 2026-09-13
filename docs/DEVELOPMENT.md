# Development

## Commands

```bash
npm run dev
```

Vite with hot reload on :5173, proxying `/api` to the server on :7823.

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run serve
```

Builds the client and server and starts the PC version on :7823. The web
version is built with `VITE_JARVIS_SERVERLESS=1` (see
[`pages.yml`](../.github/workflows/pages.yml)).

Run the typecheck before trusting a change: Vite and the test runner both strip
types without checking them, so the app can build and every test can pass while
the types are broken.

Vanilla TypeScript, no UI framework — the board is canvas plus DOM writes when a
reading changes, and a re-render layer would add weight without buying anything.
One runtime dependency: `marked`, used as a Markdown parser only. Both services are reached with plain `fetch`.

The two versions share one back end (`src/shared/services/console.ts`): the
server and the browser each give it a place to read keys from and it does
the rest, so a fix to how a key is checked or an answer is streamed is made
once. It takes its services as a parameter, which is how the tests give it
fake ones.

## The code

One codebase, two versions: the PC version is served by its own Node server;
the web version answers the same API calls in the browser
(`browser-core.ts`). Both reach the services through the same code in
`src/shared/services/`.

| Path | What |
| --- | --- |
| `src/shared/types.ts` | The client/server contract — both sides import it, so the API can't drift |
| `src/shared/services/` | The two services behind one interface — `common.ts` (the interface, the persona, the helpers), `gemini.ts`, `openai.ts` — each answering, hearing and speaking; `index.ts` adds trying an account's models in turn, and plain-words errors |
| `src/shared/services/console.ts` | The console's back end, once for both versions: given where the keys are kept, it checks a key and remembers what it can reach, says which service is in use, and answers, hears and speaks through it |
| `src/shared/directives.ts` | Every action the console can do, and the one table of what the model may ask for: the persona tells the model about them from it, and the client parses a written directive with it |
| `src/shared/weather.ts` | The weather from open-meteo, for both versions |
| `src/server/index.ts` | The PC's HTTP server: the console's API, the live-readings stream, static files |
| `src/server/services.ts`, `config.ts` | The console core with its keys in `config.json`; reading and writing that file |
| `src/server/system.ts`, `scan.ts`, `world.ts`, `exec.ts` | Machine telemetry, the network sweep, the uplink and weather; running the system commands they read |
| `src/client/main.ts` | boot(): wires every module in one explicit order — no module runs anything when imported — then starts the readings and the connections; `migrate-storage.ts` is the one import that runs, first |
| `src/client/state.ts` | The singletons every module shares (stage, workspace, panels, voice, connections) |
| `src/client/server.ts` | Which version this is: the PC with its server, or the web page on its own |
| `src/client/api.ts` | Typed calls to the console's API — to the server, or to `browser-core.ts` |
| `src/client/dom.ts`, `storage.ts`, `text.ts`, `num.ts` | Small pure helpers: elements, escaping and formatting; every name the console stores under, and the one-time move of older names; clipping and edit distance; clamp |
| `src/client/palette.ts` | The stylesheet's colours for what is drawn on a canvas, read once |
| `src/client/markdown.ts`, `message.ts` | A reply's Markdown parsed with marked and drawn into the DOM node by node (no innerHTML), media markers lifted into cards |
| `src/client/core-chat.ts` | The conversation at the core — what is said outside any thread — kept in this browser, the last dozen lines sent with each question |
| `src/client/radar-split.ts` | The line under the radar that sizes it |
| `src/client/browser-core.ts` | The console core with its keys in the browser's storage — the same calls the server answers |
| `src/client/sensors.ts` | The web version's instruments: what a browser can genuinely measure of its device |
| `src/client/workspace.ts` | Threads, groups, colours and their lifecycle, as pure data (plus migrations) |
| `src/client/stage.ts` | The board drawn from the workspace and placed: windows, bubbles, the web; a press handed to the part that follows it |
| `src/client/board-store.ts`, `core-canvas.ts`, `stage-pointer.ts`, `stage-phone.ts` | The stage's parts: the workspace loaded and saved; JARVIS drawn and where he is; carrying, sizing and dropping on the desktop (what a drop means); the list a phone shows instead, its order and the grip |
| `src/client/surface.ts` | What every box on the board shares — window, bubble, panel: one pointer gesture at a time (tap or drag), sizing from corners and edges within one set of limits, carry past the edge and put down inside the board. The stage and `panels.ts` build on it; the pure parts are tested |
| `src/client/board-geometry.ts`, `tidy.ts` | Pure and tested: keeping a window inside the board and clear of JARVIS, a free seat, bubbles nudged apart; the Tidy-up plan |
| `src/client/message.ts` | One line in a window: links, and pictures and players for image and video results |
| `src/client/ask.ts`, `routing.ts` | The command line, the queue, what JARVIS is told, and the exchange in named pieces — stream, finish, fail, carry out; where a reply goes from the model's word, pure and tested |
| `src/client/commands.ts` | The console's own commands — the few that must work with nothing connected — the route at the head of a reply, and the directives at its end |
| `src/client/actions.ts` | Carrying out every action, by you or by JARVIS's directives |
| `src/client/confirm.ts` | Anything destructive waits for a yes — by button or by word |
| `src/client/local.ts` | Questions answered from live readings, never from a model |
| `src/client/voice-choice.ts` | Which voice speaks: the service in use's, the one picked for it, or the device's while a refused voice rests |
| `src/client/voice.ts` | Speech out: sentences as they arrive, streamed and scheduled on the audio clock, with the device's voice as the fallback |
| `src/client/hearing.ts` | Speech in: the microphone, silence detection, the service's transcription, dictation as the fallback |
| `src/client/pcm.ts`, `device-voices.ts` | Pure and tested: the samples a service sends and where the speech in them is; ranking the device's own voices |
| `src/client/voice-ui.ts` | JARVIS as the microphone, the keyboard, Esc, the voice controls |
| `src/client/connections.ts`, `provider-card.ts` | The Connections screen; a service's card, drawn once for it and for the guide |
| `src/client/setup.ts`, `readiness.ts` | The first-run guide: where it's running, connecting a service, what J.A.R.V.I.S. needs (microphone, location, sound), saying hello with the Voice tab's own controls; and the readiness card left on the board when the guide is closed with something undone |
| `src/client/memory.ts` | The board's room in the browser's storage |
| `src/client/readings.ts`, `panel-rows.ts` | The live readings painted — the deck's chips, and each open panel's body from rows, the PC's and a browser's with their own words — and received |
| `src/client/threads.ts`, `threads-panel.ts`, `conversation-panel.ts`, `board-links.ts` | What the stage reports back and the counts; the Threads list; the Conversation panel; the links between threads on the board |
| `src/client/links.ts`, `web.ts` | Which threads are about the same things (pure, tested); the context web |
| `src/client/deck.ts`, `layout.ts`, `panels.ts`, `drawer.ts` | The deck and title row; which layout the screen gets; the instrument panels; the configuration drawer |
| `src/client/say.ts`, `address.ts` | The line under the core (a notice and the reply, one box), lines in a window, his status word; sir or ma'am |
| `src/client/radar.ts`, `core-draw.ts`, `icons.ts`, `stack.ts`, `motion.ts` | The Perimeter radar, JARVIS drawn, every icon, one stacking order, whether to hold still |
| `src/client/styles.css`, `styles/` | One file per concern — tokens, deck, board, windows, web, core-line, dialogs, panels, controls, drawer, phone — imported in that order, the two shared materials last: `.glass` (every box) and `.veil` (behind anything modal); use the class rather than restyling an element |
| `src/client/public/` | The logo, app icons, manifest, the service worker that makes it installable, robots and sitemap |
| `scripts/icons.mjs` | Renders every icon size and the social preview image from `icon.svg` |
| `tests/` | Node's test runner over the pure modules |
| `.github/workflows/` | `ci.yml` (typecheck, unit tests, build, and the console end to end in Chrome, on every push) and `pages.yml` (publishes the web version) |
| `docs/QA.md` | The manual test plan and a log of every run |
| `docs/PLAN-*.md` | Design decisions: the connection as the core; code mode; the evaluation and plan for a simpler console (`PLAN-simplify.md`) |
| `docs/SUPPORT.md`, `.github/FUNDING.yml` | How to support the project, the sponsor tiers, and what puts the Sponsor button on the repository |

## Tests

**What they cover:** the board's geometry and the Tidy-up plan; the speech samples and the device-voice ranking; the console core with fake services (checking a key
once, the newest model, the chosen service, the reasons a question can't be
asked, an account out of credit shown on its card, hearing, a spent speech
model giving way to the next); migrations (including bringing an older save forward
without losing a message), creating and branching threads, grouping and
ungrouping, colours, where loose windows are kept, persistence round-trips, the
archive/clear/delete rules, naming,
relatedness for the web, the command parser, how an
older save's positions are converted, model ranking, and the directive
whitelist (the model can't delete or confirm).

**End to end** (`npm run build:client:web && npm run test:e2e`, and in CI):
the web version in a real Chromium against a fake ChatGPT and Gemini — the
guide, Configuration, threads and groups, the model's directives, panels, the
Threads list, error paths, input edges, a reload, a phone. Every scenario
starts from a clean console, so each runs alone and a failure poisons nothing
after it; every wait is for the thing itself, never a sleep.

**What neither covers:** dragging, resizing, stacking, media embedding and the
sound of the voice — checked by hand, in both versions, against [QA.md](QA.md).
