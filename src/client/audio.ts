/**
 * What the microphone recorded (WebM/Opus, Ogg or MP4, depending on the
 * browser), turned into 16 kHz mono WAV: the one form every transcriber here
 * takes — OpenAI's, and JARVIS's own hearing on the PC or in the browser —
 * so neither needs an audio decoder of its own.
 */

import { HEARING_RATE } from "../shared/hearing.js";
import { encodeWav16 } from "../shared/voices.js";

/** The recording's samples at 16 kHz, mono. */
export async function toSamples16k(recording: Blob): Promise<Float32Array> {
  const bytes = await recording.arrayBuffer();
  // decode at the recording's own rate, then let the browser resample
  const decoded = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(bytes);
  const length = Math.max(1, Math.ceil(decoded.duration * HEARING_RATE));
  const ctx = new OfflineAudioContext(1, length, HEARING_RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded; // several channels are mixed down to one
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** The recording as a 16 kHz mono WAV. */
export async function toWav16k(recording: Blob): Promise<Blob> {
  return new Blob([encodeWav16(await toSamples16k(recording), HEARING_RATE)], { type: "audio/wav" });
}
