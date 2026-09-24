/**
 * Running the console by conversation.
 *
 * Everything you can click can also be said. What you say is one of three
 * things, and only one:
 *
 *   a command, and nothing else   "mute", "show the radar", "close this chat",
 *                                 "switch to Gemini" — carried out at once;
 *   a thread, then a question     "open a new thread and find owls", "new
 *                                 thread about owls", "go back to Lisbon and
 *                                 find hotels" — the thread is opened or
 *                                 brought in front, and the question asked
 *                                 in it, since where a question goes is the
 *                                 console's to decide;
 *   anything else                 a question, whole, for JARVIS — who can
 *                                 carry out any command in it himself.
 *
 * So a command word inside a sentence ("show me the weather in Paris", "use
 * ChatGPT to write a poem", "silence of the lambs") never acts on its own:
 * only what is said as a command is one.
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

import { type Action, type PanelName, PANEL_NAMES, coreFrom, directiveToAction, placeFrom } from "../shared/directives.js";

export type { Action, ActionName, ConfigTab, PanelName } from "../shared/directives.js";
export { NEEDS_CONFIRMATION } from "../shared/directives.js";

/** What the parser needs to know about the console right now. */
export interface ParseContext {
  /** Is there a thread on the board that answers to this name? */
  knowsThread(name: string): boolean;
  /** Is there a put-away thread that answers to this name? */
  knowsPutAway(name: string): boolean;
  /** Is there a group that answers to this name? */
  knowsGroup(name: string): boolean;
  /** Is the console waiting for a destructive-action confirmation? */
  pendingApproval: boolean;
}

const NO_CONTEXT: ParseContext = { knowsThread: () => false, knowsPutAway: () => false, knowsGroup: () => false, pendingApproval: false };

/* ===================================================================== *
 * The words around a command
 * ===================================================================== */

/** Calling him by name: "Jarvis,", "hey Jarvis". A question is sent as it was said, without this. */
const CALLED = /^(?:(?:hey|ok(?:ay)?)[,\s]+)?jarvis[,.!]?\s+/i;
/** Said before a command without being part of it: "ok", "Jarvis,", "could you". */
const LEAD_IN =/^(?:(?:ok(?:ay)?|alright|so|hey|please|jarvis|can you|could you|would you|will you)[,.!]?\s+)+/i;
/** Said after it: ", please", "thanks". */
const SIGN_OFF = /(?:[,\s]+(?:please|jarvis|sir|thanks|thank you))+$/i;
const TRAILING = /[\s,;:.!?]+$/;

/** What was said, without the words around it or the punctuation after it; capitals kept, for names. */
function unwrap(s: string): string {
  return s.trim().replace(TRAILING, "").replace(LEAD_IN, "").replace(SIGN_OFF, "").replace(TRAILING, "").trim();
}

/** A name as it was said, capitals and all, found again from its lowercased form. */
function asSaid(said: string, name: string): string {
  const at = said.toLowerCase().lastIndexOf(name);
  return (at < 0 ? name : said.slice(at, at + name.length)).replace(/["”]$/, "");
}

/* ===================================================================== *
 * A new thread
 * ===================================================================== */

/** "open a new thread", "start another chat", "create a subthread": asked for with a verb, so whatever follows is what it is for. */
const OPEN_THREAD = /^(?:create|start|open|make|begin|spin up)\s+(?:up\s+)?(?:a\s+)?(?:(?:new|another|fresh|separate|second|different)\s+(?:one|chat|thread|conversation|window|session|tab|sub-?thread)|chat|thread|conversation|window|sub-?thread)\b/i;
/** "new thread", "another chat", "branch off": without a verb, only when it stands apart from what follows — "new window managers for Linux" is a question. */
const BARE_THREAD = /^(?:a\s+)?(?:(?:new|another|fresh|separate|second|different)\s+(?:chat|thread|conversation|window|session|tab|sub-?thread)|sub-?thread|branch(?:\s+(?:off|out))?)(?=$|\s*[,;:.!?]|\s+(?:and|then|also|about|on|regarding|to|for|based|from|here)\b)/i;
/** A new thread with a name: "new thread called Travel". */
const NAMED_THREAD = /^(?:new|another|fresh|separate|second|different|create|start|open|make|begin)\s+(?:up\s+)?(?:a\s+)?(?:new\s+)?(?:chat|thread|conversation|window|session|tab)\s+(?:called|named)\s+["“]?(.+?)["”]?$/i;
/** Words that make it a subthread of the thread in front. */
const BRANCH = /\bbranch|\bsub-?thread\b|\b(?:based on|continu\w* (?:this|that|it)|carry (?:this|that) over|from (?:this|here|that))\b/i;
/** What can follow a new thread without being a question: "based on this", "about this", "for now". */
const POINTING = /^(?:(?:based on|continu\w*(?:\s+(?:with|from))?|carry(?:ing)?(?:\s+(?:this|that))?\s+over|from|about|on|off|out|for|with)\s*)?(?:this|that|it|here|there|now|me|us|please|thanks)?$/i;

/** Where a request for a new thread at the start of what was said ends — or null, when it doesn't start with one. */
function newThreadEnd(s: string): number | null {
  const m = OPEN_THREAD.exec(s) ?? BARE_THREAD.exec(s);
  return m ? m[0].length : null;
}

/** What follows the choice of a thread, as the question for it — or "" when nothing does. */
function questionIn(rest: string): string {
  const r = rest.replace(/^[\s,;:.–—-]+/, "").replace(/^(?:and then|and also|and|then|also)\s+/i, "").replace(LEAD_IN, "").trim();
  const plain = unwrap(r).toLowerCase();
  return !/[\p{L}\p{N}]/u.test(plain) || POINTING.test(plain) ? "" : r;
}

/* ===================================================================== *
 * The console's own commands
 * ===================================================================== */

/** The instrument panels, by the words people use for them. */
const PANEL_WORDS: [RegExp, PanelName][] = [
  [/^(?:perimeter|radar|network map|lan|devices)$/, "perimeter"],
  [/^(?:environment|weather|sky|forecast)$/, "environment"],
  [/^(?:compute|cpu|processor|cores?|memory|ram)$/, "compute"],
  [/^(?:graphics|gpu|video card|vram)$/, "graphics"],
  [/^(?:storage|disks?|drives?)$/, "storage"],
  [/^(?:uplink|wi-?fi|network|internet|connection)$/, "uplink"],
];

/** A panel however it is named: "compute", "the CPU panel", "panel perimeter", "radar". */
export function panelFrom(words: string): PanelName | null {
  const w = words.toLowerCase().trim().replace(/^(?:the|my)\s+/, "").replace(/^panel\s+|\s+panel$/, "");
  return PANEL_NAMES.find((n) => n === w) ?? PANEL_WORDS.find(([rx]) => rx.test(w))?.[1] ?? null;
}

/**
 * One of the console's own commands, said as a command and nothing else — or
 * null: it is a question, or something for JARVIS. Every rule matches the
 * whole of what was said, give or take "please" and "Jarvis".
 */
export function intentOf(clause: string, ctx: ParseContext = NO_CONTEXT): Action | null {
  // Destructive-action questions. Only while one is actually waiting, so a
  // bare "yes" is never mistaken for anything else.
  if (ctx.pendingApproval) {
    const r = clause.toLowerCase().trim().replace(TRAILING, "");
    if (/^(?:yes|yeah|yep|sure|approve(?:d)?|allow(?: it)?|go ahead|do it|proceed|ok(?:ay)?|fine)(?:,? (?:please|jarvis|sir))?$/.test(r)) return { name: "approve" };
    if (/^(?:no|nope|deny|denied|don'?t|reject|refuse|cancel that|not that)(?:,? (?:please|jarvis|sir|thanks))?$/.test(r)) return { name: "deny" };
  }

  const said = unwrap(clause);
  const q = said.toLowerCase();
  if (!q) return null;

  // A new thread — named, plain, or branched off the one in front. A thread
  // with a question after it is not a command alone (parseUtterance).
  const named = NAMED_THREAD.exec(said);
  if (named?.[1]) return { name: "new_thread", branch: false, title: named[1].trim() };
  const end = newThreadEnd(q);
  if (end !== null) return questionIn(q.slice(end)) ? null : { name: "new_thread", branch: BRANCH.test(q) };

  // The service — local, so it works when the one in use has stopped answering.
  const core = /^(?:switch|change|use|talk|go|move)(?:\s+\w+){0,3}?\s+(?:(?:to|with|via|over to)\s+)?(chatgpt|open ?ai|gpt|gemini|google)$/.exec(q);
  if (core?.[1]) {
    const p = coreFrom(core[1]);
    if (p) return { name: "switch_core", provider: p };
  }
  const model = /^(?:use|switch to|set)\s+(?:the\s+)?(?:model\s+)?((?:gpt|o\d|gemini)-[\w.-]+)$/.exec(q);
  if (model?.[1]) return { name: "set_model", model: model[1] };

  // The first-run guide and Configuration — before the voice rules, so "open
  // voice settings" is never read as a voice called "settings".
  if (/^(?:(?:run|open|show|start|redo|repeat)\s+(?:me\s+)?(?:the\s+)?(?:setup|set-up|onboarding|first[- ]run)(?:\s+guide)?|show me the guide|setup|setup guide|guide)$/.test(q)) return { name: "open_setup" };
  if (/^(?:open|show)\s+(?:me\s+)?(?:the\s+)?voice settings$/.test(q)) return { name: "open_config", tab: "voice" };
  if (/^(?:open|show)\s+(?:me\s+)?(?:the\s+)?(?:access|permissions?)(?:\s+settings)?$/.test(q)) return { name: "open_config", tab: "access" };
  if (/^(?:(?:open|show)\s+(?:me\s+)?(?:the\s+)?(?:config|configuration|settings|connections|preferences)|config|settings)$/.test(q)) return { name: "open_config", tab: "connections" };
  if (/^close\s+(?:the\s+)?(?:config|configuration|settings|drawer)$/.test(q)) return { name: "close_config" };

  // The voice — "use the Fable voice", "change the voice to Ash". Only as a
  // request for the change, so "which voice are you using?" stays a question.
  const vm = /^(?:use|switch to|set|change(?: to)?|give me)\s+(?:the\s+)?(?!(?:the|your|my|a)\b)([a-z]+)(?:'s)?\s+voice$|^(?:(?:set|change|switch)\s+(?:the\s+|your\s+)?voice\s+(?:to\s+)?|voice\s+to\s+)([a-z]+)$/.exec(q);
  if (vm) {
    const nm = vm[1] ?? vm[2] ?? "";
    // words that follow "voice" without being a voice's name: "voice off", "voice settings"
    if (!/^(a|the|your|my|different|another|new|other|settings?|speed|options?|menu|off|on|output|replies|please)$/.test(nm)) return { name: "set_voice", voice: nm };
  }
  const addr = /^(?:call|address|refer to)\s+me\s+(?:as\s+)?(sir|ma'?am|madam|miss)(?:\s+(?:again|instead|from now on))?$/.exec(q);
  if (addr?.[1]) return { name: "set_address", address: addr[1] === "sir" ? "sir" : "madam" };
  if (/^(?:(?:speak|talk)\s+(?:a (?:bit|little) )?(?:faster|quicker)|speed (?:it )?up)$/.test(q)) return { name: "set_speed", delta: 0.1 };
  if (/^(?:(?:speak|talk)\s+(?:a (?:bit|little) )?slower|slow (?:it )?down)$/.test(q)) return { name: "set_speed", delta: -0.1 };
  if (/^(?:unmute|voice on|speak again|talk to me again|turn (?:the )?(?:voice|sound) (?:back )?on)$/.test(q)) return { name: "unmute" };
  if (/^(?:mute|voice off|stop talking|be quiet|silence|turn (?:the )?(?:voice|sound) off)$/.test(q)) return { name: "mute" };

  // The put-away threads only — making room, not clearing the board. Before
  // the Threads list ("put away threads") and the whole-board rule ("delete
  // all…"), so "delete all the put-away threads" means just those.
  if (/^(?:(?:clear|delete|remove|empty|bin|get rid of|throw away)\s+(?:out\s+)?(?:all\s+)?(?:of\s+)?(?:the\s+|my\s+)?(?:put[- ]away|archived)(?:\s+(?:threads?|chats?|conversations?|ones))?|empty\s+the\s+archive)$/.test(q)) return { name: "clear_archived" };

  // The Threads list — before the panels, so "show me the threads" isn't a panel.
  if (/^(?:(?:what|which|list|show)(?:\s+me)?\s+(?:all\s+)?(?:the\s+|my\s+)?(?:threads|chats|conversations|windows|groups)(?:\s+(?:do i have|are there|are open|i have))?|how many (?:threads|chats)(?:\s+(?:do i have|are there))?|(?:(?:show|list)\s+(?:me\s+)?)?(?:the\s+)?(?:archived|put away) (?:threads|chats))$/.test(q)) return { name: "list_threads" };

  // The instrument panels — "show me the radar", "close the weather", "hide everything".
  if (/^(?:(?:close|hide|dismiss|put away|clear)\s+(?:all\s+|every\s+)?(?:the\s+)?(?:panels?|overlays?|everything)|put\s+(?:all\s+)?(?:the\s+)?(?:panels?|overlays?)\s+away)$/.test(q)) return { name: "hide_panel", panel: "all" };
  const panel = /^(show|open|display|bring up|pull up|let me see|give me|close|hide|dismiss|put away)(?:\s+me)?\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:panel|stats|readings?))?$/.exec(q);
  const hit = panel?.[2] ? PANEL_WORDS.find(([rx]) => rx.test(panel[2]!)) : undefined;
  if (panel && hit) return /^(?:close|hide|dismiss|put away)$/.test(panel[1]!) ? { name: "hide_panel", panel: hit[1] } : { name: "show_panel", panel: hit[1] };

  // The network — only ever on request.
  if (/^(?:scan|sweep)(?:\s+(?:the\s+|my\s+)?(?:network|perimeter|lan|wifi))?$/.test(q)) return { name: "sweep" };

  // Deleting a group is for good, so it is the console's own word, never the model's.
  const dg = /^(?:delete|remove|get rid of|bin|scrap)\s+(?:the\s+)?(.+?)\s+(?:group|bubble)$/.exec(q);
  if (dg?.[1] && ctx.knowsGroup(dg[1])) return { name: "delete_group", group: dg[1] };

  // Placing: "move the radar to the top right", "put Lisbon on the left" — a
  // panel, or a thread or group the board has; anything else is for JARVIS.
  if (/^(?:put|move|send)\s+(?:all\s+)?(?:the\s+)?panels\s+(?:to|on|at|down)\s+(?:the\s+)?(?:sides|edges)$/.test(q)) return { name: "arrange_board" };
  const pm = /^(?:move|put|place|send)\s+(?:the\s+|my\s+)?(.+?)\s+(?:to|on|at|in)\s+(?:the\s+)?((?:top|bottom|upper|lower|centre|center|middle)(?:[\s-]+(?:left|right))?|left|right)(?:\s+(?:corner|side|edge))?(?:\s+of\s+the\s+(?:screen|board))?$/.exec(q);
  const at = pm ? placeFrom(pm[2]!) : null;
  if (pm && at) {
    const panel = panelFrom(pm[1]!);
    if (panel) return { name: "place", what: panel, at };
    // the name as it was said, capitals and all
    const from = q.indexOf(pm[1]!);
    const what = said.slice(from, from + pm[1]!.length);
    if (ctx.knowsThread(what) || ctx.knowsGroup(what)) return { name: "place", what, at };
  }

  // Tidying: "tidy up", "arrange the windows", "clean up the board" — nothing is removed.
  if (/^(?:tidy|arrange|rearrange|organi[sz]e|sort out|clean up|neaten)(?:\s+up)?(?:\s+(?:the|my|all(?:\s+the)?))?(?:\s+(?:board|screen|desk|windows?|threads?|layout|everything|mess))?$/.test(q)) return { name: "tidy_board" };

  // The whole board — clearing it out, or putting it all away.
  if (/^(?:delete|wipe|erase|clear|remove|get rid of|bin)\s+(?:all|every|everything|the whole)(?:\s+(?:of\s+)?(?:the|my))?(?:\s+(?:threads?|chats?|conversations?|groups?|bubbles?|board|screen|everything))?$/.test(q)) return { name: "delete_all" };
  if (/^(?:(?:close|put away|archive)\s+(?:all|every|everything)(?:\s+(?:of\s+)?(?:the\s+|my\s+)?(?:threads?|chats?|conversations?))?|put\s+(?:all|every(?:thing)?)\s+(?:(?:of\s+)?(?:the\s+|my\s+)?(?:threads?|chats?|conversations?)\s+)?away)$/.test(q)) return { name: "archive_all" };
  if (/^(?:(?:start|begin)\s+(?:again|fresh|over|from scratch)|clean slate|empty the board)$/.test(q)) return { name: "delete_all" };

  // This thread: deleting for good, putting away, folding, clearing.
  if (/^(?:(?:delete|erase|destroy)\s+(?:this|the|that|current)?\s*(?:thread|chat|conversation|window)\s+(?:permanently|for good|forever)|permanently delete(?:\s+(?:this|the|that|current)?\s*(?:thread|chat|conversation|window))?)$/.test(q)) return { name: "delete_thread" };
  if (/^(?:close|delete|remove|kill|get rid of|bin|archive|put away)\s+(?:this|the|that|current)?\s*(?:thread|chat|conversation|window)$/.test(q)) return { name: "archive_thread" };
  const fold = /^(minimi[sz]e|fold|shrink|open up|unfold|maximi[sz]e|expand|open)\s+(?:this|the|that|current|it)(?:\s+(?:thread|chat|window|conversation|one))?$/.exec(q);
  if (fold?.[1]) return { name: "fold_thread", open: /^(?:open up|unfold|maximi[sz]e|expand|open)$/.test(fold[1]) };
  if (/^(?:clear|wipe)(?:\s+(?:this|the))?(?:\s+(?:thread|chat|window|conversation))?$/.test(q)) return { name: "clear_thread" };

  // The one put away most recently: "restore the last one", "open the thread I just closed", "undo that close".
  if (/^(?:(?:restore|reopen|bring back|unarchive|recover)\s+(?:the\s+|my\s+)?(?:last|latest|previous|most recent)(?:\s+(?:one|thread|chat|conversation|window))?|(?:open|restore|reopen|bring back|get back|recover|unarchive)\s+(?:the\s+|my\s+)?(?:last\s+|latest\s+)?(?:one|thread|chat|conversation|window)\s+(?:that\s+|which\s+)?(?:i|you|we)\s+(?:just\s+|last\s+|recently\s+)?(?:closed|put away|archived|hid|dismissed)|restore|undo\s+(?:that\s+|the\s+|last\s+)?(?:close|closing|put away|archive|archiving))$/.test(q)) {
    return { name: "restore_thread", title: "", last: true };
  }
  // …or one by name — only one that was put away; anything else is a question.
  const rs = /^(?:restore|reopen|bring back|unarchive)\s+(?:the\s+)?(.+?)(?:\s+(?:thread|chat|conversation))?$/.exec(q);
  if (rs?.[1] && ctx.knowsPutAway(rs[1])) return { name: "restore_thread", title: asSaid(said, rs[1]) };

  // Going to a thread by name — only one that exists; anything else is a
  // question. ("move" is JARVIS's word: "move Travel into Trips".)
  const sw = /^(?:switch|go|jump|get|focus|select)\s+(?:(?:back\s+)?to\s+)?(?:the\s+)?(.+?)(?:\s+(?:thread|chat|window|conversation))?$/.exec(q);
  if (sw?.[1] && ctx.knowsThread(sw[1])) return { name: "switch_thread", title: sw[1] };

  return null;
}

/* ===================================================================== *
 * What was said: a command, a thread and its question, or a question
 * ===================================================================== */

export interface Parsed { actions: Action[]; ask: string }

/** Where the choice of a thread ends and its question begins: "go back to Lisbon, and find hotels". */
const JOINER = /\s*(?:[,;:]|\.(?=\s))\s*|\s+(?:and then|and also|and|then|also)\s+/i;

/** What was said, as the console's command, a thread and the question for it, or a question for JARVIS. */
export function parseUtterance(text: string, ctx: ParseContext = NO_CONTEXT): Parsed {
  const command = intentOf(text, ctx);
  if (command) return { actions: [command], ask: "" };
  const said = text.trim().replace(CALLED, "");
  return threadThenQuestion(said.replace(LEAD_IN, ""), ctx) ?? { actions: [], ask: /[\p{L}\p{N}]/u.test(said) ? said : "" };
}

/**
 * A sentence that begins by choosing its thread — a new one, or one on the
 * board by name — and goes on with the question for it. Null when it doesn't.
 */
function threadThenQuestion(said: string, ctx: ParseContext): Parsed | null {
  // "open a new thread and find owls", "go back to Lisbon, find hotels":
  // the first clause chooses the thread.
  const cut = JOINER.exec(said);
  if (cut) {
    const first = intentOf(said.slice(0, cut.index), ctx);
    if (first?.name === "new_thread" || first?.name === "switch_thread") {
      const rest = said.slice(cut.index + cut[0].length);
      // People restate themselves: "open a new chat, create a new thread" is one window.
      const again = intentOf(rest, ctx);
      if (first.name === "new_thread" && again?.name === "new_thread") return { actions: [{ ...first, branch: first.branch || again.branch }], ask: "" };
      return { actions: [first], ask: questionIn(rest) };
    }
  }
  // "open a new thread about owls": the thread and what it is for, with nothing between.
  const end = newThreadEnd(said);
  const ask = end === null ? "" : questionIn(said.slice(end));
  return ask ? { actions: [{ name: "new_thread", branch: BRANCH.test(said) }], ask } : null;
}

/* ===================================================================== *
 * What the reasoning core writes
 * ===================================================================== */

const DIRECTIVE = /\[\[do:\s*([a-z_]+)((?:\s+[a-z_]+\s*=\s*"[^"]*")*)\s*\]\]/gi;
const MAX_DIRECTIVES = 8;

/**
 * Pull `[[do: …]]` directives out of a reply; return the clean text and the
 * actions. Anything not in the table — deleting, approving, anything
 * unknown, or written without what it needs — is not carried out, not
 * guessed at; it is returned as `refused`, as written, so the user can be
 * told that it did nothing.
 */
export function extractDirectives(reply: string): { text: string; actions: Action[]; refused: string[] } {
  const actions: Action[] = [];
  const refused: string[] = [];
  const text = reply.replace(DIRECTIVE, (whole: string, name: string, argStr: string) => {
    const args: Record<string, string> = {};
    for (const m of argStr.matchAll(/([a-z_]+)\s*=\s*"([^"]*)"/gi)) args[m[1]!.toLowerCase()] = m[2]!.trim();
    const act = directiveToAction(name, args);
    if (!act) refused.push(asWritten(whole));
    else if (actions.length < MAX_DIRECTIVES) actions.push(act);
    return "";
  })
    // one not even written in the directive's form ([[do: action="…"]]) is no directive either — and not shown as text
    .replace(/\[\[do:[^\]]*\]\]/gi, (whole) => { refused.push(asWritten(whole)); return ""; });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), actions, refused };
}

/** A directive as it was written, without its brackets. */
function asWritten(directive: string): string {
  return directive.slice(2, -2).replace(/^do:\s*/i, "").trim();
}
