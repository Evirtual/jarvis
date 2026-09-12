/**
 * OpenAI: answers through the Responses API (where web search lives),
 * speech through the audio endpoints. Chat uses OpenAI's own SDK for its
 * streaming; speaking and hearing are single requests, made with fetch.
 */

import type { VoiceOption } from "../types.js";
import { HEARING_HINT, MANNER, PERSONA, bytesOf, httpError, pace, rankModels, type Service } from "./common.js";

const API = "https://api.openai.com/v1";

/** OpenAI's built-in voices. Any of them takes the manner instruction, accent included. */
const VOICES: VoiceOption[] = [
  { id: "fable", name: "Fable", note: "British · soft" },
  { id: "ash", name: "Ash", note: "male · warm" },
  { id: "ballad", name: "Ballad", note: "male · even" },
  { id: "onyx", name: "Onyx", note: "male · deep" },
  { id: "echo", name: "Echo", note: "male · clear" },
  { id: "verse", name: "Verse", note: "male · expressive" },
  { id: "cedar", name: "Cedar", note: "male · natural" },
  { id: "marin", name: "Marin", note: "female · natural" },
  { id: "sage", name: "Sage", note: "female · calm" },
  { id: "coral", name: "Coral", note: "female · bright" },
  { id: "nova", name: "Nova", note: "female · friendly" },
  { id: "shimmer", name: "Shimmer", note: "female · light" },
  { id: "alloy", name: "Alloy", note: "neutral" },
];

/**
 * Listed alongside the chat models, but not for chat — including the
 * "chat-latest" names, which point at the ChatGPT app's model and which the
 * API refuses ("does not exist or you do not have access"), and the live
 * speech models.
 */
const NOT_CHAT = /audio|realtime|live|image|tts|transcribe|embed|moderation|search|codex|dall|whisper|sora|veo|imagen|guard|instruct|chat-latest/i;

/**
 * The hearing models, quickest and cheapest first: for a spoken command the
 * small model hears as well as the large one, in less time.
 */
function rankHearing(ids: string[]): string[] {
  const ranked = rankModels(ids.filter((id) => /transcribe|whisper/.test(id) && !/realtime|live|diarize/.test(id)));
  return [...ranked.filter((id) => /mini/.test(id)), ...ranked.filter((id) => !/mini/.test(id))];
}

interface ResponseStreamEvent {
  type: string;
  delta?: string;
}

export const openai: Service = {
  meta: {
    id: "openai",
    name: "ChatGPT",
    blurb: "OpenAI's GPT models, with the most natural voice. Billed per use.",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Starts with sk-",
    keyPrefix: "sk-",
    cost: "Needs a small prepaid credit on platform.openai.com — an hour of talking costs well under a dollar. Separate from a ChatGPT Plus subscription, which doesn't cover it.",
    free: false,
  },

  async catalogue(key) {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
    const ids: string[] = [];
    for await (const m of await client.models.list()) ids.push(m.id);
    return {
      chat: rankModels(ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !NOT_CHAT.test(id))),
      speech: rankModels(ids.filter((id) => /tts/.test(id))),
      hearing: rankHearing(ids),
      voices: VOICES,
    };
  },

  async chat(key, model, turns, emit, signal, persona = PERSONA) {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });

    const run = async (withSearch: boolean): Promise<void> => {
      const stream = (await client.responses.create(
        {
          model,
          stream: true,
          instructions: persona,
          input: turns.map((t) => ({ role: t.role, content: t.content })),
          ...(withSearch ? { tools: [{ type: "web_search" as const }] } : {}),
        },
        { signal },
      )) as AsyncIterable<ResponseStreamEvent>;

      for await (const ev of stream) {
        if (ev.type === "response.web_search_call.searching" || ev.type === "response.web_search_call.in_progress") {
          emit({ t: "status", status: "searching" });
        } else if (ev.type === "response.output_text.delta" && ev.delta) {
          emit({ t: "text", delta: ev.delta });
        }
      }
    };

    try {
      await run(true);
    } catch (err) {
      // Not every model carries the search tool; answer without it rather than fail.
      const msg = err instanceof Error ? err.message : String(err);
      if (signal.aborted || !/web_search|tool|unsupported|not supported/i.test(msg)) throw err;
      emit({ t: "status", status: "thinking" });
      await run(false);
    }
  },

  async *speak(key, model, text, voice, speed) {
    // The current model shapes its pace from the instruction; only the older
    // tts-1 models take a speed figure.
    const paced = /^tts-1/.test(model);
    const r = await fetch(`${API}/audio/speech`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        // raw 24 kHz samples, sent as they are made
        response_format: "pcm",
        ...(paced ? { speed } : { instructions: `${MANNER} ${pace(speed)}` }),
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok || !r.body) throw httpError("ChatGPT", r.status, await r.text());
    yield* bytesOf(r.body);
  },

  async hear(key, model, audio) {
    const type = audio.type || "audio/webm";
    const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : type.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("file", audio, `speech.${ext}`);
    form.append("model", model);
    form.append("language", "en");
    form.append("prompt", HEARING_HINT);
    const r = await fetch(`${API}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw httpError("ChatGPT", r.status, await r.text());
    const body = (await r.json()) as { text?: string };
    return (body.text ?? "").trim();
  },
};
