/**
 * Where things sit on the board: pure geometry, no DOM. Keeping a rectangle
 * inside the board and clear of JARVIS, finding a free seat, and nudging two
 * bubbles apart. The stage measures and applies; this decides.
 */

export interface Rect { x: number; y: number; w: number; h: number }

/** The board's edges, and the column kept clear above JARVIS. */
export interface Room {
  bounds: { top: number; bottom: number; left: number; right: number };
  /** Where the core is, and how far either side of it the board stays clear. */
  cx: number;
  coreZone: number;
  /** Nothing in the core's column may reach below this. */
  coreFloor: number;
}

export function overlapArea(a: Rect, b: Rect, margin: number): number {
  const w = Math.min(a.x + a.w, b.x + b.w + margin) - Math.max(a.x, b.x - margin);
  const h = Math.min(a.y + a.h, b.y + b.h + margin) - Math.max(a.y, b.y - margin);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Where a window or bubble is actually shown: inside the board, clear of the deck and of JARVIS. */
export function shown(r: Rect, room: Room): Rect {
  const B = room.bounds;
  let x = Math.max(B.left, Math.min(B.right - r.w, r.x));
  const inColumn = (px: number): boolean => px < room.cx + room.coreZone && px + r.w > room.cx - room.coreZone;
  // Too tall to fit above him: step out of his column, to whichever side is nearer.
  if (inColumn(x) && r.h > room.coreFloor - B.top) {
    const left = room.cx - room.coreZone - r.w, right = room.cx + room.coreZone;
    const fitsL = left >= B.left, fitsR = right + r.w <= B.right;
    if (fitsL && (!fitsR || x - left < right - x)) x = left;
    else if (fitsR) x = right;
  }
  const bottom = inColumn(x) ? Math.min(B.bottom, room.coreFloor) : B.bottom;
  let y = Math.max(B.top, Math.min(bottom - r.h, r.y));
  if (r.h > bottom - B.top) y = B.top;
  return { x: Math.round(x), y: Math.round(y), w: r.w, h: r.h };
}

/** A free seat begins in the board's centre, then works outward. */
export function seat(w: number, h: number, taken: Rect[], room: Room): Rect {
  const B = room.bounds;
  const step = 24;
  const mid = (B.left + B.right) / 2;
  // Both axes begin at the board's centre and fan out from there.
  const xs: number[] = [];
  for (let x = B.left + 6; x + w <= B.right; x += step) xs.push(x);
  xs.sort((a, b) => Math.abs(a + w / 2 - mid) - Math.abs(b + w / 2 - mid));
  const ys: number[] = [];
  for (let y = B.top + 6; y + h <= B.bottom; y += step) ys.push(y);
  const yMid = (B.top + B.bottom - h) / 2;
  ys.sort((a, b) => Math.abs(a - yMid) - Math.abs(b - yMid));
  let best: { r: Rect; cost: number } | null = null;
  for (const y of ys) {
    for (const x of xs) {
      // judged where it would really be shown (clear of JARVIS), not where asked
      const r = shown({ x, y, w, h }, room);
      const overlap = taken.reduce((sum, o) => sum + overlapArea(r, o, 24), 0);
      if (overlap === 0) return r;
      if (!best || overlap < best.cost) best = { r, cost: overlap };
    }
  }
  return shown(best?.r ?? { x: Math.round(mid - w / 2), y: B.top + 6, w, h }, room);
}

/**
 * Bubbles change size as windows open and close in them, so two that were
 * seated apart can come to overlap. Nudge them apart for display — the one
 * you're working in stays still — without touching where they're saved.
 */
export function separate(placed: { r: Rect; here: boolean }[], room: Room): void {
  const gap = 20;
  const clear = (a: Rect, b: Rect): boolean =>
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap <= 0 ||
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap <= 0;

  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const A = placed[i]!, B = placed[j]!;
        if (clear(A.r, B.r)) continue;
        const ox = Math.min(A.r.x + A.r.w, B.r.x + B.r.w) - Math.max(A.r.x, B.r.x) + gap;
        const oy = Math.min(A.r.y + A.r.h, B.r.y + B.r.h) - Math.max(A.r.y, B.r.y) + gap;
        // The bubble you're working in stays; the other one gives way. If the
        // way out is against an edge, try the other direction, then the other
        // bubble — anything rather than leaving two of them on top of
        // each other.
        const order = A.here ? [B, A] : [A, B];
        for (const mover of order) {
          const still = mover === A ? B : A;
          const dx = mover.r.x + mover.r.w / 2 < still.r.x + still.r.w / 2 ? -ox : ox;
          const dy = mover.r.y + mover.r.h / 2 < still.r.y + still.r.h / 2 ? -oy : oy;
          const tries: Rect[] = ox < oy
            ? [{ ...mover.r, x: mover.r.x + dx }, { ...mover.r, y: mover.r.y + dy }, { ...mover.r, x: mover.r.x - dx }]
            : [{ ...mover.r, y: mover.r.y + dy }, { ...mover.r, x: mover.r.x + dx }, { ...mover.r, y: mover.r.y - dy }];
          const fixed = tries.map((t) => shown(t, room)).find((t) => clear(t, still.r));
          if (!fixed) continue;
          mover.r = fixed;
          moved = true;
          break;
        }
      }
    }
    if (!moved) break;
  }
}
