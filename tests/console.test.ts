import { test } from "node:test";
import assert from "node:assert/strict";

import type { AskEvent, Catalogue, Effort, KeySource, ProviderId } from "../src/shared/types.ts";
import type { AskHow } from "../src/shared/services/common.ts";
import { ConsoleCore, CoreError, type KeyStore } from "../src/shared/services/console.ts";
import { PROVIDERS, type Service } from "../src/shared/services/index.ts";

/* A service that answers from memory, and counts what it was asked. */

const CATALOGUE: Catalogue = {
  chat: ["g-3", "g-2"],
  speech: ["tts-new", "tts-old"],
  hearing: ["g-3"],
  voices: [{ id: "Charon", name: "Charon", note: "" }, { id: "Kore", name: "Kore", note: "" }],
};

const refusal = (status: number, body: string): Error => Object.assign(new Error(`Gemini returned ${status}: ${body}`), { status });

interface Fake extends Service { calls: { catalogue: number; chat: number; speak: string[]; hear: number; how: AskHow } }

function fakeGemini(over: Partial<Service> = {}): Fake {
  const calls = { catalogue: 0, chat: 0, speak: [] as string[], hear: 0, how: {} as AskHow };
  const service: Fake = {
    calls,
    meta: PROVIDERS.gemini,
    async catalogue(key) {
      calls.catalogue++;
      if (key !== "good") throw refusal(401, "API key not valid");
      return CATALOGUE;
    },
    async chat(_key, _model, turns, emit, _signal, _persona, how) {
      calls.chat++;
      calls.how = how ?? {};
      emit({ t: "text", delta: `Answering “${turns[turns.length - 1]!.content}”, sir.` });
    },
    thinks: (model) => model === "g-3",
    async *speak(_key, model) {
      calls.speak.push(model);
      yield new Uint8Array([1, 2]);
    },
    async hear() {
      calls.hear++;
      return "what time is it";
    },
    ...over,
  };
  return service;
}

function storeWith(keys: Partial<Record<ProviderId, string>>, model: string | null = null, active: ProviderId | null = null, effort: Effort | null = null): KeyStore {
  return {
    key: (id) => (keys[id] ? { key: keys[id]!, source: "saved" as KeySource } : null),
    model: () => model,
    effort: () => effort,
    active: () => active,
  };
}

const coreWith = (store: KeyStore, gemini = fakeGemini()): { core: ConsoleCore; gemini: Fake } =>
  ({ core: new ConsoleCore(store, undefined, { gemini }), gemini });

/* ---------------- connections ---------------- */

test("a working key is checked once, and what it can reach is remembered", async () => {
  const { core, gemini } = coreWith(storeWith({ gemini: "good" }));
  const c = await core.connections();
  assert.equal(c.active, "gemini", "the one working service answers");
  const g = c.providers.find((p) => p.id === "gemini")!;
  assert.equal(g.status.state, "ready");
  if (g.status.state !== "ready") return;
  assert.equal(g.status.model, "g-3", "the newest chat model until one is chosen");
  assert.equal(g.status.maskedKey, "…good", "never the key itself");
  assert.ok(g.status.hears);
  assert.equal(g.status.voices.length, 2);
  await core.connections();
  await core.status();
  assert.equal(gemini.calls.catalogue, 1, "from memory the second time");
  await core.connections(true);
  assert.equal(gemini.calls.catalogue, 2, "unless a re-check is asked for");
});

test("a rejected key is reported in plain words, and not asked again on every call", async () => {
  const { core, gemini } = coreWith(storeWith({ gemini: "bad" }));
  const c = await core.connections();
  assert.equal(c.active, null, "nothing that can't answer is advertised");
  const g = c.providers.find((p) => p.id === "gemini")!;
  assert.equal(g.status.state, "error");
  if (g.status.state === "error") assert.match(g.status.message, /rejected by Gemini/);
  await core.connections();
  assert.equal(gemini.calls.catalogue, 1);
});

test("a chosen model is used while the account still lists it; otherwise the newest", async () => {
  const kept = coreWith(storeWith({ gemini: "good" }, "g-2"));
  assert.equal((await kept.core.connected("gemini"))?.model, "g-2");
  const gone = coreWith(storeWith({ gemini: "good" }, "g-retired"));
  assert.equal((await gone.core.connected("gemini"))?.model, "g-3");
});

test("the chosen service answers only while it can; the other steps in otherwise", async () => {
  const { core } = coreWith(storeWith({ gemini: "good" }, null, "openai"));
  assert.equal((await core.connections()).active, "gemini", "ChatGPT was chosen but has no key");
});

/* ---------------- asking ---------------- */

const question = (text: string) => ({ turns: [{ role: "user" as const, content: text }] });

test("a question is answered through the connected service, with the persona for the address", async () => {
  const { core, gemini } = coreWith(storeWith({ gemini: "good" }));
  const q = await core.prepare({ ...question("Is it raining?"), address: "madam" });
  assert.equal(q.id, "gemini");
  assert.equal(q.model, "g-3");
  assert.match(q.persona, /ma'am/);
  const events: AskEvent[] = [];
  await core.answer(q, (ev) => events.push(ev), new AbortController().signal);
  assert.deepEqual(events, [{ t: "text", delta: "Answering “Is it raining?”, sir." }]);
  assert.equal(gemini.calls.chat, 1);
});

test("how long the model thinks: the service's setting, quick unless chosen; asked for in words for one question; on the card for a model that thinks", async () => {
  const plain = coreWith(storeWith({ gemini: "good" }));
  assert.equal((await plain.core.prepare(question("hello"))).effort, "quick");
  const chosen = coreWith(storeWith({ gemini: "good" }, null, null, "balanced"));
  const q = await chosen.core.prepare(question("hello"));
  assert.equal(q.effort, "balanced");
  await chosen.core.answer(q, () => {}, new AbortController().signal);
  assert.deepEqual(chosen.gemini.calls.how, { search: false, effort: "balanced" }, "the service is told both");
  assert.equal((await chosen.core.prepare({ ...question("think hard about this"), effort: "thorough" })).effort, "thorough", "asked for in words, this once");
  const card = (await chosen.core.connections()).providers.find((p) => p.id === "gemini")!.status;
  assert.equal(card.state === "ready" && card.thinks, true, "g-3 thinks, so the choice is on the card");
  assert.equal(card.state === "ready" && card.effort, "balanced");
  const older = coreWith(storeWith({ gemini: "good" }, "g-2"));
  const c2 = (await older.core.connections()).providers.find((p) => p.id === "gemini")!.status;
  assert.equal(c2.state === "ready" && c2.thinks, false, "g-2 does not think: no slider");
});

test("the web is offered for a question that wants it, or a follow-up in a thread whose answers came from it", async () => {
  const { core } = coreWith(storeWith({ gemini: "good" }));
  assert.equal((await core.prepare(question("hello there"))).search, false);
  assert.equal((await core.prepare(question("find the latest news on the cables"))).search, true);
  const researched = [
    { role: "user" as const, content: "find the latest news on the cables" },
    { role: "assistant" as const, content: "According to Reuters, a second cable was cut." },
    { role: "user" as const, content: "and Germany?" },
  ];
  assert.equal((await core.prepare({ turns: researched })).search, true, "a follow-up to research");
  const talked = [
    { role: "user" as const, content: "tell me a joke" },
    { role: "assistant" as const, content: "A duck walks into a bar, sir." },
    { role: "user" as const, content: "and another?" },
  ];
  assert.equal((await core.prepare({ turns: talked })).search, false, "a thread holds talk too: being in one is not a reason to search");
});

test("the reasons a question can't be asked are the user's words, with a code for the server", async () => {
  const none = coreWith(storeWith({}));
  await assert.rejects(none.core.prepare(question("hello")), (err: unknown) => err instanceof CoreError && err.code === "no_provider" && /No reasoning core/.test(err.message));
  const empty = coreWith(storeWith({ gemini: "good" }));
  await assert.rejects(empty.core.prepare({ turns: [] }), (err: unknown) => err instanceof CoreError && err.code === "no_turns");
  await assert.rejects(empty.core.prepare({ ...question("hello"), provider: "openai" }), (err: unknown) => err instanceof CoreError && err.code === "no_key" && /ChatGPT isn't connected/.test(err.message));
});

test("an account that is out of credit is said so, shown on its card, and cleared by the next answer", async () => {
  let broke = true;
  const gemini = fakeGemini({
    async chat(_key, _model, _turns, emit) {
      if (broke) throw refusal(400, "Your credit balance is too low to access the API.");
      emit({ t: "text", delta: "Back, sir." });
    },
  });
  const { core } = coreWith(storeWith({ gemini: "good" }), gemini);
  const q = await core.prepare(question("hello"));
  await assert.rejects(core.answer(q, () => undefined, new AbortController().signal), (err: unknown) => {
    assert.ok(err instanceof CoreError);
    assert.equal(err.code, "ask_failed");
    assert.match(err.message, /out of credit/);
    assert.ok(err.cause instanceof Error && /credit balance/.test(err.cause.message), "the service's own words are kept for the log");
    return true;
  });
  const shown = (await core.connections()).providers.find((p) => p.id === "gemini")!.status;
  assert.ok(shown.state === "ready" && /out of credit/.test(shown.problem ?? ""), "the card says so");
  broke = false;
  await core.answer(q, () => undefined, new AbortController().signal);
  const again = (await core.connections()).providers.find((p) => p.id === "gemini")!.status;
  assert.equal(again.state === "ready" ? again.problem : "x", undefined, "and no longer once an answer succeeds");
});

/* ---------------- hearing and speaking ---------------- */

test("hearing goes through the active service, or says plainly why it can't", async () => {
  const { core, gemini } = coreWith(storeWith({ gemini: "good" }));
  const heard = await core.hear(new Blob([new Uint8Array(4000)], { type: "audio/webm" }));
  assert.deepEqual(heard, { via: "gemini", text: "what time is it" });
  assert.equal(gemini.calls.hear, 1);
  const deaf = coreWith(storeWith({}));
  await assert.rejects(deaf.core.hear(new Blob([])), (err: unknown) => err instanceof CoreError && err.code === "no_hearing" && /type instead/.test(err.message));
});

test("speech uses the chosen voice when it is the service's own, and its first voice otherwise", async () => {
  const { core, gemini } = coreWith(storeWith({ gemini: "good" }));
  const said = await core.speak({ text: "Good evening.", via: "gemini", voice: "Kore", speed: 1 });
  assert.equal(said.voice, "Kore");
  const other = await core.speak({ text: "Good evening.", via: "gemini", voice: "fable", speed: 9 });
  assert.equal(other.voice, "Charon", "an OpenAI voice isn't one of Gemini's");
  const bytes: number[] = [];
  for await (const piece of other.pieces) bytes.push(...piece);
  assert.deepEqual(bytes, [1, 2]);
  assert.deepEqual(gemini.calls.speak, ["tts-new"], "the newest speech model");
  await assert.rejects(core.speak({ text: "   ", via: "gemini", voice: "Kore", speed: 1 }), (err: unknown) => err instanceof CoreError && err.code === "empty_text");
});

test("a speech model that has used its allowance gives way to the next, and the refusal is in plain words when none is left", async () => {
  const gemini = fakeGemini({
    async *speak(_key, model) {
      if (model === "tts-new") throw refusal(429, "RESOURCE_EXHAUSTED: Quota exceeded for GenerateRequestsPerDayPerProjectPerModel-FreeTier");
      yield new Uint8Array([7]);
    },
  });
  const { core } = coreWith(storeWith({ gemini: "good" }), gemini);
  const said = await core.speak({ text: "Hello.", via: "gemini", voice: "Charon", speed: 1 });
  const bytes: number[] = [];
  for await (const piece of said.pieces) bytes.push(...piece);
  assert.deepEqual(bytes, [7], "the older model spoke");

  const spent = fakeGemini({ async *speak() { throw refusal(429, "RESOURCE_EXHAUSTED: GenerateRequestsPerDay"); } });
  const none = coreWith(storeWith({ gemini: "good" }), spent);
  const refused = await none.core.speak({ text: "Hello.", via: "gemini", voice: "Charon", speed: 1 });
  await assert.rejects((async () => { for await (const _ of refused.pieces) { /* nothing arrives */ } })(), (err: unknown) => err instanceof CoreError && err.code === "speak_failed" && /today's free allowance/.test(err.message));
});
