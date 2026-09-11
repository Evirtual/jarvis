import { test } from "node:test";
import assert from "node:assert/strict";

import { computeLinks, relatedness } from "../src/client/links.ts";

const th = (id: string, title: string, pairs: [string, string][], extra: Partial<{ parentId: string; ties: { to: string; why: string }[] }> = {}) => ({
  id, title,
  turns: pairs.flatMap(([q, a]) => [{ role: "user" as const, content: q }, { role: "assistant" as const, content: a }]),
  ...extra,
});

const board = () => [
  th("lt", "Lithuania", [["what's going on in Lithuania", "Vilnius hosted a summit; Rail Baltica opened a section."]]),
  th("trip", "Trip planning", [["plan a trip to Vilnius and Riga", "Three days in Vilnius, then Rail Baltica to Riga."]]),
  th("kh", "Cambodia", [["today's news in Cambodia", "Siem Reap tourism is up, says the Phnom Penh Post."]]),
  th("sky", "Weather", [["is it raining", "Light drizzle here."]]),
];

test("threads about the same places are found related, unrelated ones are not", () => {
  const r = relatedness(board(), "lt");
  const top = r[0];
  assert.equal(top?.id, "trip");
  assert.ok(top!.why.some((w) => /vilnius|rail baltica|lithuania/i.test(w)), `why was ${JSON.stringify(top!.why)}`);
  assert.ok(!r.some((x) => x.id === "sky"), "the weather thread shares nothing");
});

test("a branch and a deliberate connection count as relationships", () => {
  const list = [
    ...board(),
    th("sub", "Vilnius hotels", [["hotels?", "Stikliai."]], { parentId: "lt" }),
    th("odd", "Something else", [["unrelated question about baking", "Use more butter."]], { ties: [{ to: "lt", why: "on purpose" }] }),
  ];
  const r = relatedness(list, "lt");
  assert.ok(r.find((x) => x.id === "sub")!.why.includes("branch"));
  assert.ok(r.find((x) => x.id === "odd")!.why.includes("on purpose"), "a connection made on purpose is kept even without shared words");
});

test("the board's automatic links stay sparse", () => {
  const links = computeLinks(board());
  for (const id of ["lt", "trip", "kh", "sky"]) {
    assert.ok(links.filter((l) => l.a === id || l.b === id).length <= 2, "at most two strings per thread");
  }
});
