/**
 * How JARVIS speaks to you: the line under the core — the console's own
 * answer, and a passing notice above it, in one box — lines written into a
 * thread's window, his status word, and whether he is busy.
 */

import { addressed } from "./address.js";
import { $ } from "./dom.js";
import { line } from "./message.js";
import { graph, voice } from "./state.js";
import { drainQueue, queued } from "./ask.js";
import { pendingConfirm } from "./confirm.js";
import { S } from "./readings.js";

const logState = $("logState");
/** Whether an answer is on its way — the queue waits on it. */
export let busy = false;

/* ===================================================================== *
 * The line under the core: one box, two rows
 *
 *   the notice  what the console did or couldn't do — "Put away", "Queued",
 *               the greeting — for a few seconds, above the reply;
 *   the reply   what the console answers itself from its readings — the
 *               time, the status, help — drawn as a reply would be in a
 *               thread, while it is spoken and a while after.
 *
 * Neither is kept: everything JARVIS answers through the service is written
 * into a thread (ask.ts), and a reading is only true when it is said. The box
 * shows while either row does; a tap on it puts it away.
 * ===================================================================== */

const box = $("coreLine");
const noticeRow = $("coreNotice");
const replyRow = $("coreReply");
let noticeTimer: number | null = null;
let replyTimer: number | null = null;
let hideTimer: number | null = null;

function paintLine(): void {
  const any = !noticeRow.hidden || !replyRow.hidden;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (any) {
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add("in"));
  } else {
    box.classList.remove("in");
    hideTimer = window.setTimeout(() => { if (!box.classList.contains("in")) box.hidden = true; }, 320);
  }
}

/** A passing notice, spoken unless told not to. */
export function notice(text: string, opts: { speak?: boolean } = {}): void {
  text = addressed(text);
  noticeRow.textContent = text;
  noticeRow.hidden = false;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(hideNotice, 6000);
  paintLine();
  if (opts.speak !== false) voice.speak(text);
}

/** A notice taken back before its time — what it announced did not come to pass. */
export function hideNotice(): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  noticeRow.hidden = true;
  paintLine();
}

/**
 * The console's own answer, said under the core: shown and spoken, and gone a
 * while after it has been said, or when tapped. `more` is Markdown shown
 * under what is said but not spoken — a list, a table — and it keeps the line
 * until tapped or until something else is said, since it takes longer to read
 * than to hear.
 */
export function jarvis(text: string, opts: { more?: string } = {}): void {
  text = addressed(text);
  replyRow.replaceChildren(...line("jarvis", opts.more ? `${text}\n\n${opts.more}` : text).childNodes);
  replyRow.hidden = false;
  if (replyTimer) clearTimeout(replyTimer);
  replyTimer = opts.more ? null : window.setTimeout(replyFades, 14_000);
  paintLine();
  voice.speak(text);
}

/** After its time, and once it has been said in full. */
function replyFades(): void {
  if (voice.speaking) { replyTimer = window.setTimeout(replyFades, 3000); return; }
  hideReply();
}

export function hideReply(): void {
  if (replyTimer) clearTimeout(replyTimer);
  replyTimer = null;
  replyRow.hidden = true;
  paintLine();
}

box.addEventListener("click", () => { hideReply(); hideNotice(); });

/* ===================================================================== *
 * Lines in a thread's window
 * ===================================================================== */

/** Add a line to a thread's window — the one in front unless another is named. */
export function addMsg(kind: "user" | "jarvis" | "sys", text: string, threadId = graph.activeId): HTMLElement {
  const body = graph.bodyOf(threadId) ?? graph.activeBody();
  if (!body) {
    notice(text, { speak: false });
    return line(kind, text); // nowhere to put it; the caller may still animate into it
  }
  // An empty window carries a placeholder line; the first real message replaces it.
  if (body.childElementCount === 1 && body.firstElementChild?.classList.contains("sys") &&
      /Nothing said yet|^Empty$|Tell me what to change/.test(body.firstElementChild.textContent ?? "")) {
    body.replaceChildren();
  }
  const row = line(kind, kind === "user" ? text : addressed(text));
  body.append(row);
  // On a phone, keep the conversation being written into on screen.
  if ((kind === "user" || kind === "jarvis") && threadId === graph.activeId) graph.reveal(threadId);
  body.scrollTop = body.scrollHeight;
  return row;
}

export function noteIn(threadId: string, text: string): void { addMsg("sys", text, threadId); }

/* ===================================================================== *
 * His status word
 * ===================================================================== */

let busyLabel = "Thinking";

export function setBusy(v: boolean, label = "Thinking"): void {
  const wasBusy = busy;
  busy = v;
  busyLabel = label;
  // Take the next queued question once this answer is done. The delay lets a
  // question the core itself scheduled (a new thread's "ask") go first.
  if (wasBusy && !v && queued.length) setTimeout(drainQueue, 260);
  $("cmdForm").setAttribute("aria-busy", String(v));
  paintCoreState();
}

/**
 * The word under the core says what is happening right now — one place, one
 * priority order, so a finished answer can never label a speaking JARVIS as
 * "standing by".
 */
export function paintCoreState(): void {
  const [text, colour] =
    voice.listening ? ["Listening", "var(--red)"] :
    voice.transcribing ? ["Transcribing", "var(--gold)"] :
    pendingConfirm ? ["Awaiting your word", "var(--gold)"] :
    voice.speaking ? ["Speaking", "var(--ice)"] :
    busy ? [busyLabel, "var(--gold)"] :
    S.running ? [`Sweeping ${S.subnet ?? "the network"}`, "var(--ice-dim)"] :
    ["", "var(--ice-dim)"];
  logState.textContent = text;
  logState.style.color = colour;
  logState.hidden = !text;
}
