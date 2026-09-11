/**
 * The deck and the title row: the readings either side of JARVIS, their More
 * sheets, the phone/desktop layout switch.
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
import { paintThreadList, paintThreadName } from "./threads.js";
import { paintTelemetry } from "./readings.js";

// The chips in the top bar are both a glance at the numbers and the way in.
document.querySelectorAll<HTMLElement>("[data-open]").forEach((b) => {
  b.addEventListener("click", () => panels.toggle(b.dataset.open as PanelName));
});
panels.onChange = (): void => {
  document.querySelectorAll<HTMLElement>("[data-open]").forEach((b) => b.classList.toggle("on", panels.isOpen(b.dataset.open as PanelName)));
  if (panels.isOpen("threads")) paintThreadList();
  hud.visible = panels.isOpen("perimeter");
  // a panel's body is painted only while it is open — fill it the moment it opens
  paintTelemetry();
};

/* ---------------------------------------------------------------------
 * The deck is always one row. The readings are split either side of JARVIS —
 * this machine on the left, the world around it on the right — and each side
 * keeps its readings while they fit; as the window narrows, the least
 * important fold into that side's More, one at a time. On a phone each side
 * is only its More: two sheets, one per side.
 * --------------------------------------------------------------------- */

// Readings use the same visual vocabulary as the rows in their More sheets.
const CHIP_ICONS: Record<string, string> = {
  pillThreads: "threads", pillCpu: "compute", pillGpu: "graphics", pillDisk: "storage",
  pillLan: "perimeter", pillNet: "uplink", pillWx: "environment",
};
for (const [id, name] of Object.entries(CHIP_ICONS)) $(id).insertAdjacentHTML("afterbegin", icon(name));
// …and each panel carries its reading's icon in its title bar, as a thread carries its dot.
for (const h of document.querySelectorAll<HTMLElement>(".panel.float[data-panel] > h2")) {
  h.insertAdjacentHTML("afterbegin", icon(h.parentElement!.dataset.panel!));
}

const SIDES = ["l", "r"] as const;
type Side = (typeof SIDES)[number];
const folded: Record<Side, HTMLElement[]> = { l: [], r: [] };
const dockOf = (s: Side): HTMLElement => $(s === "l" ? "dockL" : "dockR");
const moreWrapOf = (s: Side): HTMLElement => dockOf(s).querySelector<HTMLElement>(".more-wrap")!;
const moreBtnOf = (s: Side): HTMLElement => moreWrapOf(s).querySelector<HTMLElement>(".pill.more")!;
const menuOf = (s: Side): HTMLElement => moreWrapOf(s).querySelector<HTMLElement>(".menu")!;

function chipsOf(s: Side): HTMLElement[] {
  return [...dockOf(s).querySelectorAll<HTMLElement>(":scope > .pill[data-rank]")];
}

export function menuOpen(s?: Side): boolean {
  return s ? !menuOf(s).hidden : SIDES.some((x) => !menuOf(x).hidden);
}

/** One sheet at a time: opening one side's More closes the other's. */
export function setMenu(s: Side, open: boolean): void {
  if (open) for (const other of SIDES) if (other !== s) setMenu(other, false);
  menuOf(s).hidden = !open;
  moreBtnOf(s).setAttribute("aria-expanded", String(open));
  if (open) renderDockMenu(s);
}

export function closeMenus(): void {
  for (const s of SIDES) setMenu(s, false);
}

export function renderDockMenu(s: Side): void {
  const all = chipsOf(s);
  const items = folded[s]
    .slice()
    .sort((a, b) => all.indexOf(a) - all.indexOf(b))
    .map((c) => {
      const label = c.querySelector(".k")?.textContent ?? "";
      const value = c.querySelector(".v")?.textContent ?? "";
      const open = c.dataset.open;
      const cls = ["menu-item", c.classList.contains("warn") ? "warn" : "", c.classList.contains("crit") ? "crit" : "",
        open && panels.isOpen(open as PanelName) ? "on" : "", open ? "" : "static"].filter(Boolean).join(" ");
      const inner = `${icon(open ?? "power")}<span class="k">${esc(label)}</span><span class="v">${esc(value)}</span>`;
      return open
        ? `<button class="${cls}" role="menuitem" type="button" data-open="${open}">${inner}</button>`
        : `<div class="${cls}" role="menuitem" aria-disabled="true">${inner}</div>`;
    })
    .join("");
  const title = esc(menuOf(s).dataset.title ?? "Readings");
  const html = `<div class="menu-head"><span>${title}</span><button class="menu-close" type="button" data-close-menu aria-label="Close ${title}">${ICON.close}</button></div>${items}`;
  // Only touch the DOM when a value actually changed, so keyboard focus survives.
  if (menuOf(s).dataset.html !== html) {
    menuOf(s).innerHTML = html;
    menuOf(s).dataset.html = html;
  }
}

/** Keep one side of the deck to one row: show every reading that fits, fold the rest into its More. */
function fitSide(s: Side): void {
  const dock = dockOf(s);
  const chips = chipsOf(s);
  for (const c of chips) c.hidden = false;
  folded[s] = [];
  // Measure with More present, so the readings that stay leave room for it.
  moreWrapOf(s).hidden = false;
  if (mode === "compact") {
    for (const c of chips) { c.hidden = true; folded[s].push(c); }
  } else {
    const gap = parseFloat(getComputedStyle(dock).columnGap) || 6;
    const fits = (): boolean => {
      const shown = ([...dock.children] as HTMLElement[]).filter((k) => !k.hidden);
      const need = shown.reduce((sum, k) => sum + k.getBoundingClientRect().width, 0) + gap * Math.max(0, shown.length - 1);
      return need <= dock.clientWidth + 1;
    };
    // Measure without More first: if everything fits, More isn't needed at all.
    moreWrapOf(s).hidden = true;
    if (!fits()) {
      moreWrapOf(s).hidden = false;
      for (const c of chips.slice().sort((a, b) => Number(b.dataset.rank) - Number(a.dataset.rank))) {
        if (fits()) break;
        c.hidden = true;
        folded[s].push(c);
      }
    }
  }
  if (!folded[s].length) {
    moreWrapOf(s).hidden = true;
    setMenu(s, false);
  }
  if (menuOpen(s)) renderDockMenu(s);
}

export function fitDock(): void {
  for (const s of SIDES) fitSide(s);
}

/** Readings change width as they tick ("4 KB/s" → "1.2 MB/s"): refit the row when one has. */
let fitted = "";
export function fitDockIfChanged(): void {
  const now = [...document.querySelectorAll(".deck .pill[data-rank] .v")].map((e) => e.textContent).join("|");
  if (now === fitted) return;
  fitted = now;
  fitDock();
}

for (const s of SIDES) {
  moreBtnOf(s).addEventListener("click", (e) => { e.stopPropagation(); setMenu(s, !menuOpen(s)); });
  menuOf(s).addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-close-menu]")) { setMenu(s, false); return; }
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-open]");
    if (!item) return;
    panels.toggle(item.dataset.open as PanelName);
    setMenu(s, false);
  });
  new ResizeObserver(() => fitSide(s)).observe(dockOf(s));
}
document.addEventListener("pointerdown", (e) => {
  for (const s of SIDES) if (menuOpen(s) && !moreWrapOf(s).contains(e.target as Node)) setMenu(s, false);
  // On a phone the Threads list is a modal sheet: a tap anywhere else closes it.
  const t = e.target as Element;
  if (mode === "compact" && panels.isOpen("threads") && t instanceof Element &&
      !t.closest('.panel.float[data-panel="threads"], #pillThreads, .confirm-dialog, .confirm-backdrop')) panels.hide("threads");
});

/* ===================================================================== *
 * Layout: the full stage, or — on a phone — the core over a list
 * ===================================================================== */

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
  const threadsPanel = document.querySelector<HTMLElement>('.panel.float[data-panel="threads"]')!;
  if (mode === "compact" && threadsPanel.parentElement === overlays) $("stage").append(threadsPanel);
  else if (mode !== "compact" && threadsPanel.parentElement !== overlays) overlays.prepend(threadsPanel);
  if (changed) graph.renderAll();
  panels.relayout();
  paintThreadName();
  fitDock();
}

window.addEventListener("resize", applyMode);
