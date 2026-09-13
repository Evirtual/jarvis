import { test } from "node:test";
import assert from "node:assert/strict";

import type { AskEvent } from "../src/shared/types.ts";
import { openai } from "../src/shared/services/openai.ts";

/* The Responses API as a server-sent-event stream, answered from memory. */

const sse = (events: object[]): string => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const reply = (status: number, body: string, type = "text/event-stream"): Response =>
  new Response(body, { status, headers: { "content-type": type } });

/** fetch answered by `answers` in turn; every request body is kept for inspection. */
function fakeFetch(answers: Response[]): { bodies: Record<string, unknown>[]; restore: () => void } {
  const bodies: Record<string, unknown>[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    const next = answers.shift();
    if (!next) throw new Error("no answer left");
    return next;
  }) as typeof fetch;
  return { bodies, restore: () => { globalThis.fetch = real; } };
}

const turns = [{ role: "user" as const, content: "hello" }];

test("an answer streams as text and status events, from the stream's own event types", async () => {
  const f = fakeFetch([reply(200, sse([
    { type: "response.created" },
    { type: "response.web_search_call.searching" },
    { type: "response.output_text.delta", delta: "Good " },
    { type: "response.output_text.delta", delta: "evening." },
    { type: "response.completed" },
  ]))]);
  try {
    const events: AskEvent[] = [];
    await openai.chat("k", "gpt-x", turns, (ev) => events.push(ev), new AbortController().signal, "persona");
    assert.deepEqual(events, [{ t: "status", status: "searching" }, { t: "text", delta: "Good " }, { t: "text", delta: "evening." }]);
    assert.equal(f.bodies[0]!.stream, true);
    assert.deepEqual(f.bodies[0]!.tools, [{ type: "web_search" }], "asked with the search tool first");
    assert.equal(f.bodies[0]!.instructions, "persona");
    assert.equal(f.bodies[0]!.reasoning, undefined, "a model that does not reason is not told how hard to");
  } finally { f.restore(); }
});

test("a reasoning model is asked at low effort, briefly when nothing is looked up; the search tool only when the question wants it", async () => {
  const f = fakeFetch([reply(200, sse([{ type: "response.output_text.delta", delta: "Hi." }])), reply(200, sse([{ type: "response.output_text.delta", delta: "Found." }]))]);
  try {
    const sink = (): void => {};
    await openai.chat("k", "gpt-5-mini", turns, sink, new AbortController().signal, "p", false);
    assert.deepEqual(f.bodies[0]!.reasoning, { effort: "low" });
    assert.deepEqual(f.bodies[0]!.text, { verbosity: "low" });
    assert.equal(f.bodies[0]!.tools, undefined, "no search tool for plain talk");
    await openai.chat("k", "gpt-5-mini", turns, sink, new AbortController().signal, "p", true);
    assert.deepEqual(f.bodies[1]!.reasoning, { effort: "low" });
    assert.equal(f.bodies[1]!.text, undefined, "a searched answer is not cut short");
    assert.deepEqual(f.bodies[1]!.tools, [{ type: "web_search" }]);
  } finally { f.restore(); }
  // a model that refuses the reasoning fields is asked again plainly
  const g = fakeFetch([
    reply(400, JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning' is not supported with this model." } }), "application/json"),
    reply(200, sse([{ type: "response.output_text.delta", delta: "Plain." }])),
  ]);
  try {
    const events: AskEvent[] = [];
    await openai.chat("k", "gpt-5-something-odd", turns, (ev) => events.push(ev), new AbortController().signal, "p", false);
    assert.deepEqual(events, [{ t: "status", status: "thinking" }, { t: "text", delta: "Plain." }]);
    assert.equal(g.bodies[1]!.reasoning, undefined);
  } finally { g.restore(); }
});

test("a model without the search tool is asked again without it; any other refusal is the error", async () => {
  const f = fakeFetch([
    reply(400, JSON.stringify({ error: { message: "Unsupported tool type: web_search" } }), "application/json"),
    reply(200, sse([{ type: "response.output_text.delta", delta: "Plain." }])),
  ]);
  try {
    const events: AskEvent[] = [];
    await openai.chat("k", "gpt-old", turns, (ev) => events.push(ev), new AbortController().signal, "p");
    assert.deepEqual(events, [{ t: "status", status: "thinking" }, { t: "text", delta: "Plain." }]);
    assert.equal(f.bodies.length, 2);
    assert.equal(f.bodies[1]!.tools, undefined, "the second ask carries no tool");
  } finally { f.restore(); }
  // a rate limit is tried again twice, then it is the error
  const g = fakeFetch([429, 429, 429].map((c) => reply(c, JSON.stringify({ error: { message: "Rate limit reached" } }), "application/json")));
  try {
    await assert.rejects(openai.chat("k", "gpt-x", turns, () => undefined, new AbortController().signal, "p"), (err: unknown) =>
      err instanceof Error && /429/.test(err.message) && (err as { status?: number }).status === 429);
  } finally { g.restore(); }
});

test("a failure the stream reports part-way is thrown, not shown as an answer", async () => {
  const f = fakeFetch([reply(200, sse([
    { type: "response.output_text.delta", delta: "Half" },
    { type: "error", error: { message: "The server had an error", code: "server_error" } },
  ]))]);
  try {
    const events: AskEvent[] = [];
    await assert.rejects(openai.chat("k", "gpt-x", turns, (ev) => events.push(ev), new AbortController().signal, "p"), /server_error/);
    assert.deepEqual(events, [{ t: "text", delta: "Half" }], "what arrived before it was passed on");
  } finally { f.restore(); }
});

test("the account's models come from the list endpoint, ranked, without the ones that aren't chat", async () => {
  const f = fakeFetch([reply(200, JSON.stringify({ data: [{ id: "gpt-4.1-mini" }, { id: "gpt-4.1" }, { id: "gpt-4o-mini-tts" }, { id: "whisper-1" }, { id: "gpt-5-chat-latest" }] }), "application/json")]);
  try {
    const c = await openai.catalogue("k");
    assert.deepEqual(c.chat, ["gpt-4.1-mini", "gpt-4.1"], "the small one first");
    assert.deepEqual(c.speech, ["gpt-4o-mini-tts"]);
    assert.deepEqual(c.hearing, ["whisper-1"]);
  } finally { f.restore(); }
});

test("a momentary refusal is asked again, twice at most", async () => {
  const f = fakeFetch([
    reply(503, JSON.stringify({ error: { message: "overloaded" } }), "application/json"),
    reply(503, JSON.stringify({ error: { message: "overloaded" } }), "application/json"),
    reply(200, sse([{ type: "response.output_text.delta", delta: "Back." }])),
  ]);
  try {
    const events: AskEvent[] = [];
    await openai.chat("k", "gpt-x", turns, (ev) => events.push(ev), new AbortController().signal, "p");
    assert.deepEqual(events, [{ t: "text", delta: "Back." }]);
    assert.equal(f.bodies.length, 3);
  } finally { f.restore(); }
  const g = fakeFetch([503, 503, 503].map((s) => reply(s, JSON.stringify({ error: { message: "overloaded" } }), "application/json")));
  try {
    await assert.rejects(openai.chat("k", "gpt-x", turns, () => undefined, new AbortController().signal, "p"), /503/);
    assert.equal(g.bodies.length, 3, "and then it is the error");
  } finally { g.restore(); }
});
