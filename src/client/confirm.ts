/**
 * Anything that destroys something waits for a yes — by button, or by word.
 */

import { $ } from "./dom.js";
import { type Group, type Thread } from "./workspace.js";
import { graph, ws } from "./state.js";
import { announce, paintCoreState } from "./say.js";
import { paintThread } from "./threads.js";

export let pendingConfirm: { run: () => string; question: string; yesLabel: string } | null = null;

function paintConfirm(): void {
  const dialog = $("confirmDialog");
  const backdrop = $("confirmBackdrop");
  const pending = pendingConfirm;
  dialog.hidden = !pending;
  backdrop.hidden = !pending;
  if (!pending) return;
  $("confirmText").textContent = pending.question;
  $("confirmAccept").textContent = pending.yesLabel;
}

/** Ask before doing something that can't be undone. The answer can be clicked or said. */
export function confirmFirst(question: string, yesLabel: string, run: () => string): string | null {
  cancelConfirm();
  pendingConfirm = { run, question, yesLabel };
  paintConfirm();
  paintCoreState();
  announce(`${question} Say yes to ${yesLabel.toLowerCase()}, or no.`);
  return null;
}

export function answerConfirm(yes: boolean): string | null {
  const p = pendingConfirm;
  if (!p) return null;
  pendingConfirm = null;
  paintConfirm();
  paintCoreState();
  return yes ? p.run() : "Leaving it as it is, sir.";
}

function cancelConfirm(): void {
  if (!pendingConfirm) return;
  pendingConfirm = null;
  paintConfirm();
}

$("confirmAccept").addEventListener("click", () => {
  const note = answerConfirm(true);
  if (note) announce(note);
});
$("confirmCancel").addEventListener("click", () => {
  const note = answerConfirm(false);
  if (note) announce(note);
});

/** Delete one thread for good — always after asking. Its subthreads move up a level (workspace.remove). */
export function deleteThread(t: Thread): string | null {
  // The readiness card holds settings, not a conversation: nothing is lost with it.
  if (t.kind === "setup") {
    return confirmFirst(
      "Delete the card? Everything on it stays in Config → Connections and Access, and “what's missing” brings it back.",
      "Delete",
      () => { ws.remove(t.id); graph.commit(); paintThread(); return "The card is gone, sir. Its settings are in Config."; },
    );
  }
  return confirmFirst(
    `Delete “${t.title}” for good? ${lostWords(t.turns.length)}`,
    "Delete forever",
    () => { ws.remove(t.id); graph.commit(); paintThread(); return `“${t.title}” is deleted, sir.`; },
  );
}

/** Delete a whole bubble and the threads in it — always after asking. */
export function deleteGroup(g: Group): string | null {
  const members = ws.treeOrder(g.id);
  return confirmFirst(
    `Delete the ${g.title} group and ${members.length === 1 ? "its thread" : `all ${members.length} threads`} in it? That can't be undone.`,
    "Delete the group",
    () => {
      for (const t of members) ws.remove(t.id);
      ws.removeGroup(g.id);
      graph.commit();
      paintThread();
      return `${g.title} is gone, sir.`;
    },
  );
}

/** What deleting a thread loses, in words: "3 messages will be gone…", or that it is empty. */
export function lostWords(n: number): string {
  return   n === 0 ? "It's empty, so nothing is lost." : `${n} message${n === 1 ? "" : "s"} will be gone and can't be restored.`;
}
