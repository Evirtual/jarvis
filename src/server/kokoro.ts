/**
 * Kokoro-82M speech, running locally.
 *
 * The model downloads once (~88 MB at q8) and is cached on disk; from then on
 * the voice works with no network at all. Requests are serialised because there
 * is a single ONNX session, and repeated lines are served from a small LRU.
 */

import crypto from "node:crypto";
import os from "node:os";

import type { KokoroState, VoiceOption } from "../shared/types.js";
import { DEFAULT_VOICE, KOKORO_MODEL as MODEL_ID, VOICE_ORDER, encodeWav16 } from "../shared/voices.js";

export { DEFAULT_VOICE } from "../shared/voices.js";
export const DTYPE = process.env.KOKORO_DTYPE ?? "q8";

interface KokoroTTSLike {
  voices: Record<string, unknown>;
  generate(text: string, opts: { voice: string; speed: number }): Promise<{
    audio: Float32Array;
    sampling_rate: number;
  }>;
}

export const kokoro: { state: KokoroState; tts: KokoroTTSLike | null; error: string | null } = {
  state: "loading",
  tts: null,
  error: null,
};

export function voices(): VoiceOption[] {
  if (kokoro.state !== "ready" || !kokoro.tts) return [];
  return VOICE_ORDER.filter((v) => v.id in kokoro.tts!.voices);
}

export function hasVoice(id: string): boolean {
  return kokoro.state === "ready" && !!kokoro.tts && id in kokoro.tts.voices;
}

export async function loadKokoro(): Promise<void> {
  const t0 = Date.now();
  console.log(`[kokoro] loading ${MODEL_ID} (dtype=${DTYPE})`);
  let lastPct = -1;
  try {
    type Loader = { from_pretrained(id: string, opts: Record<string, unknown>): Promise<unknown> };
    const { KokoroTTS } = (await import("kokoro-js")) as unknown as { KokoroTTS: new (model: unknown, tokenizer: unknown) => KokoroTTSLike };
    const T = (await import("@huggingface/transformers")) as unknown as { StyleTextToSpeech2Model: Loader; AutoTokenizer: Loader };

    const progress_callback = (p: { status: string; progress?: number; file?: string }): void => {
      if (p.status !== "progress" || typeof p.progress !== "number") return;
      const pct = Math.floor(p.progress / 5) * 5;
      if (pct === lastPct) return;
      lastPct = pct;
      const bar = "█".repeat(pct / 5).padEnd(20, "░");
      process.stdout.write(`\r[kokoro] ${bar} ${String(pct).padStart(3)}%  ${p.file ?? ""}   `);
    };
    // Built as KokoroTTS.from_pretrained builds it, but with the thread count
    // set: left to itself the engine takes every core and they get in each
    // other's way. Half the cores, 4 to 8, measured ~30% quicker and steadier
    // (7.2 s of speech in 4.5 s rather than 5–7 s on a 16-core laptop).
    const threads = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)));
    const [model, tokenizer] = await Promise.all([
      T.StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
        dtype: DTYPE,
        device: "cpu",
        session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
        progress_callback,
      }),
      T.AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
    ]);
    kokoro.tts = new KokoroTTS(model, tokenizer);
    process.stdout.write("\n");
    // The first line after loading is always the slowest; say one nobody hears,
    // so the first real answer isn't the one that waits.
    await kokoro.tts.generate("Ready.", { voice: DEFAULT_VOICE, speed: 1 }).catch(() => undefined);
    kokoro.state = "ready";
    console.log(`[kokoro] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (${threads} threads)`);
  } catch (err) {
    process.stdout.write("\n");
    kokoro.state = "failed";
    kokoro.error = err instanceof Error ? err.message : String(err);
    console.error("[kokoro] failed to load:", kokoro.error);
    console.error("[kokoro] the console will fall back to the browser's own voices");
  }
}

const cache = new Map<string, Buffer>();
const CACHE_MAX = 60;

let chain: Promise<Buffer> = Promise.resolve(Buffer.alloc(0));

export async function synthesize(text: string, voice: string, speed: number): Promise<Buffer> {
  const key = crypto.createHash("sha1").update(`${voice}|${speed}|${text}`).digest("hex");
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // touch
    return hit;
  }

  const run = async (): Promise<Buffer> => {
    if (!kokoro.tts) throw new Error("kokoro not ready");
    const audio = await kokoro.tts.generate(text, { voice, speed });
    return Buffer.from(encodeWav16(audio.audio, audio.sampling_rate));
  };
  chain = chain.then(run, run);
  const wav = await chain;

  cache.set(key, wav);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return wav;
}
