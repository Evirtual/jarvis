/**
 * Kokoro-82M speech, running locally.
 *
 * The model downloads once (~88 MB at q8) and is cached on disk; from then on
 * the voice works with no network at all. Requests are serialised because there
 * is a single ONNX session, and repeated lines are served from a small LRU.
 */

import crypto from "node:crypto";

import type { KokoroState, VoiceOption } from "../shared/types.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
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

/** British voices first — this console has a preference. */
const VOICE_ORDER: VoiceOption[] = [
  { id: "bm_george", name: "George", note: "British male · Received Pronunciation" },
  { id: "bm_fable", name: "Fable", note: "British male · warm" },
  { id: "bm_lewis", name: "Lewis", note: "British male · mature" },
  { id: "bm_daniel", name: "Daniel", note: "British male · crisp" },
  { id: "bf_emma", name: "Emma", note: "British female" },
  { id: "bf_alice", name: "Alice", note: "British female" },
  { id: "bf_isabella", name: "Isabella", note: "British female" },
  { id: "bf_lily", name: "Lily", note: "British female" },
  { id: "am_michael", name: "Michael", note: "American male" },
  { id: "am_fenrir", name: "Fenrir", note: "American male · deep" },
  { id: "af_heart", name: "Heart", note: "American female" },
];

export const DEFAULT_VOICE = "bm_george";

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

/**
 * Kokoro returns float32 samples and its own `toWav` writes a 32-bit float WAV —
 * twice the bytes, and not every browser decodes it. Write plain 16-bit PCM.
 */
function encodeWav16(samples: Float32Array, sampleRate: number): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
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
    return encodeWav16(audio.audio, audio.sampling_rate);
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
