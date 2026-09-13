# How it works

Where every reading comes from, what leaves your machine, how the two versions
differ, and how connections behave when something goes wrong. For using the
console, see the [Guide](GUIDE.md); for working on it, [Development](DEVELOPMENT.md).

## One connection does everything

The connected service — Gemini or ChatGPT — answers, hears and speaks, the
same on the PC, the web and a phone. No model runs on the device and nothing is
downloaded. Why it's built this way, and what it replaced:
[PLAN-connection-core.md](PLAN-connection-core.md).

**Keys** are validated the moment they're pasted, and the model is picked from
**the account's real list**, so a retired model can never silently break the
console; the newest one that answers is the default, for every job. The
"chat-latest" names OpenAI lists but its API refuses are left out.

**When a service stops answering**, JARVIS says why in plain words: a rejected
key, a model the account can't use, an account **out of credit** (account-wide,
so another model of the same service won't help), a free allowance spent, or
the service being busy. When another service is connected he answers through it
instead, and says so. The service's card in Connections shows the same problem
under its name until the next answer gets through — a key can list models
perfectly well on an account that can't answer. The service's own error is
written to the server console for diagnosis; keys never appear in it.

**A free tier gives each model its own small allowance** — Gemini's newest voice
allows ten lines a day — so the account's models for a job are tried in order
until one answers, and a model that has used its allowance is left alone for a
while.

## Two ways to run it

| | On your PC (`npm run serve`) | As a web page |
| --- | --- | --- |
| Where | The console's own server on your machine | [jarvis.edgarasneverdauskas.com](https://jarvis.edgarasneverdauskas.com/), published by [`pages.yml`](../.github/workflows/pages.yml) on every push to `main` |
| Keys | `config.json` on the machine, `chmod 600`, never sent to the browser; the screen only shows a masked tail | That browser on that device, sent only to the service they belong to |
| Readings | The machine's own — CPU per core, GPU, disks, the devices on your network | What a browser can genuinely measure (below) |
| Voice, hearing, answers | The connected service | The same |

An existing `GEMINI_API_KEY` or `OPENAI_API_KEY` in the environment is picked up
on the PC and labelled with the variable's name. **Disconnect** on such a key
makes JARVIS ignore it from then on (remembered in `config.json`) — the variable
itself is left alone for other programs — until a key is connected again.

On the web, the published page carries a Content Security Policy that lets it
talk to those services and nothing else. Use a key with a spending limit;
**Disconnect** removes it from the device. A key the browser won't keep (full,
or a private window that blocks storage) is reported, not silently lost.

A custom domain for the web version: set the repository variable
`JARVIS_SITE_URL` (so the page is built for `/` rather than `/jarvis/`) and add
the domain under Settings → Pages.

## What's actually real

Every figure on screen is measured, not simulated.

### On the PC

| Reading | Source |
| --- | --- |
| Per-core CPU load | `os.cpus()` tick deltas |
| Memory | `os.totalmem/freemem` |
| GPU util, temp, VRAM, watts, clock | `nvidia-smi` |
| Wi-Fi SSID/signal/radio, throughput, disks, gateway, DNS | one PowerShell probe, every 20 s |
| Battery | the same probe — ask "power" for it |
| Perimeter radar | real ICMP sweep of your /24 — bearing is a stable hash of the address, **radius is genuine round-trip time** |
| Device identity | ARP table + MAC OUI lookup, with randomised privacy MACs labelled as such |
| Public IP, ISP, ASN, city | ip-api.com |
| Weather, sunrise, sunset | open-meteo.com |
| Internet latency | real pings to your gateway, 1.1.1.1, 8.8.8.8 |

**The network is swept once when the server starts**, so the Perimeter panel has
something to show, and after that **only when you ask** — Sweep on the panel, or
"scan the network". It is never polled in the background. The sweep is
discovery only: ICMP, ARP and reverse DNS on your own subnet; it does not
port-scan anything.

**How the readings arrive.** The console holds one `/api/events` stream open
(server-sent events) and the server pushes a reading only when it has changed.
The stream closes a few seconds after the tab is hidden and reopens the moment
it is looked at, so a background tab costs nothing — which also means a sweep
asked for from a hidden tab reports when you look again.

### As a web page

| Reading | On the PC | As a web page |
| --- | --- | --- |
| Compute | CPU per core | how much slower a fixed task runs than at its quickest (a background worker, 20 ms every 2 s), cores, app memory |
| Graphics | GPU load, temperature, power | the adapter the browser names, frame rate against the display's refresh rate, screen, colour |
| Storage | disks | what the app keeps on the device, and what the browser allows it |
| Perimeter | devices on your network | the services JARVIS relies on — Gemini, ChatGPT, the weather, this page's host — placed on the radar by measured round trip |
| Uplink | Wi-Fi, gateway, throughput | the connection as the browser reports it, measured round trips, public IP and provider (GeoJS, ipwho.is) |
| Environment | weather where the IP says | the same, or where GPS says once you press **Use GPS** |

"power" gives the real battery where the browser shares it (not on iPhone).
Readings pause while the page is out of sight. A panel's body is
painted only while it is open, and JARVIS himself draws every frame while
anything moves and every other frame at rest.

## What leaves your machine

- **The connected service** sees your questions, your recorded speech and the
  text it speaks — nothing else. Each question carries a snapshot of the board
  (thread titles and one-line summaries) and the live readings it may need.
- **Two services see your IP for readings** on the PC: ip-api.com and
  open-meteo.com. Set `JARVIS_OFFLINE=1` to disable both — the console then
  reports it has no uplink data rather than inventing any. The web version asks
  GeoJS (or ipwho.is) and open-meteo.
- **Images and videos** you ask for load from the sites that host them, which
  therefore see your IP too; images are fetched without a referrer.

## Keeping it to yourself

The PC server listens on the machine's interfaces so a phone on your network can
use it, but it is deliberately unfriendly to anything else:

- **No CORS.** The console is served from the same origin; in development, Vite
  proxies `/api`, so the browser never makes a cross-origin call.
- Anything that changes state must carry the console's own header, which a page
  on another site cannot set without a preflight that is never granted.
- Keys never reach the browser or a model; a key pasted into the chat is
  intercepted locally and stored server-side.
- Replies are always built from text, never from markup. Their Markdown is
  read into tokens (by `marked`, used as a parser only) and each token is drawn
  with `createElement` and text nodes, so an HTML tag in a reply appears as the
  characters it is. Only `https` links become clickable, and videos are
  embedded only from YouTube and Vimeo, by validated video ID.

## Subscriptions

A ChatGPT Plus or Claude plan does not include API access — they are separate
products, and a program on your own PC is no exception. Gemini's free tier is
the honest answer if you want JARVIS without per-use billing. Claude has no
speech or hearing, so it isn't a connection here; it returns in code mode
([PLAN-code-mode.md](PLAN-code-mode.md)), where a Claude subscription does count.

## Odds and ends

- The board lives in the browser's storage: clearing site data clears it. On
  the PC the keys live on the server instead.
- Positions are saved from the board's top-left corner. Saves from before that
  (measured from the centre) are converted once, on the first load.
- An earlier version had a built-in code agent. It has been removed;
  conversations from it are kept as ordinary threads, renamed "Previous
  conversation".
