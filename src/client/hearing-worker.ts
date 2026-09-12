/**
 * JARVIS's hearing, run in the browser — the web version's speech to text,
 * the same Moonshine model the PC's server runs (shared/hearing.ts). A worker
 * of its own, so listening never costs the page a frame. About 63 MB, once;
 * the browser keeps it.
 *
 * Messages in:  { t: "load", wasmPaths }  { t: "hear", id, samples }
 * Messages out: { t: "progress", pct }  { t: "ready" }  { t: "failed", error }
 *               { t: "text", id, text }  { t: "error", id, error }
 */

import { env, pipeline } from "@huggingface/transformers";
import { HEARING_MODEL } from "../shared/hearing.js";

type In = { t: "load"; wasmPaths: string } | { t: "hear"; id: number; samples: Float32Array };
type Asr = (audio: Float32Array) => Promise<{ text?: string } | { text?: string }[]>;

const post = (m: unknown): void => (self as unknown as Worker).postMessage(m);
let asr: Asr | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function load(wasmPaths: string): Promise<void> {
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    // the speech engine's own files are served with the page, not fetched from a CDN
    wasm.wasmPaths = wasmPaths;
    if (self.crossOriginIsolated) wasm.numThreads = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 4)));
  }
  const files = new Map<string, { loaded: number; total: number }>();
  let last = -1;
  try {
    asr = (await pipeline("automatic-speech-recognition", HEARING_MODEL, {
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
    } as never)) as unknown as Asr;
    post({ t: "ready" });
  } catch (err) {
    post({ t: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}

async function hear(m: Extract<In, { t: "hear" }>): Promise<void> {
  try {
    if (!asr) throw new Error("the hearing isn't loaded");
    const out = await asr(m.samples);
    const text = (Array.isArray(out) ? out.map((o) => o.text ?? "").join(" ") : out.text ?? "").trim();
    post({ t: "text", id: m.id, text });
  } catch (err) {
    post({ t: "error", id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (e: MessageEvent<In>): void => {
  const m = e.data;
  if (m.t === "load") void load(m.wasmPaths);
  else if (m.t === "hear") chain = chain.then(() => hear(m), () => hear(m));
};
