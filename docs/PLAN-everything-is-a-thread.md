# Plan: everything is a thread

**Decided (2026-09-14).** Every question JARVIS answers is written into a
thread. The conversation at the core — the talk kept outside any thread, and
its Conversation panel — goes. There is one place for a reply, and the console
decides which, not the model.

## Why

A reply had two homes: the line under the core (kept in the Conversation
panel) or a thread. The model chose, with a marker at the head of every reply
(`[[at: core]]`, `[[at: thread]]`, `[[at: new "…"]]`). Two bugs came from that
guess, found while testing on 2026-09-14:

- **"Open a new thread and find X."** The console opened the thread itself and
  sent only "find X", with a note that the thread in front was empty and that
  anything but a follow-up was conversation. The model answered at the core,
  and the thread it had just been asked for stayed empty.
- **A YouTube video.** The model asked whether to play it, so the exchange was
  talk at the core, and the video came back in the line under JARVIS: a
  passing caption, gone after a few seconds and kept nowhere a player can be.

Prompting the model better would only make the guess right more often. With
one home there is nothing to guess.

## The rule

- **A reply goes into the thread in front.** With none in front, a new thread
  opens for the question, and JARVIS names it with his first answer, as he
  already names any thread called New thread.
- **Starting a new subject is the user's choice:** "new thread", the + button,
  or asking JARVIS for one. "Open a new thread and find X" opens the thread,
  and "find X" is asked in it, because it is now the thread in front.
- **The console's own answers stay at the core.** Time, date, a greeting,
  status, the readings, help: said under JARVIS and not kept. A reading is
  only true when it is said. Command notices ("Muted", "Put away") are the
  same.
- **The model is sent the thread** — its last dozen messages — instead of the
  last lines of the core conversation, with the console snapshot as before.
  It is offered web search when the question asks for the world, or the
  thread's earlier answers came from the web (`wantsSearch`), not for every
  follow-up merely because it is in a thread: a thread now holds talk too.

## What goes

- `core-chat.ts`, `conversation-panel.ts`, the Conversation button and panel,
  the "conversation" panel name.
- `routing.ts`, `parseRoute` and the `[[at: …]]` markers; the persona's rules
  for choosing between the core and a thread.
- The step that took a question back out of the conversation when its reply
  turned out to belong in a thread.
- `AskRequest.search`, which forced web search for anything asked in a thread.

## Nothing is lost

A conversation kept in the browser becomes an ordinary thread called
**Previous conversation**, on the board but not in front, and the old record
is removed once the board has been saved. The console did the same when the
code agent was removed.

## The cost

More threads on the board: a quick question with nothing in front opens one.
That is the trade: what was said is kept where it can be found. Putting away
and Tidy up already handle the clutter. Organising the board by talking
("move Lisbon into Trips") is answered by JARVIS, so with nothing in front it
opens a thread too; the console's own commands (new thread, close this, show
the radar, mute) do not.
