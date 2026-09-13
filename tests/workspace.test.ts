import { test } from "node:test";
import assert from "node:assert/strict";

import { averageHues, GENERAL_ID, Workspace, migrate } from "../src/client/workspace.ts";

const turns = (q: string, a: string) => [{ role: "user" as const, content: q }, { role: "assistant" as const, content: a }];

/* ---------------- migration ---------------- */

test("an empty store starts with a clean screen", () => {
  const d = migrate(null);
  assert.equal(d.version, 2);
  assert.deepEqual(d.threads, [], "no thread until there's something to talk about");
  assert.equal(d.activeId, "");
  assert.equal(d.groups[0]!.id, GENERAL_ID, "General exists to put the first thread in");
  assert.deepEqual(new Workspace(d).visibleGroups, [], "and nothing is drawn");
});

test("version 1 threads are all carried over, messages intact", () => {
  const v1 = [
    { id: "a", title: "General", turns: turns("hi", "hello"), x: -300, y: 0, createdAt: 1 },
    { id: "b", title: "Lithuania", turns: turns("news in Lithuania", "Vilnius…"), x: 300, y: 0, createdAt: 2, ties: [{ to: "c", why: "Baltics" }] },
    { id: "c", title: "Trip planning", turns: turns("plan a trip", "Riga…"), x: 300, y: 150, createdAt: 3 },
    { id: "d", title: "Branch of Lithuania", turns: [], x: 400, y: 200, createdAt: 4, parentId: "b" },
    { id: "e", title: "Orphan", turns: [], x: 0, y: 0, createdAt: 5, parentId: "gone" },
  ];
  const d = migrate(v1, "c");
  assert.equal(d.threads.length, 5, "no thread lost");
  assert.deepEqual(d.threads.find((t) => t.id === "b")!.turns, v1[1]!.turns, "messages intact");
  assert.equal(d.activeId, "c", "active thread kept");

  const byId = new Map(d.threads.map((t) => [t.id, t]));
  const baltics = d.groups.find((g) => g.title === "Baltics");
  assert.ok(baltics, "tied threads become a group named for the tie");
  assert.equal(byId.get("b")!.groupId, baltics!.id);
  assert.equal(byId.get("c")!.groupId, baltics!.id);
  assert.equal(byId.get("d")!.groupId, baltics!.id, "a branch goes where its parent goes");
  assert.equal(byId.get("a")!.groupId, GENERAL_ID);
  assert.equal(byId.get("e")!.parentId, undefined, "dangling parent removed");
});

test("version 2 data is repaired, not discarded", () => {
  const d = migrate({
    version: 2,
    groups: [],
    threads: [{ id: "x", title: "X", turns: [], createdAt: 1, groupId: "nope", parentId: "x" }],
    activeId: "missing",
  });
  assert.ok(d.groups.some((g) => g.id === GENERAL_ID));
  assert.equal(d.threads[0]!.groupId, GENERAL_ID);
  assert.equal(d.threads[0]!.parentId, undefined);
  assert.equal(d.activeId, "", "a thread not in front before is not put in front on load");
});

/* ---------------- creation, branching, switching ---------------- */

test("a subthread lives in its parent's group and hangs below it", () => {
  const ws = new Workspace();
  const g = ws.ensureGroup("Research");
  const root = ws.createThread({ title: "Solar storms", groupId: g.id });
  const sub = ws.createThread({ title: "Aurora forecasts", parentId: root.id });
  const subsub = ws.createThread({ title: "Where to see it", parentId: sub.id });
  assert.equal(sub.groupId, g.id);
  assert.equal(ws.depth(subsub), 2);
  assert.deepEqual(ws.treeOrder(g.id).map((t) => t.title), ["Solar storms", "Aurora forecasts", "Where to see it"]);
  assert.equal(ws.activeId, subsub.id, "a new thread takes the focus");
  assert.ok(ws.focus(root.id));
  assert.equal(ws.active.id, root.id);
});

test("thread names are resolved forgivingly, and ambiguity is reported", () => {
  const ws = new Workspace();
  ws.createThread({ title: "Cambodia news" });
  ws.createThread({ title: "Lithuania news" });
  ws.createThread({ title: "Trip planning" });
  assert.equal(ws.findThread("the trip planning thread").kind, "one");
  assert.equal(ws.findThread("cambodia").kind, "one");
  assert.equal(ws.findThread("trip planing").kind, "one", "a typo still finds it");
  const m = ws.findThread("news");
  assert.equal(m.kind, "many");
  assert.equal(m.kind === "many" && m.threads.length, 2);
  assert.equal(ws.findThread("mars").kind, "none");
});

/* ---------------- linking groups threads into one bubble ---------------- */

test("connecting two General threads makes a group named for the connection", () => {
  const ws = new Workspace();
  const a = ws.createThread({ title: "Lithuania" });
  const kid = ws.createThread({ title: "Vilnius hotels", parentId: a.id });
  const b = ws.createThread({ title: "Trip planning" });
  const r = ws.tie(a.id, b.id, "Baltic trip");
  assert.equal(r.group?.title, "Baltic trip");
  assert.equal(a.groupId, r.group!.id);
  assert.equal(b.groupId, r.group!.id);
  assert.equal(kid.groupId, r.group!.id, "subthreads come along");
  assert.deepEqual(a.ties, [{ to: b.id, why: "Baltic trip" }]);
});

test("a General thread joins the other's group; two named groups stay apart", () => {
  const ws = new Workspace();
  const research = ws.ensureGroup("Research");
  const travel = ws.ensureGroup("Travel");
  const a = ws.createThread({ title: "Solar storms", groupId: research.id });
  const b = ws.createThread({ title: "Loose idea" });
  assert.equal(ws.tie(b.id, a.id, "space weather").group?.id, research.id);
  assert.equal(b.groupId, research.id);

  const c = ws.createThread({ title: "Iceland", groupId: travel.id });
  const r = ws.tie(a.id, c.id, "aurora");
  assert.equal(r.group, null, "no bubble is raided");
  assert.equal(c.groupId, travel.id);
  assert.ok(a.ties?.some((t) => t.to === c.id), "the link is still recorded");
});

test("moving a subthread out of its parent's group keeps a tie back", () => {
  const ws = new Workspace();
  const root = ws.createThread({ title: "Root" });
  const sub = ws.createThread({ title: "Sub", parentId: root.id });
  const g = ws.ensureGroup("Elsewhere");
  ws.moveThread(sub.id, g.id);
  assert.equal(sub.groupId, g.id);
  assert.equal(sub.parentId, undefined);
  assert.deepEqual(sub.ties, [{ to: root.id, why: "branched from" }]);
});

/* ---------------- a group is two threads put together ---------------- */

test("dropping one thread on another makes a group; the group dissolves back to one", () => {
  const ws = new Workspace();
  const a = ws.createThread({ title: "Solar storms" });
  const b = ws.createThread({ title: "Aurora forecast" });
  const c = ws.createThread({ title: "Cambodia" });
  assert.deepEqual(ws.visibleGroups.map((g) => g.title), ["General"], "loose threads are not a group");

  const g = ws.groupThreads(b.id, a.id);
  assert.equal(g?.title, "Solar storms", "named after the thread it was dropped on");
  assert.equal(a.groupId, g!.id);
  assert.equal(b.groupId, g!.id);
  assert.equal(c.groupId, GENERAL_ID);

  // two more loose threads dropped together make a group of their own — even
  // with the same titles as before (every "New thread" pair once joined the first group)
  const d = ws.createThread({ title: "Solar storms" });
  const e = ws.createThread({ title: "Aurora forecast" });
  const g2 = ws.groupThreads(e.id, d.id);
  assert.notEqual(g2?.id, g!.id, "a new pair made a new group");
  assert.equal(g2?.title, "Solar storms 2", "named apart from the first");
  assert.equal(d.groupId, g2!.id);
  assert.equal(e.groupId, g2!.id);
  assert.equal(a.groupId, g!.id, "the first group is untouched");

  // connecting two loose threads in words does the same: a group of their own
  const f = ws.createThread({ title: "Solar storms" });
  const h = ws.createThread({ title: "Aurora forecast" });
  const tied = ws.tie(f.id, h.id);
  assert.ok(tied.group && tied.group.id !== g!.id && tied.group.id !== g2!.id, "a tie between new threads made a new group");

  // a third joins the same group rather than making another
  assert.equal(ws.groupThreads(c.id, b.id)?.id, g!.id);
  assert.equal(ws.live.filter((t) => t.groupId === g!.id).length, 3);

  // pull two back out: the last one left has no group to be in
  ws.moveThread(c.id, GENERAL_ID);
  assert.ok(ws.group(g!.id), "two is still a group");
  ws.moveThread(b.id, GENERAL_ID);
  assert.equal(ws.group(g!.id), undefined, "one is not");
  assert.equal(a.groupId, GENERAL_ID);
});

test("archiving down to one thread also dissolves the group", () => {
  const ws = new Workspace();
  const a = ws.createThread({ title: "A" });
  const b = ws.createThread({ title: "B" });
  const g = ws.groupThreads(b.id, a.id)!;
  ws.archive(b.id);
  assert.equal(ws.group(g.id), undefined);
  assert.equal(a.groupId, GENERAL_ID);
});

test("each window remembers whether it is open, on its own", () => {
  const ws = new Workspace();
  const a = ws.createThread({ title: "A" });
  const b = ws.createThread({ title: "B" });
  assert.ok(ws.isOpen(a) && ws.isOpen(b), "new threads are open");
  ws.setOpen(a.id, false);
  assert.equal(ws.isOpen(a), false);
  assert.equal(ws.isOpen(b), true, "folding one leaves the other alone");
  ws.focus(a.id);
  assert.equal(ws.isOpen(b), true, "and so does moving the focus");
});

/* ---------------- lifecycle: archive ≠ clear ≠ delete ---------------- */

test("archive puts a thread and its subthreads away; restore brings them back", () => {
  const ws = new Workspace();
  const root = ws.createThread({ title: "Research" });
  root.turns = turns("q", "a");
  const sub = ws.createThread({ title: "Sub", parentId: root.id });
  const gone = ws.archive(root.id);
  assert.equal(gone.length, 2);
  assert.ok(!ws.live.includes(root) && !ws.live.includes(sub));
  assert.ok(ws.all.includes(root), "archived is not deleted");
  assert.equal(ws.activeId, "", "nothing takes its place in front");
  assert.equal(ws.active, undefined);

  ws.restore(root.id);
  assert.ok(ws.live.includes(root) && ws.live.includes(sub));
  assert.equal(root.turns.length, 2, "history survives the round trip");
  assert.equal(ws.activeId, root.id);
});

test("clear empties history but keeps the thread; delete re-homes subthreads", () => {
  const ws = new Workspace();
  const a = ws.createThread({ title: "A" });
  a.turns = turns("q", "a");
  assert.equal(ws.clear(a.id), 2);
  assert.ok(ws.thread(a.id));
  assert.equal(a.turns.length, 0);

  const kid = ws.createThread({ title: "Kid", parentId: a.id });
  const other = ws.createThread({ title: "Other" });
  ws.tie(other.id, a.id);
  ws.remove(a.id);
  assert.equal(ws.thread(a.id), undefined);
  assert.ok(ws.thread(kid.id), "subthread kept");
  assert.equal(kid.parentId, undefined);
  assert.ok(!(other.ties ?? []).some((t) => t.to === a.id), "no tie points at a deleted thread");
});

test("the last thread can be cleared away, leaving a clean screen", () => {
  const ws = new Workspace();
  const only = ws.createThread({ title: "Only" });
  ws.archive(only.id);
  assert.equal(ws.live.length, 0);
  assert.equal(ws.activeId, "");
  assert.equal(ws.active, undefined);
  assert.ok(ws.empty);
  ws.restore(only.id);
  assert.equal(ws.activeId, only.id, "and it comes back when restored");
});

test("removing a group returns its threads to General; General can't be removed", () => {
  const ws = new Workspace();
  const g = ws.ensureGroup("Temp");
  const t = ws.createThread({ title: "T", groupId: g.id });
  ws.removeGroup(g.id);
  assert.equal(t.groupId, GENERAL_ID);
  ws.removeGroup(GENERAL_ID);
  assert.ok(ws.group(GENERAL_ID));
});

test("a loose position is preserved until a thread joins a group", () => {
  const ws = new Workspace();
  const a = ws.createThread({ title: "A" });
  const b = ws.createThread({ title: "B" });
  a.x = -180; a.y = 75;
  const restored = new Workspace(migrate(JSON.parse(JSON.stringify(ws))));
  assert.equal(restored.thread(a.id)?.x, -180);
  assert.equal(restored.thread(a.id)?.y, 75);
  const g = ws.groupThreads(a.id, b.id)!;
  assert.equal(a.x, undefined);
  assert.equal(a.y, undefined);
  assert.equal(b.x, undefined);
  ws.removeGroup(g.id);
  assert.equal(a.groupId, GENERAL_ID);
  assert.equal(a.x, undefined, "a dissolved group is reseated instead of using a stale free-window position");
});

test("threads receive distinct accents and group colours average their members", () => {
  const ws = new Workspace();
  const a = ws.createThread({ title: "A" });
  const b = ws.createThread({ title: "B" });
  assert.notEqual(a.color, b.color);
  assert.equal(averageHues(["#ff0000", "#0000ff"]), "#800080");
});

test("a group empties out and is gone; what was put away in it comes back loose", () => {
  const ws = new Workspace();
  const g = ws.ensureGroup("A");
  const t = ws.createThread({ title: "T", groupId: g.id });
  const u = ws.createThread({ title: "U", groupId: g.id });
  ws.archive(u.id);
  ws.moveThread(t.id, GENERAL_ID);
  assert.equal(ws.group(g.id), undefined, "nothing live is left in it");
  ws.restore(u.id);
  assert.equal(u.groupId, GENERAL_ID, "and the thread returns on its own, not to a group of one");
});

test("saved and reloaded, a workspace is the same", () => {
  const ws = new Workspace();
  const g = ws.ensureGroup("Research");
  const r = ws.createThread({ title: "Root", groupId: g.id });
  ws.createThread({ title: "Sub", parentId: r.id });
  const again = new Workspace(migrate(JSON.parse(JSON.stringify(ws))));
  assert.deepEqual(again.data, ws.data);
});

test("positions are measured from the board's corner, and an older save is marked for converting", () => {
  // new and pre-group saves have no positions yet, so they start corner-anchored
  assert.equal(migrate(null).anchor, "corner");
  assert.equal(migrate([{ id: "a", title: "A", turns: [] }]).anchor, "corner");
  // a version-2 save from before keeps its centre offsets untouched until the stage converts it
  const old = migrate({ version: 2, activeId: "t", groups: [{ id: GENERAL_ID, title: "General", createdAt: 0, origin: "system" }], threads: [{ id: "t", title: "T", turns: [], createdAt: 1, groupId: GENERAL_ID, x: -200, y: -100 }] });
  assert.equal(old.anchor, undefined);
  assert.equal(old.threads[0]!.x, -200);
  // once converted, the mark survives a save and reload
  const again = migrate(JSON.parse(JSON.stringify({ ...old, anchor: "corner" })));
  assert.equal(again.anchor, "corner");
});

test("a thread or group whose whole name is a filler word can still be named", () => {
  const ws = new Workspace(migrate(null));
  const a = ws.createThread({ title: "One" });
  const b = ws.createThread({ title: "Group" });
  const r1 = ws.findThread("one");
  assert.equal(r1.kind === "one" && r1.thread.id, a.id);
  const r2 = ws.findThread("Group");
  assert.equal(r2.kind === "one" && r2.thread.id, b.id);
  // filler around a real name is still ignored
  const c = ws.createThread({ title: "Cambodia news" });
  const r3 = ws.findThread("the Cambodia news one");
  assert.equal(r3.kind === "one" && r3.thread.id, c.id);
});

test("a long name is cut at a word, with an ellipsis", () => {
  const ws = new Workspace(migrate(null));
  const t = ws.createThread({ title: "An extraordinarily long thread title that goes on and on" });
  assert.equal(t.title, "An extraordinarily long thread title…");
  ws.rename(t.id, "Short one");
  assert.equal(t.title, "Short one");
  // one enormous word is cut where it has to be
  ws.rename(t.id, "Pneumonoultramicroscopicsilicovolcanoconiosis-and-more");
  assert.ok(t.title.endsWith("…") && t.title.length <= 40, t.title);
});

/* ---------------- a new subject, and naming ---------------- */

test("a question on a new subject moves, with its answer, to a thread of its own", () => {
  const ws = new Workspace();
  const lisbon = ws.createThread({ title: "Lisbon trip" });
  lisbon.turns.push(...turns("Weather in Lisbon in October?", "Mild, sir."), ...turns("Who won the last F1 race?", "Antonelli, sir."));
  const f1 = ws.splitLast(lisbon.id, "Formula 1 results");
  assert.ok(f1);
  assert.equal(f1!.title, "Formula 1 results");
  assert.deepEqual(f1!.turns.map((t) => t.content), ["Who won the last F1 race?", "Antonelli, sir."]);
  assert.deepEqual(lisbon.turns.map((t) => t.content), ["Weather in Lisbon in October?", "Mild, sir."], "the Lisbon conversation stays");
  assert.equal(ws.activeId, f1!.id, "and the new subject is the one in front");
});

test("a thread's only exchange is never moved away from it", () => {
  const ws = new Workspace();
  const t = ws.createThread({});
  t.turns.push(...turns("Who won the last F1 race?", "Antonelli, sir."));
  assert.equal(ws.splitLast(t.id, "Formula 1 results"), null);
  assert.equal(t.turns.length, 2);
});

test("a stand-in title is cleared by any real name", () => {
  const ws = new Workspace();
  const t = ws.createThread({});
  t.provisional = true;
  ws.rename(t.id, "Lisbon in October");
  assert.equal(t.title, "Lisbon in October");
  assert.equal(t.provisional, undefined);
});
