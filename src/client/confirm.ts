/**
 * Anything that destroys something waits for a yes — by button, or by word.
 */

import type { ProviderId, ScanResponse, TelemetryResponse, VoiceOption, WorldResponse } from "../shared/types.js";
import { api } from "./api.js";
import {
  NEEDS_CONFIRMATION, extractDirectives, intentOf, parseUtterance, type Action, type ConfigTab, type ParseContext, type ProviderWord,
} from "./commands.js";
import { addressed, getAddress, setAddress, type Address } from "./address.js";
import { ICON, instrumentIcon as icon } from "./icons.js";
import { $, esc, fmtRate, gib, gib0, hhmm, recall, setMeter, setPill, store } from "./dom.js";
import { computeLinks, linkKey, relatedness, type Link } from "./links.js";
import { type PanelName } from "./panels.js";
import { line, type Thread } from "./stage.js";
import { clip, editDistance } from "./text.js";
import { GENERAL_ID, threadRef, type Group } from "./workspace.js";
import { conn, graph, hud, input, panels, reduceMotion, voice, ws } from "./state.js";
import { announce, paintCoreState } from "./say.js";
import { paintThread } from "./threads.js";

export let pendingConfirm: { run: () => string; question: string; yesLabel: string } | null = null;

export function paintConfirm(): void {
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

export function cancelConfirm(): void {
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
