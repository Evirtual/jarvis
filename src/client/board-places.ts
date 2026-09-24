/**
 * The board in words: nine places and a handful of sizes, the terms JARVIS
 * reads the board in (the snapshot says where each box sits) and moves it by
 * (the place directive). Words, not pixels — a model names "top-right"
 * reliably and guesses coordinates badly. Pure: the stage and the panels
 * measure and apply; this turns a word into a rectangle and back.
 */

import { shown, type Rect, type Room } from "./board-geometry.js";
import { type Limits } from "./surface.js";
import { PLACES, type BoxSize, type Place } from "../shared/directives.js";
import { clamp } from "./num.js";

export { BOX_SIZES, PLACES, type BoxSize, type Place } from "../shared/directives.js";

/** Which third of the board a place is in, across and down: -1, 0 or 1. */
function thirds(p: Place): { col: -1 | 0 | 1; row: -1 | 0 | 1 } {
  return {
    col: p.endsWith("left") ? -1 : p.endsWith("right") ? 1 : 0,
    row: p.startsWith("top") ? -1 : p.startsWith("bottom") ? 1 : 0,
  };
}

function placeAt(col: number, row: number): Place {
  const across = ["left", "", "right"][col + 1]!;
  const down = ["top", "", "bottom"][row + 1]!;
  if (!across && !down) return "centre";
  return (down && across ? `${down}-${across}` : down || across) as Place;
}

/** Where a box sits, as the board is read: the third its middle falls in, across and down. */
export function placeOf(r: Rect, room: Room): Place {
  const B = room.bounds;
  const third = (v: number, lo: number, hi: number): number => (v < lo + (hi - lo) / 3 ? -1 : v > hi - (hi - lo) / 3 ? 1 : 0);
  return placeAt(third(r.x + r.w / 2, B.left, B.right), third(r.y + r.h / 2, B.top, B.bottom));
}

/**
 * A box of this size put at a place: against the board's edge that place
 * names, centred along the others — then shown as every box is, inside the
 * board and clear of JARVIS (a box put bottom-centre sits above him).
 */
export function rectAt(p: Place, w: number, h: number, room: Room): Rect {
  const B = room.bounds;
  const { col, row } = thirds(p);
  const x = col < 0 ? B.left : col > 0 ? B.right - w : (B.left + B.right - w) / 2;
  const y = row < 0 ? B.top : row > 0 ? B.bottom - h : (B.top + B.bottom - h) / 2;
  return shown({ x, y, w, h }, room);
}

/** A named size, within the limits every box keeps. */
export function sizeOf(s: BoxSize, lim: Limits): { w: number; h: number } {
  const want: Record<BoxSize, { w: number; h: number }> = {
    small: { w: 300, h: 200 },
    medium: { w: 440, h: 320 },
    large: { w: 640, h: 480 },
    tall: { w: 400, h: Infinity },
    wide: { w: Infinity, h: 280 },
  };
  const { w, h } = want[s];
  return { w: clamp(w, lim.minW, lim.maxW), h: clamp(h, lim.minH, lim.maxH) };
}

/**
 * The board between boxes standing down its sides (the panels): its left
 * edge moved past those on the left half, its right edge before those on
 * the right. The whole board when what is left would be too narrow to use.
 */
export function roomBetween(room: Room, sides: Rect[], gap = 14, narrowest = 360): Room {
  const B = room.bounds;
  const mid = (B.left + B.right) / 2;
  const left = Math.max(B.left, ...sides.filter((r) => r.x + r.w / 2 < mid).map((r) => r.x + r.w + gap));
  const right = Math.min(B.right, ...sides.filter((r) => r.x + r.w / 2 >= mid).map((r) => r.x - gap));
  return right - left < narrowest ? room : { ...room, bounds: { ...B, left, right } };
}

/** The places nothing covers — where a box could go without landing on another. */
export function clearPlaces(boxes: Rect[], room: Room): Place[] {
  return PLACES.filter((p) => {
    const probe = rectAt(p, 240, 140, room);
    return !boxes.some((b) => probe.x < b.x + b.w && probe.x + probe.w > b.x && probe.y < b.y + b.h && probe.y + probe.h > b.y);
  });
}
