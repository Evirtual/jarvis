/**
 * How JARVIS speaks to you: notices under the core, lines written into a
 * thread's window, his status word, and whether he is busy.
 */

import { addressed } from "./address.js";
import { $ } from "./dom.js";
import { line } from "./message.js";
import { graph, panels, voice } from "./state.js";
import { drainQueue, queued } from "./ask.js";
import { pendingConfirm } from "./confirm.js";
import { coreChat } from "./core-chat.js";
import { S } from "./readings.js";

/* ===================================================================== *
 * Transcript
 * ===================================================================== */

const logState = $("logState");
/** Whether an answer is on its way — the queue waits on it. */
export let busy = false;
let typing: number | null = null;

/** Stop a reply being typed out (a new question interrupts it). */
export function stopTyping(): void {
  if (typing) { clearTimeout(typing); typing = null; }
}

/**
 * With nothing on the board there is no window to write in, so notices appear
 * under the core for a few seconds instead — the clean screen stays clean.
 */
let toastTimer: number | null = null;
export function toast(text: string): void {
  const el = $("toast");
  el.textContent = addressed(text);
  el.classList.add("in");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("in"), 6000);
}

/** App operations live at the core, never inside an unrelated thread. */
export function announce(text: string, speak = true): void {
  toast(text);
  if (speak) voice.speak(text);
}

/** Add a line to a thread's window — the one in front unless another is named. */
export function addMsg(kind: "user" | "jarvis" | "sys", text: string, threadId = graph.activeId): HTMLElement {
  const body = graph.bodyOf(threadId) ?? graph.activeBody();
  if (!body) {
    toast(text);
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
// System activity belongs to JARVIS, rather than whichever thread happened to
// have focus when it occurred. Thread-local notices use noteIn explicitly.
export function sys(t: string): void { announce(t); }

/* ---------- what JARVIS says at the core ---------- */

const coreSay = $("coreSay");
let sayTimer: number | null = null;

/**
 * A line said at the core — under JARVIS, drawn as a reply would be in a
 * thread, so a list or a bold word comes out right. It stays while it is
 * being spoken and a while after, or until tapped. `final` false while the
 * text is still arriving.
 */
export function say(text: string, final = true): void {
  coreSay.replaceChildren(...line("jarvis", text).childNodes);
  coreSay.hidden = false;
  coreSay.parentElement?.style.setProperty("--say-h", `${coreSay.offsetHeight}px`); // a notice sits above it
  requestAnimationFrame(() => coreSay.classList.add("in"));
  if (sayTimer) clearTimeout(sayTimer);
  sayTimer = null;
  if (final) sayTimer = window.setTimeout(sayFades, 14_000);
}

/** After its time, and once it has been said in full. */
function sayFades(): void {
  if (voice.speaking) { sayTimer = window.setTimeout(sayFades, 3000); return; }
  hideSay();
}

export function hideSay(): void {
  if (sayTimer) clearTimeout(sayTimer);
  sayTimer = null;
  coreSay.classList.remove("in");
  window.setTimeout(() => { if (!coreSay.classList.contains("in")) coreSay.hidden = true; }, 320);
}
// A tap on the line opens the whole conversation, and puts the line away.
coreSay.addEventListener("click", () => { panels.show("conversation"); hideSay(); });

/**
 * JARVIS speaks, at the core: a line of conversation, kept in the transcript
 * (the Conversation panel) and spoken. Threads hold research; this is talk.
 */
export function jarvis(text: string, opts: { speak?: boolean; record?: boolean } = {}): void {
  text = addressed(text);
  if (opts.record !== false) coreChat.add("assistant", text);
  say(text);
  if (opts.speak !== false) voice.speak(text);
}

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
