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
| L-01 | Clean start at 1440×900 | Only the title row (Threads top-left with count, J.A.R.V.I.S. centred, Configuration top-right), JARVIS at the bottom centre, and the deck. No thread, no text box. |
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
"open config", "mute" / "unmute", "use the Lewis voice", "speak faster",
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
| D8–D11 | All seven panels open without overlapping, clear of the title row, deck and JARVIS; clicked thread rises above panels; Esc and ×; the web opens over the veil, Esc closes it; Tidy up |
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

**Limits of automated testing noticed:** a browser tab in the background runs no
animation frames (so drags and transitions freeze in a hidden tab) and receives
no synthetic mouse or key input; and automated "typing" inserts text without key
presses, so the "any letter opens the keyboard" shortcut has to be checked by
hand. Model-backed tests remain blocked until the OpenAI account has credit.
