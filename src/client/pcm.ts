/**
 * Samples: the 16-bit PCM a service sends, as the floats the audio graph
 * plays, and where the speech in a run of them begins and ends.
 */

import { SPEECH_RATE } from "../shared/services/index.js";

/** Below this a sample counts as silence. */
const QUIET = 0.01;

/** Where the speech starts in a run of samples, keeping 30 ms so no word is clipped. */
export function speechStart(d: Float32Array): number {
  let a = 0;
  while (a < d.length && Math.abs(d[a]!) < QUIET) a++;
  return a >= d.length ? 0 : Math.max(0, a - Math.floor(SPEECH_RATE * 0.03));
}

/** Where the speech ends in a run of samples, keeping 60 ms after it. */
export function speechEnd(d: Float32Array): number {
  let b = d.length - 1;
  while (b > 0 && Math.abs(d[b]!) < QUIET) b--;
  return b <= 0 ? d.length : Math.min(d.length, b + Math.floor(SPEECH_RATE * 0.06));
}

/** 16-bit little-endian samples as floats. */
export function toFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

export function joinFloat32(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
