/**
 * Which layout the screen gets: the full stage, or — on a phone — the core
 * over a list, with the instruments in the list and the Threads list as a
 * sheet over it.
 */

import { $ } from "./dom.js";
import { graph, panels } from "./state.js";
import { fitDock } from "./deck.js";
import { paintThreadCount } from "./threads.js";

type Mode = "desk" | "compact";
export let mode: Mode = "desk";

export function applyMode(): void {
  const next: Mode = window.innerWidth < 760 ? "compact" : "desk";
  const changed = next !== mode || !document.body.className;
  mode = next;
  document.body.className = `m-${mode}`;
  graph.compact = mode === "compact";
  panels.compact = mode === "compact";
  // On a phone the instruments join the top of the thread list and scroll with
  // it, rather than covering it; on a wider screen they float over the board.
  const overlays = $("overlays"), list = $("windows");
  if (mode === "compact" && overlays.parentElement !== list) list.prepend(overlays);
  else if (mode !== "compact" && overlays.parentElement === list) list.after(overlays);
  // …but the Threads list is a modal sheet on a phone, not an item in the list.
  const sheet = document.querySelector<HTMLElement>('.panel.float[data-panel="threads"]')!;
  if (mode === "compact" && sheet.parentElement === overlays) $("stage").append(sheet);
  else if (mode !== "compact" && sheet.parentElement !== overlays) overlays.prepend(sheet);
  if (changed) graph.renderAll();
  panels.relayout();
  paintThreadCount();
  fitDock();
}

/** The layout follows the window; on a phone a tap outside a sheet closes it. */
export function wireLayout(): void {
  window.addEventListener("resize", applyMode);
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Element;
    if (mode !== "compact" || !(t instanceof Element)) return;
    if (panels.isOpen("threads") && !t.closest('.panel.float[data-panel="threads"], #pillThreads, #coreLine, .confirm-dialog, .confirm-backdrop')) panels.hide("threads");
  });
}
