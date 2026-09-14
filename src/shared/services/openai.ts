/**
 * OpenAI: answers through the Responses API (where web search lives),
 * speech and hearing through the audio endpoints — all with plain fetch,
 * the answers as a server-sent-event stream, as Gemini's are.
 */

import type { VoiceOption, Effort } from "../types.js";
import { DEFAULT_EFFORT } from "../types.js";
import { HEARING_HINT, MANNER, PERSONA, bytesOf, eventsOf, httpError, pace, rankModels, type Service } from "./common.js";

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
/** The Responses API's word for each of ours. */
const EFFORT_WORD: Record<Effort, "low" | "medium" | "high"> = { quick: "low", balanced: "medium", thorough: "high" };

const NOT_CHAT = /audio|realtime|live|image|tts|transcribe|embed|moderation|search|codex|dall|whisper|sora|veo|imagen|guard|instruct|chat-latest/i;

/**
 * The hearing models, quickest and cheapest first: for a spoken command the
 * small model hears as well as the large one, in less time.
 */
function rankHearing(ids: string[]): string[] {
  const ranked = rankModels(ids.filter((id) => /transcribe|whisper/.test(id) && !/realtime|live|diarize/.test(id)));
  return [...ranked.filter((id) => /mini/.test(id)), ...ranked.filter((id) => !/mini/.test(id))];
}

/**
 * A request asked again, twice at most, when the service is momentarily
 * overloaded (429 and 5xx) — a moment's wait, then a little longer — never
 * once the caller has given up.
 */
async function withRetry(call: () => Promise<Response>, signal: AbortSignal): Promise<Response> {
  let r = await call();
  for (const wait of [400, 800]) {
    if (r.ok || signal.aborted || (r.status !== 429 && r.status < 500)) break;
    await new Promise((done) => setTimeout(done, wait));
    r = await call();
  }
  return r;
}

/** The key travels in a header, never in the address. */
const headers = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}`, "content-type": "application/json" });

/** One event of a Responses stream: what it is, and the piece of text when it carries one. */
interface ResponseEvent {
  type: string;
  delta?: string;
  /** How the stream reports a failure part-way — `error`, or a response that `failed`. */
  error?: { message?: string; code?: string };
  response?: { error?: { message?: string; code?: string } };
}

export const openai: Service = {
  meta: {
    id: "openai",
    name: "ChatGPT",
    envVar: "OPENAI_API_KEY",
    blurb: "OpenAI's GPT models, with the most natural voice. Billed per use.",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Starts with sk-",
    keyPrefix: "sk-",
    cost: "Needs a small prepaid credit on platform.openai.com — an hour of talking costs well under a dollar. Separate from a ChatGPT Plus subscription, which doesn't cover it.",
    free: false,
  },

  async catalogue(key) {
    const r = await fetch(`${API}/models`, { headers: headers(key), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw httpError("ChatGPT", r.status, await r.text());
    const body = (await r.json()) as { data?: { id?: string }[] };
    const ids = (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    return {
      chat: rankModels(ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !NOT_CHAT.test(id))),
      speech: rankModels(ids.filter((id) => /tts/.test(id))),
      hearing: rankHearing(ids),
      voices: VOICES,
    };
  },

  /** The gpt-5 family and the o-series think before they answer; older models refuse the reasoning fields. */
  thinks(model) {
    return /^(?:gpt-5|o\d)/.test(model);
  },

  async chat(key, model, turns, emit, signal, persona = PERSONA, how = {}) {
    const search = how.search ?? true;
    // A thinking model deliberates at a medium effort unless told otherwise —
    // several seconds before the first word of a greeting. The effort is the
    // user's choice (quick by default), and a quick answer with nothing looked
    // up is asked to be brief as well.
    const reasons = this.thinks(model);
    const effort = EFFORT_WORD[how.effort ?? DEFAULT_EFFORT];
    const call = (withSearch: boolean, tuned: boolean): Promise<Response> =>
      fetch(`${API}/responses`, {
        method: "POST",
        headers: headers(key),
        body: JSON.stringify({
          model,
          stream: true,
          instructions: persona,
          input: turns.map((t) => ({ role: t.role, content: t.content })),
          ...(withSearch ? { tools: [{ type: "web_search" }] } : {}),
          ...(tuned ? { reasoning: { effort }, ...(!withSearch && effort === "low" ? { text: { verbosity: "low" } } : {}) } : {}),
        }),
        signal,
      });

    let r = await withRetry(() => call(search, reasons), signal);
    if (!r.ok) {
      // Not every model carries the search tool or takes the reasoning fields; answer plainly rather than fail.
      const body = await r.text();
      if (signal.aborted || !/web_search|tool|unsupported|not supported|reasoning|verbosity/i.test(body)) throw httpError("ChatGPT", r.status, body);
      emit({ t: "status", status: "thinking" });
      r = await withRetry(() => call(false, false), signal);
      if (!r.ok) throw httpError("ChatGPT", r.status, await r.text());
    }
    if (!r.body) throw httpError("ChatGPT", r.status, "no body");

    for await (const ev of eventsOf<ResponseEvent>(r.body)) {
      if (ev.type === "error" || ev.type === "response.failed") {
        const e = ev.error ?? ev.response?.error;
        throw httpError("ChatGPT", 500, JSON.stringify(e ?? ev));
      }
      if (ev.type === "response.web_search_call.searching" || ev.type === "response.web_search_call.in_progress") {
        emit({ t: "status", status: "searching" });
      } else if (ev.type === "response.output_text.delta" && ev.delta) {
        emit({ t: "text", delta: ev.delta });
      }
    }
  },

  async *speak(key, model, text, voice, speed) {
    // The current model shapes its pace from the instruction; only the older
    // tts-1 models take a speed figure.
    const paced = /^tts-1/.test(model);
    const r = await fetch(`${API}/audio/speech`, {
      method: "POST",
      headers: headers(key),
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
