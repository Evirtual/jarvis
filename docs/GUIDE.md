# Using the console

How the screen is laid out, how threads and groups behave, and everything you
can say. For where the readings come from and what leaves your machine, see
[How it works](HOW-IT-WORKS.md).

## The first visit

With nothing connected, the console opens a four-step guide: where it is
running and how to talk to JARVIS; connecting Gemini (free) or ChatGPT, or not
yet; what the console needs (microphone, location, sound); and saying hello —
the same voice settings as **Config → Voice**, address, voice, listening and
all. **Not now** closes it; it doesn't come back on its own. Bring it back any time from Configuration → Connections → *Open the
setup guide*, or by saying "run setup" or "show me the guide".

## The deck

**JARVIS sits at the bottom of the screen and does not move.** He is the
console's one fixed point, with the two things you do most right beside him —
**new thread** on his left, **keyboard** on his right — and the readings split
either side: this machine (CPU, GPU, Disk) on the left, the world around it
(Net, LAN, Sky) on the right. His light spreads up from him across the board
rather than sitting in a ring around him, and resizing the window never slides
or stretches it.

**The title row** runs across the top: your **Threads** in the top-left corner
(with a count), the name in the middle, **Configuration** in the top-right. No
window, group or panel ever reaches up into this row, or down over the deck —
and in JARVIS's own column nothing comes lower than the line just above him, so
he and what he's saying are never covered.

**He is also the microphone.** Tap him to talk, tap again to stop; tap while
he's speaking to cut him off. There is no text box until you want one — press
any letter (or the keyboard button) and it rises over the deck; Esc puts it
away again. In **Config → Voice** you can make tapping him open the keyboard
instead. Enter sends.

The word just above him says what he's doing — listening, transcribing,
thinking, speaking, sweeping — and is gone when he's idle. One-off results
("Sweep complete — 12 hosts") appear as a short notice **on that same line**,
and so does the bin; they take turns rather than stacking. On a phone that line
always has room: sheets stop above it and never cover him.

He calls you **sir** — or **ma'am**, if you'd rather: **Config → Voice →
Address me as**, or just say "call me ma'am". It applies to everything he says
and writes, his own notices included.

## The board

- **A clean screen is the starting state, and talk keeps it clean.** Saying
  something to JARVIS opens nothing: the answer is spoken and shown under him,
  and kept in the Conversation panel ("show the conversation", or tap the line). A thread opens when
  JARVIS has to look something up for you, or when you ask for one.
- **A thread is a window.** One thread on its own is just that — no group, no
  label around it. Each gets its own colour, and a `#ABCD` tag so two threads
  with the same name can be told apart ("close Research #7F2K"). Drag its title
  bar to move it; resize it from any edge or corner (double-click one to reset).
  The screen changing width never resizes a window or slides it about — it only
  comes back into view if it would be off the edge. Dragging a window with a
  video playing doesn't interrupt the video (moving it into a *different* group
  does reload the player).
- **A new subject, a new thread — and a proper name.** A question goes to the
  thread in front, and JARVIS, who reads the whole conversation, judges whether
  it carries it on ("is Sintra worth a day trip?" in a Lisbon thread) or starts
  something else ("find me a carbonara recipe"). A new subject moves, question
  and answer, to a thread of its own as soon as he has answered, and he says so.
  A thread starts out named after its first question; with his first answer he
  gives it a proper two-to-four-word name ("Lisbon in October"), so "switch to
  the Lisbon thread" finds it. Both come in the same reply — no extra wait.
- **Windows stay as you leave them.** The first click on a window only brings
  it forward; clicking the title bar of the window you're in folds it to a bar.
  Nothing folds or shrinks on its own. A conversation stays on its latest line
  when its window changes size, unless you've scrolled up to read.
- **Whatever you touch is on top.** Windows, groups and panels share one
  stacking order: the one you clicked (or asked for) comes above everything
  else, the one before it just under it, and so on. The order is remembered.
- **A group is what you get when you put two threads together.** Drop one
  window onto another and they become a bubble; drop more in to add them. The
  bubble's colour is the blend of its threads'. Take threads out and when one is
  left the bubble dissolves where it was. Drop a window onto JARVIS to pull it
  out of its group.
- **Bubbles** can be moved by their name, resized from any edge or corner, and
  folded to a single orb. A thread inside a bubble takes the bubble's width and
  shares its height — growing with it until its whole conversation shows, and
  scrolling inside itself when the bubble is shorter. Deleting a bubble takes
  its threads with it (after asking).
- **Where things go.** A new thread opens in the middle of the board, between
  the top and JARVIS, and works outward from there, keeping clear of open
  panels. Anything you've placed by hand stays where you put it; closing a
  thread never moves the others.
- **Tidy up** — in the Threads panel, or "tidy up the board" — folds every
  thread to its title bar and stacks everything in one column down the middle:
  the biggest (a group, a long conversation) in the middle, the rest above and
  below it in turn, clear of JARVIS. Only when one column is too tall for the
  screen do two or three go to a row. Nothing is resized unless a row is too
  wide; then only widths come down, and the next tidy on a bigger screen gives
  them back. Panels are left where they are.
- **The web.** Press **⌗** on a window (or double-click it) and the threads that
  share its context appear as small copies of their own windows, with chips for
  what they have in common, joined by strands brighter and thicker the stronger
  the link. Tap one to go to it; Esc or a tap elsewhere closes the web.
- **The bin** rises just above JARVIS the moment you pick something up.
  Dropping something there asks before it deletes ("yes"/"no" by voice works
  too).
- **One material, one veil.** Every box is the same see-through, blurred glass,
  tinted by its own colour; everything modal sits over the same blurred veil.

The **Threads** panel is the same board as a list — every group, what's in it,
and everything you've put away, with restore and delete. Its count is every
thread you still have, put away or not.

JARVIS's own remarks about the console ("Put that away, sir") are notices, not
written into any thread, so a thread holds only its own conversation.

## Close, clear, delete

| Word | What happens |
| --- | --- |
| **Close / archive** (`×`, "close this chat") | Put away with its subthreads. Recoverable from the Threads list. |
| **Clear** ("clear this thread") | Empties the history, keeps the thread. Asks first. |
| **Delete** (bin, Threads list, "delete this thread permanently") | Gone for good. Always asks first — and the AI can never do it. |
| **Put all away / delete everything** ("close all threads", "delete everything", "start fresh") | The whole board at once. Putting away is recoverable; deleting asks first and takes the archive with it. |
| **Delete put-away** (Threads list, "clear the put-away threads", "empty the archive") | Only what's been put away — the board is untouched. Asks first, saying how many messages go. |

**Every message is kept.** A thread is as long as the conversation; the
service is only ever sent its last dozen messages, so a long thread costs
nothing extra. The board lives in this browser's own storage — about 5 MB per
site in most browsers, thousands of messages. Past four fifths of that, JARVIS
says so once; if the browser ever refuses a save, he says so at once (what's on
screen stays until the page is closed) and again when there's room. He never
trims or deletes anything on his own to make room.

## The readings and panels

The readings — CPU, GPU, Disk on the left; Net, LAN, Sky on the right — are
icons with their live values, each in its instrument's colour. As the screen
narrows, each side folds its least important readings into its own **More**.
Each reading opens its instrument panel: glass like the thread windows, dragged
by its title and resized from any edge or corner, with the readings inside
scaling with it.

A panel you haven't placed opens down its own side (machine instruments on the
left, the world on the right), below any panel already there, then in a column
further in. Once you drag a panel, it stays where you put it.

## On a phone

Each side of the deck is just its More button, opening two sheets (*Systems*
and *Surroundings*). The panels join the top of the thread list and scroll with
it, and the list uses the full height of the screen, fading behind JARVIS and
the bottom buttons so they are never hidden. The Threads list and the More
sheets open as sheets ending just above the bottom buttons; a tap outside
closes them. Everything that lines up with the screen edge keeps the same 16px
margin as on a desktop.

**The list is yours to order.** A new thread goes to the top and the list
scrolls up to it. Drag any thread by its title bar to move it up or down
(inside a group too); the others make way, and the order is remembered. A tap
on the title bar still folds or opens it.

**Threads share the screen by what they hold.** Each grows only as far as its
own conversation: a short exchange keeps its size, the room it doesn't need
goes to the long ones, two long ones split the space, and one alone may take
all of it if it has that much to show. Every thread with something in it keeps
at least a few lines; past that the list scrolls. The thread in front shows a
small grip — three diagonal lines — at its bottom edge: drag it for a height
of your own, which is kept; double-tap it to let the thread share again.

## Images and videos

Ask for pictures or footage — *"show me images of the aurora over Vilnius"*,
*"find videos of the Rail Baltica works"* — and the results appear inside the
thread, the full width of its window:

- **Images** load from where they're hosted; click one to open it. Wikimedia's
  are shown at its standard 960-pixel preview, and open the original.
- **Videos** from YouTube and Vimeo play in the thread. YouTube is embedded
  through `youtube-nocookie.com`.
- The image or player *is* the source, so no written links are added after it.
  Anything that isn't a direct image or a YouTube/Vimeo video is left out.

When you ask for sources for an ordinary answer, they're listed as links;
otherwise answers name their sources in words. Links are never read aloud.

## The voice and hearing

**JARVIS speaks with the connected service's AI voice** — ChatGPT's when you're
on ChatGPT, Gemini's on Gemini — each told to sound like a calm British butler.
**Config → Voice** lists that service's voices, then the device's own; the one
you pick is remembered. A phone's own voices answer at once, and choosing one
changes nothing else: answers and hearing still go through the service. With
nothing connected the device's voice speaks anyway, and it steps in when the
service refuses (a spent free allowance, no credit) — the reason is said once,
and the service is tried again after a while. **Cadence** sets the pace for
both; **Timbre** reaches only the device's voices, which take a pitch, so the
two sliders are put away while an AI voice is chosen.

Replies are spoken sentence by sentence as they arrive, the first while the rest
is still being written, streamed as the service makes the sound; the silence
round each piece is trimmed so they join without dead air.

**Hearing** is the connected service's, everywhere: the microphone records in
the page and the recording goes to Gemini or ChatGPT, primed with the console's
vocabulary so names and commands come back spelled right. Recording stops after
a pause in your speech — two seconds unless you set another length in **Config →
Voice**, where **Stop listening myself** keeps the microphone open until you tap
JARVIS again — and never runs while JARVIS is speaking. With
nothing connected, the browser's own dictation is used where it exists (Brave
has none); where nothing can hear, a tap to talk says so and opens
Connections, and typing always works.

## Everything by conversation

Anything you can click, you can say, on its own or mid-sentence. An utterance
is split into instructions and a question: *"start a new chat and find today's
news in Cambodia"* opens a window and asks that question in it.

- **Threads:** "open a new chat and…", "branch off and…", "close this chat",
  "restore Cambodia", "go back to Lithuania", "open the Cambodia thread",
  "rename this thread to…", "rename Solar storms to Space weather", "minimise
  this thread", "expand the Cambodia thread", "put all away" — add the `#tag`
  when two share a name
- **Groups:** "connect Lithuania with Trip planning" (they end up in one
  bubble), "move Lithuania into Travel", "new group called Home lab", "collapse
  Research", "rename the Research group to Deep dive", "delete the Research group"
- **Research:** "set up a research group on Baltic security with a thread on the
  cables and one on the shadow fleet" — JARVIS opens the group and gives every
  thread its own question, answered one after another
- **Media:** "show me images of…", "find videos of…"
- **Panels:** "show the radar", "open the weather", "show the threads", "close
  all panels"
- **Voice:** "use the Sage voice", "speak faster", "mute", "unmute", "call me
  ma'am" — and "which voice are you using?" is a question, not a command
- **Setup:** "switch to Gemini", "switch to ChatGPT", "open config" — or paste
  an API key straight into the chat; it's stored locally and never sent to a
  model

**Conversation first.** JARVIS listens and talks back; the console follows.
Anything he can answer from what he knows is said at the core, however long,
and kept in the Conversation panel, where lists and tables render in full —
open it with the button beside Threads, say "show the conversation", or tap the line under him. Anything he had to find on the web is research, and research is kept: it
goes in a thread of its own, named by him, with its sources — unless you say
"just tell me", in which case the searched answer is said at the core. Ask for
a thread, a window, or to keep something, and it is a thread. Pictures and
footage always get a window, since they can't be spoken. A follow-up to the
thread in front goes into that thread. He decides all of this from your words,
and says where each reply belongs before he says it; the console never opens
a thread of its own accord.

Phrasings the built-in patterns miss still work: JARVIS can operate the same
actions himself, from a fixed whitelist. He can open, group, connect, rename,
fold and put away threads — he can never delete anything, answer a
confirmation on your behalf, or change a model.

**He sees the whole console.** Every question carries a snapshot: every group,
every thread with a summary and its tag, what connects them, what's open, how
he's set up, and whether this is the PC or the web version. A thread's answers
are based on that thread alone — a new subthread also hears the tail of the
thread it grew from, and nothing else bleeds across.

Short questions about this machine ("status", "my IP", "weather") are answered
instantly from live readings, at the core; anything else goes to the service,
which searches the web only when you ask it to find, look up or check
something, or ask for current facts — searching costs, talking doesn't. A
question asked while an answer is still arriving is queued, and questions are
answered in the order asked.

## Installing it as an app

In Chrome, Edge or Brave use **Install** in the address bar (or the menu); on
an iPhone, **Share → Add to Home Screen**. It gets its own icon and window, no
browser bars. Browsers only offer this on a secure origin: `localhost` on the
machine itself, or `https` anywhere else — the published web page is. The
installed app caches nothing; every reading and answer is live.
