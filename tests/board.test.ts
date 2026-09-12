import { test } from "node:test";
import assert from "node:assert/strict";

import { overlapArea, seat, separate, shown, type Rect, type Room } from "../src/client/board-geometry.ts";
import { planTidy, type TidyItem } from "../src/client/tidy.ts";

/* A 1200 × 800 board: the deck below 700, JARVIS in the middle with 150 px clear either side, nothing over him below 560. */
const room: Room = { bounds: { top: 60, bottom: 700, left: 16, right: 1184 }, cx: 600, coreZone: 150, coreFloor: 560 };
const inside = (r: Rect): boolean => r.x >= room.bounds.left && r.x + r.w <= room.bounds.right && r.y >= room.bounds.top && r.y + r.h <= room.bounds.bottom;
const overCore = (r: Rect): boolean => r.x < room.cx + room.coreZone && r.x + r.w > room.cx - room.coreZone && r.y + r.h > room.coreFloor;

test("a window is shown inside the board, and never over JARVIS", () => {
  const off = shown({ x: -300, y: 5000, w: 300, h: 200 }, room);
  assert.ok(inside(off), "pulled back inside");
  const tall = shown({ x: 500, y: 60, w: 300, h: 600 }, room);
  assert.ok(!overCore(tall), "too tall for his column: stepped out of it");
  assert.ok(inside(tall));
  const low = shown({ x: 500, y: 650, w: 200, h: 100 }, room);
  assert.ok(!overCore(low), "in his column it stops above him");
});

test("a seat is free of what is already there", () => {
  const taken: Rect[] = [{ x: 400, y: 200, w: 400, h: 200 }];
  const s = seat(300, 150, taken, room);
  assert.equal(overlapArea(s, taken[0]!, 0), 0);
  assert.ok(inside(s) && !overCore(s));
});

test("two overlapping bubbles are nudged apart; the one in use stays put", () => {
  const placed = [
    { r: { x: 100, y: 100, w: 300, h: 200 }, here: true },
    { r: { x: 150, y: 150, w: 300, h: 200 }, here: false },
  ];
  separate(placed, room);
  assert.deepEqual(placed[0]!.r, { x: 100, y: 100, w: 300, h: 200 }, "the one you're in didn't move");
  assert.equal(overlapArea(placed[0]!.r, placed[1]!.r, 0), 0, "and the other gave way");
  assert.ok(inside(placed[1]!.r));
});

const item = (w: number, h: number, weight = 1, at = 0): TidyItem => ({ w, h, minW: Math.min(w, 260), weight, at });

test("tidy: a few windows go in one centred column, the biggest in the middle, widths untouched", () => {
  const items = [item(300, 60, 1, 1), item(320, 60, 5, 2), item(300, 60, 1, 3)];
  const plan = planTidy(items, room);
  assert.ok(plan.fitted);
  assert.deepEqual(plan.widths, [300, 320, 300]);
  const ys = plan.seats.map((s) => s.y);
  assert.equal(new Set(plan.seats.map((s) => Math.round(s.x + 150))).size <= 2, true, "all on the board's centre line");
  const middle = plan.seats[1]!;
  assert.ok(ys.every((y) => y >= room.bounds.top), "inside the board");
  assert.ok(Math.min(...ys) < middle.y && Math.max(...ys) > middle.y, "the biggest sits between the others");
});

test("tidy: too many for one column go to rows, and never overlap", () => {
  const items = Array.from({ length: 12 }, (_, i) => item(280, 90, 1, i));
  const plan = planTidy(items, room);
  assert.ok(plan.fitted, "twelve fit in a few rows");
  const rects = plan.seats.map((s, i) => ({ ...s, w: plan.widths[i]!, h: items[i]!.h }));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    assert.equal(overlapArea(rects[i]!, rects[j]!, 0), 0, `${i} and ${j} apart`);
  }
  assert.ok(rects.every((r) => inside(r) && !overCore(r)));
});

test("tidy: when nothing fits the height, everything is still seated, as narrow as allowed and inside the board", () => {
  // Six windows that cannot all be clear of each other in 200 px: the plan
  // takes the narrowest widths and the least-crowded seat for each.
  const tight: Room = { ...room, bounds: { ...room.bounds, bottom: 260 }, coreFloor: 200 };
  const items = Array.from({ length: 6 }, (_, i) => item(400, 120, 1, i));
  const plan = planTidy(items, tight);
  assert.equal(plan.fitted, false);
  assert.ok(plan.widths.every((w) => w === 260), "as narrow as allowed");
  assert.equal(plan.seats.length, 6);
  const rects = plan.seats.map((s, i) => ({ ...s, w: plan.widths[i]!, h: items[i]!.h }));
  assert.ok(rects.every((r) => r.x >= tight.bounds.left && r.x + r.w <= tight.bounds.right && r.y >= tight.bounds.top), "inside the board");
});
