/**
 * JARVIS's own hearing: speech to text on the device itself, with no key and
 * nothing sent anywhere — Moonshine Base (English), about 63 MB at q8. Unlike
 * Whisper, which always works through a padded 30-second window, Moonshine
 * works on only what was said, so a short command comes back quickly. Run by
 * the server on the PC, and by the browser in the web version.
 *
 * Recordings reach it as 16 kHz mono 16-bit WAV: the page converts what the
 * microphone recorded before sending it (see client/audio.ts), so neither side
 * needs an audio decoder of its own.
 */

export const HEARING_MODEL = "onnx-community/moonshine-base-ONNX";
export const HEARING_RATE = 16_000;

/** The samples of a 16-bit PCM WAV, as floats in -1..1 (the first channel). */
export function wavSamples(buf: ArrayBuffer): Float32Array {
  const v = new DataView(buf);
  const tag = (at: number): string => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  if (buf.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV recording");
  let at = 12, channels = 1, bits = 16, data = -1, size = 0;
  while (at + 8 <= buf.byteLength) {
    const id = tag(at), len = v.getUint32(at + 4, true);
    if (id === "fmt ") { channels = v.getUint16(at + 10, true); bits = v.getUint16(at + 22, true); }
    if (id === "data") { data = at + 8; size = Math.min(len, buf.byteLength - data); break; }
    at += 8 + len + (len % 2);
  }
  if (data < 0 || bits !== 16) throw new Error("unsupported WAV recording");
  const n = Math.floor(size / 2 / channels);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(data + i * 2 * channels, true) / 0x8000;
  return out;
}
