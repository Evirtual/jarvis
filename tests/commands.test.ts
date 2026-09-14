import { test } from "node:test";
import assert from "node:assert/strict";

import { NEEDS_CONFIRMATION, extractDirectives, intentOf, parseUtterance, type ParseContext, type Parsed } from "../src/client/commands.ts";
import { DIRECTIVES, directiveCatalogue } from "../src/shared/directives.ts";
import { effortAsked, rankModels, wantsSearch } from "../src/shared/services/common.ts";

const threads = ["General", "Lithuania", "Trip planning", "Cambodia news"];
const putAway = ["Cambodia", "Trip planning"];
const groups = ["Research", "Travel"];
const answersTo = (list: string[], n: string): boolean => list.some((t) => t.toLowerCase().includes(n.toLowerCase().replace(/^the /, "").replace(/ thread$/, "")));
const ctx = (over: Partial<ParseContext> = {}): ParseContext => ({
  knowsThread: (n) => answersTo(threads, n),
  knowsPutAway: (n) => answersTo(putAway, n),
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

test("a new thread's subject, said in the same breath, is its first question", () => {
  const asked = (s: string): Parsed => parseUtterance(s, ctx());
  assert.deepEqual(asked("open a new thread about owls"), { actions: [{ name: "new_thread", branch: false }], ask: "about owls" });
  assert.equal(asked("Jarvis, start another chat on the Roman empire").ask, "on the Roman empire", "capitals kept, the address dropped");
  assert.equal(asked("open a new thread about owls and find pictures").ask, "about owls and find pictures", "the rest of the question follows it");
  assert.deepEqual(asked("branch off about the costs"), { actions: [{ name: "new_thread", branch: true }], ask: "about the costs" });
  assert.equal(asked("open a new thread about the weather in Lisbon").ask, "about the weather in Lisbon", "a subject that names a panel is still the subject");
  for (const s of ["open a new thread", "open a new thread please", "start a new thread based on this", "open a new thread about this", "new thread for now"]) {
    assert.equal(asked(s).ask, "", s);
  }
  assert.deepEqual(asked("new thread called Owls").actions, [{ name: "new_thread", branch: false, title: "Owls" }], "a name is not a question");
  assert.equal(asked("new thread called Owls").ask, "");
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

test("organising the board is said to JARVIS, not parsed: it reaches him as a question, and comes back as a directive", () => {
  for (const s of ["connect Lithuania with Trip planning", "move Lithuania into Travel", "collapse the research group", "expand all", "create a group called Home lab", "rename Trip planning to Summer in Vilnius", "open the Lithuania thread"]) {
    assert.equal(intentOf(s, ctx()), null, s);
    assert.equal(parseUtterance(s, ctx()).ask, s, s);
  }
  assert.deepEqual(extractDirectives('[[do: move_thread thread="Lithuania" group="Travel"]] [[do: collapse_group group="Research"]] [[do: rename_group group="Research" title="Deep dive"]] [[do: fold_thread open="no" title="Lithuania"]]').actions, [
    { name: "move_thread", thread: "Lithuania", group: "Travel" },
    { name: "collapse_group", group: "Research" },
    { name: "rename_group", group: "Research", title: "Deep dive" },
    { name: "fold_thread", open: false, title: "Lithuania" },
  ]);
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

test("a command said on its own is carried out; the punctuation and the please around it don't matter", () => {
  assert.deepEqual(parseUtterance("use the Fable voice.", ctx()), { actions: [{ name: "set_voice", voice: "fable" }], ask: "" });
  assert.deepEqual(parseUtterance("use the Fable voice, ?", ctx()), { actions: [{ name: "set_voice", voice: "fable" }], ask: "" });
  assert.deepEqual(parseUtterance("Jarvis, mute", ctx()), { actions: [{ name: "mute" }], ask: "" });
  assert.deepEqual(parseUtterance("could you show me the radar, please", ctx()), { actions: [{ name: "show_panel", panel: "perimeter" }], ask: "" });
});

test("a command word inside a sentence never acts: the sentence goes to JARVIS whole", () => {
  for (const s of [
    "show me the weather in Paris",
    "can you show me the storage options for a NAS",
    "use ChatGPT to write a poem",
    "delete all the duplicates in a list in Python",
    "silence of the lambs, who directed it",
    "restore the old painting techniques, how did they do it",
    "use the Fable voice and what time is it in Tokyo?",
    "speak faster and tell me a joke",
    "close the deal: how do I negotiate a raise",
    "new window managers for Linux",
    "branch prediction in CPUs, explained",
    "another one",
  ]) {
    assert.deepEqual(parseUtterance(s, ctx()), { actions: [], ask: s }, s);
  }
  assert.equal(parseUtterance("Jarvis, what is the capital of Peru?", ctx()).ask, "what is the capital of Peru?", "the address is not the question");
});

test("a sentence that begins by going to a thread asks the rest of it there", () => {
  assert.deepEqual(parseUtterance("go back to Lithuania and find hotels in Vilnius", ctx()), { actions: [{ name: "switch_thread", title: "lithuania" }], ask: "find hotels in Vilnius" });
  assert.deepEqual(parseUtterance("switch to Trip planning, what's the cheapest week", ctx()), { actions: [{ name: "switch_thread", title: "trip planning" }], ask: "what's the cheapest week" });
  assert.deepEqual(parseUtterance("go to Mars and find water", ctx()), { actions: [], ask: "go to Mars and find water" }, "no thread by that name: a question");
});

test("restoring by name is only for a thread that was put away", () => {
  assert.deepEqual(intentOf("restore Trip planning", ctx()), { name: "restore_thread", title: "Trip planning" });
  assert.equal(intentOf("restore the Roman aqueducts", ctx()), null, "nothing put away by that name: a question");
});

test("the newest model first, and a date or a 'latest' alias never outranks it", () => {
  assert.deepEqual(rankModels(["gpt-5.3-chat-latest", "gpt-6-astra", "gpt-5.5", "gpt-5-2025-08-07"]).slice(0, 2), ["gpt-6-astra", "gpt-5.5"]);
  assert.equal(rankModels(["deep-research-pro-preview-12-2025", "gemini-3.8-flash"])[0], "gemini-3.8-flash");
});

test("the small model of a generation is the default; a newer generation still outranks it; nano stays behind", () => {
  assert.deepEqual(rankModels(["gpt-5.5", "gpt-5.5-nano", "gpt-5.5-mini"]), ["gpt-5.5-mini", "gpt-5.5", "gpt-5.5-nano"]);
  assert.equal(rankModels(["gpt-5.5-mini", "gpt-6"])[0], "gpt-6");
  assert.equal(rankModels(["gemini-3.5-pro", "gemini-3.5-flash", "gemini-3.5-flash-lite"])[0], "gemini-3.5-flash");
});

test("depth asked for in words — think hard, take your time — is the thorough setting for that question; the words stay", () => {
  assert.equal(effortAsked("think hard about this: which of the three mortgages is cheapest over ten years?"), "thorough");
  assert.equal(effortAsked("Take your time, what would you do with the spare room?"), "thorough");
  assert.equal(effortAsked("is Lisbon nice in October, think carefully"), "thorough");
  assert.equal(effortAsked("hello there"), null);
  assert.equal(effortAsked("I think it is raining"), null, "'I think' is not a request");
  assert.equal(effortAsked("a hard think about nothing"), null);
});

test("the web is offered for a question that wants it, or a follow-up in a thread that came from it — not for talk", () => {
  const ask = (q: string, before: { role: "user" | "assistant"; content: string }[] = []) => wantsSearch([...before, { role: "user", content: q }]);
  assert.equal(ask("hello there, how are you"), false);
  assert.equal(ask("what is the capital of Peru"), false);
  assert.equal(ask("explain how a transistor works"), false);
  assert.equal(ask("find the latest news about the Baltic sea cables"), true);
  assert.equal(ask("what's the weather in Lisbon"), true);
  assert.equal(ask("look up the price of the Pixel 10"), true);
  assert.equal(ask("who won the match last night"), true);
  assert.equal(ask("show me pictures of the Eagle S"), true);
  assert.equal(ask("hello\n\n[Live readings from this device: CPU 3%. Do not recite these unless asked.]"), false, "the readings that ride along are not the question");
  const research = [{ role: "user" as const, content: "find the latest on the cables" }, { role: "assistant" as const, content: "According to Reuters, the Eagle S was detained." }];
  assert.equal(ask("and what about Germany?", research), true, "a follow-up in a thread that came from the web");
  const talk = [{ role: "user" as const, content: "tell me a joke" }, { role: "assistant" as const, content: "Why did the capacitor…" }];
  assert.equal(ask("another one", talk), false);
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

test("this thread folds and opens by the console's own word; a name goes to JARVIS", () => {
  assert.deepEqual(intentOf("fold this thread", ctx()), { name: "fold_thread", open: false });
  assert.deepEqual(intentOf("open up this thread", ctx()), { name: "fold_thread", open: true });
  assert.deepEqual(intentOf("minimise it", ctx()), { name: "fold_thread", open: false });
  assert.equal(intentOf("open the Lithuania thread", ctx()), null);
  // "open a new thread" is still a new thread, and "open the radar" still a panel
  assert.equal(intentOf("open a new thread", ctx())?.name, "new_thread");
  assert.deepEqual(intentOf("open the radar", ctx()), { name: "show_panel", panel: "perimeter" });
  // restoring by name keeps the capitals it was given
  assert.deepEqual(intentOf("restore Trip planning.", ctx()), { name: "restore_thread", title: "Trip planning" });
});

test("the directive table is the one place the model's actions live: every documented directive makes an action", () => {
  const sample = { title: "T", ask: "q", parent: "P", group: "G", threads: "A; B", thread: "T", a: "A", b: "B", why: "w", open: "yes", provider: "gemini", name: "compute", value: "1.1", tab: "voice", last: "yes" };
  for (const d of DIRECTIVES) {
    if (!d.doc) continue;
    assert.ok(d.make(sample), `${d.name} makes nothing of a full set of arguments`);
    assert.ok(directiveCatalogue().includes(`${d.name}`), `${d.name} is not told to the model`);
  }
  assert.ok(!directiveCatalogue().includes("title_thread —"), "housekeeping is explained in its own words, not listed");
  assert.match(directiveCatalogue(), /cannot delete/);
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
