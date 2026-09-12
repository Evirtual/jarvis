import { test } from "node:test";
import assert from "node:assert/strict";

import { isNewSubject } from "../src/client/subject.ts";
import type { Turn } from "../src/shared/types.ts";

const kyoto: Turn[] = [
  { role: "user", content: "Where should I stay in Kyoto during cherry blossom season?" },
  { role: "assistant", content: "Sir, downtown around Sanjo–Kawaramachi is the best all-round base; Kyoto Station suits frequent rail trips, and Gion–Higashiyama puts you beside the temples for blossom walks. Book early: spring rooms go months ahead." },
];

test("a question on something the thread never mentions starts a new one", () => {
  assert.equal(isNewSubject(kyoto, "What's the latest news on SpaceX Starship?"), true);
  assert.equal(isNewSubject(kyoto, "Show me pictures of Mount Fuji."), true);
  assert.equal(isNewSubject(kyoto, "Recommend a good laptop for programming."), true);
});

test("follow-ups stay in the thread they carry on", () => {
  assert.equal(isNewSubject(kyoto, "And what's the weather like there at the moment?"), false);
  assert.equal(isNewSubject(kyoto, "How much does it cost per night?"), false);
  assert.equal(isNewSubject(kyoto, "Is Gion safe to walk at night?"), false);
  assert.equal(isNewSubject(kyoto, "What about the temples near Higashiyama?"), false);
  assert.equal(isNewSubject(kyoto, "Why?"), false);
  assert.equal(isNewSubject(kyoto, "Tell me more"), false);
  assert.equal(isNewSubject(kyoto, "Which of those is quieter?"), false);
});

test("a thread with nothing answered yet is the question's own", () => {
  assert.equal(isNewSubject([], "What's the latest news on SpaceX Starship?"), false);
  assert.equal(isNewSubject([{ role: "user", content: "Kyoto hotels" }], "SpaceX Starship news"), false);
});

test("a capital at the start of a sentence is not a name", () => {
  // "Show", "Tell", "Could" open sentences; only the rest can name a subject
  assert.equal(isNewSubject(kyoto, "Could you book something near Kyoto Station?"), false);
});
