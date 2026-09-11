/**
 * Kokoro-82M, run in the browser — the web version's neural voice, the same
 * one the PC's server runs. A worker of its own, so generating speech never
 * costs the page a frame. The model downloads once (~92 MB) and the browser
 * keeps it; each voice is half a megabyte more, the first time it's used.
 *
 * Messages in:  { t: "load", wasmPaths }  { t: "speak", id, text, voice, speed }
 * Messages out: { t: "progress", pct }  { t: "ready" }  { t: "failed", error }
 *               { t: "audio", id, wav }  { t: "error", id, error }
 */

import { KokoroTTS, env } from "kokoro-js";
import { env as transformers } from "@huggingface/transformers";
import { KOKORO_MODEL, encodeWav16 } from "../shared/voices.js";

type In =
  | { t: "load"; wasmPaths: string }
  | { t: "speak"; id: number; text: string; voice: string; speed: number };

const post = (m: unknown, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, transfer);

let tts: KokoroTTS | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function load(wasmPaths: string): Promise<void> {
  // the speech engine's own files are served with the page, not fetched from a CDN
  env.wasmPaths = wasmPaths;
  // More cores, when the page is cross-origin isolated (see sw.js): the engine
  // takes four at most by default; half the device's, up to eight, is quicker.
  if (self.crossOriginIsolated) {
    const wasm = transformers.backends.onnx.wasm;
    if (wasm) wasm.numThreads = Math.max(1, Math.min(8, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
  }
  const files = new Map<string, { loaded: number; total: number }>();
  let last = -1;
  try {
    tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file || !p.total) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        const pct = Math.floor((loaded / total) * 100);
        if (pct !== last) { last = pct; post({ t: "progress", pct }); }
      },
    });
    post({ t: "ready" });
  } catch (err) {
    post({ t: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}

async function speak(m: Extract<In, { t: "speak" }>): Promise<void> {
  try {
    if (!tts) throw new Error("the voice isn't loaded");
    const audio = await tts.generate(m.text, { voice: m.voice as never, speed: m.speed });
    const wav = encodeWav16(audio.audio, audio.sampling_rate);
    post({ t: "audio", id: m.id, wav }, [wav]);
  } catch (err) {
    post({ t: "error", id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (e: MessageEvent<In>): void => {
  const m = e.data;
  if (m.t === "load") void load(m.wasmPaths);
  // one sentence at a time: there is a single model session
  else if (m.t === "speak") chain = chain.then(() => speak(m), () => speak(m));
};
