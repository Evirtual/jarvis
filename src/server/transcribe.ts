/**
 * Speech to text through the connected OpenAI key.
 *
 * Chrome's built-in dictation is not local — it ships audio to Google's speech
 * service, and on networks where that host is unreachable it fails with a bare
 * "network" error even though the microphone is fine. Recording in the page and
 * transcribing here removes that dependency entirely and works in any browser
 * with a microphone.
 */

import { resolveKey } from "./config.js";

const PREFERRED = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"];
let chosen: string | null = null;

export function transcriptionAvailable(): boolean {
  return resolveKey("openai") !== null;
}

async function pickModel(key: string): Promise<string> {
  if (chosen) return chosen;
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key });
  const ids = new Set<string>();
  for await (const m of await client.models.list()) ids.add(m.id);
  chosen = PREFERRED.find((m) => ids.has(m)) ?? "whisper-1";
  return chosen;
}

export async function transcribe(audio: Buffer, mime: string): Promise<{ text: string; model: string }> {
  const resolved = resolveKey("openai");
  if (!resolved) throw new Error("Speech recognition needs ChatGPT connected — add it in Config.");

  const { default: OpenAI, toFile } = await import("openai");
  const client = new OpenAI({ apiKey: resolved.key });
  const model = await pickModel(resolved.key);

  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "mp4" : mime.includes("wav") ? "wav" : "webm";
  const file = await toFile(audio, `speech.${ext}`, { type: mime || "audio/webm" });

  // Bias the transcriber toward words this console actually uses — otherwise
  // "use the Lewis voice" comes back as "Louis" and the command misses.
  const prompt =
    "JARVIS, sir. Voices: George, Fable, Lewis, Daniel, Emma, Alice, Isabella, Lily, Michael. " +
    "Services: OpenRouter, ChatGPT, Claude, Gemini. Commands: new thread, close thread, drive mode, desktop mode, sweep the network, status, uplink.";
  const res = await client.audio.transcriptions.create({ file, model, language: "en", prompt });
  return { text: (res.text ?? "").trim(), model };
}
