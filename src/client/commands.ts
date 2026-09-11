/**
 * Running the console by conversation.
 *
 * Everything you can click can also be said. An utterance is split into
 * clauses; clauses that are instructions to the console ("open a new chat",
 * "use the Lewis voice") become actions, and whatever is left is the actual
 * question — asked in whichever window is in front once the actions have run.
 *
 * The reasoning core can operate the same actions by writing directives —
 * `[[do: new_thread title="…" ask="…"]]` — but only from a whitelist: it can
 * never delete a thread or paste keys.
 *
 * Pure: no DOM. What it needs to know about the console comes in through
 * ParseContext, so the rules can be tested on their own.
 */

import { PANEL_NAMES, type PanelName } from "./panels.js";

export type ProviderWord = "openrouter" | "openai" | "anthropic" | "gemini";
export type ConfigTab = "connections" | "voice" | "quick";

export type Action =
  | { name: "new_thread"; branch?: boolean; title?: string; ask?: string; parent?: string; parentId?: string; group?: string }
  | { name: "link_threads"; a: string; b: string; why?: string }
  | { name: "archive_thread"; title?: string }
  | { name: "restore_thread"; title: string }
  | { name: "delete_thread"; title?: string }
  | { name: "switch_thread"; title: string }
  | { name: "rename_thread"; title: string; target?: string }
  | { name: "clear_thread" }
  | { name: "fold_thread"; title?: string; open: boolean }
  | { name: "list_threads" }
  | { name: "new_group"; title: string; threads?: string[] }
  | { name: "move_thread"; thread: string; group: string }
  | { name: "rename_group"; group: string; title: string }
  | { name: "delete_group"; group: string }
  | { name: "archive_all" }
  | { name: "tidy_board" }
  | { name: "delete_all" }
  | { name: "collapse_group"; group: string }
  | { name: "expand_group"; group: string }
  | { name: "approve" }
  | { name: "deny" }
  | { name: "switch_core"; provider: ProviderWord }
  | { name: "set_model"; model: string }
  | { name: "set_voice"; voice: string }
  | { name: "set_speed"; delta?: number; value?: number }
  | { name: "set_address"; address: "sir" | "madam" }
  | { name: "mute" }
  | { name: "unmute" }
  | { name: "open_config"; tab?: ConfigTab }
  | { name: "close_config" }
  | { name: "sweep" }
  | { name: "show_panel"; panel: PanelName }
  | { name: "hide_panel"; panel: PanelName | "all" };

export type ActionName = Action["name"];

/** What the parser needs to know about the console right now. */
export interface ParseContext {
  /** Is there a thread that answers to this name? */
  knowsThread(name: string): boolean;
  /** Is there a group that answers to this name? */
  knowsGroup(name: string): boolean;
  /** Is the console waiting for a destructive-action confirmation? */
  pendingApproval: boolean;
}

export const NO_CONTEXT: ParseContext = { knowsThread: () => false, knowsGroup: () => false, pendingApproval: false };

const CORE_NAMES: Record<string, ProviderWord> = {
  chatgpt: "openai", "open ai": "openai", openai: "openai", gpt: "openai",
  claude: "anthropic", anthropic: "anthropic",
  gemini: "gemini", google: "gemini",
  openrouter: "openrouter", "open router": "openrouter",
};

export function coreFrom(word: string): ProviderWord | null {
  const k = word.toLowerCase().replace(/\s+/g, " ").trim();
  return CORE_NAMES[k] ?? null;
}

const NEW_THREAD =
  /\b(?:new|another|fresh|separate|second|different)\s+(?:chat|thread|conversation|window|session|tab)\b|\b(?:create|start|open|make|begin|spin up)\s+(?:up\s+)?(?:a\s+)?(?:new\s+)?(?:one|chat|thread|conversation|window)\b|\bbranch(?:\s+(?:off|out))?\b|\bsub-?thread\b/;
const BRANCH = /\bbranch|\bsub-?thread\b|\b(?:based on|continu\w* (?:this|that|it)|carry (?:this|that) over|from (?:this|here|that))\b/;

/** One clause in, one console action out — or null if it's part of the question. */
export function intentOf(clause: string, ctx: ParseContext = NO_CONTEXT): Action | null {
  const q = clause.toLowerCase().replace(/[?!.]+$/, "").trim();
  if (!q) return null;
  // The same clause with its capitals kept, for names that are spoken into it.
  const raw = clause.trim().replace(/[?!.]+$/, "").trim();
  const orig = (s: string): string => { const at = q.lastIndexOf(s); return (at < 0 ? s : raw.slice(at, at + s.length)).replace(/["”]$/, ""); };

  // Destructive-action questions. Only while one is actually waiting, so a
  // bare "yes" is never mistaken for anything else.
  if (ctx.pendingApproval) {
    if (/^(?:yes|yeah|yep|sure|approve(?:d)?|allow(?: it)?|go ahead|do it|proceed|ok(?:ay)?|fine)(?:,? (?:please|jarvis|sir))?$/.test(q)) return { name: "approve" };
    if (/^(?:no|nope|deny|denied|don'?t|reject|refuse|cancel that|not that)(?:,? (?:please|jarvis|sir|thanks))?$/.test(q)) return { name: "deny" };
  }
  // Reasoning core. Checked before thread switching so "switch to Gemini"
  // is never read as a thread called Gemini.
  const core = /\b(?:switch|change|use|talk|go|move)\b(?:\s+\w+){0,3}?\s+(?:to|with|via|over to)?\s*(open ?router|chatgpt|open ?ai|gpt|claude|anthropic|gemini|google)\b(?!\s+code)|\buse\s+(open ?router|chatgpt|claude|gemini)\b(?!\s+code)/.exec(q);
  if (core) {
    const p = coreFrom(core[1] ?? core[2] ?? "");
    if (p) return { name: "switch_core", provider: p };
  }

  const model = /\b(?:use|switch to|set)\s+(?:the\s+)?(?:model\s+)?((?:gpt|o\d|claude|gemini)-[\w.-]+)/.exec(q);
  if (model?.[1]) return { name: "set_model", model: model[1] };

  // Config — before the voice rules, so "open voice settings" is never read as
  // a voice called "settings"
  if (/\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?voice settings\b/.test(q)) return { name: "open_config", tab: "voice" };
  if (/\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?(?:config|configuration|settings|connections|preferences)\b|^(?:config|settings)$/.test(q)) return { name: "open_config", tab: "connections" };
  if (/\bclose\s+(?:the\s+)?(?:config|configuration|settings|drawer)\b/.test(q)) return { name: "close_config" };

  // Voice
  const vm = /\b(?:use|switch to|set|change(?: to)?|give me)\s+(?:the\s+)?([a-z]+)(?:'s)?\s+voice\b|\bvoice\s+(?:to\s+)?([a-z]+)\b/.exec(q);
  if (vm) {
    const nm = vm[1] ?? vm[2] ?? "";
    // words that follow "voice" without being a voice's name: "voice off", "voice settings"
    if (!/^(a|the|your|my|different|another|new|other|settings?|speed|options?|menu|off|on|output|replies|please)$/.test(nm)) return { name: "set_voice", voice: nm };
  }
  // How he addresses you: "call me ma'am", "address me as sir"
  const addr = /\b(?:call|address|refer to)\s+me\s+(?:as\s+)?(sir|ma'?am|madam|miss)\b/.exec(q);
  if (addr?.[1]) return { name: "set_address", address: addr[1] === "sir" ? "sir" : "madam" };
  if (/\b(?:speak|talk)\s+(?:a (?:bit|little) )?(?:faster|quicker)\b|\bspeed (?:it )?up\b/.test(q)) return { name: "set_speed", delta: 0.1 };
  if (/\b(?:speak|talk)\s+(?:a (?:bit|little) )?slower\b|\bslow (?:it )?down\b/.test(q)) return { name: "set_speed", delta: -0.1 };
  if (/\b(?:unmute|voice on|speak again|talk to me again|turn (?:the )?(?:voice|sound) (?:back )?on)\b/.test(q)) return { name: "unmute" };
  if (/\b(?:mute|voice off|stop talking|be quiet|silence|turn (?:the )?(?:voice|sound) off)\b/.test(q)) return { name: "mute" };

  // Threads list — before panels, so "show me the threads" isn't a panel
  if (/\b(?:what|which|list|show)(?:\s+me)?\s+(?:all\s+)?(?:the\s+)?(?:threads|chats|conversations|windows|groups)\b|\bhow many (?:threads|chats)\b|\b(?:archived|put away) (?:threads|chats)\b/.test(q)) return { name: "list_threads" };

  // System panels — "show me the radar", "close the weather", "hide everything"
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

  // Network — only ever on request
  if (/^(?:scan|sweep)$|\b(?:scan|sweep)\s+(?:the\s+|my\s+)?(?:network|perimeter|lan|wifi)\b/.test(q)) return { name: "sweep" };

  // Board
  const colG = /\b(collapse|fold|minimi[sz]e|shrink|expand|unfold|open up)\s+(?:the\s+)?(all|everything|.+?)(?:\s+(?:group|bubble|groups|bubbles))$/.exec(q)
    ?? /\b(collapse|fold|expand|unfold)\s+(all|everything)\b/.exec(q);
  if (colG?.[1] && colG[2]) {
    const g = /^(?:all|everything)$/.test(colG[2]) ? "all" : colG[2];
    if (g === "all" || ctx.knowsGroup(g)) return /^(?:expand|unfold|open up)$/.test(colG[1]) ? { name: "expand_group", group: g } : { name: "collapse_group", group: g };
  }
  // A group by its name alone — "expand Baltic incidents" — when no thread has that name.
  const bareG = /^(collapse|fold|minimi[sz]e|shrink|expand|unfold|open up|open)\s+(?:the\s+)?(.+)$/.exec(q);
  if (bareG?.[1] && bareG[2] && ctx.knowsGroup(bareG[2]) && !ctx.knowsThread(bareG[2])) {
    return /^(?:expand|unfold|open up|open)$/.test(bareG[1]) ? { name: "expand_group", group: bareG[2] } : { name: "collapse_group", group: bareG[2] };
  }
  // Renaming by name: "rename Solar storms to Space weather", "call the Baltic group Incidents".
  const rnBy = /\b(?:rename|call)\s+(?:the\s+)?(.+?)(?:\s+(thread|chat|conversation|group|bubble))?\s+(?:to|as)\s+["“]?(.+?)["”]?$/.exec(q);
  if (rnBy?.[1] && rnBy[3] && !/^(?:this|it|that|this one|current)$/.test(rnBy[1])) {
    const isGroup = /^(?:group|bubble)$/.test(rnBy[2] ?? "");
    if (!isGroup && ctx.knowsThread(rnBy[1])) return { name: "rename_thread", target: rnBy[1], title: orig(rnBy[3]) };
    if (!/^(?:thread|chat|conversation)$/.test(rnBy[2] ?? "") && ctx.knowsGroup(rnBy[1])) return { name: "rename_group", group: rnBy[1], title: orig(rnBy[3]) };
  }
  const mv = /\b(?:move|put|add|drop)\s+(?:the\s+)?(.+?)\s+(?:thread\s+)?(?:in|into|to|under)\s+(?:the\s+)?(.+?)(?:\s+(?:group|bubble))?$/.exec(q);
  if (mv?.[1] && mv[2] && ctx.knowsThread(mv[1]) && !/^(?:it|this)$/.test(mv[2])) return { name: "move_thread", thread: mv[1], group: orig(mv[2]).replace(/\s+(?:group|bubble)$/i, "") };
  const ng = /\b(?:new|create|make|start)\s+(?:a\s+)?(?:new\s+)?(?:group|bubble)\s+(?:called|named|for)?\s*["“]?(.+?)["”]?$/.exec(q);
  if (ng?.[1]) return { name: "new_group", title: orig(ng[1]) };
  const dg = /\b(?:delete|remove|get rid of|bin|scrap)\s+(?:the\s+)?(.+?)\s+(?:group|bubble)$/.exec(q);
  if (dg?.[1] && ctx.knowsGroup(dg[1])) return { name: "delete_group", group: dg[1] };

  // Tidying: "tidy up", "arrange the windows", "clean up the board" — nothing is removed
  if (/^(?:please\s+)?(?:tidy|arrange|rearrange|organi[sz]e|sort out|clean up|neaten)(?:\s+up)?(?:\s+(?:the|my|all(?:\s+the)?))?(?:\s+(?:board|screen|desk|windows?|threads?|layout|everything|mess))?(?:,?\s+(?:please|jarvis))?$/.test(q)) return { name: "tidy_board" };

  // The whole board — clearing it out, or putting it all away
  if (/\b(?:delete|wipe|erase|clear|remove|get rid of|bin)\s+(?:all|every|everything|the whole)\b(?:\s+\w+){0,2}?\s*(?:threads?|chats?|conversations?|groups?|bubbles?|board|screen|everything)?\b/.test(q)
      && /\b(?:all|every|everything|whole)\b/.test(q) && !/\bpanels?\b/.test(q)) {
    return /\b(?:put|close|archive|tuck)\b/.test(q) ? { name: "archive_all" } : { name: "delete_all" };
  }
  if (/\b(?:close|put away|archive)\s+(?:all|every|everything)\b(?:\s+(?:the\s+)?(?:threads?|chats?|conversations?))?\b/.test(q) && !/\bpanels?\b/.test(q)) return { name: "archive_all" };
  // "put all away", "put all the threads away", "put everything away" — the Threads list's own words
  if (/\bput\s+(?:all|every(?:thing)?)\s+(?:(?:of\s+)?(?:the\s+)?(?:threads?|chats?|conversations?)\s+)?away\b/.test(q) && !/\bpanels?\b/.test(q)) return { name: "archive_all" };
  if (/\b(?:start|begin)\s+(?:again|fresh|over|from scratch)\b|\bclean slate\b|\bempty the board\b/.test(q)) return { name: "delete_all" };

  // Threads
  if (/\b(?:delete|erase|destroy)\s+(?:this|the|that|current)?\s*(?:thread|chat|conversation|window)\s+(?:permanently|for good|forever)\b|\bpermanently delete\b/.test(q)) return { name: "delete_thread" };
  if (/\b(?:close|delete|remove|kill|get rid of|bin|archive|put away)\s+(?:this|the|that|current)?\s*(?:thread|chat|conversation|window)\b/.test(q)) return { name: "archive_thread" };
  // Folding a window away, or opening it again — by name or "this one"
  // "open the Baltic thread" is the same as unfolding it (and it comes to the front).
  const fold = /\b(minimi[sz]e|fold|shrink|open up|unfold|maximi[sz]e|expand|open)\s+(?:the\s+)?(this|it|current)?\s*(.*?)(?:\s+(?:thread|chat|window|conversation))?$/.exec(q);
  const foldName = (fold?.[3] ?? "").trim();
  // "open a new thread" asks for a new one; it never names an existing thread
  const fresh = /^(?:a|an|another|new|fresh|second|different|separate)\b/.test(foldName);
  if (fold?.[1] && !fresh && (/\b(?:thread|chat|window|conversation)\b/.test(q) || (foldName && ctx.knowsThread(foldName)))) {
    const open = /^(?:open up|unfold|maximi[sz]e|expand|open)$/.test(fold[1]);
    if (!foldName || fold[2] || ctx.knowsThread(foldName)) return { name: "fold_thread", open, ...(foldName && !fold[2] ? { title: foldName } : {}) };
  }
  const rs = /\b(?:restore|reopen|bring back|unarchive)\s+(?:the\s+)?(.+?)(?:\s+(?:thread|chat|conversation))?$/.exec(q);
  if (rs?.[1]) return { name: "restore_thread", title: orig(rs[1]) };
  if (/^(?:clear|wipe)(?:\s+(?:this|the))?(?:\s+(?:thread|chat|window|conversation))?$/.test(q)) return { name: "clear_thread" };
  const rn = /\b(?:rename|call|name)\s+(?:this|it|the thread|this thread|this chat)\s+(?:to\s+|as\s+)?["“]?(.+?)["”]?$/.exec(q);
  if (rn?.[1]) return { name: "rename_thread", title: orig(rn[1]) };
  const sw = /\b(?:switch|go|jump|move|get|focus|select)\s+(?:(?:back\s+)?to\s+)?(?:the\s+)?(.+?)(?:\s+(?:thread|chat|window|conversation))?$/.exec(q);
  if (sw?.[1] && ctx.knowsThread(sw[1])) return { name: "switch_thread", title: sw[1] };
  const tie = /\b(?:connect|link|tie|group)\s+(?:the\s+)?(.+?)\s+(?:thread\s+)?(?:with|to|and)\s+(?:the\s+)?(.+?)(?:\s+threads?)?$/.exec(q);
  if (tie?.[1] && tie[2] && ctx.knowsThread(tie[1]) && ctx.knowsThread(tie[2])) return { name: "link_threads", a: tie[1], b: tie[2] };
  // Keep a supplied name with the command instead of treating it as a
  // follow-up question. This has to run before the general new-thread check.
  const namedThread = /^\s*(?:please\s+)?(?:new|another|fresh|separate|second|different|create|start|open|make|begin)\s+(?:up\s+)?(?:a\s+)?(?:new\s+)?(?:chat|thread|conversation|window|session|tab)\s+(?:called|named)\s+["“]?(.+?)["”]?\s*$/i.exec(clause);
  if (namedThread?.[1]) return { name: "new_thread", branch: false, title: namedThread[1].trim() };
  if (NEW_THREAD.test(q)) return { name: "new_thread", branch: BRANCH.test(q) };

  return null;
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
  return { actions: [...seen.values()], ask: ask.trim() };
}

/* ===================================================================== *
 * Directives written by the reasoning core
 * ===================================================================== */

const DIRECTIVE = /\[\[do:\s*([a-z_]+)((?:\s+[a-z_]+\s*=\s*"[^"]*")*)\s*\]\]/gi;
const MAX_DIRECTIVES = 8;

/**
 * Pull `[[do: …]]` directives out of a reply; return the clean text and the
 * actions. Anything not on the whitelist — deleting, approving, anything
 * unknown — is dropped, not guessed at.
 */
export function extractDirectives(reply: string): { text: string; actions: Action[] } {
  const actions: Action[] = [];
  const text = reply.replace(DIRECTIVE, (_m, name: string, argStr: string) => {
    const args: Record<string, string> = {};
    for (const m of argStr.matchAll(/([a-z_]+)\s*=\s*"([^"]*)"/gi)) args[m[1]!.toLowerCase()] = m[2]!.trim();
    const act = directiveToAction(name.toLowerCase(), args);
    if (act && actions.length < MAX_DIRECTIVES) actions.push(act);
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), actions };
}

function directiveToAction(n: string, args: Record<string, string>): Action | null {
  const yes = (v?: string): boolean => /^(yes|true|1)$/i.test(v ?? "");
  const opt = <K extends string>(k: K, v: string | undefined): Partial<Record<K, string>> => (v ? ({ [k]: v } as Record<K, string>) : {});
  switch (n) {
    case "new_thread":
      return {
        name: "new_thread", branch: yes(args.branch),
        ...opt("title", args.title), ...opt("ask", args.ask), ...opt("parent", args.parent), ...opt("group", args.group),
      };
    case "link_threads":
      return args.a && args.b ? { name: "link_threads", a: args.a, b: args.b, ...opt("why", args.why) } : null;
    case "close_thread":
    case "archive_thread":
      return { name: "archive_thread", ...opt("title", args.title) };
    // Putting everything away is recoverable, so it's allowed; deleting is not.
    case "archive_all":
      return { name: "archive_all" };
    case "tidy_board":
      return { name: "tidy_board" };
    case "restore_thread":
      return args.title ? { name: "restore_thread", title: args.title } : null;
    case "switch_thread":
      return args.title ? { name: "switch_thread", title: args.title } : null;
    case "rename_thread":
      return args.title ? { name: "rename_thread", title: args.title, ...opt("target", args.target) } : null;
    case "clear_thread":
      return { name: "clear_thread" };
    case "fold_thread":
      return { name: "fold_thread", open: /^(yes|true|1|open)$/i.test(args.open ?? ""), ...opt("title", args.title) };
    case "new_group":
      return args.title
        ? { name: "new_group", title: args.title, ...(args.threads ? { threads: args.threads.split(/\s*[;|]\s*/).filter(Boolean) } : {}) }
        : null;
    case "move_thread":
      return args.thread && args.group ? { name: "move_thread", thread: args.thread, group: args.group } : null;
    case "rename_group":
      return args.group && args.title ? { name: "rename_group", group: args.group, title: args.title } : null;
    case "collapse_group":
      return args.group ? { name: "collapse_group", group: args.group } : null;
    case "expand_group":
      return args.group ? { name: "expand_group", group: args.group } : null;
    case "switch_core": {
      const p = coreFrom(args.provider ?? "");
      return p ? { name: "switch_core", provider: p } : null;
    }
    case "set_voice":
      return args.name ? { name: "set_voice", voice: args.name } : null;
    case "set_speed":
      return Number.isFinite(Number(args.value)) && args.value ? { name: "set_speed", value: Number(args.value) } : null;
    case "mute": return { name: "mute" };
    case "unmute": return { name: "unmute" };
    case "open_config": {
      const tab = (["connections", "voice", "quick"] as const).find((t) => t === args.tab) ?? "connections";
      return { name: "open_config", tab };
    }
    case "sweep_network": return { name: "sweep" };
    case "show_panel":
      return PANEL_NAMES.includes(args.name as PanelName) ? { name: "show_panel", panel: args.name as PanelName } : null;
    case "hide_panel":
      return args.name === "all" || PANEL_NAMES.includes(args.name as PanelName)
        ? { name: "hide_panel", panel: args.name as PanelName | "all" } : null;
    // Never from the model: delete_thread, delete_group, approve, deny, set_model.
    default:
      return null;
  }
}

/** Actions that destroy something and must be confirmed by the user first. */
export const NEEDS_CONFIRMATION: ReadonlySet<ActionName> = new Set<ActionName>([
  "clear_thread", "delete_thread", "delete_group", "delete_all",
]);
