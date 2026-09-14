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
import { DEFAULT_EFFORT, EFFORTS } from "../shared/types.js";
import { api } from "./api.js";
import { $, esc } from "./dom.js";
import { COPY_ICON, TICK_ICON } from "./icons.js";
import { providerCard } from "./provider-card.js";
import { SERVERLESS } from "./server.js";

export class Connections {
  private root: HTMLElement;
  private hint: HTMLElement;
  private data: ConnectionsResponse = { providers: [], active: null };
  private busy = new Set<ProviderId>();
  private errors = new Map<ProviderId, string>();

  onChange: ((c: ConnectionsResponse) => void) | null = null;
  /** Anyone else who follows the connections (the readiness card). */
  onConnectionsChanged: (() => void)[] = [];

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

  /** The line under a connected service's key — what it does through it — the same in the guide and here. */
  hintOf(id: ProviderId): string | null {
    const p = this.data.providers.find((x) => x.id === id);
    if (p?.status.state !== "ready") return null;
    const st = p.status;
    return `${st.hears ? "Answers and hears" : "Answers"} through this key.${st.voices.length ? ` ${st.voices.length} voices to choose from in the Voice tab.` : ""}`;
  }

  /** A connected service's key, masked, for the guide's key line. */
  maskedKeyOf(id: ProviderId): string | null {
    const p = this.data.providers.find((x) => x.id === id);
    return p?.status.state === "ready" ? p.status.maskedKey : null;
  }

  /** A connected service's models and the one chosen, for the setup guide's picker. */
  modelsOf(id: ProviderId): { models: string[]; model: string } | null {
    const p = this.data.providers.find((x) => x.id === id);
    return p?.status.state === "ready" ? { models: p.status.models, model: p.status.model } : null;
  }

  /** How many times what is connected has changed here; a refresh that began before the latest change is out of date. */
  private changes = 0;

  async refresh(revalidate = false): Promise<void> {
    const at = this.changes;
    const next = await api.connections(revalidate);
    // A re-check in flight while a key was disconnected (or a model, a service or the thinking
    // chosen) would land after the change and show the screen as it was: drop it.
    if (at !== this.changes) return;
    this.apply(next);
  }

  private apply(next: ConnectionsResponse): void {
    this.changes++;
    this.data = next;
    this.render();
    this.onChange?.(next);
    for (const f of this.onConnectionsChanged) f();
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
    const el = e.target as HTMLSelectElement | HTMLInputElement;
    const forEffort = el.getAttribute("data-effort") as ProviderId | null;
    if (forEffort) { this.apply(await api.selectEffort(forEffort, EFFORTS[Number(el.value)] ?? DEFAULT_EFFORT)); return; }
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

  /** The one card, drawn for this screen: what is in use, what is being checked, what went wrong here. */
  private card(p: ProviderView): string {
    return providerCard(p, {
      active: this.data.active === p.id,
      busy: this.busy.has(p.id),
      error: this.errors.get(p.id) ?? null,
      hint: this.hintOf(p.id),
      inGuide: false,
    });
  }

  /** A service as its card shows it, for the guide. */
  viewOf(id: ProviderId): ProviderView | undefined {
    return this.data.providers.find((p) => p.id === id);
  }
}
