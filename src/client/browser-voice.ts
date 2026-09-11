/**
 * The web version's neural voice: Kokoro in a worker (voice-worker.ts), the
 * same voices as on the PC. Nothing downloads until the user asks
 * (Configuration → Voice); once it has, the browser keeps the model and it is
 * loaded at every start, with no network needed.
 */

import type { KokoroState, VoiceOption } from "../shared/types.js";
import { KOKORO_MODEL, VOICE_ORDER } from "../shared/voices.js";
import { recall, store } from "./dom.js";

/** "none": never downloaded here. */
export let neuralState: KokoroState | "none" = "none";
export let neuralPct = 0;
export let neuralError: string | null = null;
export const neuralVoices = (): VoiceOption[] => (neuralState === "ready" ? VOICE_ORDER : []);

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();
let onChange: (() => void) | null = null;

/** Called whenever the voice's state or download progress changes. */
export function onNeuralChange(f: () => void): void {
  onChange = f;
}

const WANTED = "jarvis.neuralVoice";

/** Download (the first time) and load the voice. */
export function loadNeural(): void {
  if (worker) return;
  store(WANTED, "1");
  neuralState = "loading";
  neuralPct = 0;
  neuralError = null;
  onChange?.();
  worker = new Worker(new URL("./voice-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ t: string; pct?: number; error?: string; id?: number; wav?: ArrayBuffer }>) => {
    const m = e.data;
    if (m.t === "progress") { neuralPct = m.pct ?? 0; onChange?.(); }
    else if (m.t === "ready") { neuralState = "ready"; onChange?.(); }
    else if (m.t === "failed") {
      neuralState = "failed";
      neuralError = m.error ?? "unknown";
      worker?.terminate();
      worker = null;
      onChange?.();
    } else if (m.t === "audio" && m.id != null) {
      waiting.get(m.id)?.resolve(new Blob([m.wav!], { type: "audio/wav" }));
      waiting.delete(m.id);
    } else if (m.t === "error" && m.id != null) {
      waiting.get(m.id)?.reject(new Error(m.error ?? "speech failed"));
      waiting.delete(m.id);
    }
  };
  worker.postMessage({ t: "load", wasmPaths: `${new URL(import.meta.env.BASE_URL, location.href).href}ort/` });
}

/** Spoken audio for one line. */
export function speakNeural(text: string, voice: string, speed: number): Promise<Blob> {
  if (!worker || neuralState !== "ready") return Promise.reject(new Error("the neural voice isn't loaded"));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ t: "speak", id, text, voice, speed });
  });
}

/** Whether the model is already in this browser's keeping — then it loads without asking. */
async function downloaded(): Promise<boolean> {
  try {
    const cache = await caches.open("transformers-cache");
    return !!(await cache.match(`https://huggingface.co/${KOKORO_MODEL}/resolve/main/onnx/model_quantized.onnx`));
  } catch {
    return false;
  }
}

/** At start: load the voice if it was downloaded before. */
export async function resumeNeural(): Promise<void> {
  if (recall(WANTED) === "1" && (await downloaded())) loadNeural();
}
