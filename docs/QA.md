# JARVIS Console — manual QA plan

The unit tests (`npm test`) cover the pure modules. Everything that happens in a
browser — layout, dragging, stacking, the web, media, voice, phones — is checked
by hand against this list. Run it after any change to the board, the deck or the
styles, and add a row to the [run log](#run-log) at the bottom.

**Before a run**

1. `npm run typecheck`, `npm test`, `npm run build` — all clean.
2. Restart the server if anything under `src/server/` changed (`npm start`).
3. Use a fresh browser profile or clear site data for `localhost:7823`, so the
   run starts from the clean screen. Never test in your everyday profile: the
   board lives in browser storage.
4. Sizes to cover: **1440×900, 1280×720, 1024×768, 768×1024** (desktop layout),
   **414×896, 375×812** (phone layout, below 760px wide).

Tests marked **(model)** need a connected reasoning core with credit; the rest
run entirely locally.

**A quick fixture.** Paste in the devtools console to get six threads (four
loose, two grouped) without asking a model anything, then reload:

```js
const now = Date.now(), T = (id, title, color, g, q, a, x, y) => ({ id, title, named: true, color, groupId: g, createdAt: now - 1000 * +id.slice(1), turns: [{ role: "user", content: q }, { role: "assistant", content: a }], ...(x !== undefined ? { x, y } : {}) });
localStorage.setItem("jarvis.workspace", JSON.stringify({ version: 2, anchor: "corner", activeId: "t1",
  groups: [{ id: "g-general", title: "General", createdAt: 0, origin: "system" }, { id: "g1", title: "Baltic incidents", createdAt: now, origin: "user", x: 420, y: 380 }],
  threads: [
    T("t1", "Baltic cable damage", "#6ff0ff", "g-general", "What is the latest on the Baltic Sea cable damage?", "Finnish police are investigating the Eagle S tanker over the Estlink 2 cable in the Gulf of Finland.", 60, 70),
    T("t2", "Eagle S oil tanker", "#ffb648", "g1", "show me images of the Eagle S", "The Eagle S is a shadow-fleet tanker detained by Finland after the Estlink 2 damage."),
    T("t3", "Estlink 2 repairs", "#b48cff", "g1", "When will Estlink 2 be repaired?", "Repairs clip, sir.\n[[media:video https://www.youtube.com/watch?v=QTJF4fWjLYA]]"),
    T("t4", "Shadow fleet sanctions", "#56e39f", "g-general", "what are the sanctions on the shadow fleet", "The EU listed more shadow-fleet tankers, including ships linked to the Baltic cable incidents.", 900, 90),
    T("t5", "Solar storms", "#ff7ab6", "g-general", "whats happening with solar storms", "Auroras may be visible across the Baltic region and Finland tonight.", 880, 420),
    T("t6", "Rail Baltica", "#7fb2ff", "g-general", "find videos of the Rail Baltica works", "Two clips, sir.\n[[media:video https://www.youtube.com/watch?v=mvnkzeje-94]]", 100, 470),
  ] }));
localStorage.removeItem("jarvis.stack");
```

---

## 1. Layout: title row, deck, board

| ID | Steps | Expected |
| --- | --- | --- |
| L-01 | Clean start at 1440×900 | Only the title row (Threads and Conversation top-left, each with a count, J.A.R.V.I.S. centred, Configuration top-right), JARVIS at the bottom centre, and the deck. No thread, no text box. |
| L-02 | Look at the deck | New thread button left of JARVIS, keyboard right of him. CPU/GPU/Disk on the left edge, Net/LAN/Sky on the right edge. Readings show icon + value only (no labels). |
| L-03 | Each reading's colour | CPU, GPU, Disk, Net, LAN, Sky each have their instrument's colour on border/icon; the same colour as that panel's border and title. Open a panel: its reading lights up in that colour. |
| L-04 | Narrow the window (1440 → 768) | Each side folds its least important reading first (Disk, then LAN, …) into its own More (2×2 grid icon). Nothing overlaps JARVIS or the side buttons. |
| L-05 | Title-row clearance | Drag any window, group or panel towards the top: on release it sits below the title row (≥ 56px). Nothing is ever drawn over the corner buttons. |
| L-06 | Deck clearance | Drag a window down over the deck and release: it comes back above the deck. |
| L-07 | Screen width change keeps windows | Note a window's position and width at 1440; resize to 1100 and back. Width never changes; position only changes if it would be off the right edge, and returns when widened again. Panels behave the same way. |
| L-08 | Old save conversion | Put a save with no `anchor` and centre-based `x: -300, y: -200` in storage; reload at 1024×768. The window appears at (212, 184) and the save now has `anchor: "corner"`. |
| L-09 | Icon sizes | Title-bar buttons on threads, groups and panels are the same size (22px button, 16px glyph); panel titles carry their instrument icon; every close is the same drawn ×. |

## 2. Stacking (what's on top)

| ID | Steps | Expected |
| --- | --- | --- |
| S-01 | Open Compute over a loose window | Panel is on top. Click the window behind it: the window comes above the panel. Click the panel: it's on top again. |
| S-02 | Click a thread inside a group | The whole group comes to the top. |
| S-03 | "open the Baltic cable damage thread" | That thread opens, becomes active and comes to the top. |
| S-04 | Reload | The last order is kept (`jarvis.stack`). |
| S-05 | Phone | A More sheet always opens above the thread list; panels are part of the list itself, so they never cover a thread. |

## 3. Threads

| ID | Steps | Expected |
| --- | --- | --- |
| T-01 (model) | Clean screen, ask "What is the latest on the Baltic Sea undersea cable damage investigations?" | One thread opens, named for the subject ("Baltic Sea undersea cable da…"), answer names its source in words. |
| T-02 | Title from instruction-style questions | "show me images of the Eagle S" → "Eagle S"; "what's happening with solar storms" → "Solar storms"; "can you tell me about Lithuania" → "Lithuania". |
| T-03 | Click an inactive window's body | It becomes active; nothing folds. |
| T-04 | Click the active window's title bar | It folds to its bar; click again, it opens. Other windows unaffected. |
| T-05 | Resize from each corner | NW/NE/SW move that corner only, the opposite corner stays put. Double-click any corner resets the size. |
| T-06 | New threads never land on others | With four loose windows placed, "open a new thread" ×3: none overlaps an existing window or group. |
| T-07 | × on a window | Put away; appears under "Put away" in the Threads panel; "restore Baltic cable damage" brings it back. |
| T-08 | Commands don't pollute | Any local command (fold, rename, switch, yes/no) writes nothing into a thread's history. |

## 4. Groups (drag and drop)

| ID | Steps | Expected |
| --- | --- | --- |
| G-01 | Drag a loose window onto another | They become a group named after the target; colour is the blend. Group appears at the target's place, never inside the title row. |
| G-02 | Drag a grouped window onto JARVIS | It leaves the group, loose again; a group left with one thread dissolves. |
| G-03 | Drag a grouped window to open space | It becomes a loose window where dropped (pulled back into view if needed). |
| G-04 | Drag a window onto a group | It joins that group. |
| G-05 | Group title bar | Drag moves the group; fold button makes an orb; clicking the orb opens it. |
| G-06 | Group resize | Any corner; list scrolls inside; double-click corner resets. |
| G-07 | By voice | "fold Baltic incidents", "expand Baltic incidents" (no word "group" needed), "rename the Baltic incidents group to Baltic Sea", "move Solar storms into Baltic Sea". |
| G-08 (model) | "set up a research group on Baltic Sea security with one thread on the undersea cable incidents and one on the Russian shadow fleet" at a clean screen | A group with the two threads; **each** gets its own question, answered in turn; no stray thread named after the request is left behind. |

## 5. Deleting, archiving, clean screen

| ID | Steps | Expected |
| --- | --- | --- |
| D-01 | Pick up a window | The bin rises on the status line just above JARVIS (the status word and any notice step aside). |
| D-02 | Drop on the bin, answer "no" | Confirmation over the blurred veil; "no" by text cancels, window unchanged and in place. |
| D-03 | Drop on the bin, answer "yes" | Thread deleted; notice "… is deleted". |
| D-04 | Drag a group by its title onto the bin | Asks; deleting takes its threads. |
| D-05 | "put all away" / "put all threads away" / "put everything away" | Every thread put away (recoverable). "put all panels away" closes panels instead. |
| D-06 | "delete everything" → Confirm | Clean screen; Threads count 0; notice "The board is empty". |
| D-07 | The model never deletes | Ask the model to delete a thread: it can't; only you can, with confirmation. |

## 6. The context web

| ID | Steps | Expected |
| --- | --- | --- |
| W-01 | ⌗ on "Baltic cable damage" (fixture) at 1440 | Veil over the board; heading "Context web · BALTIC CABLE DAMAGE"; the thread as a larger card in the middle; related threads as glass cards in their own colours, two to four a side, with #tag, last line and "why" chips; strands in each thread's colour from card edge to card edge. The masthead steps aside. |
| W-02 | Move the pointer | Cards and strands drift together (strands stay attached). |
| W-03 | Below 860px wide / phone | Thread card at the top, related cards listed beneath with a rail down the left; nothing overlaps. |
| W-04 | Tap a related card | Web closes, that thread is active and on top (phone: scrolled into view). |
| W-05 | Thread with nothing related | "Nothing else on the board shares this thread's context yet." |
| W-06 | Esc / tap background | Closes. |

## 7. Media

| ID | Steps | Expected |
| --- | --- | --- |
| M-01 (model) | "show me images of the Eagle S oil tanker" | 2–5 images inline, full card width, no written links. |
| M-02 (model) | "open a new thread and find videos of the Rail Baltica construction" | New thread "Rail Baltica construction"; 2 YouTube players (youtube-nocookie). |
| M-03 | Play a video, drag its window around open space | Video keeps playing; the drag is smooth (no blur while carried). |
| M-04 | Play a video, drag its window out of its group and back | Keeps playing. (Moving it into a *different* group re-parents it and reloads the player — known.) |
| M-05 (model) | "what are your sources for that? give me the links" | Sources line with clickable https links. |

## 8. Panels and sheets

| ID | Steps | Expected |
| --- | --- | --- |
| P-01 | Click each reading | Its panel opens at its first seat (machine left, world right, Threads under its corner button); click again closes. |
| P-02 | Drag / resize a panel | Title drags; any corner resizes; text scales; stays below the title row and above the deck. |
| P-03 | Esc | Closes the front panel. |
| P-04 | Reload | Open panels, positions and sizes are remembered. |
| P-05 | Phone: left More | "Systems" sheet with CPU, GPU, Disk rows (icons in instrument colours). |
| P-06 | Phone: right More | "Surroundings" sheet with Net, LAN, Sky; opening one closes the other. |
| P-07 | Phone: tap a row | Its panel opens at the top of the thread list and scrolls into view. |
| P-08 | Phone: open two or three panels | They sit at the top of the thread list, full width, and scroll with it; none covers a thread. |

## 9. Overlays and materials

| ID | Steps | Expected |
| --- | --- | --- |
| O-01 | Open Configuration | Drawer is glass; behind it the same blurred veil as a confirmation and the web (`--veil-bg`, `--veil-blur`). |
| O-02 | Every box | Threads, groups, panels, web cards, More sheets, drawer, dialog, keyboard, notices: same glass gradient and 16px blur (`.glass`). |
| O-03 | Notices | Appear on the status line above JARVIS, one line on a phone. |

## 10. Voice and address

| ID | Steps | Expected |
| --- | --- | --- |
| V-01 | Config → Voice → Address me as → Ma'am | Notice "Very good, ma'am."; the typing prompt reads "MA'AM ›"; later notices say ma'am. |
| V-02 | Say/type "call me sir" | Back to sir; setting follows. |
| V-03 (model) | Ask anything with ma'am set | The model's answer addresses you as ma'am. |
| V-04 | Names are untouched | A notice about a thread called "Sir David" keeps "Sir David". |
| V-05 | Tap JARVIS | Listens (default) or opens the keyboard, per "Tap JARVIS to speak". |

## 11. Local commands (no model)

"status", "what time is it", "weather", "show me the radar", "close all panels",
"open config", "mute" / "unmute", "use the Charon voice", "speak faster",
"switch to Rail Baltica", "minimise Baltic cable damage", "open the Baltic cable
damage thread", "rename Solar storms to Space weather." — each acts at once, with
a short notice, and nothing reaches the model. While an answer is streaming, a new
request is **queued** ("Queued — I'll take … next") and asked in the thread that
was in front when you asked.

## 12. Phone specifics (375×812 and 414×896)

| ID | Steps | Expected |
| --- | --- | --- |
| F-01 | Thread list | Every loose window the full list width; grouped ones full width inside their group. List runs from under the title row to above the status line. |
| F-02 | Tap another thread's body | Focuses it, nothing folds. Tap the active one's title: folds to its bar only (nothing below it). |
| F-03 | Deck | More · New thread · JARVIS · Keyboard · More; all visible, none overlapping. |
| F-04 | No horizontal scroll | At both sizes. |

## Known limitations

- Panels find free room among other panels, but can still sit over a thread
  (whichever you touch comes to the top).
- Windows keep their saved spot when the screen narrows, clamped into view, so
  on a much smaller screen two can end up overlapping until you move one.
- On a full board a new window takes the seat with the least overlap; some overlap
  is then unavoidable.
- Moving a window with a playing video into a different group reloads the player
  (the browser reloads an iframe that changes parent).
- The web's relatedness is word-based: threads sharing place names (Finland,
  Baltic) count as related even when the subjects differ.

---

## Run log

### 2026-09-11 — build after the deck/header rework

Sizes: 1440×900, 1280×720, 1100×900, 1024×768, 800×863, 768×1024, 414×896,
375×812. Typecheck clean, 43 unit tests pass, build clean.

| Area | Result |
| --- | --- |
| Layout L-01…L-09 | Pass at all sizes (automated overlap/offscreen check: no issues on desktop sizes). |
| Stacking S-01…S-05 | Pass. |
| Threads T-02…T-08 | Pass. T-01 passed earlier in the day. |
| Groups G-01…G-07 | Pass. G-08 pass after fixes (below). |
| Delete/archive D-01…D-06 | Pass after the "put all away" fix. |
| Web W-01…W-06 | Pass (desktop mind-map, 800px list, phone list). |
| Media | M-02 pass (two YouTube players). M-03/M-04 pass in automation (player element kept, no reload, 16.7 ms frames); needs a re-check by hand with a video actually playing. M-01 passed earlier; M-05 **not run** — the OpenAI key ran out of credit mid-run ("You have no credits remaining"); the error was shown cleanly in the thread. |
| Panels/sheets P-01…P-07 | Pass. |
| Overlays O-01…O-03 | Pass. |
| Voice/address V-01, V-02, V-04 | Pass (server log shows "Very good, ma'am." spoken). V-03 not run (no credit). |
| Phone F-01…F-04 | Pass. |

**Bugs found and fixed in this run**

1. "open the X thread", "rename X to Y" and "expand <group>" without the word
   *group* went to the model (slow, and wrote the command into a thread). Now
   handled locally; names keep their capitals even with a trailing full stop.
2. "put all threads away" / "put everything away" weren't understood.
3. A new loose window could be seated on top of an existing one (seated windows
   later in the list weren't counted as taken).
4. A group formed by dropping onto a window near the top was saved inside the
   title row.
5. A research request at an empty board left a stray thread named after the
   instruction; the second research thread sometimes got no question.
6. Dragging a window re-parented it, reloading any video in it; the drag also
   re-measured every window on every pointer event and re-blurred under the
   carried window, which stuttered with a video playing.
7. Stat panels always covered threads (two separate stacking layers).
8. Thread windows changed width and slid with the screen width (vw-based size,
   centre-based positions).
9. The configuration drawer had a plain dark scrim, unlike the blurred veil of
   confirmations and the web.
10. On a phone, notices overlapped an open sheet, and the thread list ran behind
    JARVIS.
11. A question typed while JARVIS was busy was asked in whichever thread was in
    front when he got to it (possibly one he had moved to himself), not the one
    you were looking at.
12. Icons were defined three times (stage, main, seven inline copies in the
    page); now one module, `icons.ts`.

### 2026-09-11 — second pass, in Brave (Chromium 152)

Run in the real browser on `http://127.0.0.1:7823`: a different origin from
`localhost`, so it has its own board and the everyday board is never touched.
Window sizes Brave wouldn't take (a maximized window ignores resizing) were
covered by loading the app in a sized frame: 1920×861, 1280×800, 1024×768,
768×1024, 390×844.

| Area | Result |
| --- | --- |
| Layout at all five sizes | Pass after fixes 13–14. |
| Real-mouse drag of a video thread (M-03) | Pass: same player element, no reload, window follows the pointer exactly (after fix 16). |
| Drop onto a thread → group; drop on JARVIS → ungroup (G-01, G-02) | Pass. |
| Web: open, tap a card (W-01, W-04) | Pass. |
| Config drawer over the veil (O-01), gear icon | Pass. |
| Bin → confirmation → "no" (D-02), × → put away → restore (T-07), delete everything → confirm (D-06) | Pass. |
| Phone sheets (P-05…P-07) at 390×844 | Pass: sheet ends above the status line. |
| Local commands, sir/ma'am (V-01, V-02) | Pass. |

**Bugs found and fixed in this pass**

13. Boxes were only kept above the deck, but JARVIS rises above it: at 1920×861
    a group covered his ring and status line. Everything in his column now stops
    above his status line (and a box too tall for that steps to the side).
14. The right-hand panels (Perimeter, Uplink, Environment) opened on top of
    each other. A panel's first seat now finds free room down its side, then a
    column further in; unplaced panels keep their spot on resize if it's still
    free.
15. The routine that kept the Threads list clear of the left-hand panels pushed
    them to the bottom and saved those spots as if you had placed them.
16. A carried loose window eased after the pointer (its own .3s transform
    transition outranked the drag's "no transition") — the lag you saw.
17. A group created a frame after the board was drawn (e.g. by JARVIS) glided
    in from the top-left corner. It now appears directly in its seat.
18. The configuration icon looked like a theme (sun) toggle; it's a gear now.
19. Notices said "archived" where the rest of the console says "put away".

### 2026-09-11 — third pass (preview, desktop and phone)

| Area | Result |
| --- | --- |
| Keyboard: a letter opens the keyboard with it typed; Esc closes and clears | Pass (real key events). |
| Corner resize by hand: thread NW corner, group SE corner | Pass: the opposite edges stay put; the group's list scrolls inside. |
| Group fold to orb, click the orb to reopen | Pass. |
| Release after dragging a thread / group / panel | Pass after fix 20: no animation runs, opacity steady. |
| Drag with the glass kept on while carried | 16.7 ms frames, window follows the pointer. |
| Tidy up (button and "tidy up the board") | Pass (fix 21 was the parser). |
| Phone: several panels open, part of the list | Pass. |
| Phone: full-height list fading behind the bottom controls | Pass. |
| Accessibility sweep | Every control named, no duplicate ids, embeds titled. |
| Every OpenAI model on the account (67) | None usable: all `429 credit_balance_exhausted`; `*-chat-latest` 404 through the Responses API; `instruct` models unsupported. |

**Fixed / changed in this pass**

20. A short blink when letting go of a thread, group or panel: dragging turned
    the entrance animation off and letting go turned it on again, which
    replayed the fade-in. Nothing is switched any more, and a carried window
    keeps its glass (no solid-then-glass flash).
21. New: **Tidy up** — re-seats every window and group, keeping sizes.
22. Phone: stat panels are now part of the thread list, several at once,
    instead of a single sheet over it; the list uses the whole height and fades
    behind the bottom controls.
23. The Uplink throughput graph filled in from the left over a minute; it now
    scrolls, newest reading at the right edge.
24. Provider errors: "out of credit" and "no access to this model" are now
    explained properly (the latter was reported as a retired model), and the
    raw provider error is logged on the server.
25. The model list no longer offers `instruct` models, which the console can't use.

### 2026-09-11 — fourth pass

| Area | Result |
| --- | --- |
| Resize from every edge (thread, group, panel) | Pass: an edge moves one axis, the opposite edge stays put; grouped windows offer right, bottom and bottom-right only; a panel's title bar still drags. |
| Glow on window resize | Pass: fixed at JARVIS's spot, fixed size, nothing animates it. |
| Phone: Threads list as a modal sheet; sheets end on the fade line; blurred veil behind sheets; tap outside closes | Pass. |
| Phone: 16px edge margin for title row, deck, list and sheets | Pass (all measured 16px). |

**Fixed / changed:** 26. resizing from edges as well as corners (threads,
groups, panels; a panel edge fixes only the dimension dragged). 27. the
background glow trailed behind JARVIS and was sized in % of the screen, so it
slid and stretched on resize. 28. phone: Threads list is a modal sheet, not a
list item; the fade begins with a visible edge exactly where sheets end; a
blurred veil sits behind open sheets. 29. one edge margin (`--edge`, 16px)
everywhere. 30. "Tidy up" hidden on phones (nothing to tidy in a list).

### 2026-09-11 — fifth pass (phone)

| Area | Result |
| --- | --- |
| A lone thread on a phone | Pass: fills the list down to the status line; its conversation scrolls inside. |
| Latest line kept in view on resize | Pass: pinned on load and on growth; a real scroll up unpins, scrolling back to the end re-pins. |
| Phone sheets (More, Threads) | Pass: both end 30px above the bottom buttons — the same 30px the buttons keep from the screen edge (100px up at 375×812); status word and notices hide while one is open. |

**Fixed / changed:** 31. a lone phone thread was capped at 42% of the screen.
32. a conversation could end up cut off at the bottom when its window grew.
33. phone sheets come down to just above the bottom buttons, with the same gap
    the buttons keep from the edge (was: the fade line).
34. phone: loose threads sat 24px from the edge (a group's inner padding) —
    now 16px like everything else; 6px of room above the list and no hover
    lift, so a tapped thread's top border is never clipped; the list (not the
    thread) keeps bottom room, so a lone thread fills down to the fade line and
    a scrolled-to-the-end list stops there too — nothing is left behind the
    bottom controls.

### 2026-09-11 — end-to-end run (desktop 1440×900, 1280×800, 1024×768; phone 375×812)

A scripted run through the whole console with synthetic pointer and keyboard
input, in the preview's own storage. Every step passed after the fixes below.

| # | Covered |
| --- | --- |
| D1–D5 | Clean start; New thread; "rename this to …"; fold/open by title; four threads never overlapping; the newest is active and on top |
| D6–D7 | Drop a window on another → group; drop on JARVIS → out, a group of one dissolves |
| D8–D11 | All eight panels open without overlapping, clear of the title row, deck and JARVIS; clicked thread rises above panels; Esc and ×; the web opens over the veil, Esc closes it; Tidy up |
| D12–D13 | × puts away; "put all away"; restore by name (an unknown name is answered, never guessed); bin → confirm → "no" keeps it in place → "yes" deletes |
| D14–D16 | Reload keeps windows and panels in place; narrowing keeps widths and clamps, widening restores; delete everything → clean screen |
| M1–M3 | Phone deck and 16px edges; newest first; a new thread lands on top and the list scrolls to it; tap body focuses, tap title folds/opens |
| M4 | Drag a thread from the bottom of a long list to the top (auto-scroll); nothing left mid-drag; order survives reload |
| M5–M7 | More sheets 30px above the buttons over the veil, one at a time, veil tap closes; Threads sheet in the same place; several panels in the list |
| M8–M10 | Web on a phone; trash → confirm; "connect One with Two" → group; reorder inside a group; fold a group by its name |
| X1–X3 | Phone → desktop → phone keeps panels, the Threads sheet and the phone order in the right places; phone keyboard |

**Fixed in this run:** 35. a thread made with New thread (or by a command)
became active but wasn't raised, so it could open underneath a window or panel
— whichever thread becomes active now comes to the top. 36. a thread whose whole
name is a filler word ("One", "Group") couldn't be named by voice. 37. restore
replies quoted the name in lower case. 38. phone: scrolling to a new thread put
its border right on the list's edge (scroll padding added).
New: phone list order — new threads on top with auto-scroll, drag to reorder.

### 2026-09-11 — every button (desktop 1280×800, 1440×900, 800/770 wide; phone 375×812)

| # | Covered | Result |
| --- | --- | --- |
| C1–C5 | Config: open by gear, "open config", "open voice settings"; three tabs; three providers, key masked, no full key anywhere in the page or `/api/connections`; model list without `instruct`; Re-check; close by Close, veil, Esc, "close config" | Pass after fix 39 |
| V1–V6 | Voice tab: tap-to-speak toggle (keyboard button follows), spoken replies, voice picker, timbre and cadence sliders, Test voice, address; all restored | Pass |
| Q1 | Every Quick query: status, sweep, weather, uplink, power, devices — real readings | Pass |
| T1–T5 | Branch (subthread, in front); chevron; long names; "clear this thread" → confirm; "delete this thread permanently" → "no" | Pass after fixes 40–41 |
| G1–G3 | Group +, fold to orb, reopen by the orb; a tall group stays above JARVIS | Pass after fix 42 |
| L1–L6 | Threads list rows: go to, put away, restore, delete (Cancel and Confirm); corner count | Pass |
| P1, R1–R3 | Perimeter Sweep (11 hosts); live readings; every core in Compute; Environment | Pass |
| N1–N5 | Desktop More at 770px: one reading folds, its menu opens above its button, a row opens its panel, a click elsewhere closes | Pass |
| K1–K3 | Tapping JARVIS without mic permission explains itself; typing in a Config field doesn't open the command bar; Esc closes drawer, then panel | Pass |
| S1–S3 | Writes without the console header → 403; no CORS preflight; no key in any response | Pass |
| B1–B3 | Tidy up (button, voice) | Pass after fix 43 |
| CX1 | A failed answer shows on the service's card | Pass (new, 44) |
| PH1–PH3 | Phone: Config full width over the veil; confirmation fits; "tidy up" explains the list | Pass |

**Fixed / new in this run:** 39. "open voice settings" was read as switching to
a voice called "settings" (config phrases now come first), and "voice off"
likewise tried a voice called "off" — words that follow "voice" without being a
name are excluded. 40. "Clear all 1 messages" / "0 messages will be gone" —
proper wording. 41. long names are cut at a word with an ellipsis, not mid-word.
42. a group or panel could be taller than the space above JARVIS and cover him on
a narrow screen — every box is now capped at that height (manual resizing too).
43. Tidy up packs from the top-left instead of seating from the middle (overlap
111k → 31k px² when too much is open to fit; none when it fits); the board's
edge margin is now 16px like everything else. 44. the Connections card shows the
last account problem (out of credit / no access to the model) until an answer
succeeds; choosing another model clears a model-access note.

### 2026-09-11 — fresh-reviewer pass (Fable 5.1), trying to break it

Desktop 1440×900 and 1280×800, landscape phone 812×375, phone 375×812.

| # | Tried | Result |
| --- | --- | --- |
| A1 | A thread named `<img src=x onerror=…> "quoted" & co` shown in the title bar, Threads list, web, notices and a confirmation | No script runs anywhere; the name is shown as text |
| A2 | Blank, whitespace and 20,000-character messages | Blank ignored; the long one accepted |
| A3 | Triple-clicking New thread; double-clicking ×, delete and Cancel | Three threads, one archive, one confirmation, no errors |
| B1 | Dragging a window far past every edge, and below JARVIS | Always pulled back onto the board; never binned by accident |
| B2 | Resizing past the screen; double-click reset | Capped (760 wide, above JARVIS); reset works |
| B3 | By voice: connect, rename group, move into group, collapse, delete group → yes | All as intended |
| C1–C2 | Esc with panel + web + drawer + confirmation open at once | **Fixed 45**: wrong order |
| C3 | Pressing a letter while a confirmation is open | Opens the keyboard (so "yes" can be typed); never answers by itself |
| C4 | Web from a thread that was connected on purpose but has no messages yet | **Fixed 46** |
| L1 | Landscape phone 812×375 | Desktop layout; boxes shrink to the 137px above JARVIS and scroll |
| P1–P4 | Phone: sheet veil blocks the list; confirmation above the Threads sheet; put all away → restore; lone thread fill and shrink | All pass |
| S | Server: 100 KB body, bad JSON, no turns, assistant-only turns, bad key, unknown provider, empty speech, path traversal (plain and encoded) | All refused cleanly; **fixed 47** |
| R | A hostile model reply: HTML, `<script>`, `javascript:` media, an unknown video host, a plain http link | Nothing runs; only https is linked (**48**); YouTube via nocookie |

**Fixed:** 45. Esc now peels overlays in the order they stack — drawer, then a
confirmation (Esc means "no"), menus, the web, the keyboard, the front panel;
before, it closed the web underneath an open confirmation. 46. a thread connected
on purpose (or branched) showed in the web only once it had messages. 47. the
server accepted at most 64 KB per question, but a conversation can carry 24
turns of 4,000 characters — a long research thread would have failed with
"Could not reach ChatGPT"; `/api/ask` now allows 1 MB. 48. plain `http://`
links were made clickable despite the README's https-only promise.

### 2026-09-11 — architecture pass (no behaviour change intended)

What changed: `main.ts` (1,900 lines) split into twelve modules; the web and
the core's drawing moved out of `stage.ts`; readings now arrive on one pushed
`/api/events` stream instead of 55 requests a minute, and stop while the tab is
hidden; the PowerShell probe runs every 20 s instead of every 4 s (it takes ~2 s
each time); panel bodies are painted only while open; the radar only while
Perimeter is open; the core at 30 fps at rest; the deck refits only when a
reading's text changed (the 1 s interval is gone); a confirmation now stands
above the configuration drawer; a message over 4,000 characters is announced as
cut rather than cut silently.

| Area | Result |
| --- | --- |
| Regression: new threads, rename, connect → group, the web (open, tap a card, Esc), the core drawing, panel painted on open, confirm by voice, tidy, put all away, restore, delete everything | Pass, no errors |
| Stream: one `/api/events` connection, no `/api/telemetry` polling, sweep announced from the stream, a closed panel's body untouched, filled on open | Pass |
| Confirmation above the open drawer; Esc answers it first | Pass |
| Brave: a tab loaded in the background opens no stream at all | As designed |

**Limits of automated testing noticed:** a browser tab in the background runs no
animation frames (so drags and transitions freeze in a hidden tab) and receives
no synthetic mouse or key input; and automated "typing" inserts text without key
presses, so the "any letter opens the keyboard" shortcut has to be checked by
hand. Model-backed tests remain blocked until the OpenAI account has credit.

### 2026-09-11 — tidy, groups, the drawer's shadow, Pages

Fixes: 49. a shadow lay along the right edge of the board — the closed
configuration drawer sits just off-screen and its shadow reached back in; it now
has one only while open. 50. a thread inside a group could be resized on its
own; now only the group is, and its threads take its width and share its height
— each grows until its whole conversation shows and shrinks, scrolling, with
the group. 51. the service worker was no longer registered after the client was
split into modules, so the console had stopped being installable; restored.
52. Tidy up piled everything from the top-left and treated the instrument
panels as obstacles. It now folds every thread and stacks everything in one
column down the middle — the biggest in the middle, the rest above and below
in turn — clear of JARVIS and ignoring the panels. Only when one column is too
tall for the screen do two (then three) go to a row, each row centred the same
way. Nothing is resized unless a row is too wide; then only widths come down
(to 260px at least), and the next tidy on a bigger screen gives them back.

| Area | Result |
| --- | --- |
| Tidy, every row measured for symmetry (left gap = right gap) at 1920×1080, 1440×900, 1280×720, 1000×900, 780×940: one column, widths kept; 780×600: 1-2-2-2 at 326/394px; 900×500: 2-3-2 at 260/309px — all within 1px of symmetric, no overlaps, all above JARVIS, all folded | Pass |
| Group resized wider/shorter/taller: threads follow the width; shorter scrolls inside; taller grows until nothing scrolls, then stops | Pass |
| Closed drawer has no shadow | Pass |
| Pages-style build (`JARVIS_BASE=/jarvis/`): assets, manifest and service worker all under `/jarvis/` | Pass |

### 2026-09-12 — the web version, serverless

The console now also runs as a web page with no server
(`VITE_JARVIS_SERVERLESS=1`, published by `pages.yml`). The provider code moved
to `src/shared/providers.ts` and is used by both; the browser's back end is
`browser-core.ts`, its instruments `sensors.ts`.

Fixes found while testing it: 53. the page root's class `web` collided with the
context web's own `.web` (which starts invisible and fades in), so the whole
web page faded to black a second after loading — renamed `serverless`.
54. the load estimate read NaN under a browser's coarse clock — it now counts
work done in a 20 ms window in a background worker instead of timing a short
task. 55. a sample with no frames (a covered window) read as 0 fps in red — now
skipped. 56. storage read 0 B because the browser's estimate leaves out local
storage — the board's own saves are added.

| Area | Result |
| --- | --- |
| Six readings in the browser: load %, fps against refresh, app storage, round trip, services answering, weather | Pass — 3% · 60 fps · 4 KB · 58 ms · 8 · ☁ 25° |
| Perimeter: sweep of the services JARVIS relies on, plotted on the radar by round trip | Pass — 8 answering, Gemini 77 ms, ChatGPT 276 ms, Claude 328 ms |
| Connections from the browser: an invalid placeholder key for each of ChatGPT, Claude and Gemini is refused by the provider itself with the usual message, and not stored | Pass (proves each provider accepts calls from the page) |
| Spoken answers from browser readings: status, power, devices, uplink, weather | Pass |
| Content Security Policy on the web build only; fonts, readings, sweep and providers all work under it, no violations | Pass |
| PC version unchanged after the move: Kokoro, the connected OpenAI key, weather, CPU/GPU/Disk/LAN readings, CORS refusal | Pass |

Not testable here: a real conversation from the web version (needs the user's
own key pasted on their device), GPS on a phone, battery on Android.

### 2026-09-12 — the web version's neural voice

Kokoro now runs in the browser too (`browser-voice.ts`, `voice-worker.ts`),
downloaded on request from Configuration → Voice, kept by the browser, and
loaded by itself on later visits.

Fixes found: 57. after a deploy, a cached page asked for replaced script files
(404) and could open blank for up to ten minutes — the service worker now always
fetches the page fresh. 58. the latency anchors re-ran every time the page was
shown again — now at most every 15 s. 59. in the browser the voice ran on one
core, about 2× slower than real time — the service worker now makes the page
cross-origin isolated on Chromium (COEP credentialless; videos in credentialless
frames), about real time on this laptop. 60. a long first sentence was spoken
in one piece when a whole reply was known up front — it now starts at its first
comma, streaming or not.

| Area | Result |
| --- | --- |
| Download in the Voice tab: progress 11 → 36 → 57 → 86% → ready in ~25 s; George selected by itself; "Neural voice online" said once | Pass |
| Speaking (Test voice, 5.5 s of speech): single core 11.6–12.1 s; isolated 5.6–5.9 s | Pass — about real time |
| Next visit: loads from the browser's copy without asking; storage reading shows the 92.9 MB | Pass |
| Isolated page: fonts, readings, sweep, weather, providers all still work; no CSP violations | Pass |

### 2026-09-12 — radar and sweep fixes

61. the radar stayed blank when the page loaded with Perimeter already open —
the open panels restored from last time never told it; the panel state is now
applied once at start-up (a regression from the architecture pass). 62. the
service worker had wrapped the live readings stream, so sweep results stopped
reaching the PC's radar — it now touches only the page and its workers.
63. devices on the radar bunched in one corner (a weak hash of similar
addresses) — now spread round the dish, each still in a fixed place. 64. the
web version's sweep timed the services with addresses that refuse requests
without a key (red 401/403 in the console; Chrome and Brave block those replies,
so most services dropped out) and one Brave's shields block — it now uses
addresses that answer cleanly (OpenAI's /healthz, Google's /generate_204,
anthropic.com on the same servers as Claude's API, Cloudflare's DNS service).
65. the web radar used the home-network scale (1–100 ms), so every service sat
on the rim — it now runs 10 ms to 1 s. 66. a page shown and hidden quickly ran
several frame counters at once ("301 fps") — one at a time now.

| Area | Result |
| --- | --- |
| PC: Perimeter open at load, sweep → radar drawn, 13 hosts spread round the dish | Pass (confirmed in Brave) |
| Web: sweep → 8 services, only 200/204 or timing-only requests, no new console errors | Pass |

### 2026-09-12 — OpenRouter, and Disconnect for environment keys

New: OpenRouter as a fourth service, first in Connections — **Connect with
OpenRouter** (OAuth PKCE) needs no key; free models by default (`openrouter/free`);
no web search, and JARVIS is told so. 67. Disconnect on a key from the
environment (`OPENAI_API_KEY`) did nothing — the key came straight back; now it
is ignored until a key is connected again, and the card names the variable.

| Area | Result |
| --- | --- |
| OpenRouter from a web page: CORS on /chat/completions and /auth/keys | Pass (`*`) |
| Sign-in route with an invalid code: friendly "press Connect to try again"; without the console header: 403 | Pass |
| "switch to OpenRouter", "use open router" | Pass (unit test) |
| A real sign-in and a free answer | Needs the user's own OpenRouter account |

### 2026-09-12 — JARVIS hears without a key; he speaks sooner

68. With no ChatGPT key, voice input fell back to the browser's dictation —
which Brave doesn't have, and Chrome only through Google's service. JARVIS now
has his own hearing, Moonshine Base, on the device: the PC's server loads it at
start; the web version downloads it on request. Recordings are converted in the
page to 16 kHz WAV, so no side needs an audio decoder. 69. Speaking waited on
OpenRouter's free models "thinking" silently first — reasoning is now off for
them — and on a long first clause; the PC's Kokoro runs on 8 threads and warms
up at start.

| Area | Result |
| --- | --- |
| Kokoro on the PC, 7.2 s of speech: default threads 5.0–6.9 s → 8 threads ~4.5 s | Pass (~30% quicker) |
| Kokoro on the GPU (DirectML), q8 model | Not possible — DirectML rejects a layer of the q8 model |
| Moonshine on the PC: 4.0 s of speech in 0.12 s, 6.1 s in 0.24 s, word-for-word but for one proper name | Pass |
| PC, no ChatGPT key: /api/transcribe hears Kokoro's own speech exactly, 0.15–0.19 s | Pass |
| Web: hearing download 15 → 41 → 65 → 92% → online (~12 s); a Kokoro line heard exactly in 0.22 s, under the page's CSP and isolation | Pass |
70. Long pauses while speaking: every Kokoro piece carries ~0.25 s of silence
before and ~0.5 s after, so pieces played back to back left ~¾ s of dead air
at each join. Playback now trims to the speech and adds a pause that fits the
join — 0.12 s after a comma, 0.3 s after a sentence. Measured: "…parameters,"
→ ", sir." now 0.12 s apart (was ~0.7 s).

### 2026-09-12 — the connection is the core

The refactor in `docs/PLAN-connection-core.md`, phase 1. One connected
service — Gemini (free) or ChatGPT — now answers, hears and, in the web
version, speaks; nothing is downloaded by the browser. Gone: OpenRouter and
its sign-in, the Claude chat connection (Claude returns in code mode), the
in-browser Kokoro and Moonshine, Moonshine on the PC, and the cross-origin
isolation that only those needed. Kokoro stays on the PC as its own voice.
`shared/providers.ts` became `shared/services/` (`common.ts`, `gemini.ts`,
`openai.ts`) with one interface: catalogue, chat, speak, hear.

| Area | Result |
| --- | --- |
| Typecheck, 48 unit tests, PC build, web build | Pass |
| PC: status shows Kokoro ready with its voices; `/api/speak` via Kokoro, 99 KB WAV in 1.7 s | Pass |
| PC, no key: `/api/speak` via Gemini → 503 "can't speak from here"; `/api/transcribe` → 503 "no way to hear you yet" | Pass |
| PC and web: Connections shows the two cards, Gemini first, with what each gives and costs | Pass |
| PC: Voice tab reads "Neural voice — George … Kokoro, on this PC" | Pass |
| Web: no console errors; CSP without huggingface/jsdelivr/anthropic/openrouter | Pass |
| Gemini free tier hearing and voice, real key; ChatGPT voice latency | Not yet — no key on the PC, no credit on OpenAI; the user tests on the live site |

Later the same day: **no speech engine of its own.** Kokoro removed from the
PC too (the user's call: one way of speaking everywhere, and two heavy
dependencies fewer); the device's voice is the default, the service's neural
voice a choice in Configuration → Voice. Gemini's model list ranked properly
(`gemini-3.8-flash` first; deep-research, antigravity, gemma and dated
previews no longer outrank it), `gemini-3.5-transcribe` read from the field it
answers in, and a model chosen before a change falls back to the newest.

| Area | Result |
| --- | --- |
| Gemini voice, whole-line request, on the PC: 2.5-flash-tts 4.7 s for 2.1 s of speech, 6.6 s for 7.1 s; 3.1-flash-tts 2.6 s for 2.0 s, 5.8–10.8 s for 6–8 s; pro-tts not on the free tier (429) | Measured — too slow whole; **3.1 streams: first sound 1.1 s**, done 3.5 s for 7.9 s → next step is streamed playback |
| Gemini hearing: `gemini-3.5-transcribe`, a 2 s line, 1.8–1.9 s, word-perfect; answers in `audioTranscription.text`; refuses `thinkingConfig` (400) — not sent to it | Pass after the fix |
| `gemini-2.5-flash` "no longer available to new users" (404) — the chat list now ranks 3.8-flash first anyway | Noted |
| Voice tab: device voices listed and one chosen even when the browser hands them over late; "no voices" only when there truly are none | Pass |

**Streamed speech.** A service's speech now arrives as raw 24 kHz samples
as it is made — `/api/speak` passes them straight through, the page
schedules each quarter-second slice as it lands and holds the last back to
trim its silence — and the first of the account's speech models that answers
is used (`speakWith`; likewise `hearWith` for hearing).

| Area | Result |
| --- | --- |
| Gemini's newest voice on the free tier: **10 lines a day per model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit 10) — spent by the day's tests; the older 2.5 voice took over, whole-line, 6.2 s for a 5 s line | Measured — Gemini's free voice is not enough to talk with; answers and hearing are fine on it. The neural voice needs ChatGPT with credit. |
| "Neural voice unavailable — using a system voice": what the user heard as "the PC voice" with Charon selected — the quota fallback, said once; the message now names Gemini's allowance | Fixed wording |

**The voice falls back cleanly.** 71. With Gemini's voice spent, every line
waited for a refusal, then showed a generic "Neural voice unavailable" and
played the radio click with nothing after it; and in Brave — which doesn't
list its voices — Charon had been picked by default. Now: the device's voice
is always the default (in Brave, "This device's voice", its unnamed default);
a refused neural voice shows the service's own reason once and rests for ten
minutes, the device's voice speaking meanwhile; the click plays only as the
service's audio actually starts.

| Area | Result |
| --- | --- |
| Web, no saved choice: "device:" chosen, list "This device · instant, free" then "Neural · through Gemini (20)" | Pass |
| Charon chosen with Gemini's voice spent: notice "Gemini's voice has used today's free allowance, sir — it comes back tomorrow. I'll speak with this device's voice meanwhile."; no click | Pass |
| A second line straight after: no request to Gemini, device voice at once | Pass |
| PC: the same | Pass |

**The AI voice, always.** 72. The user's rule: the service in use speaks
with its own AI voice — ChatGPT's when on ChatGPT, Gemini's when on Gemini —
and the device's voice only when nothing is connected or the service's voice
is refused. The Voice list shows only the service's voices (the device's
only with nothing connected); the voice picked for each service is kept for
it. A refusal rests that service's voice alone, so Gemini's spent allowance
never silences ChatGPT. 73. On the PC, choosing a service did nothing:
`/api/connections/active` was caught by the per-service key route as a
service called "active" (404). The route now comes first.

| Area | Result |
| --- | --- |
| PC: switch Gemini → ChatGPT with Use | Pass (was 404) |
| PC on ChatGPT: list "AI voices · through ChatGPT (13)", Fable chosen, Test voice → `/api/speak` openai:fable 200 | Pass |
| ChatGPT voice through the PC, 7 s of speech: first sound 1.9–2.2 s, done 3.0 s; "Voice profile set, sir." first sound 1.1 s | Measured |
| ChatGPT hearing through the PC: "Good evening, sir." in 0.70 s, exact | Pass |
| Web on ChatGPT: list "AI voices · through ChatGPT (13)", Fable chosen, Test voice speaks with no refusal | Pass |
| Web on Gemini with its voice spent: the reason once, then the device voice (verified before this change; the rest is now per service) | Pass |

### 2026-09-12 — end-to-end pass, PC and web, after the connection refactor

Driven in the app's preview, typing what would be said (the pane has no
microphone) and, for listening, a fake microphone playing a real spoken
command so recording, silence detection, hearing and the command all ran as
they would. PC on 7823, web build on 4173, ChatGPT (gpt-6-astra) and Gemini
(gemini-3.8-flash) connected on both.

| Area | PC | Web |
| --- | --- | --- |
| Test voice through ChatGPT (Fable): each piece ready | 1.2 s | 0.9 s |
| "What are you running on, which service, which voice, what's on my board?" | Pass — service, voice, speed, open and put-away threads | Pass |
| "PC version or web version, and on what?" (new: the snapshot says which) | Pass — "the PC version … livingcell, Windows … Ryzen 7 8845HS, 15.3 GB, RTX 4060 Laptop" | Pass — "the web version, a page in Chrome … no server of its own, keys in this browser" |
| Research: three threads, each asked, grouped "Japan trip" | Pass — answered in turn from the web, dated, sourced | — |
| Pictures (Golden Pavilion, Northern Lights, Mount Fuji) | Pass — Wikimedia, credited | Pass (via ChatGPT when Gemini was down) |
| Video (Shinkansen) | Pass — 2 YouTube embeds, both real (checked with YouTube) | — |
| News with sources (Starship) | Pass — dated, 4 links, tentative dates called tentative | — |
| Readings: status, weather, battery, radar | Pass with the tab in view (CPU, GPU, drizzle in Phnom Penh, 80% on mains) | — |
| Voice commands: "use the Onyx voice", "speak a little faster", mute, unmute | Pass | — |
| "Switch to Gemini": Gemini's voices listed, spent voice → reason once → device voice; answer from Gemini | Pass | Pass |
| "Switch back to ChatGPT": Onyx remembered, speaks at once | Pass | Pass |
| Listening: "Jarvis, open a new thread and tell me the time in Tokyo right now" | Pass — heard in 0.95 s, new thread "Time in Tokyo right now", 3:38 p.m. JST (correct) | Pass — heard in 1.2 s directly by OpenAI, 3:42 p.m. |
| Hearing the same recording: ChatGPT / Gemini | 0.76 s / 2.4 s, word for word | — |
| Follow-up "what's the weather like there?" in the Tokyo thread | Pass — Tokyo, live | — |
| Tidy, close, restore by voice | Pass | — |
| Gemini overloaded (503) and its search allowance spent (429): answers through ChatGPT and says so | Pass after fix 76 | Pass after fix 76 |

Found and fixed:

74. "Which voice are you speaking with?" changed the voice to Ash — "voice
    are" was read as "voice <name>", and "are" is two letters from "Ash".
    A voice change now needs a verb asking for it ("use", "set", "change").
75. ChatGPT refused every question: the account lists `gpt-5.3-chat-latest`
    and the rest of the `chat-latest` family, but the API refuses them for
    everyone ("does not exist or you do not have access"); a "latest" bonus in
    the ranking had picked one. They are no longer offered, and the bonus is
    gone — the newest model that answers (gpt-6-astra) is chosen.
76. Gemini, overloaded, answered "I've nothing useful on that": its stream
    can carry an error after a good start, which was ignored, leaving an empty
    reply. Errors inside a stream now surface; an empty answer is a failure;
    503 "high demand" reads as "busy", which hands the question to ChatGPT
    with the reason shown. The answer limit rose from 800 to 4,096 tokens so
    the newest models' thinking can't crowd out the reply.
77. A thread named "." — the leftover of fix 74's misreading. Leftover text
    with no words in it is no longer asked, nor used as a name.
78. "Rename this thread to Tokyo" named it "thread to Tokyo".
79. With the readings not yet in (a tab opened in the background), "how's the
    battery?" said "no battery here" and the weather "no uplink"; now "hasn't
    attached yet".
80. Wikimedia pictures loaded the original — 5,000 px, megabytes, and
    rate-limited when linked (429). Their 960-px preview is shown; the link
    opens the original.

Observed, not changed (for the user to decide): a thread keeps its last 24
messages, so a long one loses its oldest; and a question goes into the
thread in front even when it's about something else.

### 2026-09-12 — a new subject, a new thread

The user's decision after the end-to-end pass: a question on a different
subject opens a thread of its own. `subject.ts` decides locally, from the
names and telling words in the question and the thread (the evidence the
board's links use): a follow-on ("and…", "what about…", "why?") or anything
the thread already names stays; a name the thread never mentioned, or two
telling words none of which are here, is a new subject; "it"/"there"/"that"
with nothing new named stays. When in doubt, it stays. Ten unit cases.

| Step (PC, ChatGPT, clean board) | Result |
| --- | --- |
| "What's the best ramen to try in Tokyo?" | new thread (empty board) |
| "Is it expensive?" | same thread — answered about the shop named before |
| "What's the latest news on SpaceX Starship?" | a thread of its own; notice "A new subject, sir — it has a thread of its own." |
| "When is the next launch attempt?" | stays in the Starship thread |

Also: "What's the latest news on X" names the thread "X" (it came out as
"What's the latest news on Sp…").

### 2026-09-12 — every message kept, and the storage ceiling in the open

The user's decision: no per-thread limit for the local-storage demo. A
thread kept only its last 24 messages; now every message stays (the service
is still sent the last 12, so nothing costs more). The ceiling is the
browser's storage — about 5 MB per site in most browsers; this one allowed
over 20 million characters. `store()` now reports a refused save, and
`memory.ts` speaks: once past 80% of 5 MB, and at once when a save is refused,
then again when there's room. "Clear the put-away threads" / **Delete
put-away** makes room, always asking first; the AI can't ask for it. On the
web, a key the browser refuses to keep is reported instead of seeming saved.

| Check (PC) | Result |
| --- | --- |
| 15 × "status report" into one thread | 30 messages kept (was capped at 24) |
| Saving refused (setItem made to throw), two saves | one notice: "This browser's storage is full, sir — the latest changes aren't saved…" |
| Saving allowed again | "There's room again, sir — everything is saved."; the messages from while it was full are in the save (36) |
| A 4.1-million-character put-away thread planted | the 80% warning, once, not repeated on the next save |
| "clear the put-away threads" → "yes" | dialog "Delete the 17 put-away threads? 66 messages will be gone…"; board 4.1 M → 6 K characters; the thread on the board untouched |
| Web build: Threads list shows **Delete put-away** | Pass |
| Unit: "clear the put-away threads", "delete all the put away threads", "empty the archive", "delete the archived chats" → clear_archived; "delete everything" still the whole board; needs confirming; not a directive the model can give | Pass (56 tests) |

### 2026-09-12 — second end-to-end pass, PC and web side by side

Each test was started in both at once (PC on 7823, web on 4173, ChatGPT
gpt-6-astra), results compared.

| Area | PC | Web |
| --- | --- | --- |
| Put away → "clear the put-away threads" → "no" keeps them → "empty the archive" → "yes" | Pass | Pass |
| Small talk ("Good evening JARVIS, how are you today?") | Pass, in character | Pass |
| Lisbon → "is Sintra worth a day trip?" (stays) → carbonara video (moves) → "what wine goes with it?" (stays) → "switch to the Lisbon thread" (command) → tram ticket (stays) | Pass after fix 82 | Pass after fix 82 |
| Pictures (Eiffel Tower at night, 960-px previews), video (carbonara, 2 real), news with sources (Artemis) | Pass | Pass |
| "use the Sage voice", "speak a little slower", "which voice are you using?" (a question), Gemini and back | Pass | Pass |
| Spoken question "What is the capital of Australia, and how far is it from Sydney?" | Pass — heard 0.97 s, Canberra ~250 km | Pass — heard 0.72 s by OpenAI |
| Over 4,000 characters: said, and cut | Pass | Pass |
| Two questions sent while answering, a third as the first finishes | Pass after fix 83 — answered in order | Pass after fix 83 |
| Reload: threads, names, voice and speed kept | Pass | Pass |
| Sweep | 11 hosts on the LAN, announced (when the tab is in view — the stream pauses while hidden, by design) | 7 services |
| Phone layout (375 × 812): Threads sheet, a question answered, no sideways scroll | — | Pass |

Found and fixed:

81. "Put all 1 thread away, sir. They're…", "Delete the 1 put-away thread?" —
    one thread is now spoken of as one.
82. A new subject was guessed from the words in the question (`subject.ts`):
    "find me a video on pasta carbonara" stayed in a thread on the Eiffel
    Tower, "is Sintra worth a day trip?" would have left a Lisbon thread, and
    a command the parser missed ("switch to the Lisbon thread", its title cut
    to "…Lisbo…") opened a junk thread. Now JARVIS, who reads the whole
    conversation, decides in the same reply: `[[do: new_subject title="…"]]`
    moves the question and answer to a thread of their own, and
    `[[do: title_thread title="…"]]` gives a thread named after its first
    question a proper two-to-four-word name ("Lisbon in October", "Making
    Pasta Carbonara") — so threads can be found by subject. No extra request.
    Greetings no longer become names.
83. On the web, a question typed as the answer before it finished could jump
    a question already waiting. The queue now keeps the order asked.
84. Two threads "related — both mention I'd": contractions are no longer names.
85. After a question moved to a thread of its own, the window it left still
    showed it: that window only redrew when its message count changed, and the
    move restored the count it had last drawn. Removing messages (a move, a
    clear) now redraws the window.

### 2026-09-12 — repo recheck: leftovers and duplicates

Nothing a person uses changed; each removal was checked before it went.
Typecheck clean with `noUnusedLocals` and `noUnusedParameters` now on for both
builds; 57 tests pass; both versions rebuilt and reloaded with no failed
requests; the radar sweeps; the PC's telemetry (GPU, the Windows probe) and
network sweep work through the one `exec`.

- **Unused code:** 128 lines of unused imports; `nearestOnRect`; `askCore`'s
  unused parameter; the reactor drawing in `canvas.ts`, which nothing gave a
  canvas to, with `flash`, `amplitude`, `activity` and `telemetry`, which only
  it read. What was left is the radar, so the file is now `radar.ts`
  (`Radar`, `radar`).
- **Unused styles:** the old chat log (`.log`, `.msg`), the reactor bay, the
  voice bars (`.vox`), `.stage-empty` (which pointed at an animation that no
  longer existed), `.cw-confirm`, `.cw-msg.alert` and `.tool`, `.menu-sep`,
  `.caret-dn`, `.kv .v.red` and `.green`, and `--gap`, about 4 K characters.
  The three page ids no script uses stay: `aria-controls` and
  `aria-labelledby` point screen readers at them.
- **One copy each:** `pace` (both voices) in `common.ts`; `maskKey` there too,
  for the PC and the web; `isProviderId` beside `PROVIDER_IDS` in `types.ts`;
  `exec` in `server/exec.ts` for the telemetry, the sweep and the uplink; the
  reduced-motion check in `client/motion.ts` (not in `dom.ts`, which the tests
  load outside a browser).
- **Surplus `export`:** removed from 21 functions only their own file uses.
- **Stale words:** the Pages workflow still named Anthropic; `.gitignore` kept
  the old speech-model folders; `PLAN-connection-core.md` described the
  in-between plan (device voice by default, Kokoro offline on the PC). It now
  records what was built, and the setup guide still to build.

Found and fixed:

86. The radar's hover label tested the address with `/^d+.d+.d+.d+$/`, its
    backslashes lost, so it never matched an IP address. It now shows the
    last number of a LAN address, as intended.
87. With reduced motion asked for, the radar drew one frame and stopped; if
    the Perimeter panel was closed at that moment it stayed blank. It now
    keeps drawing while open, with the sweep held still.

### 2026-09-12 — third pass: one back end for both versions, and the bugs the review found

The connection layer existed twice — once for the server, once for the web
page — and had drifted. It is now one module, `shared/services/console.ts`,
given only where the keys are kept; the server and the browser each hand it
theirs. It takes its services as a parameter, so `tests/console.test.ts`
drives it with fake ones (10 tests, no network, no credit). 67 tests pass;
typecheck clean; both versions rebuilt. Net −400 lines.

Run in the Browser pane with the harness. The web tab's storage had been
reset, and keys can't be moved into it by the assistant, so the web column
covers what needs no key; its connected paths are the same core the PC
column exercised, plus the unit tests. Gemini's free tier ran out during
the pass (grounding first, then the voice): the questions marked † fell back
to ChatGPT, as designed, and cost a few cents.

| Area | PC | Web |
| --- | --- | --- |
| Connections screen through the core: both cards ready, masked keys, the env-var label, voices and hearing | Pass | — (no keys) |
| "switch to Gemini" → Canberra/Sydney question † → "Is Sintra worth a day trip?" (new subject → its own thread) | Pass | — |
| Two questions sent while the first is answered: answered in order, and **neither started while he was still speaking** (fix 88) | Pass — 0 violations in 100 ms polling | — |
| Grounding allowance spent → answered without web search rather than refused (fix 94, after a regression caught in this pass) | Pass | — |
| Pictures: "Eiffel Tower at night" † | Pass — 2 images, 2 links | — |
| "use the Kore voice" → spoken by Gemini's Kore; "which voice are you using?" names Gemini's voices (fix 92) | Pass | "No service is connected…", no stale names |
| Listening (fake microphone): heard by Gemini in 2.7 s → answered † | Pass | — |
| Gemini's voice allowance spent → device voice, said once | Pass | — |
| Snapshot says "the PC version … (Windows)" (fix 91) | Pass | — |
| Local commands: status, time, weather, uplink, help, thanks | — | Pass |
| Threads: named new thread, rename, close, restore, delete (no → yes), connect two, collapse/expand, tidy, list | — | Pass |
| Panels: show the radar, close all; sweep (7 services) | — | Pass |
| "Related to…" notice shown as a toast and **not spoken** over the answer (fix 89) | — | Pass — 0 spoken |
| "speak a little faster" moves the slider (setRate) ; mute/unmute | — | Pass (1.06) |
| Phone layout 375 × 812: compact, Threads sheet in the stage, no sideways scroll, voice note painted (fix 96) | — | Pass |
| Reload: threads, groups, speed, voice kept | Pass | Pass |
| "switch to ChatGPT" → its 13 voices, Fable speaks the line | Pass | — |

Found and fixed:

88. A question queued behind an answer was asked the moment the answer's
    text finished, cutting its speech off mid-sentence. The queue now waits
    until he has finished speaking (for up to half a minute, in case a
    browser's own voice never reports the end of a line).
89. "Related to …" was spoken the moment an answer finished — over the
    answer. It is shown under the core instead.
90. A plain `http://` address was linked in one of two copies of the
    link-making code, against the https-only promise. One copy now, in
    `message.ts`.
91. The console snapshot's OS label never read "Windows": the platform is
    "win32 10.0.26200", and only its first word names it.
92. "Which voice are you using?" and `help` still offered George, Lewis and
    Emma — device voices from the old speech engine. He names the connected
    service's voices now.
93. Gemini's key travelled in the request address, where proxies and servers
    log it. It goes in a header now.
94. Gemini retried without web search after *every* refusal, a rejected key
    included, doubling the calls. Now only when grounding is refused (400,
    not offered; 429, its allowance spent) — the first cut retried on 400
    alone and this pass caught the 429 case straight away.
95. The web version re-checked a failed key on every question, and neither
    clamped the speech speed nor cut an over-long line as the server did.
    One core, so one behaviour.
96. In a browser with no voices of its own and nothing connected, the Voice
    tab said "Scanning installed voices…" for ever: nothing painted the note
    once. It is painted on the first frame now — deferred, because painting
    it during module loading tripped an import cycle (caught in this pass).

### 2026-09-12 — the first-run guide

`setup.ts`: four steps (where you are; connect a service; what J.A.R.V.I.S. needs; say hello — the Voice tab's own controls), shown
once when nothing is connected, back from Configuration → Connections or by
"run setup" / "show me the guide". 68 tests; both versions rebuilt.

| Check | PC | Web |
| --- | --- | --- |
| Opens by itself on a first visit with nothing connected | — (connected: stays closed, marked seen) | Pass |
| Step 1 says which version and where keys live | Pass | Pass ("web version… no server behind it") |
| Step 2: Gemini and ChatGPT cards, key-page links, paste fields; connected services shown as such | Pass (both "Connected", ChatGPT "in use") | Pass |
| Last step: the Voice tab's controls; "Test voice"; how to talk | Pass | Pass (prompt → "MA'AM ›") |
| Not now / Done close it and it doesn't return; the old "No service connected" notice shows instead | — | Pass |
| "show me the guide" opens it; Esc closes it; Configuration → Connections → *Open the setup guide* reopens it and closes the drawer | Pass | — |
| Centred on the desktop; full-screen on a phone (375 × 812), no sideways scroll | Pass | Pass |

Found and fixed before commit:

97. The guide's styles were inserted at the first `.cw-head {` in the file,
    which was the tail of `.chatwin.lifted .cw-head {`: the sheet lost its
    position and the lifted-window rule was split. Caught by the browser
    pass (the sheet sat under the deck); the block now sits after the
    confirm dialog's rules.

### 2026-09-12 — read cold, and the two big files split

**Read cold, five ways** (a stranger on a phone, a developer, someone
impatient, a keyboard user, someone coming back): the guide opened with an
insider's sentence before saying what JARVIS is; on a phone it was a strip at
the top of a dark screen; the key hint had lost its capitals; the tab title
read "— none"; after "Not now" the board was dark with nothing to say what to
do; a single empty thread took the whole phone screen. All fixed (below).

**The split.** `stage.ts` 1,494 → 1,338 lines and `voice.ts` 809 → 599, the
pure parts in modules of their own with tests: `board-geometry.ts` (inside
the board, clear of JARVIS, a free seat, bubbles apart), `tidy.ts` (the plan),
`pcm.ts` (samples, where the speech in them is), `device-voices.ts` (ranking),
`hearing.ts` (the microphone, silence detection, transcription, dictation).
78 tests; typecheck clean; both versions rebuilt.

| Check | PC | Web |
| --- | --- | --- |
| Guide on a phone: a sheet at the bottom edge, full width; on the desktop: centred | — | Pass |
| A confirmation on a phone: the same sheet | — | Pass |
| Guide's first line introduces him; "it starts with AIza"; title without "none"; empty board says "tap me to talk · or type" | — | Pass |
| A lone empty thread is the size of any other (83 px); with an answer in it, the room (670 px) | — | Pass |
| Tidy up after the split: six folded windows in one centred column, no overlaps, clear of the core, inside the board | Pass | — |
| Listening after the split (fake microphone): heard in 0.96 s → answered → spoken | Pass | — |
| The device voice after the split ("Hear his voice") | — | Pass (2 sentences) |

Found and fixed:

98. The guide was a strip at the top of a phone screen; every sheet on a
    phone now rises to the same line, the bottom edge — the Threads list, the
    More menus, the guide and a confirmation.
99. A single thread on a phone took the whole screen even when empty. It
    earns the room only with something in it, and the board's room class is
    recomputed on every save rather than only on a full redraw.
100. The line under the core (`#threadName`) had been hidden since code mode
    left; it now says what to do on a clear board.

Found and fixed, later the same day:

101. With the sheets moved down onto the deck, the deck (z 200) drew over
    the Threads list's footer (z 80): its buttons showed through "Put all
    away". The Threads sheet now stacks above the deck. And the Threads list
    and the More menus keep the same 16 px gap at the bottom as at the sides;
    the guide and a confirmation run to the edge, full width.

### 2026-09-13 — conversation first, the readiness card, one surface behaviour

Sizes: 800×563 (desktop pane), 414×896, 360×740. Typecheck clean, 93 unit
tests, 20 end-to-end scenarios (`npm run test:e2e`), build clean; after fixes
112–113, 104 unit tests and 22 scenarios. Checked
against the real ChatGPT model: a greeting and a factual question stay at
the core; "find the latest news about …" opens a thread with findings and
sources; "look up …, just tell me" answers at the core.

By hand, desktop: a window carried past the edge glides back and keeps its
seat; a tap on the title bar folds and opens it; corner resize; a window
dropped on another makes a group of its own (a second pair makes a second
group); a bubble carried past the edge glides back; a bubble's corner grows
and shrinks it from its own height; a panel carried past the edge glides
back; a panel's corner resizes it and the seat is kept; folding one group
never opens another, by tap or by command; the readiness card appears on
"Not now", its Connect opens Connections, it survives a reload, "what's
missing" brings it back, "Not needed" on the rest sends it away.

By hand, phone: full-width windows, groups indented; reorder by title bar;
the grip on the thread in front; the Conversation, Threads, Systems and
confirm sheets each 16 px from the sides and the bottom, a tap outside
closes them; the drawer full width; no horizontal overflow at 360.

Found and fixed on the way:

102. Dropping two "New thread" windows together joined the first group ever
     made: the new group was looked up by name. A drop makes a group that is
     certainly new (numbered if the name is taken); so does connecting two
     threads in words unless a reason names a subject.
103. Folding the group you were in moved you into a folded group and opened
     it — on the board and by command. You are moved only to a thread in the
     open, or nowhere.
104. A bubble's corner only shrank it: the height was a cap on its list, and
     the drag began from the list's height and jumped. It sets the bubble's
     own height now, from its own height.
105. A bubble could not be carried past the edge; a window and a panel could.
     All three are carried wherever the pointer goes and glide back.
106. A window and a panel jumped back to their seat where a bubble eased; all
     three ease now, with one time and curve.
107. Everything beside a title — dot, icon, count, tag, buttons — sat a pixel
     below the title's capitals, each header by its own amount. One rule
     lifts them all onto the capitals, measured against the cap height.
108. A group folded only by its arrow; a tap on its name bar folds it now,
     as a window's title bar does.
109. Threads, groups and panels each had their own drag, resize and edge
     code. One shared surface behaviour (surface.ts) carries all three.
110. The line under the core (`#threadName`), recorded as restored in fix
     100, had been hidden again ever since. Element, style and code are
     removed for good; the status word and notices are the line under him.
111. An audit of the whole client (see the commits of 2026-09-13, "Audit"):
     dead rules and code, doubled constants and helpers, three focus rings
     and nine hover alphas, storage keys in three styles, the palette retyped
     on the canvas — each brought to one.
112. Closing the thread in front put the newest other thread in front, so the
     next question was written into it as a follow-up — two subjects in one
     window. Nothing takes the place of a closed thread now (on reload too);
     "this thread" with none in front asks for a name instead of guessing.
113. With the service in use at its limit and the spare failing too, two
     notices sat over each other in two different boxes: the rounded "meanwhile
     I'm answering through …" notice and the spare's own line. The notice is
     taken back and one line carries both reasons; a notice and the line
     under the core are drawn as the same box.
