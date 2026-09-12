/**
 * Gemini: answers, speech and hearing through Google's Generative Language
 * API, all with plain fetch — the free tier costs us no dependency. The
 * chat model itself does the hearing: Gemini takes audio as it takes text.
 */

import type { VoiceOption } from "../types.js";
import { HEARING_HINT, MANNER, PERSONA, eventsOf, fromBase64, httpError, pace, rankModels, toBase64, type Service } from "./common.js";

const API = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini's prebuilt voices; the accent and manner come from the instruction that precedes each line. */
const VOICES: VoiceOption[] = [
  { id: "Charon", name: "Charon", note: "male · informative" },
  { id: "Algenib", name: "Algenib", note: "male · gravelly" },
  { id: "Schedar", name: "Schedar", note: "male · even" },
  { id: "Iapetus", name: "Iapetus", note: "male · clear" },
  { id: "Orus", name: "Orus", note: "male · firm" },
  { id: "Alnilam", name: "Alnilam", note: "male · firm" },
  { id: "Rasalgethi", name: "Rasalgethi", note: "male · informative" },
  { id: "Sadaltager", name: "Sadaltager", note: "male · knowledgeable" },
  { id: "Gacrux", name: "Gacrux", note: "mature" },
  { id: "Umbriel", name: "Umbriel", note: "easy-going" },
  { id: "Enceladus", name: "Enceladus", note: "breathy" },
  { id: "Achird", name: "Achird", note: "friendly" },
  { id: "Kore", name: "Kore", note: "female · firm" },
  { id: "Sulafat", name: "Sulafat", note: "female · warm" },
  { id: "Despina", name: "Despina", note: "female · smooth" },
  { id: "Vindemiatrix", name: "Vindemiatrix", note: "female · gentle" },
  { id: "Erinome", name: "Erinome", note: "female · clear" },
  { id: "Aoede", name: "Aoede", note: "female · breezy" },
  { id: "Leda", name: "Leda", note: "female · youthful" },
  { id: "Zephyr", name: "Zephyr", note: "female · bright" },
];

/**
 * Only the Gemini models proper are for chat: not speech, pictures, live
 * audio, embeddings, nor the agents and research models listed beside them.
 */
const CHAT = /^gemini-\d/;
const NOT_CHAT = /tts|transcribe|image|live|audio|embedding|computer-use|robotics|customtools|-exp\b/i;

interface GeminiModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        /** The model's own deliberation, when it shares it — never shown or spoken. */
        thought?: boolean;
        inlineData?: { mimeType?: string; data?: string };
        /** How a transcription model answers. */
        audioTranscription?: { text?: string };
      }[];
    };
    groundingMetadata?: unknown;
    finishReason?: string;
  }[];
  /** A stream that started well can still fail part-way; it says so in an event like this. */
  error?: { code?: number; message?: string; status?: string };
}

/** Each event of a stream, failing loudly on an error the service sends inside it. */
async function* checked(body: ReadableStream<Uint8Array>): AsyncIterable<GeminiResponse> {
  for await (const ev of eventsOf<GeminiResponse>(body)) {
    if (ev.error) throw httpError("Gemini", ev.error.code ?? 500, JSON.stringify(ev.error));
    yield ev;
  }
}

const url = (path: string, key: string): string => `${API}/${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;

async function generate(key: string, model: string, body: unknown, signal?: AbortSignal): Promise<GeminiResponse> {
  const r = await fetch(url(`models/${encodeURIComponent(model)}:generateContent`, key), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(30000),
  });
  if (!r.ok) throw httpError("Gemini", r.status, await r.text());
  return (await r.json()) as GeminiResponse;
}

export const gemini: Service = {
  meta: {
    id: "gemini",
    name: "Gemini",
    blurb: "Google's Gemini: answers, hearing and a voice, all on a free tier. The way in for anyone new.",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "Starts with AIza",
    keyPrefix: "AIza",
    cost: "Free tier: no credit card, hundreds of questions a day on the Flash models, the voice included. Google may use free-tier data to improve their models.",
    free: true,
  },

  async catalogue(key) {
    const r = await fetch(url("models?pageSize=200", key), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw httpError("Gemini", r.status, await r.text());
    const body = (await r.json()) as { models?: GeminiModel[] };
    const ids = (body.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
    const chat = rankModels(ids.filter((id) => CHAT.test(id) && !NOT_CHAT.test(id)));
    return {
      chat,
      speech: rankModels(ids.filter((id) => /tts/.test(id))),
      // A model made for transcription first, where the account has one; then
      // a Flash model, which hears a short command in well under a second.
      hearing: [
        ...rankModels(ids.filter((id) => /transcribe/.test(id))),
        ...chat.filter((id) => /flash/.test(id) && !/lite/.test(id)),
        ...chat.filter((id) => !/flash/.test(id) || /lite/.test(id)),
      ],
      voices: VOICES,
    };
  },

  async chat(key, model, turns, emit, signal, persona = PERSONA) {
    const contents = turns.map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.content }],
    }));

    const call = (withSearch: boolean): Promise<Response> =>
      fetch(url(`models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, key), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: persona }] },
          // Room for the model's own deliberation as well as the answer: the
          // newest models think first, and a tight limit left nothing to say.
          generationConfig: { maxOutputTokens: 4096 },
          // Google Search grounding — Gemini's own live-information tool.
          ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
        }),
        signal,
      });

    let r = await call(true);
    if (!r.ok) {
      // Grounding isn't offered on every model, and has its own allowance on
      // the free tier: answer without it rather than fail.
      emit({ t: "status", status: "thinking" });
      r = await call(false);
    }
    if (!r.ok || !r.body) throw httpError("Gemini", r.status, await r.text());

    let grounded = false;
    let wrote = false;
    let finish = "";
    for await (const ev of checked(r.body)) {
      const cand = ev.candidates?.[0];
      if (cand?.groundingMetadata && !grounded) {
        grounded = true;
        emit({ t: "status", status: "searching" });
      }
      for (const part of cand?.content?.parts ?? []) {
        if (part.text && !part.thought) { wrote = true; emit({ t: "text", delta: part.text }); }
      }
      finish = cand?.finishReason ?? finish;
    }
    // Nothing written is a failure, not an answer — say why, so the console can
    // try the other service rather than print "nothing useful".
    if (!wrote) throw Object.assign(new Error(`Gemini returned no answer${finish ? ` (${finish})` : ""}.`), { status: 502 });
  },

  async *speak(key, model, text, voice, speed) {
    // The manner is an instruction, read as one and not aloud; the line
    // follows. The newest speech model sends the audio as it is made
    // ("audio/L16;codec=pcm;rate=24000" — raw samples); an older one sends it
    // whole, as a single piece, through the same stream.
    const r = await fetch(url(`models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, key), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${MANNER} ${pace(speed)} Say: ${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok || !r.body) throw httpError("Gemini", r.status, await r.text());
    for await (const ev of checked(r.body)) {
      for (const part of ev.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) yield fromBase64(part.inlineData.data);
      }
    }
  },

  async hear(key, model, audio) {
    const data = toBase64(new Uint8Array(await audio.arrayBuffer()));
    const parts = [
      { text: `Transcribe this recording word for word and reply with the transcript only — no quotes, no commentary. It may use these words: ${HEARING_HINT}` },
      { inlineData: { mimeType: audio.type || "audio/webm", data } },
    ];
    // A transcription model just transcribes. A chat model would deliberate
    // first unless told not to — and not every one lets it be switched off.
    const transcriber = /transcribe/.test(model);
    const request = (thinking: boolean): unknown => ({
      contents: [{ parts }],
      ...(transcriber ? {} : {
        generationConfig: { temperature: 0, maxOutputTokens: 300, ...(thinking ? {} : { thinkingConfig: { thinkingBudget: 0 } }) },
      }),
    });
    let res: GeminiResponse;
    try {
      res = await generate(key, model, request(false));
    } catch (err) {
      if (transcriber || (err as { status?: number }).status !== 400) throw err;
      res = await generate(key, model, request(true));
    }
    return (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.audioTranscription?.text ?? p.text ?? "").join("").trim();
  },
};
