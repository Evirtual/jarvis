/**
 * Kokoro-82M: the neural voice, the same on the PC (run by the server) and in
 * the web version (run by the browser itself).
 */

import type { VoiceOption } from "./types.js";

export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** British voices first — this console has a preference. */
export const VOICE_ORDER: VoiceOption[] = [
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

/**
 * Kokoro returns float32 samples and its own `toWav` writes a 32-bit float WAV —
 * twice the bytes, and not every browser decodes it. Write plain 16-bit PCM.
 */
export function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ascii = (at: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return buf;
}
