/**
 * The web version's hearing: Moonshine in a worker (hearing-worker.ts), the
 * same model the PC's server runs. Nothing downloads until the user asks
 * (Configuration → Voice); once it has, the browser keeps it and it loads at
 * every start. Used when no ChatGPT key is connected — and in Brave, which has
 * no dictation of its own, it is the only way JARVIS hears you.
 */

import { HEARING_MODEL } from "../shared/hearing.js";
import { recall, store } from "./dom.js";

/** "none": never downloaded here. */
export let hearingState: "none" | "loading" | "ready" | "failed" = "none";
export let hearingPct = 0;
export let hearingError: string | null = null;

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
let onChange: (() => void) | null = null;

export function onHearingChange(f: () => void): void {
  onChange = f;
}

const WANTED = "jarvis.hearing";

/** Download (the first time) and load the hearing. */
export function loadHearing(): void {
  if (worker) return;
  store(WANTED, "1");
  hearingState = "loading";
  hearingPct = 0;
  hearingError = null;
  onChange?.();
  worker = new Worker(new URL("./hearing-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ t: string; pct?: number; error?: string; id?: number; text?: string }>) => {
    const m = e.data;
    if (m.t === "progress") { hearingPct = m.pct ?? 0; onChange?.(); }
    else if (m.t === "ready") { hearingState = "ready"; onChange?.(); }
    else if (m.t === "failed") {
      hearingState = "failed";
      hearingError = m.error ?? "unknown";
      worker?.terminate();
      worker = null;
      onChange?.();
    } else if (m.t === "text" && m.id != null) {
      waiting.get(m.id)?.resolve(m.text ?? "");
      waiting.delete(m.id);
    } else if (m.t === "error" && m.id != null) {
      waiting.get(m.id)?.reject(new Error(m.error ?? "couldn't make that out"));
      waiting.delete(m.id);
    }
  };
  worker.postMessage({ t: "load", wasmPaths: `${new URL(import.meta.env.BASE_URL, location.href).href}ort/` });
}

/** What was said, from 16 kHz mono samples. */
export function hearLocally(samples: Float32Array): Promise<string> {
  if (!worker || hearingState !== "ready") return Promise.reject(new Error("my hearing isn't loaded"));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ t: "hear", id, samples }, [samples.buffer]);
  });
}

async function downloaded(): Promise<boolean> {
  try {
    const cache = await caches.open("transformers-cache");
    return !!(await cache.match(`https://huggingface.co/${HEARING_MODEL}/resolve/main/onnx/encoder_model_quantized.onnx`));
  } catch {
    return false;
  }
}

/** At start: load the hearing if it was downloaded before. */
export async function resumeHearing(): Promise<void> {
  if (recall(WANTED) === "1" && (await downloaded())) loadHearing();
}
