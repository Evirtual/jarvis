/**
 * What JARVIS needs: a card on the board, drawn like a thread, that says what
 * is still missing — a service, the microphone, location, sound — what each
 * costs you while it is missing, and the way to set it. Every check shows the
 * real state, never a tick you gave it. It appears when the guide is closed
 * with something left undone, goes by itself once everything is set (or
 * marked not needed), and comes back only when the service goes missing, or
 * when asked: "what's missing".
 *
 * It lives in the workspace as a thread of kind "setup", so it sits, folds,
 * moves and scrolls like any window; the rest of the console leaves it out —
 * the model never sees it, and it counts as no thread.
 */

import { $, esc, recall, store } from "./dom.js";
import { line } from "./message.js";
import { conn, graph, voice, ws } from "./state.js";
import { setDrawer } from "./drawer.js";
import { needs, needsChange, paintNeeds, permissionWatchers, setSetupClosed } from "./setup.js";
import { announce } from "./say.js";
import { paintThread } from "./threads.js";
import { type Thread } from "./workspace.js";

export const READINESS_TITLE = "What J.A.R.V.I.S. needs";
const SKIP = "jarvis.readinessSkip";
const SEEN_READY = "jarvis.readinessSeenReady";
type Optional = "mic" | "geo" | "sound";

const skipped = (): Set<Optional> => new Set((recall(SKIP) ?? "").split(",").filter(Boolean) as Optional[]);

/** The card on the board, if there is one. */
function card(): Thread | undefined {
  return ws.live.find((t) => t.kind === "setup");
}

/** The card, made or brought back if need be, and in front. */
function ensure(): Thread {
  let t = card() ?? ws.all.find((c) => c.kind === "setup");
  if (t?.archivedAt) ws.restore(t.id);
  if (!t) {
    t = ws.createThread({ title: READINESS_TITLE });
    t.kind = "setup";
    t.named = true;
  }
  if (!ws.isOpen(t)) ws.setOpen(t.id, true);
  graph.commit();
  paintThread();
  return t;
}

/** The rows, from what the browser and the connections say right now. */
function paint(body: HTMLElement): void {
  const skip = skipped();
  const ready = conn.anyReady;
  body.replaceChildren(line("sys", ready
    ? "Nearly there. What is switched on is done; the rest has a way in, or can be marked not needed. All of it is also in Config → Connections and Access."
    : "J.A.R.V.I.S. is limited until these are set: without a service there are no answers, no hearing and no AI voice. What is switched on is done; the rest has a way in. All of it is also in Config → Connections and Access."));
  const box = document.createElement("div");
  box.className = "ready";
  box.innerHTML =
    `<label class="switch-row need" data-need="service"><span><b>A service</b><small>${ready
      ? `Connected: ${esc(conn.readyNames().join(", "))}. Answers, hearing and the AI voice come through it.`
      : "Gemini is free and takes a minute; ChatGPT needs a key with credit. Answers, hearing and the AI voice come through it."}</small></span>` +
    (ready ? `<input type="checkbox" class="switch" disabled checked aria-label="A service">` : `<button type="button" class="btn sm" data-ready="connect">Connect</button>`) +
    `</label>` +
    needs();
  body.append(box);
  // a "not needed" for each optional row not yet granted, and the word on those already marked so
  for (const key of ["mic", "geo", "sound"] as Optional[]) {
    const row = box.querySelector<HTMLElement>(`.need[data-need="${key}"]`);
    const text = row?.querySelector("span");
    if (!row || !text) continue;
    if (skip.has(key)) {
      row.classList.add("skipped");
      const note = document.createElement("small");
      note.textContent = key === "sound" ? "Not needed — the greeting is written instead of spoken." : "Not needed — you can still allow it in Config → Access.";
      text.append(note);
    } else {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn sm ghost";
      b.dataset.ready = "skip";
      b.dataset.key = key;
      b.textContent = "Not needed";
      text.append(b);
    }
  }
  void paintNeeds(box).then(() => {
    // a row already on needs no "not needed"
    for (const row of box.querySelectorAll<HTMLElement>(".switch-row.need")) {
      if (row.querySelector<HTMLInputElement>("input")?.checked) row.querySelector('[data-ready="skip"]')?.remove();
    }
    checkDone(box);
  });
}

/** Everything set — or marked not needed — and the card goes by itself. */
function checkDone(box: HTMLElement): void {
  const t = card();
  if (!t || !conn.anyReady) return;
  const skip = skipped();
  const on = (key: Optional): boolean => {
    if (skip.has(key)) return true;
    return !!box.querySelector<HTMLInputElement>(`.need[data-need="${key}"] input`)?.checked;
  };
  if (!on("mic") || !on("geo") || !on("sound")) return;
  ws.remove(t.id);
  graph.commit();
  paintThread();
  announce("Everything's set, sir — the card has gone.");
}

/** Draw the card's rows again from the current state, where it is open. */
function refresh(): void {
  const t = card();
  if (!t) return;
  graph.redraw(t.id);
  graph.renderAll();
}

export const readiness = {
  card,
  ensure,
  /** Bring the card in front, said or asked for. */
  show(): void {
    const t = ensure();
    graph.focus(t.id);
  },
  /** What the card lists as missing, in words — the same four things, from the same sources — for "what's missing". */
  async missing(): Promise<string[]> {
    const out: string[] = [];
    if (!conn.anyReady) out.push("a service");
    const skip = skipped();
    const granted = async (name: PermissionName): Promise<boolean> => {
      try { return (await navigator.permissions.query({ name })).state === "granted"; } catch { return false; }
    };
    if (!skip.has("mic") && !(await granted("microphone" as PermissionName))) out.push("the microphone");
    if (!skip.has("geo") && !(await granted("geolocation" as PermissionName))) out.push("location");
    const soundOn = matchMedia("(display-mode: standalone)").matches || voice.soundOnOpen === "yes" || (navigator.userActivation?.hasBeenActive ?? false) || voice.acted;
    if (!skip.has("sound") && !soundOn) out.push("sound on opening");
    return out;
  },
};

/* ---------------- wiring ---------------- */

// The stage draws this kind of window with the rows instead of messages.
graph.bodyPainter = (t, body): void => { if (t.kind === "setup") paint(body); };

// The rows answer: a switch asks the browser, Connect opens Connections, Not needed is remembered.
const layer = $("windows");
layer.addEventListener("change", (e) => {
  const target = e.target as HTMLElement;
  const body = target.closest<HTMLElement>('.chatwin[data-kind="setup"] .cw-body');
  if (!body) return;
  needsChange(target, body);
  window.setTimeout(refresh, 600); // the browser's answer takes a moment; the rows follow it (and permissionWatchers)
});
layer.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const b = target.closest<HTMLElement>("[data-ready]");
  if (!b || !b.closest('.chatwin[data-kind="setup"]')) return;
  e.preventDefault(); // inside a label: a plain click would flip its switch
  if (b.dataset.ready === "connect") setDrawer(true, "connections");
  else if (b.dataset.ready === "skip" && b.dataset.key) {
    const skip = skipped();
    skip.add(b.dataset.key as Optional);
    store(SKIP, [...skip].join(","));
    refresh();
  }
});
permissionWatchers.push(refresh);

// Closing the guide with something left undone leaves the card behind.
setSetupClosed(() => { if (!conn.anyReady || card()) { ensure(); refresh(); } else ensure(); });

// A service connected: the card follows; gone again after it was once there: the card comes back.
conn.onConnectionsChanged.push(() => {
  if (conn.anyReady) store(SEEN_READY, "1");
  else if (recall(SEEN_READY) === "1" && !card()) { ensure(); }
  refresh();
});
