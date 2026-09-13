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
import { type Room } from "./board-geometry.js";
import { gestures, putDown, resized, sidesAt, sizeCursor, sizeLimits } from "./surface.js";

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

// A panel sits on the same board as the conversations, by the same rules:
// the board's edges, the deck, the column above JARVIS — the room the stage
// keeps (Room, board-geometry.ts) — and the one set of size limits and the
// one carry-and-put-down every box has (surface.ts).

interface Seat { x: number; y: number; w?: number; h?: number }

export class Panels {
  private root: HTMLElement;
  private els = new Map<PanelName, HTMLElement>();
  private seats: Partial<Record<PanelName, Seat>> = {};
  /** The board as the stage keeps it right now: edges, the deck, the column above JARVIS. */
  private room: () => Room;
  /** Panels waiting to be seated again, which the ones before them ignore. */
  private pending = new Set<PanelName>();
  /** One sheet at a time on a phone. */
  compact = false;
  onChange: (() => void) | null = null;

  constructor(root: HTMLElement, room: () => Room) {
    this.root = root;
    this.room = room;
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
    const B = this.room().bounds;
    const gap = 14;
    const others = this.openNames.filter((n) => n !== name && !this.pending.has(n)).map((n) => {
      const el = this.els.get(n)!;
      return { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, w: el.offsetWidth, h: el.offsetHeight };
    });
    const hits = (x: number, y: number) => others.some((o) => x < o.x + o.w + gap && x + w + gap > o.x && y < o.y + o.h + gap && y + h + gap > o.y);
    const top = B.top + 4;
    // Already on the board and still clear: it stays where it is.
    if (here && here.x >= B.left && here.x + w <= B.right && here.y >= B.top &&
        here.y + h <= this.floorAt(here.x, w) && !hits(here.x, here.y)) return here;
    // The outer edge this column hugs: its left edge on the left side, its right edge on the right.
    let edge = side === "l" ? x0 : x0 + w;
    for (let col = 0; col < 3; col++) {
      const x = side === "l" ? edge : edge - w;
      if (x < B.left || x + w > B.right) break;
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
    const r = this.room();
    const inColumn = x < r.cx + r.coreZone && x + w > r.cx - r.coreZone;
    return inColumn ? r.coreFloor : r.bounds.bottom;
  }

  private seat(name: PanelName, el: HTMLElement): void {
    if (this.compact) {
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.height = "";
      return;
    }
    const room = this.room();
    const B = room.bounds;
    const saved = this.seats[name];
    const lim = sizeLimits(room);
    const width = saved?.w ? Math.min(lim.maxW, saved.w) : undefined;
    const height = saved?.h ? Math.min(lim.maxH, saved.h) : undefined;
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
      ({ x, y } = this.freeSeat(name, d.side, d.side === "l" ? B.left : B.right - w, d.top, w, h, here));
    }
    // on the board whatever the window size is now, and off JARVIS — the same rule as a window's
    ({ x, y } = putDown({ x, y, w, h }, room));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (saved) this.seats[name] = { x, y, ...(width ? { w } : {}), ...(height ? { h } : {}) };
  }

  /**
   * The title bar carries the panel wherever the pointer goes, past the edge
   * included — as a window and a bubble are carried — and it is put down
   * inside the board when let go (seat → putDown).
   */
  private startDrag(e: PointerEvent, name: PanelName, el: HTMLElement): void {
    if (this.compact || gestures.busy || (e.target as HTMLElement).closest("button")) return;
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    e.preventDefault();
    gestures.begin(e, {
      travel: 3,
      move: (ev) => {
        if (!el.classList.contains("dragging")) el.classList.add("dragging");
        const root = this.root.getBoundingClientRect();
        el.style.left = `${ev.clientX - root.left - ox}px`;
        el.style.top = `${ev.clientY - root.top - oy}px`;
      },
      end: (_ev, moved) => {
        el.classList.remove("dragging");
        if (!moved) return;
        const old = this.seats[name];
        this.seats[name] = {
          x: parseFloat(el.style.left), y: parseFloat(el.style.top),
          ...(old?.w ? { w: el.offsetWidth } : {}),
          ...(old?.h ? { h: el.offsetHeight } : {}),
        };
        this.seat(name, el);
        this.persist();
      },
    });
  }

  /**
   * Every edge and corner sizes the panel (no grip is drawn; the cursor says
   * so), within the board's limits, the opposite side staying put — and never
   * below the floor above JARVIS.
   */
  private startResize(e: PointerEvent, name: PanelName, el: HTMLElement): void {
    if (this.compact || gestures.busy || (e.target as HTMLElement).closest("button")) return;
    const sides = sidesAt(el.getBoundingClientRect(), e.clientX, e.clientY);
    if (!sides) return;
    const r = el.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    const start = { x: r.left - root.left, y: r.top - root.top, w: el.offsetWidth, h: el.offsetHeight };
    const room = this.room();
    const lim = sizeLimits(room);
    el.classList.add("sizing");
    this.front(el); // stopPropagation below means the bubbling handler won't
    e.preventDefault();
    e.stopPropagation();
    gestures.begin(e, {
      travel: 0,
      move: (_ev, dx, dy) => {
        const B = room.bounds;
        let { x, y, w, h } = resized(start, sides, dx, dy, lim);
        x = Math.max(B.left, Math.min(B.right - w, x));
        // growing downwards stops at the floor (above the deck, or above JARVIS in his column)
        if (sides.ey > 0) h = Math.max(lim.minH, Math.min(h, this.floorAt(x, w) - start.y));
        y = Math.max(B.top, Math.min(this.floorAt(x, w) - h, y));
        // only the dimension being dragged is fixed; the other stays as it was
        if (sides.ex) el.style.width = `${Math.round(w)}px`;
        if (sides.ey) el.style.height = `${Math.round(h)}px`;
        el.style.left = `${Math.round(x)}px`;
        el.style.top = `${Math.round(y)}px`;
      },
      end: () => {
        el.classList.remove("sizing");
        const old = this.seats[name];
        this.seats[name] = {
          x: parseFloat(el.style.left) || 6, y: parseFloat(el.style.top) || 44,
          ...(sides.ex || old?.w ? { w: el.offsetWidth } : {}),
          ...(sides.ey || old?.h ? { h: el.offsetHeight } : {}),
        };
        this.persist();
      },
    });
  }

  private resizeCursor(e: PointerEvent, el: HTMLElement): void {
    if (this.compact || gestures.busy) return;
    el.style.cursor = sizeCursor(sidesAt(el.getBoundingClientRect(), e.clientX, e.clientY));
  }

  private persist(): void {
    store("jarvis.panelsOpen", this.openNames.join(","));
    store("jarvis.panelSeats", JSON.stringify(this.seats));
  }
}
