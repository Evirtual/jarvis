# Plan: the connection is the core

**Decided (2026-09-12).** One connected service gives JARVIS everything:
his reasoning, his hearing and his voice. The console behaves the same on the
PC, on the web and on the phone. There are two services, **Gemini** and
**OpenAI**. Gemini comes first because its free tier needs no card. Claude
leaves the chat connections and lives only in code mode
(`PLAN-code-mode.md`), where a Max plan counts; Codex on a ChatGPT plan joins
it there later. OpenRouter goes: it gave 50 free questions a day, then needed
credit anyway, and it added a second sign-in path and a set of confusing
errors.

**Settled with the user the same day:**

- **No speech engine of the app's own, anywhere.** Moonshine (hearing) and
  Kokoro (voice) both go, PC included, and so do their dependencies.
- **JARVIS speaks with the connected service's voice.** Gemini's voices
  through Gemini, ChatGPT's through ChatGPT.
- **The device's own voice is only the fallback,** used when no service is
  connected or the service's voice has hit its limit.
- **The service hears everywhere.** The browser's dictation is the fallback.

## Why

The web version ran the speech models in the browser: Kokoro to speak,
Moonshine to hear. In a browser they are five to ten times slower than on the
PC, and a sentence could take half a minute. A day of scheduling work did not
make it fluid, because the problem was where the work ran, not how it was
cut. The services we already connect can speak and hear, from a browser, in
well under a second. So no model runs in the browser.

## What each service gives, from the browser and the PC alike

| | Text | Hearing (speech → text) | Voice (text → speech) | Cost |
|---|---|---|---|---|
| **Gemini** | the newest `gemini-N` model | `gemini-3.5-transcribe` when the account has it, otherwise the chat model takes the audio directly | the `*-tts` models, the voice's manner given as an instruction | free tier: text generous, voice about 10 lines a day per model |
| **OpenAI** | the newest GPT model (dated snapshots, `chat-latest` and live models left out) | the newest `*-transcribe` model | the newest `*-tts` model, 13 voices, streamed | prepaid credit; an hour of talking well under $1 |

Both accept plain `fetch` from a browser with the user's own key. Neither
subscription (ChatGPT Plus, Claude Pro/Max) covers API use. We can't change
that, and the setup guide will say so plainly.

## What was built

```
                    ┌──────────────── shared/services ────────────────┐
                    │  common.ts: Service = { catalogue, chat,        │
                    │             speak, hear }, persona, helpers     │
                    │  gemini.ts   openai.ts                          │
                    │  index.ts: an account's models tried in turn,   │
                    │            errors in plain words                │
                    └────────────┬───────────────────────┬────────────┘
                                 │                       │
     PC:  server/index.ts ───────┘        web: client/browser-core.ts
          + keys on disk (config.json)          + keys in localStorage
          + real sensors and network sweep
                                 │                       │
                                 └────── client/api.ts ──┘  (one interface)
                                                 │
                        ask.ts   voice.ts   connections.ts
```

- **One module per service, one interface.** `catalogue` lists the
  account's models once and sorts them into three jobs: chat, speech and
  hearing. `rankModels` picks the newest capable model for each job.
  `speak` yields 24 kHz PCM as it arrives; `hear` takes the recording as it
  was made.
- **Models are tried in turn.** `speakWith` and `hearWith` move to the
  account's next model when one runs out, and leave the spent model to rest
  for 15 minutes. `humanise` turns each refusal into a plain sentence: a
  daily quota, a momentary one, out of credit, or a rejected key.
- **`voice.ts` chooses the voice once.** If a service is connected, it uses
  that service's voice: the one picked in Configuration → Voice
  (remembered per service), otherwise the first on its list. If no service is
  connected, or its voice is resting after a refusal (10 minutes), it uses the
  device's voice and says why, once. Playback streams in quarter-second
  slices, with silence trimmed at the joins.
- **Removed:** OpenRouter (`oauth.ts`, its route and messages), Anthropic from
  chat (the SDK went with it), Kokoro and Moonshine with their workers and
  dependencies, and the cross-origin isolation in `sw.js` that existed only for
  them. The one runtime dependency left is `openai`.

## Still to build: the first-run guide (`client/setup.ts`)

Shown once (`jarvis.setupDone`) and reopened from Configuration. It checks
where it is running (`SERVERLESS`) and says so:

1. **Where you are.** "Running on your PC": keys stay on this machine, and
   the real sensors are here. Or "Running as a web page": keys stay in this
   browser and go only to the service they belong to.
2. **Connect.** Two cards. *Gemini: free, no card; gives text, hearing and
   voice.* *OpenAI: needs a small prepaid credit.* Each has its key page one
   tap away and a paste field. The guide waits for one key to validate, then
   says what JARVIS can now do.
3. **Say hello.** Microphone permission, one spoken line back through the
   connection, and the address (sir or ma'am).
4. **(PC) Code mode.** A note that code mode signs in with a Claude or
   ChatGPT account through Claude Code or Codex. It's a later step and
   doesn't block setup.

Voice commands "run setup" and "show me the guide" open it again.
