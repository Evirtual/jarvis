/**
 * System panels — Compute, Graphics, Storage, Perimeter, Uplink, Environment —
 * as glass sheets floating over the stage.
 *
 * The stage is the room; these are instruments you call up and put away. Closed
 * by default so the core has the screen. Open one from its reading in the deck,
 * or by asking ("show me the radar"). Drag by the title, resize from any corner,
 * close with ×; Esc closes the one in front. Positions, sizes and which are open
 * are remembered.
 *
 * On a phone they are part of the thread list — at its top, full width,
 * scrolling with the threads — as many as you open.
 */

import { recall, store } from "./dom.js";
import { ICON } from "./icons.js";
import { raise, stackKey, track } from "./stack.js";

export const PANEL_NAMES = ["threads", "conversation", "compute", "graphics", "storage", "perimeter", "uplink", "environment"] as const;
export type PanelName = (typeof PANEL_NAMES)[number];

/** Where each opens the first time: on the side of the deck its reading is on — this machine down the left, the world down the right. Threads opens under its corner button. */
const DEFAULT_SEAT: Record<PanelName, { side: "l" | "r"; top: number }> = {
  threads: { side: "l", top: 64 },
  conversation: { side: "l", top: 64 },
  compute: { side: "l", top: 64 },
  graphics: { side: "l", top: 270 },
  storage: { side: "l", top: 494 },
  perimeter: { side: "r", top: 64 },
  uplink: { side: "r", top: 438 },
  environment: { side: "r", top: 698 },
};

// Keep instrument panels on the exact same usable board as conversations.
// The stage reserves its last 104px for the dock, so neither kind of surface
// can be dragged or resized underneath it.
const MIN_SURFACE_W = 210;
const MIN_SURFACE_H = 90;
const MAX_SURFACE_W = 760;
/** The screen-edge margin, as for the title row, the deck and the board (--edge). */
const BOARD_INSET = 16;
/** Below the title row (threads, the JARVIS title, configuration) — HEADER_H in stage.ts. */
const BOARD_TOP = 60;
const BOARD_BOTTOM_RESERVE = 104;
/** The column kept clear above JARVIS — his ring, status line and notices (as in stage.ts). */
const CORE_ZONE = 150;
const CORE_STATUS_ROOM = 44;

interface Seat { x: number; y: number; w?: number; h?: number }

export class Panels {
  private root: HTMLElement;
  private els = new Map<PanelName, HTMLElement>();
  private seats: Partial<Record<PanelName, Seat>> = {};
  private drag: { el: HTMLElement; name: PanelName; dx: number; dy: number; pid: number } | null = null;
  private resize: { el: HTMLElement; name: PanelName; pid: number; sx: number; sy: number; x: number; y: number; w: number; h: number; ex: number; ey: number } | null = null;
  /** Panels waiting to be seated again, which the ones before them ignore. */
  private pending = new Set<PanelName>();
  /** One sheet at a time on a phone. */
  compact = false;
  onChange: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    for (const el of root.querySelectorAll<HTMLElement>(".panel.float")) {
      const name = el.dataset.panel as PanelName;
      if (!PANEL_NAMES.includes(name)) continue;
      this.els.set(name, el);
      track(stackKey.panel(name), el);
      const close = el.querySelector<HTMLElement>(".p-x");
      if (close) close.innerHTML = ICON.close; // the same close as a thread window's
      close?.addEventListener("click", (e) => { e.stopPropagation(); this.hide(name); });
      el.addEventListener("pointerdown", () => this.front(el));
      // Capture phase: a corner must be claimed for resizing before the title
      // bar's drag handler sees the press, or both start at once and the panel
      // keeps following the pointer after release.
      el.addEventListener("pointerdown", (e) => this.startResize(e, name, el), { capture: true });
      el.addEventListener("pointermove", (e) => this.resizeCursor(e, el));
      el.querySelector("h2")?.addEventListener("pointerdown", (e) => this.startDrag(e as PointerEvent, name, el));
    }
    window.addEventListener("pointermove", (e) => this.moveDrag(e));
    window.addEventListener("pointerup", (e) => this.endDrag(e));
    window.addEventListener("pointercancel", (e) => this.endDrag(e));
    // The stage can shrink without a browser-window resize (dock changes,
    // responsive shell, browser side panel). Re-seat panels in all cases.
    new ResizeObserver(() => this.relayout()).observe(root);

    try {
      this.seats = JSON.parse(recall("jarvis.panelSeats") ?? "{}") as Partial<Record<PanelName, Seat>>;
    } catch { this.seats = {}; }
    const open = (recall("jarvis.panelsOpen") ?? "").split(",").filter((n): n is PanelName => PANEL_NAMES.includes(n as PanelName));
    for (const n of open) this.show(n, true);
  }

  isOpen(name: PanelName): boolean {
    return this.els.get(name)?.hidden === false;
  }

  get openNames(): PanelName[] {
    return PANEL_NAMES.filter((n) => this.isOpen(n));
  }

  toggle(name: PanelName): void {
    if (this.isOpen(name)) this.hide(name);
    else this.show(name);
  }

  show(name: PanelName, quiet = false): void {
    const el = this.els.get(name);
    if (!el) return;
    el.hidden = false;
    this.seat(name, el);
    this.front(el);
    // On a phone panels sit in the thread list; bring the new one into view.
    if (this.compact) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (!quiet) this.persist();
    this.onChange?.();
  }

  hide(name: PanelName, quiet = false): void {
    const el = this.els.get(name);
    if (!el || el.hidden) return;
    el.hidden = true;
    if (!quiet) this.persist();
    this.onChange?.();
  }

  hideAll(): void {
    for (const n of PANEL_NAMES) this.hide(n, true);
    this.persist();
    this.onChange?.();
  }

  /** Close the one in front. Returns false if none was open. */
  closeTop(): boolean {
    let top: { n: PanelName; z: number } | null = null;
    for (const n of this.openNames) {
      const z = Number(this.els.get(n)!.style.zIndex || 0);
      if (!top || z > top.z) top = { n, z };
    }
    if (!top) return false;
    this.hide(top.n);
    return true;
  }

  /** Re-apply seats after the stage changes size or layout mode. */
  relayout(): void {
    // placed-by-hand panels first (clamped to the screen), then the rest find room around them
    for (const n of this.openNames) if (this.seats[n]) this.seat(n, this.els.get(n)!);
    if (!this.compact) this.reseatUnplaced();
    else for (const n of this.openNames) this.seat(n, this.els.get(n)!);
    this.persist();
  }

  /**
   * A growing Threads list can become taller after it is opened.
   * Keep the normal left-hand reading lane clear without resetting panels a
   * person has deliberately placed elsewhere.
   */
  clearLaneOverlaps(): void {
    if (this.compact) return;
    this.reseatUnplaced();
  }

  /**
   * Seat again, in order, every open panel that hasn't been placed by hand, so
   * each finds free room down its side given the ones before it. Panels you
   * placed stay exactly where you put them, and nothing here is saved as if
   * you had placed it.
   */
  private reseatUnplaced(): void {
    const unplaced = this.openNames.filter((n) => !this.seats[n]);
    for (const n of unplaced) this.pending.add(n);
    for (const n of unplaced) {
      this.pending.delete(n);
      this.seat(n, this.els.get(n)!);
    }
  }

  /** On top of everything on the board: threads and groups share this order. */
  private front(el: HTMLElement): void {
    raise(stackKey.panel(el.dataset.panel ?? ""));
  }

  /**
   * A first seat for a panel that hasn't been placed by hand: down its own
   * side from its usual spot, below any panel already open there, and when
   * that side is full, a column further in. Never on top of another panel if
   * there is room anywhere along that side.
   */
  private freeSeat(name: PanelName, side: "l" | "r", x0: number, y0: number, w: number, h: number, here: { x: number; y: number } | null = null): { x: number; y: number } {
    const W = this.root.clientWidth;
    const gap = 14;
    const others = this.openNames.filter((n) => n !== name && !this.pending.has(n)).map((n) => {
      const el = this.els.get(n)!;
      return { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, w: el.offsetWidth, h: el.offsetHeight };
    });
    const hits = (x: number, y: number) => others.some((o) => x < o.x + o.w + gap && x + w + gap > o.x && y < o.y + o.h + gap && y + h + gap > o.y);
    const top = BOARD_TOP + 4;
    // Already on the board and still clear: it stays where it is.
    if (here && here.x >= BOARD_INSET && here.x + w <= W - BOARD_INSET && here.y >= BOARD_TOP &&
        here.y + h <= this.floorAt(here.x, w) && !hits(here.x, here.y)) return here;
    // The outer edge this column hugs: its left edge on the left side, its right edge on the right.
    let edge = side === "l" ? x0 : x0 + w;
    for (let col = 0; col < 3; col++) {
      const x = side === "l" ? edge : edge - w;
      if (x < BOARD_INSET || x + w > W - BOARD_INSET) break;
      // its usual height first, then the top, then just below each panel in the way
      const tops = [col === 0 ? y0 : top, top, ...others.map((o) => o.y + o.h + gap).sort((a, b) => a - b)];
      for (const y of tops) if (y >= top && y + h <= this.floorAt(x, w) && !hits(x, y)) return { x, y };
      // this column is full: the next one starts beyond everything standing in it
      const inColumn = others.filter((o) => o.x < x + w && o.x + o.w > x);
      edge = side === "l"
        ? Math.max(x + w, ...inColumn.map((o) => o.x + o.w)) + gap
        : Math.min(x, ...inColumn.map((o) => o.x)) - gap;
    }
    return { x: x0, y: y0 };
  }

  /**
   * The lowest a panel's bottom edge may go at this x: above the deck, and in
   * JARVIS's column above his status line, so a panel never covers him.
   */
  private floorAt(x: number, w: number): number {
    const W = this.root.clientWidth, H = this.root.clientHeight;
    const clear = parseFloat(getComputedStyle(this.root).getPropertyValue("--core-clear")) || 140;
    const inColumn = x < W / 2 + CORE_ZONE && x + w > W / 2 - CORE_ZONE;
    return inColumn ? H - clear + 8 - CORE_STATUS_ROOM : H - BOARD_BOTTOM_RESERVE;
  }

  private seat(name: PanelName, el: HTMLElement): void {
    if (this.compact) {
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.height = "";
      return;
    }
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    const saved = this.seats[name];
    const maxW = Math.max(MIN_SURFACE_W, Math.min(MAX_SURFACE_W, W - BOARD_INSET * 2));
    const maxH = Math.max(MIN_SURFACE_H, H - BOARD_TOP - BOARD_BOTTOM_RESERVE);
    const width = saved?.w ? Math.min(maxW, saved.w) : undefined;
    const height = saved?.h ? Math.min(maxH, saved.h) : undefined;
    el.style.width = width ? `${width}px` : "";
    el.style.height = height ? `${height}px` : "";
    const w = el.offsetWidth || 290;
    const h = el.offsetHeight || 200;
    let x: number;
    let y: number;
    if (saved) {
      x = saved.x;
      y = saved.y;
    } else {
      const d = DEFAULT_SEAT[name];
      const here = el.style.left ? { x: parseFloat(el.style.left), y: parseFloat(el.style.top) } : null;
      // first seat lines up with the title row and the deck (--edge, 16px)
      ({ x, y } = this.freeSeat(name, d.side, d.side === "l" ? 16 : W - w - 16, d.top, w, h, here));
    }
    // stay on screen whatever the window size is now, and off JARVIS
    x = Math.max(BOARD_INSET, Math.min(W - w - BOARD_INSET, x));
    if (h > this.floorAt(x, w) - BOARD_TOP) {
      // too tall to sit above him: step out of his column, to the nearer side
      const left = W / 2 - CORE_ZONE - w, right = W / 2 + CORE_ZONE;
      if (left >= BOARD_INSET && (right + w > W - BOARD_INSET || x - left < right - x)) x = left;
      else if (right + w <= W - BOARD_INSET) x = right;
    }
    y = Math.max(BOARD_TOP, Math.min(this.floorAt(x, w) - h, y));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (saved) this.seats[name] = { x, y, ...(width ? { w } : {}), ...(height ? { h } : {}) };
  }

  private startDrag(e: PointerEvent, name: PanelName, el: HTMLElement): void {
    if (this.compact || this.resize || (e.target as HTMLElement).closest("button")) return;
    const r = el.getBoundingClientRect();
    this.drag = { el, name, dx: e.clientX - r.left, dy: e.clientY - r.top, pid: e.pointerId };
    el.classList.add("dragging");
    e.preventDefault();
  }

  private moveDrag(e: PointerEvent): void {
    if (this.resize && e.pointerId === this.resize.pid) {
      const d = this.resize;
      const root = this.root.getBoundingClientRect();
      const maxW = Math.max(MIN_SURFACE_W, Math.min(MAX_SURFACE_W, root.width - BOARD_INSET * 2));
      const maxH = Math.max(MIN_SURFACE_H, root.height - BOARD_TOP - BOARD_BOTTOM_RESERVE);
      const w = Math.max(MIN_SURFACE_W, Math.min(maxW, d.w + (e.clientX - d.sx) * d.ex));
      const h = Math.max(MIN_SURFACE_H, Math.min(maxH, d.h + (e.clientY - d.sy) * d.ey));
      const rawX = d.ex < 0 ? d.x + d.w - w : d.x;
      const rawY = d.ey < 0 ? d.y + d.h - h : d.y;
      const x = Math.max(BOARD_INSET, Math.min(root.width - w - BOARD_INSET, rawX));
      // growing downwards stops at the floor (above the deck, or above JARVIS in his column)
      const hh = d.ey > 0 ? Math.max(MIN_SURFACE_H, Math.min(h, this.floorAt(x, w) - d.y)) : h;
      const y = Math.max(BOARD_TOP, Math.min(this.floorAt(x, w) - hh, rawY));
      // only the dimension being dragged is fixed; the other stays as it was
      if (d.ex) d.el.style.width = `${Math.round(w)}px`;
      if (d.ey) d.el.style.height = `${Math.round(hh)}px`;
      d.el.style.left = `${Math.round(x)}px`;
      d.el.style.top = `${Math.round(y)}px`;
      return;
    }
    if (!this.drag || e.pointerId !== this.drag.pid) return;
    const root = this.root.getBoundingClientRect();
    const { el } = this.drag;
    // Match loose thread windows: while carrying a panel, let it travel past
    // the visible board. The stage clips that temporary overhang, then
    // `seat()` brings it back into the usable board on release.
    const x = e.clientX - root.left - this.drag.dx;
    const y = e.clientY - root.top - this.drag.dy;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  private endDrag(e: PointerEvent): void {
    if (this.resize && e.pointerId === this.resize.pid) {
      const { el, name } = this.resize;
      el.classList.remove("sizing");
      const old = this.seats[name];
      const { ex, ey } = this.resize;
      this.seats[name] = {
        x: parseFloat(el.style.left) || 6, y: parseFloat(el.style.top) || 44,
        ...(ex || old?.w ? { w: el.offsetWidth } : {}),
        ...(ey || old?.h ? { h: el.offsetHeight } : {}),
      };
      this.resize = null;
      this.persist();
      return;
    }
    if (!this.drag || e.pointerId !== this.drag.pid) return;
    const { el, name } = this.drag;
    el.classList.remove("dragging");
    const old = this.seats[name];
    this.seats[name] = {
      x: parseFloat(el.style.left), y: parseFloat(el.style.top),
      ...(old?.w ? { w: el.offsetWidth } : {}),
      ...(old?.h ? { h: el.offsetHeight } : {}),
    };
    this.drag = null;
    this.seat(name, el);
    this.persist();
  }

  /**
   * Which sides a point on a panel would resize: a corner (22px) takes two, an
   * edge (a thin 7px strip, so the title bar still drags) takes one. No grip is
   * drawn; the cursor says so.
   */
  private sidesAt(e: PointerEvent, el: HTMLElement): { ex: -1 | 0 | 1; ey: -1 | 0 | 1 } | null {
    const r = el.getBoundingClientRect();
    const corner = 22, edge = 7;
    const nearW = e.clientX <= r.left + corner, nearE = e.clientX >= r.right - corner;
    const nearN = e.clientY <= r.top + corner, nearS = e.clientY >= r.bottom - corner;
    if ((nearW || nearE) && (nearN || nearS)) return { ex: nearW ? -1 : 1, ey: nearN ? -1 : 1 };
    const onW = e.clientX <= r.left + edge, onE = e.clientX >= r.right - edge;
    const onN = e.clientY <= r.top + edge, onS = e.clientY >= r.bottom - edge;
    if (onW || onE) return { ex: onW ? -1 : 1, ey: 0 };
    if (onN || onS) return { ex: 0, ey: onN ? -1 : 1 };
    return null;
  }

  /** Every edge and corner is a resize affordance. */
  private startResize(e: PointerEvent, name: PanelName, el: HTMLElement): void {
    if (this.compact || (e.target as HTMLElement).closest("button")) return;
    const side = this.sidesAt(e, el);
    if (!side) return;
    const r = el.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    this.resize = { el, name, pid: e.pointerId, sx: e.clientX, sy: e.clientY, x: r.left - root.left, y: r.top - root.top, w: el.offsetWidth, h: el.offsetHeight, ex: side.ex, ey: side.ey };
    el.classList.add("sizing");
    this.front(el); // stopPropagation below means the bubbling handler won't
    e.preventDefault();
    e.stopPropagation();
  }

  private resizeCursor(e: PointerEvent, el: HTMLElement): void {
    if (this.compact || this.drag || this.resize) return;
    const side = this.sidesAt(e, el);
    el.style.cursor = !side ? ""
      : side.ex && side.ey ? (side.ex === side.ey ? "nwse-resize" : "nesw-resize")
      : side.ex ? "ew-resize" : "ns-resize";
  }

  private persist(): void {
    store("jarvis.panelsOpen", this.openNames.join(","));
    store("jarvis.panelSeats", JSON.stringify(this.seats));
  }
}
