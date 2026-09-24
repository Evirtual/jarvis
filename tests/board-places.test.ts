import { test } from "node:test";
import assert from "node:assert/strict";

import { clearPlaces, placeOf, rectAt, roomBetween, sizeOf, PLACES } from "../src/client/board-places.ts";
import { sizeLimits } from "../src/client/surface.ts";
import type { Room } from "../src/client/board-geometry.ts";

const room: Room = { bounds: { top: 60, bottom: 700, left: 16, right: 1184 }, cx: 600, coreZone: 150, coreFloor: 560 };

test("a box put at a place hugs the edges that place names", () => {
  assert.deepEqual(rectAt("top-left", 300, 200, room), { x: 16, y: 60, w: 300, h: 200 });
  assert.deepEqual(rectAt("top-right", 300, 200, room), { x: 884, y: 60, w: 300, h: 200 });
  assert.deepEqual(rectAt("bottom-left", 300, 200, room), { x: 16, y: 500, w: 300, h: 200 });
  assert.deepEqual(rectAt("left", 300, 200, room), { x: 16, y: 280, w: 300, h: 200 });
});

test("a box put at the bottom centre sits above JARVIS, never on him", () => {
  const r = rectAt("bottom", 300, 200, room);
  assert.equal(r.x, 450);
  assert.ok(r.y + r.h <= room.coreFloor, "clear of his column");
});

test("where a box is put is where it is read back", () => {
  for (const p of PLACES) {
    if (p.startsWith("bottom") && p !== "bottom-left" && p !== "bottom-right") continue; // above JARVIS, the bottom centre reads as the middle
    assert.equal(placeOf(rectAt(p, 260, 160, room), room), p, p);
  }
});

test("named sizes stay within the limits every box keeps", () => {
  const lim = sizeLimits(room);
  assert.deepEqual(sizeOf("small", lim), { w: 300, h: 200 });
  assert.equal(sizeOf("tall", lim).h, lim.maxH);
  assert.equal(sizeOf("wide", lim).w, lim.maxW);
});

test("the board between the panels: past those on the left, short of those on the right", () => {
  const r = roomBetween(room, [{ x: 16, y: 60, w: 290, h: 200 }, { x: 890, y: 60, w: 294, h: 300 }]);
  assert.equal(r.bounds.left, 320);
  assert.equal(r.bounds.right, 876);
  // too little left between them: the whole board
  assert.deepEqual(roomBetween(room, [{ x: 16, y: 60, w: 500, h: 200 }, { x: 600, y: 60, w: 580, h: 200 }]), room);
});

test("clear places are the ones nothing covers", () => {
  const clear = clearPlaces([{ x: 16, y: 60, w: 400, h: 300 }], room);
  assert.ok(!clear.includes("top-left"));
  assert.ok(clear.includes("top-right"));
});
