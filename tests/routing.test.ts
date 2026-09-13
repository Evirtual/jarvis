import { test } from "node:test";
import assert from "node:assert/strict";

import { whereTo } from "../src/client/routing.ts";
import type { Thread } from "../src/client/workspace.ts";

const thread = (id: string, title: string): Thread => ({ id, title, turns: [], createdAt: 1, groupId: "g-general" });
const lisbon = thread("t1", "Lisbon");
const riga = thread("t2", "Riga");
const byTitle = (title: string): Thread | null => (title === "Riga" ? riga : null);

test("a reply goes where the model says: the core, the thread in front, the thread named, or a new one", () => {
  assert.deepEqual(whereTo({ at: "core" }, lisbon, byTitle), { kind: "core" });
  assert.deepEqual(whereTo(null, lisbon, byTitle), { kind: "core" }, "no word is the core");
  assert.deepEqual(whereTo({ at: "thread" }, lisbon, byTitle), { kind: "thread", thread: lisbon });
  assert.deepEqual(whereTo({ at: "thread", title: "Riga" }, lisbon, byTitle), { kind: "thread", thread: riga }, "a thread named wins over the one in front");
  assert.deepEqual(whereTo({ at: "thread", title: "Mars" }, lisbon, byTitle), { kind: "thread", thread: lisbon }, "a name that fits nothing falls back to the one in front");
  assert.deepEqual(whereTo({ at: "new", title: "Tallinn" }, lisbon, byTitle), { kind: "new", title: "Tallinn" });
  assert.deepEqual(whereTo({ at: "new" }, null, byTitle), { kind: "new" });
});

test("a follow-up with nothing in front is conversation, not a thread", () => {
  assert.deepEqual(whereTo({ at: "thread" }, null, byTitle), { kind: "core" });
  assert.deepEqual(whereTo({ at: "thread", title: "Mars" }, null, byTitle), { kind: "core" });
});
