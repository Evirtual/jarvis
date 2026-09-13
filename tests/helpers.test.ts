import { test } from "node:test";
import assert from "node:assert/strict";

import { capitalise, clip, editDistance } from "../src/client/text.ts";
import { esc, fmtRate, gib, gib0, hhmm } from "../src/client/dom.ts";
import { maskKey, pace, prepareTurns } from "../src/shared/services/common.ts";
import { coreChat } from "../src/client/core-chat.ts";
import { clamp } from "../src/client/num.ts";

/* ---------------- text ---------------- */

test("edit distance: the small distances a name lookup depends on", () => {
  assert.equal(editDistance("", ""), 0);
  assert.equal(editDistance("lisbon", "lisbon"), 0);
  assert.equal(editDistance("lisbon", "lisbn"), 1, "a letter dropped");
  assert.equal(editDistance("lisbon", "lisbom"), 1, "a letter changed");
  assert.equal(editDistance("lisbon", "lisbons"), 1, "a letter added");
  assert.equal(editDistance("cat", "dog"), 3);
  assert.equal(editDistance("abc", ""), 3);
});

test("clip: one line, at most n characters, an ellipsis where it was cut", () => {
  assert.equal(clip("  a   b\n\tc  ", 20), "a b c", "whitespace collapsed");
  assert.equal(clip("abcdef", 6), "abcdef", "exactly n stays whole");
  assert.equal(clip("abcdefg", 6), "abcde…", "n − 1 characters and the ellipsis");
  assert.equal(clip("", 5), "");
});

test("capitalise: the first letter only", () => {
  assert.equal(capitalise("trip planning"), "Trip planning");
  assert.equal(capitalise("ÉCOLE"), "ÉCOLE");
  assert.equal(capitalise(""), "");
});

test("clamp holds a number between two others", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

/* ---------------- dom helpers (the pure ones) ---------------- */

test("esc: the five characters that could turn text into markup", () => {
  assert.equal(esc(`<img src=x onerror="alert('1')">&`), "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;");
  assert.equal(esc("plain text, sir."), "plain text, sir.");
});

test("sizes and rates as the deck shows them", () => {
  assert.equal(gib(1024 ** 3), "1.0");
  assert.equal(gib(1.5 * 1024 ** 3), "1.5");
  assert.equal(gib0(1.5 * 1024 ** 3), "2");
  assert.equal(fmtRate(null), "—");
  assert.equal(fmtRate(512), "512 B/s");
  assert.equal(fmtRate(2500), "3 KB/s");
  assert.equal(fmtRate(1_500_000), "1.5 MB/s");
});

test("hhmm: the time of day out of an ISO stamp", () => {
  assert.equal(hhmm("2026-09-13T18:42:00+07:00"), "18:42");
  assert.equal(hhmm(null), "—");
  assert.equal(hhmm("nonsense"), "—");
});

/* ---------------- what the services are sent ---------------- */

test("prepareTurns: the last dozen, alternating, starting with the user, the context on the newest question only", () => {
  const turns = [
    { role: "assistant", content: "Good evening." }, // a console line before any question: dropped
    { role: "user", content: "hello" },
    { role: "assistant", content: "Hello, sir." },
    { role: "assistant", content: "Anything else?" }, // two replies in a row: joined
    { role: "user", content: "the weather" },
  ];
  const out = prepareTurns(turns, "[readings]");
  assert.ok(out);
  assert.deepEqual(out.map((t) => t.role), ["user", "assistant", "user"]);
  assert.equal(out[1]!.content, "Hello, sir.\n\nAnything else?");
  assert.equal(out[2]!.content, "the weather\n\n[readings]", "the context rides on the newest question");
  assert.equal(out[0]!.content, "hello", "and on nothing else");
});

test("prepareTurns: nothing to ask is null; long questions are capped; only the last twelve go", () => {
  assert.equal(prepareTurns([], "x"), null);
  assert.equal(prepareTurns([{ role: "assistant", content: "only me" }]), null);
  assert.equal(prepareTurns([{ role: "user", content: "" }]), null, "an empty question is no question");
  const long = prepareTurns([{ role: "user", content: "x".repeat(5000) }]);
  assert.equal(long![0]!.content.length, 4000);
  const many = Array.from({ length: 29 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  const out = prepareTurns(many)!;
  assert.ok(out.length <= 12);
  assert.equal(out[out.length - 1]!.content, "m28", "the newest question is the last one asked");
  assert.equal(prepareTurns(many.slice(0, 30).concat({ role: "assistant", content: "trailing reply" })), null, "a history that ends with a reply has no question to ask");
});

test("maskKey shows a key's head and tail, never the middle", () => {
  assert.equal(maskKey("sk-proj-ABCDEFGHIJKL"), "sk-proj…IJKL");
  assert.equal(maskKey("AIza1234"), "AIza…1234");
  assert.equal(maskKey("ab"), "…ab");
});

test("pace: a slider's figure becomes an instruction in words", () => {
  assert.equal(pace(1.2), "Speak briskly.");
  assert.equal(pace(0.8), "Speak slowly and deliberately.");
  assert.equal(pace(1.0), "Speak at an easy, natural pace.");
});

/* ---------------- the conversation at the core ---------------- */

test("the conversation keeps the last eighty lines, hands the model only talk, and takes a line back", () => {
  coreChat.clear();
  for (let i = 0; i < 90; i++) coreChat.add(i % 2 ? "assistant" : "user", `line ${i}`);
  assert.equal(coreChat.lines.length, 80, "capped");
  assert.equal(coreChat.lines[0]!.content, "line 10", "the oldest fall off the top");
  coreChat.add("sys", "a notice");
  assert.ok(coreChat.recent(3).every((t) => t.role !== "sys"), "notices are not sent to the model");
  assert.equal(coreChat.recent(3).length, 3);
  assert.equal(coreChat.lines.length, 80, "the cap holds on every add");
  coreChat.add("user", "a question");
  coreChat.forget("user", "a question");
  assert.notEqual(coreChat.lines[coreChat.lines.length - 1]!.content, "a question", "taken back when it belonged in a thread");
  const n = coreChat.lines.length;
  coreChat.forget("user", "not the last line");
  assert.equal(coreChat.lines.length, n, "only the last line, only if it matches");
  coreChat.clear();
  assert.equal(coreChat.lines.length, 0);
});
