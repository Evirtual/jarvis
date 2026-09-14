/**
 * Running the console by conversation.
 *
 * Everything you can click can also be said. An utterance is split into
 * clauses; a clause that is one of the console's own commands becomes an
 * action, and whatever is left is the question — asked once the actions
 * have run.
 *
 * The console's own commands are the few it must answer with nothing
 * connected, or at once: a yes or no to a confirmation, the voice and the
 * settings, the panels, opening, closing, restoring and deleting threads,
 * the whole board. Organising the board — grouping, moving, linking,
 * renaming, folding by name — is said to JARVIS, who does it with a
 * directive (shared/directives.ts: the one table of what he may do).
 *
 * Pure: no DOM. What it needs to know about the console comes in through
 * ParseContext, so the rules can be tested on their own.
 */

import { type Action, type PanelName, coreFrom, directiveToAction } from "../shared/directives.js";

export type { Action, ActionName, ConfigTab, PanelName } from "../shared/directives.js";
export { NEEDS_CONFIRMATION } from "../shared/directives.js";

/** What the parser needs to know about the console right now. */
export interface ParseContext {
  /** Is there a thread that answers to this name? */
  knowsThread(name: string): boolean;
  /** Is there a group that answers to this name? */
  knowsGroup(name: string): boolean;
  /** Is the console waiting for a destructive-action confirmation? */
  pendingApproval: boolean;
}

const NO_CONTEXT: ParseContext = { knowsThread: () => false, knowsGroup: () => false, pendingApproval: false };

const NEW_THREAD =
  /\b(?:new|another|fresh|separate|second|different)\s+(?:chat|thread|conversation|window|session|tab)\b|\b(?:create|start|open|make|begin|spin up)\s+(?:up\s+)?(?:a\s+)?(?:new\s+)?(?:one|chat|thread|conversation|window)\b|\bbranch(?:\s+(?:off|out))?\b|\bsub-?thread\b/;
const BRANCH = /\bbranch|\bsub-?thread\b|\b(?:based on|continu\w* (?:this|that|it)|carry (?:this|that) over|from (?:this|here|that))\b/;

/** One clause in, one console command out — or null: it is part of the question, or something for JARVIS. */
export function intentOf(clause: string, ctx: ParseContext = NO_CONTEXT): Action | null {
  const q = clause.toLowerCase().replace(/[?!.]+$/, "").trim();
  if (!q) return null;

  // Destructive-action questions. Only while one is actually waiting, so a
  // bare "yes" is never mistaken for anything else.
  if (ctx.pendingApproval) {
    if (/^(?:yes|yeah|yep|sure|approve(?:d)?|allow(?: it)?|go ahead|do it|proceed|ok(?:ay)?|fine)(?:,? (?:please|jarvis|sir))?$/.test(q)) return { name: "approve" };
    if (/^(?:no|nope|deny|denied|don'?t|reject|refuse|cancel that|not that)(?:,? (?:please|jarvis|sir|thanks))?$/.test(q)) return { name: "deny" };
  }

  // The service — local, so it works when the one in use has stopped answering.
  const core = /\b(?:switch|change|use|talk|go|move)\b(?:\s+\w+){0,3}?\s+(?:to|with|via|over to)?\s*(chatgpt|open ?ai|gpt|gemini|google)\b(?!\s+code)|\buse\s+(chatgpt|gemini)\b(?!\s+code)/.exec(q);
  if (core) {
    const p = coreFrom(core[1] ?? core[2] ?? "");
    if (p) return { name: "switch_core", provider: p };
  }
  const model = /\b(?:use|switch to|set)\s+(?:the\s+)?(?:model\s+)?((?:gpt|o\d|gemini)-[\w.-]+)/.exec(q);
  if (model?.[1]) return { name: "set_model", model: model[1] };

  // The first-run guide and Configuration — before the voice rules, so "open
  // voice settings" is never read as a voice called "settings".
  if (/\b(?:run|open|show|start|redo|repeat)\s+(?:me\s+)?(?:the\s+)?(?:setup|set-up|onboarding|first[- ]run)(?:\s+guide)?\b|\bshow me the guide\b|^(?:setup|setup guide|guide)$/.test(q)) return { name: "open_setup" };
  if (/\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?voice settings\b/.test(q)) return { name: "open_config", tab: "voice" };
  if (/\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?(?:access|permissions?)(?:\s+settings)?\b/.test(q)) return { name: "open_config", tab: "access" };
  if (/\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?(?:config|configuration|settings|connections|preferences)\b|^(?:config|settings)$/.test(q)) return { name: "open_config", tab: "connections" };
  if (/\bclose\s+(?:the\s+)?(?:config|configuration|settings|drawer)\b/.test(q)) return { name: "close_config" };

  // The voice — "use the Fable voice", "change the voice to Ash". Only as a
  // request for the change, so "which voice are you using?" stays a question.
  const vm = /\b(?:use|switch to|set|change(?: to)?|give me)\s+(?:the\s+)?(?!(?:the|your|my|a)\b)([a-z]+)(?:'s)?\s+voice\b|(?:\b(?:set|change|switch)\s+(?:the\s+|your\s+)?voice\s+(?:to\s+)?|^voice\s+to\s+)([a-z]+)\b/.exec(q);
  if (vm) {
    const nm = vm[1] ?? vm[2] ?? "";
    // words that follow "voice" without being a voice's name: "voice off", "voice settings"
    if (!/^(a|the|your|my|different|another|new|other|settings?|speed|options?|menu|off|on|output|replies|please)$/.test(nm)) return { name: "set_voice", voice: nm };
  }
  const addr = /\b(?:call|address|refer to)\s+me\s+(?:as\s+)?(sir|ma'?am|madam|miss)\b/.exec(q);
  if (addr?.[1]) return { name: "set_address", address: addr[1] === "sir" ? "sir" : "madam" };
  if (/\b(?:speak|talk)\s+(?:a (?:bit|little) )?(?:faster|quicker)\b|\bspeed (?:it )?up\b/.test(q)) return { name: "set_speed", delta: 0.1 };
  if (/\b(?:speak|talk)\s+(?:a (?:bit|little) )?slower\b|\bslow (?:it )?down\b/.test(q)) return { name: "set_speed", delta: -0.1 };
  if (/\b(?:unmute|voice on|speak again|talk to me again|turn (?:the )?(?:voice|sound) (?:back )?on)\b/.test(q)) return { name: "unmute" };
  if (/\b(?:mute|voice off|stop talking|be quiet|silence|turn (?:the )?(?:voice|sound) off)\b/.test(q)) return { name: "mute" };

  // The put-away threads only — making room, not clearing the board. Before
  // the Threads list ("put away threads") and the whole-board rule ("delete
  // all…"), so "delete all the put-away threads" means just those.
  if (/\b(?:clear|delete|remove|empty|bin|get rid of|throw away)\s+(?:out\s+)?(?:all\s+)?(?:of\s+)?(?:the\s+|my\s+)?(?:put[- ]away|archived)(?:\s+(?:threads?|chats?|conversations?|ones))?\b|\bempty\s+the\s+archive\b/.test(q)) return { name: "clear_archived" };

  // The Threads list — before the panels, so "show me the threads" isn't a panel.
  if (/\b(?:what|which|list|show)(?:\s+me)?\s+(?:all\s+)?(?:the\s+)?(?:threads|chats|conversations|windows|groups)\b|\bhow many (?:threads|chats)\b|\b(?:archived|put away) (?:threads|chats)\b/.test(q)) return { name: "list_threads" };

  // The instrument panels — "show me the radar", "close the weather", "hide everything".
  const PANEL_WORDS: [RegExp, PanelName][] = [
    [/\b(?:perimeter|radar|network map|lan|devices)\b/, "perimeter"],
    [/\b(?:environment|weather|sky|forecast)\b/, "environment"],
    [/\b(?:compute|cpu|processor|cores?|memory|ram)\b/, "compute"],
    [/\b(?:graphics|gpu|video card|vram)\b/, "graphics"],
    [/\b(?:storage|disks?|drives?)\b/, "storage"],
    [/\b(?:uplink|wi-?fi|network|internet|connection)\b/, "uplink"],
  ];
  if ((/\b(?:close|hide|dismiss|put away|clear)\s+(?:all|every|the)?\s*(?:panels?|overlays?|everything)\b/.test(q) ||
       /\bput\s+(?:all\s+)?(?:the\s+)?(?:panels?|overlays?)\s+away\b/.test(q)) && !/\b(?:thread|chat|group)\b/.test(q)) {
    return { name: "hide_panel", panel: "all" };
  }
  const showP = /\b(?:show|open|display|bring up|pull up|let me see|give me)\b/.test(q);
  const hideP = /\b(?:close|hide|dismiss|put away)\b/.test(q);
  if ((showP || hideP) && /\b(?:panel|stats|readings?|map|radar|weather|compute|graphics|gpu|cpu|storage|disks?|uplink|environment|perimeter)\b/.test(q)) {
    const hit = PANEL_WORDS.find(([rx]) => rx.test(q));
    if (hit) return hideP && !showP ? { name: "hide_panel", panel: hit[1] } : { name: "show_panel", panel: hit[1] };
  }

  // The network — only ever on request.
  if (/^(?:scan|sweep)$|\b(?:scan|sweep)\s+(?:the\s+|my\s+)?(?:network|perimeter|lan|wifi)\b/.test(q)) return { name: "sweep" };

  // Deleting a group is for good, so it is the console's own word, never the model's.
  const dg = /\b(?:delete|remove|get rid of|bin|scrap)\s+(?:the\s+)?(.+?)\s+(?:group|bubble)$/.exec(q);
  if (dg?.[1] && ctx.knowsGroup(dg[1])) return { name: "delete_group", group: dg[1] };

  // Tidying: "tidy up", "arrange the windows", "clean up the board" — nothing is removed.
  if (/^(?:please\s+)?(?:tidy|arrange|rearrange|organi[sz]e|sort out|clean up|neaten)(?:\s+up)?(?:\s+(?:the|my|all(?:\s+the)?))?(?:\s+(?:board|screen|desk|windows?|threads?|layout|everything|mess))?(?:,?\s+(?:please|jarvis))?$/.test(q)) return { name: "tidy_board" };

  // The whole board — clearing it out, or putting it all away.
  if (/\b(?:delete|wipe|erase|clear|remove|get rid of|bin)\s+(?:all|every|everything|the whole)\b(?:\s+\w+){0,2}?\s*(?:threads?|chats?|conversations?|groups?|bubbles?|board|screen|everything)?\b/.test(q)
      && /\b(?:all|every|everything|whole)\b/.test(q) && !/\bpanels?\b/.test(q)) {
    return /\b(?:put|close|archive|tuck)\b/.test(q) ? { name: "archive_all" } : { name: "delete_all" };
  }
  if (/\b(?:close|put away|archive)\s+(?:all|every|everything)\b(?:\s+(?:the\s+)?(?:threads?|chats?|conversations?))?\b/.test(q) && !/\bpanels?\b/.test(q)) return { name: "archive_all" };
  // "put all away", "put all the threads away", "put everything away" — the Threads list's own words
  if (/\bput\s+(?:all|every(?:thing)?)\s+(?:(?:of\s+)?(?:the\s+)?(?:threads?|chats?|conversations?)\s+)?away\b/.test(q) && !/\bpanels?\b/.test(q)) return { name: "archive_all" };
  if (/\b(?:start|begin)\s+(?:again|fresh|over|from scratch)\b|\bclean slate\b|\bempty the board\b/.test(q)) return { name: "delete_all" };

  // This thread: deleting for good, putting away, folding, clearing.
  if (/\b(?:delete|erase|destroy)\s+(?:this|the|that|current)?\s*(?:thread|chat|conversation|window)\s+(?:permanently|for good|forever)\b|\bpermanently delete\b/.test(q)) return { name: "delete_thread" };
  if (/\b(?:close|delete|remove|kill|get rid of|bin|archive|put away)\s+(?:this|the|that|current)?\s*(?:thread|chat|conversation|window)\b/.test(q)) return { name: "archive_thread" };
  const fold = /^(minimi[sz]e|fold|shrink|open up|unfold|maximi[sz]e|expand|open)\s+(?:this|the|that|current|it)(?:\s+(?:thread|chat|window|conversation|one))?$/.exec(q);
  if (fold?.[1]) return { name: "fold_thread", open: /^(?:open up|unfold|maximi[sz]e|expand|open)$/.test(fold[1]) };
  if (/^(?:clear|wipe)(?:\s+(?:this|the))?(?:\s+(?:thread|chat|window|conversation))?$/.test(q)) return { name: "clear_thread" };

  // The one put away most recently: "restore the last one", "open the thread I just closed", "undo that close".
  if (/\b(?:restore|reopen|bring back|unarchive|recover)\s+(?:the\s+|my\s+)?(?:last|latest|previous|most recent)\b/.test(q) ||
      (/\b(?:open|restore|reopen|bring back|get back|recover|unarchive)\b/.test(q) && /\b(?:one|thread|chat|conversation|window)\s+(?:that\s+|which\s+)?(?:i|you|we)\s+(?:just\s+|last\s+|recently\s+)?(?:closed|put away|archived|hid|dismissed)\b/.test(q)) ||
      /^(?:restore|undo\s+(?:that\s+|the\s+|last\s+)?(?:close|closing|put away|archive|archiving))$/.test(q)) {
    return { name: "restore_thread", title: "", last: true };
  }
  const rs = /\b(?:restore|reopen|bring back|unarchive)\s+(?:the\s+)?(.+?)(?:\s+(?:thread|chat|conversation))?$/.exec(q);
  if (rs?.[1]) return { name: "restore_thread", title: orig(clause, q, rs[1]) };

  // Going to a thread by name — only one that exists; anything else is a
  // question. ("move" is JARVIS's word: "move Travel into Trips".)
  const sw = /\b(?:switch|go|jump|get|focus|select)\s+(?:(?:back\s+)?to\s+)?(?:the\s+)?(.+?)(?:\s+(?:thread|chat|window|conversation))?$/.exec(q);
  if (sw?.[1] && ctx.knowsThread(sw[1])) return { name: "switch_thread", title: sw[1] };

  // A new thread — named, plain, or branched off the one in front.
  const namedThread = /^\s*(?:please\s+)?(?:new|another|fresh|separate|second|different|create|start|open|make|begin)\s+(?:up\s+)?(?:a\s+)?(?:new\s+)?(?:chat|thread|conversation|window|session|tab)\s+(?:called|named)\s+["“]?(.+?)["”]?\s*$/i.exec(clause);
  if (namedThread?.[1]) return { name: "new_thread", branch: false, title: namedThread[1].trim() };
  if (NEW_THREAD.test(q)) return { name: "new_thread", branch: BRANCH.test(q) };

  return null;
}

/** A name as it was written, capitals and all, found again in the lowercased clause. */
function orig(clause: string, q: string, s: string): string {
  const raw = clause.trim().replace(/[?!.]+$/, "").trim();
  const at = q.lastIndexOf(s);
  return (at < 0 ? s : raw.slice(at, at + s.length)).replace(/["”]$/, "");
}

/** Leftover words that are about the window juggling, not the question. */
const NOISE = /\b(?:chat|thread|conversation|window|tab|general)\b|\b(?:new|this|that|other|the)\s+one\b/g;
const FILLER = /^(?:ok(?:ay)?|so|right|alright|well|please|jarvis|sir|now|and|then|also|hey)\b[,\s]*/i;

export interface Parsed { actions: Action[]; ask: string }

/** Split an utterance into console actions and the question that remains. */
export function parseUtterance(text: string, ctx: ParseContext = NO_CONTEXT): Parsed {
  const parts = text.split(/((?<=[.!?])\s+|[,;]\s*|\s+(?:and then|and also|and|then|also)\s+)/i);
  const actions: Action[] = [];
  let ask = "";
  let lastWasAsk = false;
  for (let i = 0; i < parts.length; i += 2) {
    const clause = (parts[i] ?? "").trim();
    const sep = parts[i - 1] ?? " ";
    if (!clause) continue;
    const act = intentOf(clause, ctx);
    if (act) {
      actions.push(act);
      lastWasAsk = false;
      continue;
    }
    let c = clause;
    while (FILLER.test(c)) c = c.replace(FILLER, "");
    // Only discard a fragment when it is entirely interface filler. A normal
    // note can mention a thread, chat, or window — especially research and QA
    // notes — and must reach the active conversation unchanged.
    const meaningful = c.toLowerCase().replace(NOISE, " ").replace(/\s+/g, " ").trim();
    if (!meaningful && !/\?$/.test(c)) { lastWasAsk = false; continue; }
    ask += (ask && lastWasAsk ? sep : ask ? ". " : "") + c;
    lastWasAsk = true;
  }
  // People restate themselves: "start a new chat… create a new one" is one
  // new window, not two. Keep the first of each action, merging a branch request.
  const seen = new Map<string, Action>();
  for (const a of actions) {
    const prev = seen.get(a.name);
    if (!prev) seen.set(a.name, a);
    else if (a.name === "new_thread" && prev.name === "new_thread" && a.branch) prev.branch = true;
  }
  // What's left once the commands are taken out is only a question if it has
  // words in it: a stray "." or "?" is not something to send, or to name a thread after.
  return { actions: [...seen.values()], ask: /[\p{L}\p{N}]/u.test(ask) ? ask.trim() : "" };
}

/* ===================================================================== *
 * What the reasoning core writes
 * ===================================================================== */

const DIRECTIVE = /\[\[do:\s*([a-z_]+)((?:\s+[a-z_]+\s*=\s*"[^"]*")*)\s*\]\]/gi;
const MAX_DIRECTIVES = 8;

/**
 * Pull `[[do: …]]` directives out of a reply; return the clean text and the
 * actions. Anything not in the table — deleting, approving, anything
 * unknown — is dropped, not guessed at.
 */
export function extractDirectives(reply: string): { text: string; actions: Action[] } {
  const actions: Action[] = [];
  const text = reply.replace(DIRECTIVE, (_m, name: string, argStr: string) => {
    const args: Record<string, string> = {};
    for (const m of argStr.matchAll(/([a-z_]+)\s*=\s*"([^"]*)"/gi)) args[m[1]!.toLowerCase()] = m[2]!.trim();
    const act = directiveToAction(name, args);
    if (act && actions.length < MAX_DIRECTIVES) actions.push(act);
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), actions };
}
