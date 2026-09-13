/**
 * What every box on the board has in common — a thread's window, a group's
 * bubble, an instrument panel. Each is carried by its title bar and put down
 * inside the board, clear of JARVIS; each is sized from its corners and
 * edges within one set of limits; on each, a tap on the bar is a tap and a
 * travel is a drag. The boxes differ in what they hold and what a drop
 * means. This is the part that must not differ, kept in one place so a fix
 * to one is a fix to all: the stage (windows, bubbles) and panels.ts use it.
 */

import { type Rect, type Room, shown } from "./board-geometry.js";
import { clamp } from "./num.js";

/* ---------------- sizing ---------------- */

/** No box narrower or shorter than this, none wider than this. */
export const SURFACE_MIN_W = 210;
export const SURFACE_MAX_W = 760;
export const SURFACE_MIN_H = 90;

export type Side = -1 | 0 | 1;
/** Which sides of a box a size drag moves: -1 the left/top, 1 the right/bottom, 0 neither. */
export interface Sides { ex: Side; ey: Side }
export interface Limits { minW: number; maxW: number; minH: number; maxH: number }

/** The sides a corner name stands for: "nw" moves the left and the top, "e" the right alone. */
export function sidesOf(corner: string): Sides {
  return {
    ex: corner.includes("w") ? -1 : corner.includes("e") ? 1 : 0,
    ey: corner.includes("n") ? -1 : corner.includes("s") ? 1 : 0,
  };
}

/**
 * Which sides a point on a box would size, where the box draws no grips: a
 * corner (22px) takes two, an edge (a 7px strip, so the title bar still
 * drags) takes one, the middle none.
 */
export function sidesAt(r: DOMRect, x: number, y: number, corner = 22, edge = 7): Sides | null {
  const nearW = x <= r.left + corner, nearE = x >= r.right - corner;
  const nearN = y <= r.top + corner, nearS = y >= r.bottom - corner;
  if ((nearW || nearE) && (nearN || nearS)) return { ex: nearW ? -1 : 1, ey: nearN ? -1 : 1 };
  const onW = x <= r.left + edge, onE = x >= r.right - edge;
  const onN = y <= r.top + edge, onS = y >= r.bottom - edge;
  if (onW || onE) return { ex: onW ? -1 : 1, ey: 0 };
  if (onN || onS) return { ex: 0, ey: onN ? -1 : 1 };
  return null;
}

/** The cursor that says which way a point would size the box. */
export function sizeCursor(s: Sides | null): string {
  if (!s) return "";
  if (s.ex && s.ey) return s.ex === s.ey ? "nwse-resize" : "nesw-resize";
  return s.ex ? "ew-resize" : "ns-resize";
}

/** What a box on this board may be sized to: never wider than the board, never taller than the room above JARVIS. */
export function sizeLimits(room: Room): Limits {
  const B = room.bounds;
  return {
    minW: SURFACE_MIN_W,
    maxW: clamp(B.right - B.left, SURFACE_MIN_W, SURFACE_MAX_W),
    minH: SURFACE_MIN_H,
    maxH: Math.max(SURFACE_MIN_H, B.bottom - B.top),
  };
}

/**
 * A box sized from a corner or an edge by a pointer that has travelled (dx,
 * dy) since the press: the sides being dragged follow it, the opposite
 * sides stay where they were.
 */
export function resized(start: Rect, s: Sides, dx: number, dy: number, lim: Limits): Rect {
  const w = s.ex ? clamp(start.w + dx * s.ex, lim.minW, lim.maxW) : start.w;
  const h = s.ey ? clamp(start.h + dy * s.ey, lim.minH, lim.maxH) : start.h;
  return {
    x: s.ex < 0 ? start.x + start.w - w : start.x,
    y: s.ey < 0 ? start.y + start.h - h : start.y,
    w, h,
  };
}

/* ---------------- carrying ---------------- */

/**
 * Where a box is put down after being carried: wherever it was let go,
 * brought inside the board and clear of JARVIS. While carried it goes
 * wherever the pointer goes, the edge included; this is for the release.
 */
export const putDown = (r: Rect, room: Room): Rect => shown(r, room);

/* ---------------- one gesture at a time ---------------- */

export interface GestureHandlers {
  /** How far the pointer must travel before this counts as a drag rather than a tap. 0: from the first move. */
  travel?: number;
  /** The pointer has moved (past `travel`): where it is, and how far from the press. */
  move?(e: PointerEvent, dx: number, dy: number): void;
  /** The pointer was released or lost. `moved`: it travelled, so this was a drag, not a tap. */
  end(e: PointerEvent, moved: boolean): void;
}

/**
 * The pointer gesture in progress: begun on a press, followed by the same
 * pointer wherever it goes (the window, not the element, hears the moves,
 * so a box carried under the pointer never loses it), ended on release. One
 * at a time: a second press while one is under way is ignored.
 */
class Gestures {
  private active: { pid: number; sx: number; sy: number; moved: boolean; h: GestureHandlers } | null = null;
  private listening = false;

  /** Whether a press is being followed right now. */
  get busy(): boolean { return this.active !== null; }

  begin(e: PointerEvent, h: GestureHandlers): void {
    if (this.active) return;
    // The window is listened to from the first gesture, not at load: the
    // modules that use this are also read where there is no window (tests).
    if (!this.listening) {
      this.listening = true;
      window.addEventListener("pointermove", (ev) => this.onMove(ev));
      window.addEventListener("pointerup", (ev) => this.onEnd(ev));
      window.addEventListener("pointercancel", (ev) => this.onEnd(ev));
    }
    this.active = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, h };
  }

  private onMove(e: PointerEvent): void {
    const a = this.active;
    if (!a || e.pointerId !== a.pid) return;
    const dx = e.clientX - a.sx, dy = e.clientY - a.sy;
    if (!a.moved && Math.hypot(dx, dy) < (a.h.travel ?? 5)) return;
    a.moved = true;
    a.h.move?.(e, dx, dy);
  }

  private onEnd(e: PointerEvent): void {
    const a = this.active;
    if (!a || e.pointerId !== a.pid) return;
    this.active = null;
    a.h.end(e, a.moved);
  }
}

export const gestures = new Gestures();
