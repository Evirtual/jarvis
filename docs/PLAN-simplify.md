# Plan: a simpler console

**Status (2026-09-13): proposed.** A full reading of the repository — every
source file, the styles, the tests, the workflows and the docs — with what
should change, in what order, and what should be left alone. Nothing here is
done yet.

## The short version

Line by line the code is in good shape: typed strictly, commented, with 104
unit tests and 22 end-to-end scenarios, and one shared back end for the two
versions. The trouble is not sloppy code. It is the **number of concepts** and
the **number of places each concept lives**. Over one day the console gained
conversation-first routing, a Conversation panel, a readiness card, a shared
surface behaviour, phone sizing and a grip — each sound on its own, each added
beside what was there rather than replacing it. Several ideas now exist twice
or three times:

| One idea | Where it lives today |
| --- | --- |
| "JARVIS says something under the core" | `toast` (a notice), `say` (the reply), `jarvis` (reply + transcript + voice), `announce` (notice + voice), `noteIn` (a line inside a thread), `coreChat.add("sys")` — six calls, two boxes, one line on screen shared with his status word and the bin |
| "Name a thread" | `titleFrom` (a stand-in cut from the question, 35 lines of regex), `title_thread` (the model renames a stand-in), `new_subject` (the model moves the exchange to a new thread), `[[at: new "Title"]]` (the model names it up front), `named` and `provisional` flags |
| "What did the user ask the console to do" | `KEY_PATTERNS` (a pasted key), `parseUtterance`/`intentOf` (161 lines of ordered regex), `localCommand` (another regex set), the model's `[[at:]]` route, the model's `[[do:]]` directives, and two housekeeping directives |
| "The list of actions" | the `Action` type (37), `runAction` (37 cases), `directiveToAction` (28 cases), the persona text (27 names) — four places to touch for one new action |
| "A setting kept in the browser" | 23 current keys plus 12 old names still read through `recall(new, old)` fallbacks |
| "A service's card" | drawn in `connections.ts` and again in `setup.ts`, ~60 lines each; five commits this week were about keeping the two the same |
| "The instrument panels' readings" | `paintTelemetry` (the PC) and `paintWeb` (the browser) write into the same 30 element ids, with 16 labels swapped by `data-web` so "Fan" can show the graphics API |

The rest of this document says what each of these costs, what to do about
it, and how big each change is. The recommended order is at the end.

## The map, so the whole thing fits in one head again

**What is on screen.** The stage (`stage.ts`) draws JARVIS on a canvas and
hosts three kinds of box, all handled by one gesture module (`surface.ts`):
thread windows, group bubbles, instrument panels (`panels.ts`). The deck at
the bottom holds the readings (`deck.ts`, `readings.ts`). The configuration
drawer, the first-run guide and the confirmation dialog are modal sheets.
Under JARVIS, on one line: his status word, a passing notice, the line he is
saying, and the bin when something is carried.

**What is data.** `workspace.ts` is the board as pure data: threads (with
their turns and their layout), groups, which thread is in front. `core-chat.ts`
is the conversation at the core. Everything else is settings.

**How a sentence travels.** `ask.ts` takes what you typed or said → a pasted
key is intercepted → `commands.ts` splits it into console actions and a
question → `local.ts` answers the built-in questions from readings → the rest
goes to the connected service with a snapshot of the board (`askCore`) → the
reply's first words say where it belongs (`[[at: core|thread|new]]`) → it is
streamed there and spoken (`voice.ts`) → directives at the end are carried out
(`actions.ts`).

**Where the service is.** `api.ts` calls the PC's server or, on the web,
`browser-core.ts`; both drive the same `shared/services/console.ts`, which
talks to `gemini.ts` or `openai.ts`.

That is the whole app. Everything below is about making the code match that
paragraph more closely than it does now.

## Findings

Each finding: what it is, the evidence, what it costs, the fix, and its size
(S: an hour or two; M: half a day; L: a day or more).

### A. Ideas that exist more than once

**A1. Two notice boxes under the core.** `#toast` is a passing notice
(6 seconds, not recorded, for console operations: "Put away", "Queued",
"Related to…", the greeting). `#coreSay` is the line being said (a reply or a
built-in answer, 14 seconds or while speaking, tap to open the Conversation,
recorded). Both sit at `--status-y`; when both show, the notice is lifted above
the line by its measured height. Until yesterday they were also styled apart.
*Cost:* the user sees two things that look like one thing behaving
differently, and a third (the status word) and a fourth (the bin) share the
line. *Fix:* one element, one component: a `CoreLine` in `say.ts` that renders
a stack — the reply row and, above it, at most one notice row — inside one box,
with the status word as its header when nothing else is showing. Notices are
recorded in the Conversation as `sys` lines, so the panel is truthful about
what was said. `toast`, `announce`, `say`, `jarvis` become two calls: `reply()`
and `notice()`. Size: M.

**A2. Three ways to name a thread.** Since replies declare their place, a new
thread is named by the model in `[[at: new "…"]]`. The stand-in naming
(`titleFrom`), the `provisional` flag, `title_thread` and `new_subject`
(`splitLast`) date from the earlier rule that "a question goes to the thread in
front and JARVIS judges whether it is a new subject" — which
[GUIDE.md](GUIDE.md) still describes at line 71, contradicting the
"Conversation first" section further down. *Cost:* 15 uses across five files,
a persona paragraph, three unit tests, and two behaviours that can both fire on
one reply. *Fix:* keep only `title_thread`, sent when the thread in front is
still called "New thread" (one flag: `title === DEFAULT_TITLE`); a
`[[at: thread]]` with nothing in front is answered at the core. Remove
`titleFrom`, `provisional`, `new_subject`, `splitLast`, `housekeep`. Size: M.

**A3. A regex parser and a model that can do the same things.** `intentOf` is
161 lines of ordered regular expressions with comments such as "before X so Y
isn't read as Z". The model can operate the same actions through directives,
and the persona says so. *Cost:* the most brittle code in the client; every new
phrasing is a new regex and a new ordering hazard; a typed sentence can be
chopped before the model sees it. *Fix:* keep a **small, offline** set the
console must answer without a service (yes/no to a confirmation, mute/unmute,
open/close config, close this chat, the panels, a pasted key) and send
everything else to the model when one is connected; when none is, the small set
is all there is, and the console says so. Size: M, and it shrinks the
`commands.test.ts` surface rather than growing it.

**A4. Four tables for one list of actions.** Adding an action means the
`Action` type, `runAction`, `directiveToAction` and the persona text. *Fix:* one
`ACTIONS` table (name, arguments, allowed from the model, one-line description)
from which the persona's directive list and the directive parser are generated,
and which `runAction` switches over. Size: M. Also cuts the persona.

**A5. Twelve old storage names.** `recall(new, old)` reads a value under its
old name if the new one is missing: `jarvis.core`, `jarvis.pitch`,
`jarvis.rate`, `jarvis.tapSpeaks`, `jarvis.voiceOn`, `jarvis.listenPause`,
`jarvis.manualStop`, `jarvis.panelSeats`, `jarvis.panelsOpen`, `jarvis.radarH`,
`jarvis.readinessSkip`, `jarvis.readinessSeenReady`, plus the pre-groups
`jarvis.threads`/`jarvis.activeThread`. All were renamed this week. *Fix:* one
`migrateStorage()` at boot that renames each old key once, then plain reads;
one `settings.ts` that owns every key name in a typed table. Size: S.

**A6. The provider card, twice.** `connections.ts` and `setup.ts` each render
a service's card. *Fix:* one `providerCard(view, { inGuide })` used by both.
Size: S.

**A7. The panels' readings through repurposed ids.** `paintWeb` writes the
screen size into `#gpuPwr` and the graphics API into `#gpuFan`; `index.html`
carries 16 `data-web` labels to relabel the rows. *Fix:* each panel body drawn
from a small view-model (`rows: [label, value][]`) by one painter, with the PC
and the browser each supplying their rows. Size: M.

### B. Structure

**B1. `stage.ts` is 1,445 lines and owns too much.** Persistence (load, save,
migrate, the corner conversion), the workspace itself, card and bubble DOM,
placing, phone list sizing, phone reordering, desktop carry/size/drop, the
canvas loop, the web, tidy. `state.ts` exposes the workspace as
`graph.ws`. *Fix:* split by concern, without changing behaviour:
`board-store.ts` (load/save/migrate, owns the Workspace, `onSaved`),
`stage.ts` (render and place), `stage-pointer.ts` (desktop gestures and what a
drop means), `stage-phone.ts` (`fitList`, reorder, the grip), `core-canvas.ts`
(the frame loop). Each under 400 lines. Size: L.

**B2. Eight import cycles and nine side-effect imports.** `say↔ask`,
`actions↔ask`, `threads↔actions`, `confirm↔threads`, `voice-ui↔ask`,
`readings↔deck`, `deck↔threads`, `say↔confirm`; `main.ts` imports nine
modules for their side effects, and `threads.ts`, `readiness.ts`, `memory.ts`,
`voice-ui.ts` wire callbacks at import time. It works because every use is
inside a function, but it is why `state.ts` "must import nothing", why
`voice-ui.ts` paints "on the next frame, when every module has loaded", and why
boot order is a thing one has to know. *Fix:* an explicit `boot()` in `main.ts`
that constructs the modules in order and wires their callbacks; modules export
functions and take what they need. Size: L, best done alongside B1.

**B3. `voice.ts` is 704 lines with two jobs.** Which voice speaks (selection,
preferences, resting a refused service) and how it speaks (the audio graph,
the streamed synthesis scheduler, the device fallback). *Fix:* `voice-choice.ts`
and `speech-out.ts`. Size: M.

**B4. `threads.ts` mixes five things.** Counts, the Threads panel's HTML, the
Conversation panel, the links, and the stage's callbacks. *Fix:*
`threads-panel.ts`, `conversation-panel.ts`, `board-links.ts`, with the
callbacks in `boot()`. Size: S once B2 exists.

**B5. `askCore` is a 169-line function.** Closures `place`, `setBody`,
`askVia`, two levels of try/catch and a `current()` accessor to satisfy the
type checker. Both of yesterday's bugs were in it, and nothing tests it because
it is bound to the DOM. *Fix:* a pure `whereTo(route, front, live)` that
decides the target (tested), and an `Answer` object with `write`, `finish`,
`fail` that does the drawing. Size: M.

**B6. `Thread` is a bag of 13 optional fields.** Conversation data (`turns`,
`parentId`, `ties`, `archivedAt`), naming (`named`, `provisional`), layout
(`x`, `y`, `size`, `fit`, `mh`, `open`), and `kind`. *Fix:* after A2, move
layout into `layout?: { x, y, w, h, mh, open }`, so migrations and tests read
as two things. Size: M, with a migration.

**B7. `deck.ts` also switches the layout mode and dismisses phone sheets.**
*Fix:* `layout.ts` for `applyMode` and the phone sheet rule. Size: S.

### C. Dependencies

**C1. The OpenAI SDK is the largest thing shipped.** It is one lazy chunk of
255 KB; the console uses two calls from it, `models.list` and a streaming
`responses.create`, both of which are a `fetch` and a server-sent-event stream
that `gemini.ts` already does by hand with `eventsOf`. *Fix:* two `fetch`
calls in `openai.ts`; remove the dependency. The lock file stops churning, the
web page loads 255 KB less, and `dangerouslyAllowBrowser` goes. Size: S.

### D. Styles

**D1. One 1,404-line stylesheet with 22 `!important`s and 55 phone
overrides.** The `!important`s are specificity fights between the desktop
rules and the phone ones (`transform: none !important`, `width: 100%
!important`), and between a carried window and its own transition. Two
comments say "how it is laid out is with the other rules further down".
*Fix:* split into files by concern (`tokens`, `deck`, `board`, `windows`,
`panels`, `drawer`, `phone`) imported in order; give the phone its own rules
by putting the desktop-only ones under `body.m-desk` so neither needs
`!important`. Remove the `--chamfer: none` token (7 uses of a no-op). Size: M.

### E. Tests

**E1. The unit tests are fine and fast** (0.5 s, 104) and are not in the way.
The pure modules they cover — workspace, commands, links, geometry, tidy,
surface, pcm, markdown, the shared core — are the ones that don't regress.

**E2. The end-to-end suite is order-dependent and sleeps 106 times.** One
549-line script; each scenario relies on the state the previous one left. A
failure part-way (as happened today) poisons the scenarios after it, and the
`wait(800)`s make it both slow and occasionally flaky. It is not run in CI.
*Fix:* a `fresh()` helper that clears storage, reloads and reconnects the fake
service, used at the top of every scenario; replace sleeps with
`waitForFunction` on the thing being waited for; add it to `ci.yml` (the
runner has Chrome). Size: M.

**E3. The heart is untested.** `ask.ts` routing and `say.ts` are DOM-bound
and have no unit tests; they are where the bugs have been. B5 fixes this.

### F. Documentation and words

**F1. [GUIDE.md](GUIDE.md) line 71** still describes the new-subject rule
that conversation-first replaced. *Fix with A2.*

**F2. Stale comments:** `styles.css` line 666 "the conversation in the Threads
panel", line 939 an empty "caret" heading, `core-draw.ts` line 24 a dangling
"One field of colour". `Stage.parentOf` is unused. Size: S.

**F3. The PC version's extra readings are Windows-only** (one PowerShell probe
for battery, Wi-Fi, disks, gateway) and nothing in the README says so; on
macOS or Linux those rows are simply empty. *Fix:* one sentence in the README
and HOW-IT-WORKS. Size: S.

**F4. The persona is 7,364 characters, sent with every question** (about 1,800
tokens), a third of it the directive catalogue. A4 generates that part from
the table and lets it be trimmed to what the model needs. Size: with A4.

**F5. [QA.md](QA.md) is 1,050 lines.** Useful, but the run log has become the
place where "what changed" is recorded, duplicating the commit history. *Fix:*
keep the checklist; keep only the last run's log and link the rest to git.
Size: S.

## What to leave alone

These look elaborate and are earning their keep; changing them would cost
more than it saves:

- `surface.ts` — one gesture, one sizing, one put-down for every box. Tested.
- `workspace.ts` — the board as pure data with its lifecycle rules. Tested.
- `shared/services/console.ts` — one back end for both versions. Tested.
- `message.ts` and `markdown.ts` — replies drawn from tokens, never markup.
- `board-geometry.ts`, `tidy.ts` — pure and tested.
- `hearing.ts` — the recording, the pause detection, the dictation fallback.
- The server (`src/server/`) — small, plain, does its job.

## Recommended order

Each step leaves the app working and tested; stop at any point.

1. **Words and dead weight** (F2, F3, A5, C1): stale comments, the README
   sentence, one storage migration, the SDK out. A day. Removes a dependency
   and twelve old names; nothing the user sees changes.
2. **One line under the core** (A1) and **one way to name a thread** (A2,
   F1): the two things the user noticed. A day. Removes two directives, five
   fields and flags, and 35 lines of naming regex; the guide says one thing.
3. **One table of actions** (A4) and **a small offline command set** (A3):
   the parser stops being the place phrasings go to break. A day and a half.
4. **The stage in parts, and an explicit boot** (B1, B2, B4, B7, B5): the
   structural change. Two to three days. After it, no module runs code at
   import, and the module a thing is in is the module its name says.
5. **Readings from a view-model, the card once, the voice in two**
   (A7, A6, B3). A day and a half.
6. **Styles by concern** (D1) and **the end-to-end suite made independent and
   put in CI** (E2). A day and a half.

Steps 1–3 are where the confusion is; 4–6 are where the maintenance cost is.
After step 3 the console has roughly the same behaviour with about a fifth
fewer lines and three fewer concepts; after step 6 every file is under 500
lines and the whole thing runs in CI, phone included.
