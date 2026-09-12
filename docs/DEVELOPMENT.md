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
One runtime dependency: `openai`, for its streaming chat.

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
| `src/shared/weather.ts` | The weather from open-meteo, for both versions |
| `src/server/index.ts` | The PC's HTTP server: the console's API, the live-readings stream, static files |
| `src/server/services.ts`, `config.ts` | The console core with its keys in `config.json`; reading and writing that file |
| `src/server/system.ts`, `scan.ts`, `world.ts`, `exec.ts` | Machine telemetry, the network sweep, the uplink and weather; running the system commands they read |
| `src/client/main.ts` | Boot only: imports the modules below in order and starts them |
| `src/client/state.ts` | The singletons every module shares (stage, workspace, panels, voice, connections) |
| `src/client/server.ts` | Which version this is: the PC with its server, or the web page on its own |
| `src/client/api.ts` | Typed calls to the console's API — to the server, or to `browser-core.ts` |
| `src/client/browser-core.ts` | The console core with its keys in the browser's storage — the same calls the server answers |
| `src/client/sensors.ts` | The web version's instruments: what a browser can genuinely measure of its device |
| `src/client/workspace.ts` | Threads, groups, colours and their lifecycle, as pure data (plus migrations) |
| `src/client/stage.ts` | The board: JARVIS, windows, bubbles, the bin — measured and moved by pointer; the pure parts are beside it |
| `src/client/board-geometry.ts`, `tidy.ts` | Pure and tested: keeping a window inside the board and clear of JARVIS, a free seat, bubbles nudged apart; the Tidy-up plan |
| `src/client/message.ts` | One line in a window: links, and pictures and players for image and video results |
| `src/client/ask.ts` | The command line, the queue, what JARVIS is told, the streamed answer, his housekeeping (naming threads, moving a new subject) |
| `src/client/commands.ts` | What can be said or written as a directive, and what the model may not do |
| `src/client/actions.ts` | Carrying out every action, by you or by JARVIS's directives |
| `src/client/confirm.ts` | Anything destructive waits for a yes — by button or by word |
| `src/client/local.ts` | Questions answered from live readings, never from a model |
| `src/client/voice.ts` | Which voice speaks, and speech out: sentences as they arrive, streamed and scheduled on the audio clock |
| `src/client/hearing.ts` | Speech in: the microphone, silence detection, the service's transcription, dictation as the fallback |
| `src/client/pcm.ts`, `device-voices.ts` | Pure and tested: the samples a service sends and where the speech in them is; ranking the device's own voices |
| `src/client/voice-ui.ts` | JARVIS as the microphone, the keyboard, Esc, the voice controls |
| `src/client/connections.ts` | The Connections screen |
| `src/client/setup.ts` | The first-run guide: where it's running, connecting a service, saying hello; back from Configuration or by asking |
| `src/client/memory.ts` | The board's room in the browser's storage |
| `src/client/readings.ts` | Painting the live readings, and receiving them |
| `src/client/threads.ts`, `links.ts`, `web.ts` | The Threads list; which threads are about the same things; the context web |
| `src/client/deck.ts`, `panels.ts`, `drawer.ts` | The deck and title row; the instrument panels; the configuration drawer |
| `src/client/say.ts`, `address.ts` | Notices, lines in a window, his status word; sir or ma'am |
| `src/client/radar.ts`, `core-draw.ts`, `icons.ts`, `stack.ts`, `motion.ts` | The Perimeter radar, JARVIS drawn, every icon, one stacking order, whether to hold still |
| `src/client/styles.css` | Ends with the two shared materials, `.glass` (every box) and `.veil` (behind anything modal); use the class rather than restyling an element |
| `src/client/public/` | The logo, app icons, manifest, the service worker that makes it installable, robots and sitemap |
| `scripts/icons.mjs` | Renders every icon size and the social preview image from `icon.svg` |
| `tests/` | Node's test runner over the pure modules |
| `.github/workflows/` | `ci.yml` (typecheck, tests, build on every push) and `pages.yml` (publishes the web version) |
| `docs/QA.md` | The manual test plan and a log of every run |
| `docs/PLAN-*.md` | Design decisions: the connection as the core; code mode |
| `docs/SUPPORT.md`, `.github/FUNDING.yml` | How to support the project, the sponsor tiers, and what puts the Sponsor button on the repository |

## Tests

**What they cover:** the board's geometry and the Tidy-up plan; the speech samples and the device-voice ranking; the console core with fake services (checking a key
once, the newest model, the chosen service, the reasons a question can't be
asked, an account out of credit shown on its card, hearing, a spent speech
model giving way to the next); migrations (including bringing an older save forward
without losing a message), creating and branching threads, grouping and
ungrouping, colours, where loose windows are kept, persistence round-trips, the
archive/clear/delete rules, moving a new subject to its own thread, context
isolation between threads, relatedness for the web, the command parser, how an
older save's positions are converted, model ranking, and the directive
whitelist (the model can't delete or confirm).

**What they don't:** anything in a browser — the canvas, dragging, resizing,
stacking, layout, media embedding and the voice pipeline are checked by hand,
and end to end in both versions, against [QA.md](QA.md).
