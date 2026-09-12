# Plan: the connection is the core

**Decided (2026-09-12).** One connected service gives JARVIS everything —
his reasoning, his hearing and his voice — and the console is the same on
the PC, on the web and on the phone. Two services: **OpenAI** and **Gemini**.
Gemini's free tier makes it the recommended first connection. Claude leaves
the chat connections and lives only in code mode (`PLAN-code-mode.md`), where
the Max plan counts; Codex on a ChatGPT plan joins it there later. OpenRouter
goes: 50 free questions a day and then credit anyway, for a second sign-in
path and a set of confusing errors.

## Why

The web version ran the speech models in the browser — Kokoro to speak,
Moonshine to hear. In a browser they are five to ten times slower than on the
PC, Brave lies about the core count, and a sentence could take half a minute.
A day of scheduling work did not make it fluid, because the problem is where
the work runs, not how it is cut. The services we already connect can speak
and hear, from a browser, in well under a second. So: no model runs in the
browser. Ever.

## What each service gives, from the browser and the PC alike

| | Text | Hearing (speech → text) | Voice (text → speech) | Cost |
|---|---|---|---|---|
| **Gemini** | Flash, newest | the Flash model takes audio directly | `gemini-*-tts` models, 30 voices, style by instruction; 3.1 streams | free tier for text and voice (rate-limited); audio input on the free tier to be confirmed on a real key |
| **OpenAI** | GPT-5 family, newest | `gpt-transcribe` / `gpt-4o-mini-transcribe`, ~$0.003–0.0045 a minute | `gpt-4o-mini-tts`, 13 voices, an `instructions` line for accent and manner, streams PCM | prepaid credit; an hour of talking well under $1 |

Both accept plain `fetch` from a browser with the user's own key. Neither
subscription (ChatGPT Plus, Claude Pro/Max) covers API use; that is not a
thing we can change, and the setup guide says so plainly.

Verified today: OpenAI lists `gpt-4o-mini-tts-2025-12-15`, `gpt-transcribe`,
`gpt-4o-mini-transcribe-2025-12-15`. Not yet verified (no credit on the
OpenAI key, no Gemini key on the PC): first-audio latency, and whether the
Gemini free tier accepts audio input. Both are checked in phase 1 with
`scratchpad/speech-probe.mjs`, which prints timings and never a key.

## The shape

```
                    ┌──────────────── shared/services ────────────────┐
                    │  Service = { validate, chat, speak, hear }       │
                    │  openai.ts   gemini.ts                          │
                    └────────────┬───────────────────────┬────────────┘
                                 │                       │
     PC:  server/index.ts ───────┘        web: client/browser-core.ts
          + keys on disk (config.json)          + keys in localStorage
          + Kokoro / Moonshine offline          (nothing else)
          + real sensors, scan, code mode
                                 │                       │
                                 └────── client/api.ts ──┘  (one interface)
                                                 │
                 ask.ts   speech.ts   connections.ts   setup.ts
```

### 1. `shared/services/` replaces `shared/providers.ts`

One module per service, one interface:

```ts
interface Service {
  meta: ServiceMeta;                       // name, key page, cost line, free?
  validate(key): Promise<Catalogue>;       // { chat: string[]; speech: string[]; hearing: string[]; voices: VoiceOption[] }
  chat(key, model, turns, emit, signal, persona): Promise<void>;   // as today
  speak(key, model, text, voice, style, signal): AsyncIterable<Int16Array>;  // 24 kHz PCM, streamed
  hear(key, model, audio: Blob, hint: string): Promise<string>;
}
```

- `validate` lists the account's models once and sorts them into the three
  jobs; `rankModels` picks the newest capable one for each (the rule the
  console already follows for text: always the latest). The Connections
  screen shows all three choices.
- `chat` is today's streaming adapter, unchanged in behaviour (search
  grounding on Gemini, the `[[…]]` directives, `humanise` for errors).
- `speak` yields PCM as it arrives. OpenAI streams; Gemini 3.1 TTS streams,
  2.5 returns whole. The player (`speech.ts`) does not care which.
- `hear` sends the recording as it was made (WebM/Opus or WAV); both services
  take those. `audio.ts` stays only for the PC's Moonshine.
- The JARVIS voice per service is chosen by us and can be changed in Config:
  OpenAI `ash` (or `cedar`) with the instruction *"a calm, precise British
  butler; Received Pronunciation; unhurried"*; Gemini `Charon` with the same
  line in the prompt; on the PC offline, Kokoro `bm_george`.

### 2. `client/speech.ts` — one chooser, one player

Replaces the engine logic scattered over `voice.ts`, `voice-ui.ts`,
`browser-voice.ts`, `browser-hearing.ts`, `server/transcribe.ts` and
`server/index.ts`. It decides **once**, and Config → Voice shows the decision
in one line:

- **Voice:** the active connection's voice → (PC only) Kokoro offline → the
  device's own voice. "Speaking through Gemini · Charon" / "Speaking with this
  PC's own voice (offline)" / "Speaking with Windows' voice — connect a
  service for JARVIS's own".
- **Hearing:** the active connection's hearing → (PC only) Moonshine → the
  browser's dictation → the keyboard. Same one-line status.

The player keeps what already works — sentences cut as they arrive and
scheduled back to back on the audio clock, silence trimmed at the joins — and
requests them **in parallel over the network**, so the first sentence plays
within about a second and the rest are ready before they are due. No pacing,
no lanes, no per-device speed tests.

`voice.ts` shrinks to: the microphone (recording and silence detection), the
audio graph and amplitude for the globe, and the sentence splitter.

### 3. `client/setup.ts` — the first-run guide

Shown once (`jarvis.setupDone`), reopened from Config. It reads where it is
(`SERVERLESS`) and says so:

1. **Where you are.** "Running on your PC" — keys stay on this machine, the
   offline voice and real sensors are here; or "Running as a web page" — keys
   stay in this browser and go only to the service they belong to.
2. **Connect.** Two cards. *Gemini — free, no card; gives text, hearing and
   voice.* *OpenAI — the best voice; needs a small prepaid credit.* Each with
   its key page one tap away and the paste field. The guide waits for one to
   validate and then says what JARVIS can now do.
3. **Say hello.** Microphone permission, one spoken line back through the
   connection, and the address (sir / ma'am).
4. **(PC) Code mode.** A note that code mode signs in with a Claude or ChatGPT
   account through Claude Code or Codex — a later step, not blocking.

### 4. What goes

- `openrouter` everywhere: `oauth.ts`, the server route, the provider, the
  free-limit messages.
- `anthropic` from the chat providers (the SDK dependency goes with it; code
  mode uses the CLI, not the SDK).
- `browser-voice.ts`, `voice-worker.ts`, `browser-hearing.ts`,
  `hearing-worker.ts`, the `/ort/` copy, the cross-origin isolation in
  `sw.js` (it existed only for those threads).
- The stashed voice-pacing experiment (`git stash list`).
- `kokoro-js` and `@huggingface/transformers` remain **server** dependencies
  only, for the PC's offline fallback.

## Phases

1. **Services** — `shared/services/{index,openai,gemini}.ts` with
   `validate/chat/speak/hear`; types; the server's routes and `browser-core.ts`
   delegate to them (`/api/speak` and `/api/transcribe` take a `via`:
   connection or offline). Remove OpenRouter and Anthropic. Probe both
   services on real keys and record the numbers in `QA.md`.
2. **Speech** — `client/speech.ts` chooser and player; `voice.ts` trimmed;
   in-browser models deleted; Config → Voice shows source and voice; the phone
   checked on the live site.
3. **Setup guide** — `client/setup.ts`, first run on both versions, voice
   commands "run setup" / "show me the guide".
4. **Docs and QA** — README "Two ways to run it" rewritten around the
   connection; `QA.md` entries; memory updated.

## Open until a key is on the PC

- Gemini free tier and audio input: run the probe once the Gemini key is
  connected on the PC's Connections screen (the user pastes it there; it is
  never shown or typed by the assistant).
- OpenAI's voice latency: needs credit on the account first.
