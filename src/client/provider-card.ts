/**
 * A service's card — on Connections and in the first-run guide, the same
 * card: its name and whether it is free; when connected, the masked key
 * (copyable where the key is kept in this browser), what it does through
 * the key, and its models; otherwise the key field, the way to get a key
 * and what it costs. Drawn once, here, so the two screens never differ.
 *
 * What is pressed is read by the screen that holds the card:
 *   input[data-key=ID], [data-act="save|copy|use|remove|recheck"][data-id=ID], select[data-model=ID], input[data-effort=ID]
 */

import type { Effort, ProviderView } from "../shared/types.js";
import { EFFORTS } from "../shared/types.js";
import { api } from "./api.js";
import { esc } from "./dom.js";
import { COPY_ICON } from "./icons.js";

export interface CardState {
  /** The service in use answers; a ready one that isn't is a spare. */
  active: boolean;
  /** Its key is being checked right now. */
  busy: boolean;
  /** What went wrong the last time a key was tried on this screen, if anything. */
  error: string | null;
  /** The sentence under the key line: what it does through the key. */
  hint: string | null;
  /** In the guide: a connected service says so, a spare offers Use, and there is no re-check or disconnect. */
  inGuide: boolean;
}

/** The three stops, and what each costs in time and money — measured, not promised: a model and a question vary. */
const EFFORT_NOTE: Record<Effort, { name: string; note: string }> = {
  quick: { name: "Quick", note: "answers in a second or two; the sensible everyday setting." },
  balanced: { name: "Balanced", note: "thinks for a few seconds first; a little more careful, a little dearer." },
  thorough: { name: "Thorough", note: "thinks hard — often ten seconds or more before the first word, and the dearest answer." },
};

/** The thinking slider: three stops, quick on the left, thorough on the right, the thumb over the word at each. */
function effortControl(p: ProviderView, effort: Effort): string {
  const at = EFFORTS.indexOf(effort);
  const marks = EFFORTS.map((e, i) => `<span${i === at ? ' class="on"' : ""}>${EFFORT_NOTE[e].name}</span>`).join("");
  return (
    `<div class="ctl effort">` +
    `<span class="ctl-k"><span>Thinking</span></span>` +
    // the lane draws the line edge to edge; the input inside it is inset so its thumb stops over each word (alignEffortSliders)
    `<div class="sl-lane"><input class="sl" type="range" min="0" max="${EFFORTS.length - 1}" step="1" value="${at}" data-effort="${p.id}" aria-label="${esc(p.name)} thinking" aria-valuetext="${EFFORT_NOTE[effort].name}"></div>` +
    `<div class="sl-marks">${marks}</div>` +
    `<p class="hint">${EFFORT_NOTE[effort].name}: ${EFFORT_NOTE[effort].note} Say “think hard about…” for one question.</p>` +
    `</div>`
  );
}

/** Half the slider's thumb (.sl, controls.css), in px. */
const HALF_THUMB = 5.5;

/**
 * Put the thinking slider's thumb over the middle of each word: the track is
 * inset by half of each end word, and the middle word is centred between the
 * two end centres. Word widths depend on the font, so this is measured after
 * the card is painted (and again once the fonts are in).
 */
export function alignEffortSliders(root: ParentNode): void {
  for (const ctl of root.querySelectorAll<HTMLElement>(".ctl.effort")) {
    const slider = ctl.querySelector<HTMLElement>(".sl");
    const [first, middle, last] = ctl.querySelectorAll<HTMLElement>(".sl-marks span");
    if (!slider || !first || !middle || !last) continue;
    const a = first.offsetWidth, b = last.offsetWidth;
    if (!a || !b) continue; // not laid out (hidden): nothing to measure
    // the track starts under the first word's middle and ends under the last's (a range input keeps
    // its own width, so it is narrowed rather than given a right margin)
    slider.style.marginLeft = `${a / 2 - HALF_THUMB}px`;
    slider.style.width = `calc(100% - ${(a + b) / 2 - 2 * HALF_THUMB}px)`;
    middle.style.transform = `translateX(${(a - b) / 4}px)`;
  }
}

export function providerCard(p: ProviderView, s: CardState): string {
  const st = p.status;
  const ready = st.state === "ready";
  const cls = ["provider", ready ? "ready" : "", st.state === "error" ? "bad" : "", s.active ? "active" : ""].filter(Boolean).join(" ");
  const head =
    `<div class="provider-head">` +
    `<span class="dot"></span><span class="nm">${esc(p.name)}</span>` +
    (p.free ? `<span class="badge">Free tier</span>` : "") +
    `<span class="spacer"></span>` +
    (s.inGuide
      ? (ready ? `<span class="ok">Connected</span>` : "")
      : s.active ? `<span class="src on">In use</span>`
        : ready ? `<button class="btn sm" data-act="use" data-id="${p.id}">Use</button>` : "") +
    `</div>`;

  if (st.state === "checking") return `<div class="${cls}">${head}<p class="blurb">Checking the key…</p></div>`;

  if (st.state === "unconfigured" || st.state === "error") {
    const err = s.error ?? (st.state === "error" ? st.message : null);
    return (
      `<div class="${cls}">` + head +
      `<p class="blurb">${esc(p.blurb)}</p>` +
      (err ? `<p class="err">${esc(err)}</p>` : "") +
      `<div class="row">` +
      `<input class="field grow" type="password" data-key="${p.id}" placeholder="${esc(p.keyPrefix)}…" autocomplete="off" spellcheck="false" aria-label="${esc(p.name)} API key">` +
      `<button class="btn primary" type="button" data-act="save" data-id="${p.id}"${s.busy ? " disabled" : ""}>${s.busy ? "Checking" : "Connect"}</button>` +
      `</div>` +
      // the how and the cost, a line away rather than on the page
      `<details class="disclose"><summary>How to get a key</summary><div class="body">` +
      `<ol class="steps">` +
      `<li>Open <a href="${p.keyUrl}" target="_blank" rel="noreferrer noopener">the key page</a>${p.free ? " and sign in with a Google account" : ""}.</li>` +
      `<li>Create a key and copy it. ${esc(p.keyHint)}.</li>` +
      `<li>Paste it above and press Connect.</li>` +
      `</ol>` +
      `<p class="cost">${esc(p.cost)}</p>` +
      `</div></details>` +
      (st.state === "error" ? `<div class="row" style="margin-top:8px"><button class="btn sm danger" type="button" data-act="remove" data-id="${p.id}">Forget key</button></div>` : "") +
      `</div>`
    );
  }

  const models = st.models.map((m) => `<option value="${esc(m)}"${m === st.model ? " selected" : ""}>${esc(m)}</option>`).join("");
  return (
    `<div class="${cls}">` + head +
    `<div class="keyline">` +
    `<span class="mask">${esc(st.maskedKey)}</span>` +
    // the key can be copied back out only where it is kept in this browser
    (api.keyOf(p.id) !== null ? `<button class="copy" type="button" data-act="copy" data-id="${p.id}" title="Copy the key" aria-label="Copy the key">${COPY_ICON}</button>` : "") +
    `<span class="src"${st.source === "environment" ? ` title="Disconnect makes J.A.R.V.I.S. stop using it; the variable itself is left alone for other programs"` : ""}>${st.source === "environment" ? `from ${p.envVar}` : ""}</span>` +
    `</div>` +
    (st.problem ? `<p class="err">${esc(st.problem)}</p>` : "") +
    `<p class="hint">${esc(s.hint ?? "")}</p>` +
    (s.inGuide && !s.active
      ? `<div class="row" style="align-items:center;margin-bottom:10px"><p class="blurb grow" style="margin:0">Connected, as a spare.</p><button class="btn sm" type="button" data-act="use" data-id="${p.id}">Use ${esc(p.name)}</button></div>`
      : "") +
    `<div class="ctl"><span class="ctl-k"><span>Model</span><span class="n">${st.models.length} available</span></span>` +
    `<select class="sel" data-model="${p.id}" aria-label="${esc(p.name)} model">${models}</select></div>` +
    (st.thinks ? effortControl(p, st.effort) : "") +
    (s.inGuide ? "" :
      `<div class="row">` +
      `<button class="btn" type="button" data-act="recheck" data-id="${p.id}"${s.busy ? " disabled" : ""}>${s.busy ? "Checking" : "Re-check"}</button>` +
      `<button class="btn danger" type="button" data-act="remove" data-id="${p.id}">Disconnect</button>` +
      `</div>`) +
    `</div>`
  );
}
