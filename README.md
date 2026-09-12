<p align="center"><img src="src/client/public/icon.svg" width="112" alt="JARVIS's core: segmented cyan rings around a glowing gold triangle"></p>

# J.A.R.V.I.S. Console

[![CI](https://github.com/Evirtual/jarvis/actions/workflows/ci.yml/badge.svg)](https://github.com/Evirtual/jarvis/actions/workflows/ci.yml)

An Iron Man–style console that talks back. Every figure on screen is
**measured, not simulated** — real CPU cores, real GPU thermals, real devices on
your network, real weather where you are. You talk to JARVIS; he answers, hears
and speaks through one AI service you connect, and keeps your research as
threads on a board.

**[Try the web version](https://jarvis.edgarasneverdauskas.com/)** — it runs
in the browser with no install. Or run it on your PC for the machine's real
readings.

## What it does

- **Talk to him.** Tap JARVIS and speak, or type. Answers stream in and are
  spoken as they're written, in the connected service's voice.
- **Research as threads.** Each subject gets its own window, named for it;
  change subject and he opens a new one. Group threads, link them, tidy the
  board, all by voice or by hand.
- **Search the web** for answers with sources, pictures and videos, shown
  inside the thread.
- **Live instruments:** compute, graphics, storage, the devices on your
  network, your uplink and the weather.
- **The same everywhere** — PC, browser and phone, installable as an app.

## Quick start

**On the web:** open [jarvis.edgarasneverdauskas.com](https://jarvis.edgarasneverdauskas.com/),
then **Configuration → Connections** and paste a key.

**On your PC** (Node 20.11 or later):

```bash
npm install
```

```bash
npm run serve
```

Then open **http://localhost:7823** and connect a service the same way.

## Connecting a service

One key gives JARVIS his answers, his hearing and his voice.

| Service | Cost |
| --- | --- |
| **Gemini** | **Free tier, no credit card** — [get a key](https://aistudio.google.com/apikey). The free voice allows only a few lines a day; answers and hearing go much further. |
| ChatGPT | A small prepaid credit — [get a key](https://platform.openai.com/api-keys). An hour of talking is well under a dollar, and it has the most natural voice. |

A ChatGPT Plus or Claude subscription doesn't cover this: API use is a separate
product. Connect both and JARVIS falls back from one to the other, saying why.

## The two versions

| | PC | Web |
| --- | --- | --- |
| Readings | The machine's own: CPU per core, GPU, disks, the devices on your network | What a browser can measure of its device |
| Keys | In `config.json` on the machine, never sent to the browser | In that browser, sent only to their service |
| Answers, hearing, voice | The connected service | The same |

## Learn more

- **[Guide](docs/GUIDE.md)** — the deck and board, threads and groups, voice,
  and everything you can say
- **[How it works](docs/HOW-IT-WORKS.md)** — where every reading comes from,
  what leaves your machine, how the versions differ, what happens when a
  service fails
- **[Development](docs/DEVELOPMENT.md)** — commands, the code map and tests
- **[QA log](docs/QA.md)** — the manual test plan and every end-to-end run
