/**
 * Tidy up: the plan. Everything is stacked in one column down the middle of
 * the board, the biggest in the middle, the rest above and below it in turn.
 * When one column is too tall for the screen, two go to a row, then three,
 * each row centred the same way, the biggest in the middle of the middle
 * row. It all stays above JARVIS.
 *
 * Nothing is resized unless there are so many that they don't fit side by
 * side; then only their widths come down, and only as far as they must. Pure:
 * the stage measures the windows and bubbles, this says where each goes, and
 * the stage puts them there.
 */

import { overlapArea, seat, shown, type Rect, type Room } from "./board-geometry.js";

/** One thing to seat: a folded window or a bubble, as measured. */
export interface TidyItem {
  w: number;
  h: number;
  /** The narrowest it may be made. */
  minW: number;
  /** How much is in it: what wins the middle seat among equals. */
  weight: number;
  /** When it was made: the newest of equals goes first. */
  at: number;
}

export interface TidyPlan {
  /** Each item's width, in the order given: less than it was only when the row was too wide. */
  widths: number[];
  /** Each item's top-left corner, in the order given. */
  seats: { x: number; y: number }[];
  /** False when nothing fitted the height and the narrowest arrangement was used instead. */
  fitted: boolean;
}

export function planTidy(items: TidyItem[], room: Room, gap = 14): TidyPlan {
  const B = room.bounds;
  const W = B.right - B.left;
  const roomH = Math.min(B.bottom, room.coreFloor) - B.top;

  // Biggest first; among equals, the one with more in it, then the newest.
  const order = items.map((_, i) => i).sort((a, b) => {
    const A = items[a]!, C = items[b]!;
    return C.w * C.h - A.w * A.h || C.weight - A.weight || C.at - A.at;
  });
  const sorted = order.map((i) => items[i]!);

  /** `cols` to a row, as evenly as rows allow — the fuller rows first, as they sit in the middle. */
  const rowsOf = (n: number, cols: number): number[][] => {
    const count = Math.ceil(n / cols), base = Math.floor(n / count), extra = n % count;
    const rows: number[][] = [];
    let i = 0;
    for (let r = 0; r < count; r++) { const k = base + (r < extra ? 1 : 0); rows.push(Array.from({ length: k }, () => i++)); }
    return rows;
  };
  const tall = (rows: number[][]): number =>
    rows.reduce((sum, r) => sum + Math.max(...r.map((i) => sorted[i]!.h)), 0) + gap * (rows.length - 1);
  const wide = (widths: number[], rows: number[][]): number =>
    Math.max(...rows.map((r) => r.reduce((sum, i) => sum + widths[i]!, 0) + gap * (r.length - 1)));

  /**
   * One centred column if it fits; two to a row if not, then three… — the
   * fewest that fit the height. Widths stay as they are unless a row is too
   * wide for the screen, and then come down only as far as that row needs.
   * Null if nothing fits.
   */
  const plan = (): { widths: number[]; rows: number[][] } | null => {
    for (let cols = 1; cols <= sorted.length; cols++) {
      const rows = rowsOf(sorted.length, cols);
      if (tall(rows) > roomH) continue;
      for (let sx = 1; sx >= 0.3; sx -= 0.02) {
        const widths = sorted.map((it) => Math.round(Math.max(it.minW, Math.min(it.w, it.w * sx))));
        if (wide(widths, rows) <= W) return { widths, rows };
        if (widths.every((w, i) => w === sorted[i]!.minW)) break;
      }
      return null; // too narrow for this many side by side; more to a row won't help
    }
    return null;
  };
  /** Whatever fits across at the narrowest, for when nothing fits the height. */
  const fallback = (): { widths: number[]; rows: number[][] } => {
    const widths = sorted.map((it) => it.minW);
    let cols = sorted.length;
    while (cols > 1 && wide(widths, rowsOf(sorted.length, cols)) > W) cols--;
    return { widths, rows: rowsOf(sorted.length, cols) };
  };

  const planned = plan();
  const p = planned ?? fallback();

  // Within a row: the biggest in the middle, the rest to its right and left
  // in turn. Rows stack the same way: the first in the middle, the next above
  // it, the next below, and so on.
  const stacked: { line: number[]; h: number; at: "mid" | "above" | "below" }[] = [];
  p.rows.forEach((row, k) => {
    const line: number[] = [];
    row.forEach((i, n) => (n % 2 ? line.push(i) : line.unshift(i)));
    const r = { line, h: Math.max(...row.map((i) => sorted[i]!.h)) };
    if (k === 0) stacked.push({ ...r, at: "mid" });
    else if (k % 2) stacked.unshift({ ...r, at: "above" });
    else stacked.push({ ...r, at: "below" });
  });
  const total = stacked.reduce((sum, r) => sum + r.h, 0) + gap * (stacked.length - 1);
  let y = B.top + Math.max(0, (roomH - total) / 2);
  const mx = (B.left + B.right) / 2;
  const placed: Rect[] = [];
  const seats: { x: number; y: number }[] = new Array<{ x: number; y: number }>(sorted.length);
  for (const r of stacked) {
    const width = r.line.reduce((sum, i) => sum + p.widths[i]!, 0) + gap * (r.line.length - 1);
    let x = mx - width / 2;
    for (const i of r.line) {
      // Rows above hang from the middle row, rows below stand on it, and the
      // middle one is centred on its own line.
      const h = sorted[i]!.h;
      const dy = r.at === "above" ? r.h - h : r.at === "below" ? 0 : (r.h - h) / 2;
      let at: Rect = { x: Math.round(x), y: Math.round(y + dy), w: p.widths[i]!, h };
      // Too many for the screen: any that would land on JARVIS or another
      // window take the nearest free seat instead.
      if (!planned) {
        const s = shown(at, room);
        if (s.x !== at.x || s.y !== at.y || placed.some((o) => overlapArea(at, o, gap / 2) > 0)) at = seat(at.w, at.h, placed, room);
      }
      placed.push(at);
      seats[i] = { x: at.x, y: at.y };
      x += p.widths[i]! + gap;
    }
    y += r.h + gap;
  }

  // Back in the order the items were given.
  const widths = new Array<number>(items.length);
  const out = new Array<{ x: number; y: number }>(items.length);
  order.forEach((original, k) => { widths[original] = p.widths[k]!; out[original] = seats[k]!; });
  return { widths, seats: out, fitted: planned !== null };
}
