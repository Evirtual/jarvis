/**
 * Kokoro-82M speech, running locally.
 *
 * The model downloads once (~88 MB at q8) and is cached on disk; from then on
 * the voice works with no network at all. Requests are serialised because there
 * is a single ONNX session, and repeated lines are served from a small LRU.
 */

import crypto from "node:crypto";

import type { KokoroState, VoiceOption } from "../shared/types.js";
import { KOKORO_MODEL as MODEL_ID, VOICE_ORDER, encodeWav16 } from "../shared/voices.js";

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
    const { KokoroTTS } = (await import("kokoro-js")) as unknown as {
      KokoroTTS: {
        from_pretrained(
          id: string,
          opts: {
            dtype: string;
            device: string;
            progress_callback?: (p: { status: string; progress?: number; file?: string }) => void;
          },
        ): Promise<KokoroTTSLike>;
      };
    };

    kokoro.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      device: "cpu",
      progress_callback: (p) => {
        if (p.status !== "progress" || typeof p.progress !== "number") return;
        const pct = Math.floor(p.progress / 5) * 5;
        if (pct === lastPct) return;
        lastPct = pct;
        const bar = "█".repeat(pct / 5).padEnd(20, "░");
        process.stdout.write(`\r[kokoro] ${bar} ${String(pct).padStart(3)}%  ${p.file ?? ""}   `);
      },
    });
    process.stdout.write("\n");
    kokoro.state = "ready";
    console.log(`[kokoro] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
