import { test } from "node:test";
import assert from "node:assert/strict";

import { NEEDS_CONFIRMATION, extractDirectives, intentOf, parseRoute, parseUtterance, type ParseContext } from "../src/client/commands.ts";
import { rankModels } from "../src/shared/services/common.ts";

const threads = ["General", "Lithuania", "Trip planning", "Cambodia news"];
const groups = ["Research", "Travel"];
const ctx = (over: Partial<ParseContext> = {}): ParseContext => ({
  knowsThread: (n) => threads.some((t) => t.toLowerCase().includes(n.toLowerCase().replace(/^the /, "").replace(/ thread$/, ""))),
  knowsGroup: (n) => groups.some((g) => g.toLowerCase() === n.toLowerCase()),
  pendingApproval: false,
  ...over,
});

/* ---------------- utterances ---------------- */

test("an instruction and a question are separated", () => {
  const p = parseUtterance("start a new chat and find today's news in Cambodia", ctx());
  assert.deepEqual(p.actions, [{ name: "new_thread", branch: false }]);
  assert.equal(p.ask, "find today's news in Cambodia");
});

test("branching and subthreads are recognised", () => {
  assert.deepEqual(intentOf("branch off", ctx()), { name: "new_thread", branch: true });
  assert.deepEqual(intentOf("open a subthread", ctx()), { name: "new_thread", branch: true });
});

test("restating an instruction doesn't open two windows", () => {
  const p = parseUtterance("open a new chat, create a new thread", ctx());
  assert.equal(p.actions.filter((a) => a.name === "new_thread").length, 1);
});

test("ordinary notes that mention threads are kept intact", () => {
  const p = parseUtterance("QA log: created blank and named threads; verified unique references", ctx());
  assert.deepEqual(p.actions, []);
  assert.equal(p.ask, "QA log: created blank and named threads; verified unique references");
});

test("a named new thread keeps its supplied title", () => {
  assert.deepEqual(intentOf("new thread called QA named thread", ctx()), {
    name: "new_thread", branch: false, title: "QA named thread",
  });
  assert.deepEqual(intentOf('create a new chat named “Trip ideas”', ctx()), {
    name: "new_thread", branch: false, title: "Trip ideas",
  });
});

test("switching needs a thread that exists; the core name wins over a thread name", () => {
  assert.deepEqual(intentOf("go back to Lithuania", ctx()), { name: "switch_thread", title: "lithuania" });
  assert.deepEqual(intentOf("focus Trip planning", ctx()), { name: "switch_thread", title: "trip planning" });
  assert.deepEqual(intentOf("select the Cambodia thread", ctx()), { name: "switch_thread", title: "cambodia" });
  assert.equal(intentOf("go back to Mars", ctx()), null);
  assert.deepEqual(intentOf("switch to Gemini", ctx()), { name: "switch_core", provider: "gemini" });
  assert.deepEqual(intentOf("use chatgpt", ctx()), { name: "switch_core", provider: "openai" });
  assert.deepEqual(intentOf("talk to open ai", ctx()), { name: "switch_core", provider: "openai" });
});

test("connecting and moving threads, and folding groups", () => {
  assert.deepEqual(intentOf("connect Lithuania with Trip planning", ctx()), { name: "link_threads", a: "lithuania", b: "trip planning" });
  assert.deepEqual(intentOf("move Lithuania into Travel", ctx()), { name: "move_thread", thread: "lithuania", group: "Travel" });
  assert.deepEqual(intentOf("collapse the research group", ctx()), { name: "collapse_group", group: "research" });
  assert.deepEqual(intentOf("expand all", ctx()), { name: "expand_group", group: "all" });
  assert.deepEqual(intentOf("create a group called Home lab", ctx()), { name: "new_group", title: "Home lab" });
});

test("deleting a group is understood, and always needs confirming", () => {
  assert.deepEqual(intentOf("delete the research group", ctx()), { name: "delete_group", group: "research" });
  assert.equal(intentOf("delete the nonexistent group", ctx()), null, "only groups that exist");
  assert.ok(NEEDS_CONFIRMATION.has("delete_group"));
  assert.ok(NEEDS_CONFIRMATION.has("delete_thread"));
  assert.ok(NEEDS_CONFIRMATION.has("clear_thread"));
  assert.deepEqual(extractDirectives('[[do: delete_group group="Research"]]').actions, [], "and the model can't ask for it");
});

test("close means archive; only an explicit phrase deletes", () => {
  assert.deepEqual(intentOf("close this chat", ctx()), { name: "archive_thread" });
  assert.deepEqual(intentOf("delete this thread", ctx()), { name: "archive_thread" });
  assert.deepEqual(intentOf("delete this thread permanently", ctx()), { name: "delete_thread" });
  assert.deepEqual(intentOf("restore the Cambodia thread", ctx()), { name: "restore_thread", title: "Cambodia" });
  for (const q of ["restore the last one", "open the last thread I closed", "bring back the thread I just put away", "undo that close", "restore"]) {
    assert.deepEqual(intentOf(q, ctx()), { name: "restore_thread", title: "", last: true }, q);
  }
});

test("a reply says where it belongs in its first words; no word means the core", () => {
  assert.deepEqual(parseRoute("[[at: core]] Good afternoon, sir."), { route: { at: "core" }, text: "Good afternoon, sir.", undecided: false });
  assert.deepEqual(parseRoute("[[at: thread]] Sintra is worth the day."), { route: { at: "thread" }, text: "Sintra is worth the day.", undecided: false });
  assert.deepEqual(parseRoute('[[at: new "Lisbon in October"]] Mild, sir.'), { route: { at: "new", title: "Lisbon in October" }, text: "Mild, sir.", undecided: false });
  assert.deepEqual(parseRoute("Good afternoon, sir."), { route: null, text: "Good afternoon, sir.", undecided: false });
  assert.deepEqual(parseRoute("[[at: co"), { route: null, text: "", undecided: true }, "still arriving");
  assert.deepEqual(parseRoute("[[do: mute]]").undecided, false, "a directive is not a route");
});

test("clearing the put-away threads is its own request, and always asks first", () => {
  for (const q of ["clear the put-away threads", "delete all the put away threads", "empty the archive", "delete the archived chats"]) {
    assert.deepEqual(intentOf(q, ctx()), { name: "clear_archived" }, q);
  }
  assert.deepEqual(intentOf("delete everything", ctx()), { name: "delete_all" }, "the whole board is still the whole board");
  assert.ok(NEEDS_CONFIRMATION.has("clear_archived"));
  assert.deepEqual(extractDirectives('[[do: clear_archived]]').actions, [], "and the model can't ask for it");
});

test("a question about the voice is not a request to change it", () => {
  assert.equal(intentOf("which voice are you speaking with", ctx()), null);
  assert.equal(intentOf("what voice is that", ctx()), null);
  assert.deepEqual(intentOf("use the Fable voice", ctx()), { name: "set_voice", voice: "fable" });
  assert.deepEqual(intentOf("change the voice to Ash", ctx()), { name: "set_voice", voice: "ash" });
  assert.deepEqual(intentOf("set voice George", ctx()), { name: "set_voice", voice: "george" });
});

test("what is left after the commands is only asked if it has words in it", () => {
  assert.equal(parseUtterance("use the Fable voice.", ctx()).ask, "");
  assert.equal(parseUtterance("use the Fable voice, ?", ctx()).ask, "");
  assert.equal(parseUtterance("use the Fable voice and what time is it in Tokyo?", ctx()).ask, "what time is it in Tokyo?");
});

test("the newest model first, and a date or a 'latest' alias never outranks it", () => {
  assert.deepEqual(rankModels(["gpt-5.3-chat-latest", "gpt-6-astra", "gpt-5.5", "gpt-5-2025-08-07"]).slice(0, 2), ["gpt-6-astra", "gpt-5.5"]);
  assert.equal(rankModels(["deep-research-pro-preview-12-2025", "gemini-3.8-flash"])[0], "gemini-3.8-flash");
});

test("services that aren't connections are not cores", () => {
  assert.equal(intentOf("use claude", ctx()), null);
});

test("yes and no only mean approve and deny while a confirmation is waiting", () => {
  assert.equal(intentOf("yes", ctx()), null);
  assert.equal(intentOf("no", ctx()), null);
  assert.deepEqual(intentOf("yes", ctx({ pendingApproval: true })), { name: "approve" });
  assert.deepEqual(intentOf("go ahead", ctx({ pendingApproval: true })), { name: "approve" });
  assert.deepEqual(intentOf("no", ctx({ pendingApproval: true })), { name: "deny" });
});

test("a sweep is only ever asked for in so many words", () => {
  assert.equal(intentOf("what's my network like", ctx())?.name ?? null, null);
  assert.deepEqual(intentOf("scan the network", ctx()), { name: "sweep" });
});

/* ---------------- directives from the reasoning core ---------------- */

test("directives become actions and vanish from the text", () => {
  const r = extractDirectives(
    'On it, sir. [[do: new_thread title="Aurora" ask="Where is the aurora visible tonight?" parent="Solar storms"]] ' +
    '[[do: link_threads a="Lithuania" b="Trip planning" why="Baltics"]] [[do: new_group title="Research" threads="A; B"]]',
  );
  assert.equal(r.text, "On it, sir.");
  assert.deepEqual(r.actions, [
    { name: "new_thread", branch: false, title: "Aurora", ask: "Where is the aurora visible tonight?", parent: "Solar storms" },
    { name: "link_threads", a: "Lithuania", b: "Trip planning", why: "Baltics" },
    { name: "new_group", title: "Research", threads: ["A", "B"] },
  ]);
});

test("the model can't delete, approve, or run unknown actions", () => {
  const r = extractDirectives('[[do: delete_thread title="General"]][[do: approve]][[do: format_disk]][[do: close_thread]]');
  assert.deepEqual(r.actions, [{ name: "archive_thread" }], "close is archive; the rest are dropped");
});

test("at most eight directives are taken from one reply", () => {
  const r = extractDirectives(Array.from({ length: 12 }, () => "[[do: archive_all]]").join(" "));
  assert.equal(r.actions.length, 8);
});

test("threads and groups are opened, folded and renamed by name, without asking the model", () => {
  assert.deepEqual(intentOf("open the Lithuania thread", ctx()), { name: "fold_thread", open: true, title: "lithuania" });
  assert.deepEqual(intentOf("open Trip planning", ctx()), { name: "fold_thread", open: true, title: "trip planning" });
  assert.deepEqual(intentOf("minimise Cambodia news", ctx()), { name: "fold_thread", open: false, title: "cambodia news" });
  // "open a new thread" is still a new thread, and "open the radar" still a panel
  assert.equal(intentOf("open a new thread", ctx())?.name, "new_thread");
  assert.deepEqual(intentOf("open the radar", ctx()), { name: "show_panel", panel: "perimeter" });
  // a group by its name alone
  assert.deepEqual(intentOf("expand Research", ctx()), { name: "expand_group", group: "research" });
  assert.deepEqual(intentOf("fold the Travel", ctx()), { name: "collapse_group", group: "travel" });
  // renaming keeps the capitals it was given, even with a full stop at the end
  assert.deepEqual(intentOf("rename Trip planning to Summer in Vilnius.", ctx()), { name: "rename_thread", target: "trip planning", title: "Summer in Vilnius" });
  assert.deepEqual(intentOf("rename the Research group to Deep Dive", ctx()), { name: "rename_group", group: "research", title: "Deep Dive" });
  assert.deepEqual(intentOf("rename this to Budget.", ctx()), { name: "rename_thread", title: "Budget" });
  assert.deepEqual(intentOf("rename this thread to Tokyo", ctx()), { name: "rename_thread", title: "Tokyo" });
  assert.deepEqual(intentOf("call this chat Budget", ctx()), { name: "rename_thread", title: "Budget" });
  // moving into a group keeps the group's name intact
  assert.deepEqual(intentOf("move Lithuania into the Travel group", ctx()), { name: "move_thread", thread: "lithuania", group: "Travel" });
  // an unknown name is a question, not a command
  assert.equal(intentOf("rename Mars to Phobos", ctx()), null);
});

test("putting everything away is understood however it is said", () => {
  for (const s of ["put all away", "put all threads away", "put all the threads away", "put everything away", "close all threads", "put away all chats"]) {
    assert.deepEqual(intentOf(s, ctx()), { name: "archive_all" }, s);
  }
  // panels are not threads
  assert.deepEqual(intentOf("put all panels away", ctx()), { name: "hide_panel", panel: "all" });
});

test("tidying the board is understood, and never mistaken for deleting", () => {
  for (const s of ["tidy up", "tidy up the board", "arrange the windows", "clean up the board", "organise my threads", "rearrange everything"]) {
    assert.deepEqual(intentOf(s, ctx()), { name: "tidy_board" }, s);
  }
  assert.deepEqual(parseUtterance("tidy up the board, please", ctx()).actions, [{ name: "tidy_board" }]);
  // deleting still needs its own words
  assert.equal(intentOf("delete everything", ctx())?.name, "delete_all");
});

test("the first-run guide can be asked for, and settings are still settings", () => {
  for (const q of ["run setup", "show me the guide", "open the setup guide", "start the onboarding", "setup"]) {
    assert.deepEqual(intentOf(q, ctx()), { name: "open_setup" }, q);
  }
  assert.deepEqual(intentOf("open settings", ctx()), { name: "open_config", tab: "connections" });
  assert.deepEqual(extractDirectives("[[do: open_setup]]").actions, [{ name: "open_setup" }]);
});

test("voice words that aren't a voice's name are not read as one", () => {
  assert.deepEqual(intentOf("open voice settings", ctx()), { name: "open_config", tab: "voice" });
  assert.deepEqual(intentOf("show me the voice settings", ctx()), { name: "open_config", tab: "voice" });
  assert.deepEqual(intentOf("voice off", ctx()), { name: "mute" });
  assert.deepEqual(intentOf("turn the voice on", ctx()), { name: "unmute" });
  // a real voice still works
  assert.deepEqual(intentOf("use the Lewis voice", ctx()), { name: "set_voice", voice: "lewis" });
  assert.deepEqual(intentOf("voice to emma", ctx()), { name: "set_voice", voice: "emma" });
});

test("naming a thread is JARVIS's own housekeeping, never something typed or said", () => {
  const d = extractDirectives('Mild, sir. [[do: title_thread title="Lisbon in October"]]');
  assert.equal(d.text, "Mild, sir.");
  assert.deepEqual(d.actions, [{ name: "title_thread", title: "Lisbon in October" }]);
  assert.deepEqual(extractDirectives('[[do: new_subject title="Formula 1 results"]]').actions, [], "a directive that no longer exists is ignored");
  assert.equal(intentOf("title thread Lisbon", ctx()), null);
});
