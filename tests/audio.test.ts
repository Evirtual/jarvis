import { test } from "node:test";
import assert from "node:assert/strict";

import { joinFloat32, speechEnd, speechStart, toFloat32 } from "../src/client/pcm.ts";
import { rankDeviceVoices, shortName } from "../src/client/device-voices.ts";

test("16-bit little-endian samples become floats between -1 and 1", () => {
  const bytes = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]);
  const f = toFloat32(bytes);
  assert.equal(f.length, 3);
  assert.equal(f[0], 0);
  assert.ok(Math.abs(f[1]! - 1) < 0.001);
  assert.equal(f[2], -1);
  assert.equal(toFloat32(new Uint8Array([1, 2, 3])).length, 1, "an odd byte is left over");
});

test("speech is found inside the silence a service leaves around it", () => {
  const rate = 24000;
  const d = new Float32Array(rate); // one second
  for (let i = 12000; i < 14000; i++) d[i] = 0.3; // speech from 0.5 s to 0.58 s
  const a = speechStart(d), b = speechEnd(d);
  assert.equal(a, 12000 - Math.floor(rate * 0.03), "30 ms kept before the first sound");
  assert.equal(b, 14000 - 1 + Math.floor(rate * 0.06), "60 ms kept after the last");
  const silent = new Float32Array(100);
  assert.equal(speechStart(silent), 0);
  assert.equal(speechEnd(silent), silent.length, "silence throughout: play it as it is");
});

test("pieces join in order", () => {
  const out = joinFloat32([new Float32Array([1, 2]), new Float32Array([3])]);
  assert.deepEqual([...out], [1, 2, 3]);
});

test("the device's voices are ranked British, male and natural first, novelties last", () => {
  const voices = [
    { name: "Microsoft Zira - English (United States)", lang: "en-US" },
    { name: "Google Deutsch", lang: "de-DE" },
    { name: "Microsoft Ryan Online (Natural) - English (United Kingdom)", lang: "en-GB" },
    { name: "Bad News", lang: "en-US" },
    { name: "Microsoft George - English (United Kingdom)", lang: "en-GB" },
  ];
  const ranked = rankDeviceVoices(voices).map((v) => shortName(v));
  assert.deepEqual(ranked.slice(0, 2), ["Ryan Online ✦", "George"]);
  assert.equal(ranked.at(-1), "Bad News");
  assert.ok(!ranked.includes("Google Deutsch"), "not English: left out while English voices exist");
  assert.equal(rankDeviceVoices([{ name: "Google Deutsch", lang: "de-DE" }]).length, 1, "but shown when nothing else is");
});
