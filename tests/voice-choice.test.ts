import { test } from "node:test";
import assert from "node:assert/strict";

/* Which voice speaks, with no browser: no device speech, a fake storage. */

const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
const { VoiceChoice } = await import("../src/client/voice-choice.ts");

const gemini = [{ id: "Charon", name: "Charon", note: "male · informative" }, { id: "Kore", name: "Kore", note: "female · firm" }];

test("with a service connected its first voice speaks; the one picked is remembered for it", () => {
  kept.clear();
  const c = new VoiceChoice(null);
  assert.equal(c.selectionValue, "", "nothing to speak with yet");
  assert.match(c.describe().text, /can't speak/);
  c.setNeuralVoices("gemini", gemini);
  assert.equal(c.selectionValue, "gemini:Charon");
  assert.equal(c.neuralNow()?.voice.name, "Charon");
  assert.ok(c.select("gemini:Kore"));
  assert.equal(c.selectionValue, "gemini:Kore");
  assert.equal(kept.get("jarvis.voice.gemini"), "Kore", "remembered for Gemini");
  assert.match(c.describe().text, /Kore.*through Gemini/);
  assert.equal(c.summary(), "Kore (through Gemini)");
  assert.equal(c.select("openai:fable"), false, "not one of the voices on offer");
  assert.equal(c.select("nonsense"), false);
});

test("a refused voice rests, and the device's speaks meanwhile; the next line it speaks ends the rest", () => {
  kept.clear();
  const c = new VoiceChoice(null);
  const notices: string[] = [];
  c.onNotice = (m) => notices.push(m);
  c.setNeuralVoices("gemini", gemini);
  c.rest("gemini", "Gemini's voice has used today's free allowance, sir.");
  c.rest("gemini", "again");
  assert.equal(c.neuralNow(), null, "not asked again for a while");
  assert.equal(notices.length, 1, "said once");
  assert.match(c.describe().text, /unavailable/);
  assert.ok(c.describe().warn);
  c.spoke("gemini");
  assert.equal(c.neuralNow()?.voice.id, "Charon");
});

test("a service gone takes its voices with it", () => {
  kept.clear();
  const c = new VoiceChoice(null);
  let changes = 0;
  c.onState = () => { changes++; };
  c.setNeuralVoices("gemini", gemini);
  c.setNeuralVoices("gemini", gemini);
  assert.equal(changes, 1, "the same list again is no change");
  c.setNeuralVoices("gemini", []);
  assert.equal(c.neuralVoices().length, 0);
  assert.equal(c.selectionValue, "");
});
