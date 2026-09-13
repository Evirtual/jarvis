import { test } from "node:test";
import assert from "node:assert/strict";

import { resized, sidesAt, sidesOf, sizeCursor, sizeLimits, putDown, SURFACE_MAX_W, SURFACE_MIN_H, SURFACE_MIN_W } from "../src/client/surface.ts";
import type { Room } from "../src/client/board-geometry.ts";

const room: Room = { bounds: { top: 60, bottom: 700, left: 16, right: 1184 }, cx: 600, coreZone: 150, coreFloor: 560 };

test("a corner names the sides it moves", () => {
  assert.deepEqual(sidesOf("se"), { ex: 1, ey: 1 });
  assert.deepEqual(sidesOf("nw"), { ex: -1, ey: -1 });
  assert.deepEqual(sidesOf("e"), { ex: 1, ey: 0 });
  assert.deepEqual(sidesOf("n"), { ex: 0, ey: -1 });
});

test("sized from a corner: the dragged sides follow, the opposite ones stay put, within the limits", () => {
  const start = { x: 100, y: 100, w: 300, h: 200 };
  const lim = sizeLimits(room);
  assert.deepEqual(resized(start, sidesOf("se"), 50, 30, lim), { x: 100, y: 100, w: 350, h: 230 }, "bottom-right grows away");
  assert.deepEqual(resized(start, sidesOf("nw"), 50, 30, lim), { x: 150, y: 130, w: 250, h: 170 }, "top-left moves the box and shrinks it; the far corner is where it was");
  assert.deepEqual(resized(start, sidesOf("e"), 50, 999, lim), { x: 100, y: 100, w: 350, h: 200 }, "an edge moves one dimension only");
  assert.equal(resized(start, sidesOf("se"), -1000, 0, lim).w, SURFACE_MIN_W, "never narrower than the minimum");
  assert.equal(resized(start, sidesOf("se"), 5000, 0, lim).w, SURFACE_MAX_W, "never wider than the maximum");
  assert.equal(resized(start, sidesOf("s"), 0, -1000, lim).h, SURFACE_MIN_H, "never shorter than the minimum");
  assert.equal(resized(start, sidesOf("s"), 0, 5000, lim).h, room.bounds.bottom - room.bounds.top, "never taller than the board");
});

test("the limits come from the board: a narrow board caps the width", () => {
  const narrow = { ...room, bounds: { ...room.bounds, right: 416 } };
  assert.equal(sizeLimits(narrow).maxW, 400);
  assert.equal(sizeLimits(room).maxW, SURFACE_MAX_W);
});

test("a point on a box without grips: corners take two sides, edges one, the middle none", () => {
  const r = { left: 100, top: 100, right: 400, bottom: 300 } as DOMRect;
  assert.deepEqual(sidesAt(r, 105, 105), { ex: -1, ey: -1 });
  assert.deepEqual(sidesAt(r, 395, 295), { ex: 1, ey: 1 });
  assert.deepEqual(sidesAt(r, 250, 297), { ex: 0, ey: 1 }, "the bottom edge");
  assert.deepEqual(sidesAt(r, 103, 200), { ex: -1, ey: 0 }, "the left edge");
  assert.equal(sidesAt(r, 250, 200), null, "the middle drags, it doesn't size");
  assert.equal(sizeCursor(sidesAt(r, 395, 295)), "nwse-resize");
  assert.equal(sizeCursor(sidesAt(r, 395, 105)), "nesw-resize");
  assert.equal(sizeCursor(null), "");
});

test("put down past the edge, a box comes back inside the board", () => {
  const r = putDown({ x: 2000, y: -500, w: 300, h: 200 }, room);
  assert.equal(r.x, room.bounds.right - 300);
  assert.equal(r.y, room.bounds.top);
});
