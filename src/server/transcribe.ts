/**
 * Speech to text: through the connected OpenAI key when there is one (the
 * most accurate), otherwise with JARVIS's own hearing — Moonshine, running
 * here on the PC, with no key and nothing sent anywhere (shared/hearing.ts).
 *
 * Browsers' built-in dictation isn't local either: Chrome ships audio to
 * Google's speech service, and Brave has none at all. Recording in the page
 * and transcribing here removes that dependency, in any browser with a
 * microphone.
 */

import os from "node:os";

import { HEARING_MODEL, wavSamples } from "../shared/hearing.js";
import { resolveKey } from "./config.js";

const PREFERRED = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"];
let chosen: string | null = null;

type Asr = (audio: Float32Array) => Promise<{ text?: string } | { text?: string }[]>;

/** The local hearing: loading at start, like the voice. */
export const hearing: { state: "loading" | "ready" | "failed"; error: string | null; asr: Asr | null } = {
  state: "loading",
  error: null,
  asr: null,
};

export async function loadHearing(): Promise<void> {
  const t0 = Date.now();
  try {
    const { pipeline } = (await import("@huggingface/transformers")) as unknown as {
      pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<Asr>;
    };
    const threads = Math.max(2, Math.min(4, Math.floor(os.cpus().length / 4)));
    hearing.asr = await pipeline("automatic-speech-recognition", HEARING_MODEL, {
      dtype: "q8",
      device: "cpu",
      session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
    });
    hearing.state = "ready";
    console.log(`[hear] local hearing ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (Moonshine Base)`);
  } catch (err) {
    hearing.state = "failed";
    hearing.error = err instanceof Error ? err.message : String(err);
    console.error("[hear] local hearing failed to load:", hearing.error);
  }
}

export function transcriptionAvailable(): boolean {
  return resolveKey("openai") !== null || hearing.state === "ready";
}

async function pickModel(key: string): Promise<string> {
  if (chosen) return chosen;
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key });
  const ids = new Set<string>();
  for await (const m of await client.models.list()) ids.add(m.id);
  chosen = PREFERRED.find((m) => ids.has(m)) ?? "whisper-1";
  return chosen;
}

export async function transcribe(audio: Buffer, mime: string): Promise<{ text: string; model: string }> {
  const resolved = resolveKey("openai");
  if (!resolved) return transcribeLocally(audio, mime);

  const { default: OpenAI, toFile } = await import("openai");
  const client = new OpenAI({ apiKey: resolved.key });
  const model = await pickModel(resolved.key);

  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "mp4" : mime.includes("wav") ? "wav" : "webm";
  const file = await toFile(audio, `speech.${ext}`, { type: mime || "audio/webm" });

  // Bias the transcriber toward words this console actually uses — otherwise
  // "use the Lewis voice" comes back as "Louis" and the command misses.
  const prompt =
    "JARVIS, sir. Voices: George, Fable, Lewis, Daniel, Emma, Alice, Isabella, Lily, Michael. " +
    "Services: OpenRouter, ChatGPT, Claude, Gemini. Commands: new thread, close thread, drive mode, desktop mode, sweep the network, status, uplink.";
  const res = await client.audio.transcriptions.create({ file, model, language: "en", prompt });
  return { text: (res.text ?? "").trim(), model };
}

async function transcribeLocally(audio: Buffer, mime: string): Promise<{ text: string; model: string }> {
  if (hearing.state !== "ready" || !hearing.asr) {
    throw new Error(hearing.state === "loading"
      ? "My hearing is still loading, sir — a moment, or type instead."
      : "My hearing couldn't load on this machine. Connect ChatGPT in Config and I'll transcribe through it.");
  }
  if (!mime.includes("wav")) throw new Error("This recording needs converting first — reload the console and try again.");
  const samples = wavSamples(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer);
  const out = await hearing.asr(samples);
  const text = (Array.isArray(out) ? out.map((o) => o.text ?? "").join(" ") : out.text ?? "").trim();
  return { text, model: "moonshine-base (local)" };
}
