/**
 * Carrying out what was asked — by you, or by the reasoning core's directives.
 */

import type { ProviderId } from "../shared/types.js";
import type { NeuralVoice } from "./voice.js";
import { PROVIDERS } from "../shared/services/index.js";
import { api } from "./api.js";
import { NEEDS_CONFIRMATION, type Action, type ParseContext } from "./commands.js";
import { type Thread } from "./stage.js";
import { editDistance } from "./text.js";
import { GENERAL_ID, threadRef, type Group } from "./workspace.js";
import { conn, graph, panels, voice, ws } from "./state.js";
import { notice } from "./say.js";
import { answerConfirm, confirmFirst, deleteGroup, deleteThread, lostWords, pendingConfirm } from "./confirm.js";
import { bringBack, paintThread, putAway } from "./threads.js";
import { refreshLinks } from "./board-links.js";
import { enqueue } from "./ask.js";
import { sweep } from "./readings.js";
import { mode } from "./layout.js";
import { applyAddress, setRate, setVoiceOut } from "./voice-ui.js";
import { setDrawer } from "./drawer.js";
import { openSetup } from "./setup.js";

/* ===================================================================== *
 * Carrying out actions
 *
 * Shared by typed/spoken commands and by the reasoning core's directives.
 * Every action is checked against the board first: a name that fits two
 * threads gets a question back rather than a guess, and anything that destroys
 * something waits for the user to confirm.
 * ===================================================================== */

function coreLabel(p: ProviderId): string {
  return PROVIDERS[p].name;
}

function findVoice(name: string): NeuralVoice | null {
  const n = name.toLowerCase();
  const all = voice.neuralVoices();
  return (
    all.find((v) => v.voice.name.toLowerCase() === n) ??
    // Spoken names come back spelled however the transcriber guesses —
    // "Louis" for Lewis — so match by closeness, not equality.
    all
      .map((v) => ({ v, d: editDistance(v.voice.name.toLowerCase(), n) }))
      .filter((x) => x.d <= 2 && x.d <= Math.ceil(x.v.voice.name.length * 0.4))
      .sort((a, b) => a.d - b.d)[0]?.v ??
    null
  );
}

/** A thread by name — or the words to say when that isn't possible. */
export function resolve(name: string, opts: { archived?: boolean } = {}): Thread | string {
  const m = ws.findThread(name, opts);
  if (m.kind === "one") return m.thread;
  if (m.kind === "many") {
    const names = m.threads.slice(0, 4).map((t) => `“${t.title} #${threadRef(t)}”`);
    return `Which one, sir — ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}? Say its # reference.`;
  }
  return `I've no ${opts.archived ? "put-away " : ""}thread called “${name}”, sir.`;
}

export function parseCtx(): ParseContext {
  return {
  knowsThread: (n) => ws.findThread(n).kind !== "none",
  knowsGroup: (n) => !!ws.findGroup(n),
  pendingApproval: !!pendingConfirm,
  };
}

/**
 * Carry out one action. Returns what to tell the user, or null if the action
 * speaks for itself. `fromModel` marks directives written by the reasoning core.
 */
export async function runAction(a: Action, fromModel = false): Promise<string | null> {
  if (fromModel && NEEDS_CONFIRMATION.has(a.name) && a.name !== "clear_thread") return null;
  // "This thread" is the one in front; with none in front, it has to be named.
  const noFront = (): string => ws.live.length ? "There's no thread in front, sir — name it, or tap one." : "There's nothing on the board, sir.";
  switch (a.name) {
    case "new_thread": {
      let parent: Thread | undefined;
      if (a.parentId) parent = ws.thread(a.parentId);
      else if (a.parent) {
        const r = resolve(a.parent);
        if (typeof r === "string") return r;
        parent = r;
      } else if (a.branch) parent = graph.active ?? undefined;
      const groupId = !parent && a.group ? ws.ensureGroup(a.group, fromModel ? "jarvis" : "user").id : undefined;
      const t = ws.createThread({ ...(a.title ? { title: a.title } : {}), ...(parent ? { parentId: parent.id } : {}), ...(groupId ? { groupId } : {}) });
      graph.commit();
      paintThread();
      // Its question is answered in its own window, in turn with any others.
      if (a.ask) enqueue(a.ask, t.id, true);
      const where = ws.groupOf(t).id !== GENERAL_ID ? ` in ${ws.groupOf(t).title}` : "";
      return parent ? `Subthread “${t.title}” under “${parent.title}”, sir.` : `Opened “${t.title}”${where}, sir.`;
    }
    case "link_threads": {
      const A = resolve(a.a), B = resolve(a.b);
      if (typeof A === "string") return A;
      if (typeof B === "string") return B;
      if (A.id === B.id) return "That's the same thread, sir.";
      const r = ws.tie(A.id, B.id, a.why ?? "related");
      graph.commit();
      refreshLinks();
      return r.group
        ? `Connected “${A.title}” with “${B.title}” — they're together in ${r.group.title} now, sir.`
        : `Connected “${A.title}” with “${B.title}” across their groups, sir. The link shows when either is in front.`;
    }
    case "archive_thread": {
      let t = graph.active;
      if (a.title) {
        const r = resolve(a.title);
        if (typeof r === "string") return r;
        t = r;
      }
      if (!t) return noFront();
      return putAway(t);
    }
    case "restore_thread": {
      const r = a.last ? (ws.archived[0] ?? "Nothing is put away, sir.") : resolve(a.title, { archived: true });
      if (typeof r === "string") return r;
      return bringBack(r);
    }
    case "delete_thread": {
      let t = graph.active;
      if (a.title) {
        const r = resolve(a.title);
        if (typeof r === "string") return r;
        t = r;
      }
      if (!t) return noFront();
      return deleteThread(t);
    }
    case "switch_thread": {
      const r = resolve(a.title);
      if (typeof r === "string") return r;
      graph.focus(r.id);
      paintThread();
      return `Back to “${r.title}”, sir.`;
    }
    case "rename_thread": {
      let t = graph.active;
      if (a.target) {
        const r = resolve(a.target);
        if (typeof r === "string") return r;
        t = r;
      }
      if (!t) return noFront();
      ws.rename(t.id, a.title);
      graph.commit();
      return `Renamed to “${t.title}”, sir.`;
    }
    case "clear_thread": {
      const t = graph.active;
      if (!t) return noFront();
      if (!t.turns.length) return "It's already empty, sir.";
      return confirmFirst(
        `Clear ${t.turns.length === 1 ? "the one message" : `all ${t.turns.length} messages`} in “${t.title}”? The thread stays; its history goes.`,
        "Clear it",
        () => { ws.clear(t.id); graph.redraw(t.id); graph.commit(); paintThread(); return "Cleared, sir."; },
      );
    }
    case "fold_thread": {
      let t: Thread | undefined = graph.active;
      if (a.title) {
        const r = resolve(a.title);
        if (typeof r === "string") return r;
        t = r;
      }
      if (!t) return noFront();
      ws.setOpen(t.id, a.open);
      graph.commit();
      // Opening one by name brings it to the front, as clicking it would.
      if (a.open) { graph.focus(t.id); graph.reveal(t.id); }
      return a.open ? `“${t.title}” is open, sir.` : `Folded “${t.title}” away, sir — its title bar is still there.`;
    }
    case "set_address":
      applyAddress(a.address);
      return "Very good, sir.";
    case "list_threads": {
      panels.show("threads");
      const groups = ws.visibleGroups.map((g) => `${g.title} (${ws.treeOrder(g.id).length})`);
      const away = ws.archived.length;
      return `${ws.live.length} thread${ws.live.length === 1 ? "" : "s"} in ${groups.length} group${groups.length === 1 ? "" : "s"}, sir: ${groups.join(", ")}${away ? `. ${away} put away` : ""}.`;
    }
    case "new_group": {
      const g = ws.ensureGroup(a.title, fromModel ? "jarvis" : "user");
      const moved: string[] = [];
      const missing: string[] = [];
      for (const n of a.threads ?? []) {
        const r = resolve(n);
        if (typeof r === "string") { missing.push(n); continue; }
        ws.moveThread(r.id, g.id);
        moved.push(r.title);
      }
      if (!moved.length && !ws.live.some((t) => t.groupId === g.id)) ws.createThread({ title: a.title, groupId: g.id });
      graph.commit();
      paintThread();
      return `${g.title} is ready${moved.length ? ` with ${moved.map((m) => `“${m}”`).join(", ")}` : ""}, sir.${missing.length ? ` I couldn't place ${missing.join(", ")}.` : ""}`;
    }
    case "move_thread": {
      const r = resolve(a.thread);
      if (typeof r === "string") return r;
      const g = ws.findGroup(a.group) ?? ws.ensureGroup(a.group, fromModel ? "jarvis" : "user");
      if (r.groupId === g.id) return `“${r.title}” is already in ${g.title}, sir.`;
      ws.moveThread(r.id, g.id);
      graph.commit();
      paintThread();
      return `Moved “${r.title}” into ${g.title}, sir.`;
    }
    case "rename_group": {
      const g = ws.findGroup(a.group);
      if (!g) return `I've no group called “${a.group}”, sir.`;
      ws.renameGroup(g.id, a.title);
      graph.commit();
      return `The group is now ${g.title}, sir.`;
    }
    case "delete_group": {
      const g = ws.findGroup(a.group);
      if (!g) return `I've no group called “${a.group}”, sir.`;
      return deleteGroup(g);
    }
    case "tidy_board": {
      if (!ws.live.length) return "There's nothing on the board to tidy, sir.";
      if (mode === "compact") return "On a phone the threads are already a list, sir — drag one by its title bar to move it.";
      graph.tidy();
      return "Tidied up, sir — everything folded and in its place. Open any thread from its title bar.";
    }
    case "archive_all": {
      const n = ws.live.length;
      if (!n) return "The board is already clear, sir.";
      for (const t of [...ws.live]) if (!t.parentId) ws.archive(t.id);
      for (const t of [...ws.live]) ws.archive(t.id); // any left by a vanished parent
      graph.commit();
      paintThread();
      return n === 1 ? "Put the thread away, sir. It's in the Threads list." : `Put all ${n} threads away, sir. They're in the Threads list.`;
    }
    case "delete_all": {
      const live = ws.live.length, away = ws.archived.length;
      if (!live && !away) return "There's nothing to delete, sir.";
      const what = [live ? `${live} thread${live === 1 ? "" : "s"} on the board` : "", away ? `${away} put away` : ""].filter(Boolean).join(" and ");
      return confirmFirst(
        `Delete everything — ${what}? Nothing can be restored afterwards.`,
        "Delete everything",
        () => {
          ws.wipe();
          graph.commit();
          paintThread();
          return "The board is empty, sir. A clean start.";
        },
      );
    }
    case "title_thread":
      return null; // applied by ask.ts, together with the exchange it is about
    case "clear_archived": {
      const away = ws.archived;
      if (!away.length) return "Nothing is put away, sir — there's nothing to clear.";
      const messages = away.reduce((n, t) => n + t.turns.length, 0);
      const one = away.length === 1;
      return confirmFirst(
        `Delete ${one ? `the put-away thread “${away[0]!.title}”` : `the ${away.length} put-away threads`}? ${lostWords(messages)}`,
        one ? "Delete it" : "Delete them",
        () => {
          for (const t of [...ws.archived]) ws.remove(t.id);
          graph.commit();
          paintThread();
          return `${one ? "The put-away thread is" : `All ${away.length} put-away threads are`} gone, sir. What's on the board is untouched.`;
        },
      );
    }
    case "collapse_group":
    case "expand_group": {
      const fold = a.name === "collapse_group";
      const targets: Group[] = a.group === "all" ? ws.visibleGroups : [ws.findGroup(a.group)].filter((g): g is Group => !!g);
      if (!targets.length) return `I've no group called “${a.group}”, sir.`;
      const hereGroup = graph.active?.groupId;
      for (const g of targets) if (!fold || g.id !== hereGroup || a.group !== "all") ws.setCollapsed(g.id, fold);
      // Folding the group you're in moves you only to a thread in the open — never
      // into a folded group, which focusing would open (as on the board: stage.setFolded).
      if (fold && targets.some((g) => g.id === hereGroup) && a.group !== "all") {
        const open = new Set(ws.visibleGroups.filter((g) => g.id === GENERAL_ID || !g.collapsed).map((g) => g.id));
        const elsewhere = ws.live.filter((t) => !targets.some((g) => g.id === t.groupId) && open.has(t.groupId)).sort((x, y) => y.createdAt - x.createdAt)[0];
        if (elsewhere) ws.focus(elsewhere.id);
      }
      graph.commit();
      paintThread();
      return null;
    }

    case "approve": {
      if (pendingConfirm) return answerConfirm(true);
      return "Nothing is waiting for an answer, sir.";
    }
    case "deny": {
      if (pendingConfirm) return answerConfirm(false);
      return "Nothing is waiting for an answer, sir.";
    }

    case "switch_core": {
      try {
        await api.setActive(a.provider);
        await conn.refresh();
        return `Switched to ${conn.activeName()}, sir.`;
      } catch {
        setDrawer(true, "connections");
        return `${coreLabel(a.provider)} isn't connected yet, sir. I've opened Connections — paste its key there, or paste it here and I'll store it.`;
      }
    }
    case "set_model": {
      const id = conn.active;
      if (!id) return "No service is connected to set a model on, sir.";
      try {
        await api.selectModel(id, a.model);
        await conn.refresh();
        return `${conn.activeName()} will use ${a.model} from now on, sir.`;
      } catch {
        return `I couldn't select ${a.model}, sir.`;
      }
    }
    case "set_voice": {
      const v = findVoice(a.voice);
      if (!v) return `I've no voice called ${a.voice}, sir. I have ${voice.neuralVoices().map((x) => x.voice.name).slice(0, 6).join(", ")}.`;
      voice.select(`${v.via}:${v.voice.id}`);
      return `Voice set to ${v.voice.name}, sir.`;
    }
    case "set_speed": {
      const next = setRate(a.value ?? voice.rateValue + (a.delta ?? 0));
      return next > 1 ? "A little brisker, sir." : "Taking my time, sir.";
    }
    case "mute":
      setVoiceOut(false);
      return "Muted, sir. I'll stay in text.";
    case "unmute":
      setVoiceOut(true);
      return "Audio restored, sir.";

    case "open_config":
      setDrawer(true, a.tab ?? "connections");
      void conn.refresh();
      return null;
    case "close_config":
      setDrawer(false);
      return null;
    case "open_setup":
      setDrawer(false);
      openSetup();
      return null;

    case "sweep":
      panels.show("perimeter");
      sweep();
      return null;
    case "show_panel":
      panels.show(a.panel);
      return null;
    case "hide_panel":
      if (a.panel === "all") panels.hideAll();
      else panels.hide(a.panel);
      return null;
  }
}

/* ---- API keys typed into the chat never reach a model ---- */

export const KEY_PATTERNS: [ProviderId, RegExp][] = [
  ["gemini", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["openai", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
];

/** If the text contains an API key, store it locally and keep it out of the conversation. */
export async function interceptKey(text: string): Promise<boolean> {
  for (const [id, rx] of KEY_PATTERNS) {
    const m = rx.exec(text);
    if (!m) continue;
    notice(`${coreLabel(id)} key received — checking it. It stays on this machine and is not sent to any model.`);
    try {
      await api.saveKey(id, m[0]);
      await conn.refresh();
      await api.setActive(id).catch(() => undefined);
      await conn.refresh();
      notice(`${coreLabel(id)} is connected and in use, sir.`);
    } catch (err) {
      notice(`That key didn't work, sir: ${err instanceof Error ? err.message : String(err)}`);
    }
    return true;
  }
  return false;
}
