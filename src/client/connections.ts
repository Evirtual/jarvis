/**
 * The Connections screen.
 *
 * Written for someone who has never heard of an API key. Each provider is a
 * card that states plainly what it is, what it costs, and what to do next —
 * with the key page one tap away, live validation, and the model list pulled
 * from the account rather than guessed, so a retired model can never silently
 * break the console.
 */

import type { ConnectionsResponse, ProviderId, ProviderView } from "../shared/types.js";
import { api } from "./api.js";
import { $, esc } from "./dom.js";
import { SERVERLESS } from "./server.js";

/** Two sheets, one over the other: copy. And the tick that replaces it for a moment once done. */
const COPY_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 5.5V3.7A1.2 1.2 0 0 0 9.3 2.5H3.7A1.2 1.2 0 0 0 2.5 3.7v5.6a1.2 1.2 0 0 0 1.2 1.2h1.8"/></svg>`;
const TICK_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>`;

export class Connections {
  private root: HTMLElement;
  private hint: HTMLElement;
  private data: ConnectionsResponse = { providers: [], active: null };
  private busy = new Set<ProviderId>();
  private errors = new Map<ProviderId, string>();

  onChange: ((c: ConnectionsResponse) => void) | null = null;

  constructor() {
    this.root = $("providers");
    this.hint = $("connHint");
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("change", (e) => void this.onSelect(e));
    this.root.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key !== "Enter") return;
      const input = e.target as HTMLElement;
      if (input.matches("input[data-key]")) {
        e.preventDefault();
        const id = input.getAttribute("data-key") as ProviderId;
        void this.save(id);
      }
    });
  }

  get active(): ProviderId | null {
    return this.data.active;
  }

  get anyReady(): boolean {
    return this.data.providers.some((p) => p.status.state === "ready");
  }

  activeName(): string {
    const p = this.data.providers.find((x) => x.id === this.data.active);
    return p?.name ?? "no core";
  }

  /** The model the active service will use. */
  activeModel(): string | null {
    const p = this.data.providers.find((x) => x.id === this.data.active);
    return p?.status.state === "ready" ? p.status.model : null;
  }

  /** Every service that can answer right now. */
  readyNames(): string[] {
    return this.data.providers.filter((p) => p.status.state === "ready").map((p) => p.name);
  }

  readyIds(): ProviderId[] {
    return this.data.providers.filter((p) => p.status.state === "ready").map((p) => p.id);
  }

  nameOf(id: ProviderId): string {
    return this.data.providers.find((p) => p.id === id)?.name ?? id;
  }

  /** A connected service's models and the one chosen, for the setup guide's picker. */
  modelsOf(id: ProviderId): { models: string[]; model: string } | null {
    const p = this.data.providers.find((x) => x.id === id);
    return p?.status.state === "ready" ? { models: p.status.models, model: p.status.model } : null;
  }

  async refresh(revalidate = false): Promise<void> {
    this.data = await api.connections(revalidate);
    this.render();
    this.onChange?.(this.data);
  }

  private apply(next: ConnectionsResponse): void {
    this.data = next;
    this.render();
    this.onChange?.(next);
  }

  private async onClick(e: Event): Promise<void> {
    const el = (e.target as HTMLElement).closest("[data-act]");
    if (!el) return;
    const act = el.getAttribute("data-act");
    const id = el.getAttribute("data-id") as ProviderId;
    if (!id) return;

    if (act === "save") await this.save(id);
    if (act === "copy") {
      const key = api.keyOf(id);
      if (key) {
        // the icon becomes a tick for a moment: copied
        try {
          await navigator.clipboard.writeText(key);
          el.innerHTML = TICK_ICON;
          el.classList.add("done");
          el.setAttribute("title", "Copied");
        } catch {
          el.setAttribute("title", "The browser refused the clipboard");
        }
        window.setTimeout(() => { el.innerHTML = COPY_ICON; el.classList.remove("done"); el.setAttribute("title", "Copy the key"); }, 1500);
      }
    }
    if (act === "use") {
      this.apply(await api.setActive(id));
    }
    if (act === "remove") {
      this.errors.delete(id);
      this.apply(await api.removeKey(id));
    }
    if (act === "recheck") {
      this.busy.add(id);
      this.render();
      await this.refresh(true);
      this.busy.delete(id);
      this.render();
    }
  }

  private async onSelect(e: Event): Promise<void> {
    const el = e.target as HTMLSelectElement;
    const id = el.getAttribute("data-model") as ProviderId | null;
    if (!id) return;
    this.apply(await api.selectModel(id, el.value));
  }

  private async save(id: ProviderId): Promise<void> {
    const input = this.root.querySelector<HTMLInputElement>(`input[data-key="${id}"]`);
    const key = input?.value.trim();
    if (!key) return;

    this.busy.add(id);
    this.errors.delete(id);
    this.render();
    try {
      this.apply(await api.saveKey(id, key));
    } catch (err) {
      this.errors.set(id, err instanceof Error ? err.message : String(err));
      this.render();
    } finally {
      this.busy.delete(id);
      this.render();
    }
  }

  private render(): void {
    this.root.innerHTML = this.data.providers.map((p) => this.card(p)).join("");

    const ready = this.data.providers.filter((p) => p.status.state === "ready");
    if (!ready.length) {
      this.hint.className = "hint warn";
      this.hint.innerHTML = "Nothing connected: I answer only my built-in commands. <b>Gemini</b> is free, and the quickest way to get me talking.";
    } else {
      const active = this.data.providers.find((p) => p.id === this.data.active);
      const ready = active?.status.state === "ready" ? active.status : null;
      const does = ready?.hears ? "answering and hearing" : "answering";
      this.hint.className = "hint";
      this.hint.innerHTML =
        `<b>${esc(this.activeName())}</b> is ${does}. The voice is chosen in Voice. ` +
        (SERVERLESS ? "Keys stay in this browser." : "Keys stay on this machine.");
    }
  }

  private card(p: ProviderView): string {
    const busy = this.busy.has(p.id);
    const isActive = this.data.active === p.id;
    const st = p.status;
    const cls = [
      "provider",
      st.state === "ready" ? "ready" : "",
      st.state === "error" ? "bad" : "",
      isActive ? "active" : "",
    ].filter(Boolean).join(" ");

    const head =
      `<div class="provider-head">` +
      `<span class="dot"></span><span class="nm">${esc(p.name)}</span>` +
      (p.free ? `<span class="badge">Free tier</span>` : "") +
      `<span class="spacer" style="flex:1"></span>` +
      (isActive
        ? `<span class="src" style="color:var(--ice);font-family:var(--f-hud);font-size:9px;letter-spacing:.12em;text-transform:uppercase">In use</span>`
        : st.state === "ready"
          ? `<button class="btn sm" data-act="use" data-id="${p.id}">Use</button>`
          : "") +
      `</div>`;

    if (st.state === "checking") {
      return `<div class="${cls}">${head}<p class="blurb">Checking the key…</p></div>`;
    }

    if (st.state === "unconfigured" || st.state === "error") {
      const err =
        this.errors.get(p.id) ?? (st.state === "error" ? st.message : null);
      return (
        `<div class="${cls}">` +
        head +
        `<p class="blurb">${esc(p.blurb)}</p>` +
        (err ? `<p class="err">${esc(err)}</p>` : "") +
        `<div class="row">` +
        `<input class="field grow" type="password" data-key="${p.id}" placeholder="${esc(p.keyPrefix)}…" autocomplete="off" spellcheck="false" aria-label="${esc(p.name)} API key">` +
        `<button class="btn primary" data-act="save" data-id="${p.id}"${busy ? " disabled" : ""}>${busy ? "Checking" : "Connect"}</button>` +
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
        (st.state === "error"
          ? `<div class="row" style="margin-top:8px"><button class="btn sm danger" data-act="remove" data-id="${p.id}">Forget key</button></div>`
          : "") +
        `</div>`
      );
    }

    const models = st.models
      .map((m) => `<option value="${esc(m)}"${m === st.model ? " selected" : ""}>${esc(m)}</option>`)
      .join("");

    return (
      `<div class="${cls}">` +
      head +
      `<div class="keyline">` +
      `<span class="mask">${esc(st.maskedKey)}</span>` +
      // the key can be copied back out only where it is kept in this browser
      (api.keyOf(p.id) !== null ? `<button class="copy" type="button" data-act="copy" data-id="${p.id}" title="Copy the key" aria-label="Copy the key">${COPY_ICON}</button>` : "") +
      `<span class="src"${st.source === "environment" ? ` title="Disconnect makes JARVIS stop using it; the variable itself is left alone for other programs"` : ""}>${st.source === "environment" ? `from ${p.envVar}` : "saved here"}</span>` +
      `</div>` +
      (st.problem ? `<p class="err">${esc(st.problem)}</p>` : "") +
      `<p class="hint">${st.hears ? "Answers and hears" : "Answers"} through this key${st.voices.length ? `, and offers ${st.voices.length} voices in Voice` : ""}.</p>` +
      `<div class="ctl"><span class="ctl-k"><span>Model</span><span class="n">${st.models.length} available</span></span>` +
      `<select class="sel" data-model="${p.id}" aria-label="${esc(p.name)} model">${models}</select></div>` +
      `<div class="row">` +
      `<button class="btn" data-act="recheck" data-id="${p.id}"${busy ? " disabled" : ""}>${busy ? "Checking" : "Re-check"}</button>` +
      `<button class="btn danger" data-act="remove" data-id="${p.id}">Disconnect</button>` +
      `</div>` +
      `</div>`
    );
  }
}
