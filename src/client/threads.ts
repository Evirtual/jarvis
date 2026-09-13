/**
 * The board as it is described on screen — the count on the Threads button,
 * putting a thread away and bringing it back — and what the stage reports
 * back: a close, a branch, a new thread, a drop on the bin (wired at boot).
 */

import { addressed } from "./address.js";
import { $ } from "./dom.js";
import { relatedness } from "./links.js";
import { type Thread } from "./stage.js";
import { GENERAL_ID } from "./workspace.js";
import { graph, input, ws } from "./state.js";
import { notice, noteIn } from "./say.js";
import { deleteGroup, deleteThread } from "./confirm.js";
import { mode } from "./layout.js";
import { refreshLinks } from "./board-links.js";
import { paintThreadList } from "./threads-panel.js";

/** The count on the Threads button and the prompt's address — whenever the board or the address changes. */
export function paintThreadCount(): void {
  // The deck reports retained work, not only what happens to be open. A
  // thread put away is still there until the person explicitly deletes it.
  $("pThreads").textContent = String(ws.all.filter((t) => !t.kind).length);
  $("prompt").textContent = addressed("SIR ›");
}

/** Redraw the board and everything that describes it. */
export function paintThread(): void {
  graph.renderAll();
  paintThreadCount();
  paintThreadList();
  refreshLinks();
}

/** Put a thread away (recoverable), and say so — the one way, whether by its ×, by a word, or by the model. */
export function putAway(t: Thread): string {
  const gone = ws.archive(t.id);
  graph.commit();
  paintThread();
  if (t.kind === "setup") return "The card is put away, sir. Everything on it is in Config — Connections and Access — and “what's missing” brings it back.";
  const subs = gone.length - 1;
  const clean = ws.empty ? " The board is clear." : "";
  return `“${t.title}” is put away${subs ? ` with its ${subs} subthread${subs === 1 ? "" : "s"}` : ""}, not deleted — restore it from the Threads list, sir.${clean}`;
}

/** Bring a put-away thread back onto the board, in front, and say so. */
export function bringBack(t: Thread): string {
  ws.restore(t.id);
  graph.commit();
  graph.focus(t.id);
  paintThread();
  return `“${t.title}” is restored and open on the board, sir.`;
}

/** What the stage reports back, and the deck's New thread button. */
export function wireBoard(): void {
  graph.onFocus = (): void => { paintThreadCount(); paintThreadList(); refreshLinks(); if (mode === "desk") input.focus(); };
  graph.onChange = (): void => { paintThreadCount(); paintThreadList(); refreshLinks(); };
  graph.onArchive = (id): void => {
    const t = ws.thread(id);
    if (t) notice(putAway(t));
  };
  graph.onBranch = (id): void => {
    const parent = ws.thread(id);
    if (!parent) return;
    const child = ws.createThread({ parentId: parent.id });
    graph.commit();
    paintThread();
    noteIn(child.id, `Subthread of “${parent.title}” — it carries that conversation's context.`);
  };
  graph.onNewThread = (groupId): void => {
    ws.createThread({ groupId });
    graph.commit();
    paintThread();
  };
  // What the board knows about a thread's context — the web asks for this.
  graph.relatedFor = (id) => relatedness(ws.live, id);
  // Dropped on the bin: gone for good, but never without asking.
  graph.onDropDelete = (kind, id): void => {
    const note = kind === "group"
      ? (() => { const g = ws.group(id); return g ? deleteGroup(g) : null; })()
      : (() => { const t = ws.thread(id); return t ? deleteThread(t) : null; })();
    if (note) notice(note);
  };
  // The deck button starts an independent conversation. The + inside a group
  // remains the deliberate way to add a thread to that group.
  $("newThread").addEventListener("click", () => {
    ws.createThread({ groupId: GENERAL_ID });
    graph.commit();
    paintThread();
  });
}
