/**
 * Gemini: answers, speech and hearing through Google's Generative Language
 * API, all with plain fetch — the free tier costs us no dependency. The
 * chat model itself does the hearing: Gemini takes audio as it takes text.
 */

import type { Catalogue, VoiceOption } from "../types.js";
import { HEARING_HINT, MANNER, PERSONA, fromBase64, httpError, pcm16ToWav, rankModels, toBase64, type Service } from "./common.js";

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
        inlineData?: { mimeType?: string; data?: string };
        /** How a transcription model answers. */
        audioTranscription?: { text?: string };
      }[];
    };
    groundingMetadata?: unknown;
  }[];
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
          generationConfig: { maxOutputTokens: 800 },
          // Google Search grounding — Gemini's own live-information tool.
          ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
        }),
        signal,
      });

    let r = await call(true);
    if (!r.ok) {
      // Grounding is not offered on every model; answer without it rather than fail.
      emit({ t: "status", status: "thinking" });
      r = await call(false);
    }
    if (!r.ok || !r.body) throw httpError("Gemini", r.status, await r.text());

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let grounded = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const cand = (JSON.parse(payload) as GeminiResponse).candidates?.[0];
          if (cand?.groundingMetadata && !grounded) {
            grounded = true;
            emit({ t: "status", status: "searching" });
          }
          for (const part of cand?.content?.parts ?? []) {
            if (part.text) emit({ t: "text", delta: part.text });
          }
        } catch {
          /* a split SSE frame; the next chunk completes it */
        }
      }
    }
  },

  async speak(key, model, text, voice, speed) {
    // The manner is an instruction, read as one and not aloud; the line follows.
    const res = await generate(key, model, {
      contents: [{ parts: [{ text: `${MANNER} ${pace(speed)} Say: ${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("Gemini returned no audio.");
    // "audio/L16;codec=pcm;rate=24000": raw 16-bit samples, the rate in the type
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24000);
    return pcm16ToWav(fromBase64(part.inlineData.data), rate);
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

/** The Cadence slider, as an instruction. */
function pace(speed: number): string {
  if (speed >= 1.15) return "Speak briskly.";
  if (speed <= 0.85) return "Speak slowly and deliberately.";
  return "Speak at an easy, natural pace.";
}
