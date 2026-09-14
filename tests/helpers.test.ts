import { test } from "node:test";
import assert from "node:assert/strict";

import { capitalise, clip, editDistance } from "../src/client/text.ts";
import { esc, fmtRate, gib, gib0, hhmm } from "../src/client/dom.ts";
import { maskKey, pace, prepareTurns } from "../src/shared/services/common.ts";
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

/* ---------------- what is kept in the browser ---------------- */

/** A browser's storage for the length of a test: what it keeps, and whether it takes a save. */
function fakeStorage(): { kept: Map<string, string>; refuse: (yes: boolean) => void } {
  const kept = new Map<string, string>();
  let refusing = false;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => { if (refusing) throw new Error("QuotaExceededError"); kept.set(k, v); },
    removeItem: (k: string) => { kept.delete(k); },
  };
  return { kept, refuse: (yes) => { refusing = yes; } };
}

test("a setting kept under an older name is moved to its current one once, and never over a newer value", async () => {
  const { kept } = fakeStorage();
  try {
    const { KEY, migrateStorage, recall } = await import("../src/client/storage.ts");
    kept.set("jarvis.pitch", "0.9");
    kept.set("jarvis.panelsOpen", "compute");
    kept.set("jarvis.panels.open", "radar"); // already saved under the new name: the old one is dropped, not taken
    migrateStorage();
    assert.equal(recall(KEY.voicePitch), "0.9");
    assert.equal(recall(KEY.panelsOpen), "radar");
    assert.equal(kept.has("jarvis.pitch"), false);
    assert.equal(kept.has("jarvis.panelsOpen"), false);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("the conversation kept at the core before everything was a thread becomes a thread, not in front, and is then dropped", async () => {
  const { kept, refuse } = fakeStorage();
  try {
    const { BoardStore } = await import("../src/client/board-store.ts");
    const said = [
      { role: "user", content: "hello", at: 1 },
      { role: "assistant", content: "Good evening, sir.", at: 2 },
      { role: "sys", content: "Put away.", at: 3 }, // the console's notice, not the conversation
      { role: "user", content: "how are the systems", at: 4 },
    ];
    kept.set("jarvis.conversation", JSON.stringify(said));
    // The browser refuses the save: the old record stays, to be brought over next time.
    refuse(true);
    const refused = new BoardStore();
    assert.equal(refused.ws.all.length, 1, "on the board for this visit");
    assert.equal(kept.has("jarvis.conversation"), true, "not dropped before the board holding it was saved");
    refuse(false);
    const store = new BoardStore();
    const t = store.ws.all[0]!;
    assert.equal(store.ws.all.length, 1);
    assert.equal(t.title, "Previous conversation");
    assert.deepEqual(t.turns.map((x) => x.role), ["user", "assistant", "user"], "notices left out");
    assert.equal(store.ws.activeId, "", "on the board, not in front");
    assert.equal(kept.has("jarvis.conversation"), false, "dropped once saved");
    assert.equal(JSON.parse(kept.get("jarvis.workspace")!).threads[0].title, "Previous conversation");
    // An empty one leaves nothing behind and makes no thread.
    kept.clear();
    kept.set("jarvis.conversation", "[]");
    assert.equal(new BoardStore().ws.all.length, 0);
    assert.equal(kept.has("jarvis.conversation"), false);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
