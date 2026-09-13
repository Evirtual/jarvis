/**
 * What can be done to the console, in one table.
 *
 * An Action is one thing the console does — open a thread, fold a group,
 * mute — asked for by the user in words (client/commands.ts) or by the
 * reasoning core in a directive written at the end of its reply:
 *
 *   [[do: new_thread title="Lisbon" ask="What is the weather in Lisbon?"]]
 *
 * The DIRECTIVES table below is the one place the core's directives exist:
 * the persona (services/common.ts) tells the model about them from it, and
 * the client turns a written directive into an Action with it. What is not
 * in the table the model cannot do — delete anything, answer a confirmation
 * on the user's behalf, change the model. Pure: no DOM, shared with the server.
 */

import type { ProviderId } from "./types.js";

/* ---------------- what the console has ---------------- */

export const PANEL_NAMES = ["threads", "conversation", "compute", "graphics", "storage", "perimeter", "uplink", "environment"] as const;
export type PanelName = (typeof PANEL_NAMES)[number];

export const CONFIG_TABS = ["connections", "voice", "access", "quick"] as const;
export type ConfigTab = (typeof CONFIG_TABS)[number];

/* ---------------- the actions ---------------- */

export type Action =
  | { name: "new_thread"; branch?: boolean; title?: string; ask?: string; parent?: string; parentId?: string; group?: string }
  | { name: "link_threads"; a: string; b: string; why?: string }
  | { name: "archive_thread"; title?: string }
  | { name: "restore_thread"; title: string; last?: boolean }
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
  | { name: "clear_archived" }
  /** From JARVIS only: a name for the thread we're in, which has none yet. */
  | { name: "title_thread"; title: string }
  | { name: "collapse_group"; group: string }
  | { name: "expand_group"; group: string }
  | { name: "approve" }
  | { name: "deny" }
  | { name: "switch_core"; provider: ProviderId }
  | { name: "set_model"; model: string }
  | { name: "set_voice"; voice: string }
  | { name: "set_speed"; delta?: number; value?: number }
  | { name: "set_address"; address: "sir" | "madam" }
  | { name: "mute" }
  | { name: "unmute" }
  | { name: "open_config"; tab?: ConfigTab }
  /** The first-run guide, brought back. */
  | { name: "open_setup" }
  | { name: "close_config" }
  | { name: "sweep" }
  | { name: "show_panel"; panel: PanelName }
  | { name: "hide_panel"; panel: PanelName | "all" };

export type ActionName = Action["name"];

/** Actions that destroy something and must be confirmed by the user first. */
export const NEEDS_CONFIRMATION: ReadonlySet<ActionName> = new Set<ActionName>([
  "clear_thread", "delete_thread", "delete_group", "delete_all", "clear_archived",
]);

/** The names a person uses for a service. */
const CORE_NAMES: Record<string, ProviderId> = {
  chatgpt: "openai", "open ai": "openai", openai: "openai", gpt: "openai",
  gemini: "gemini", google: "gemini",
};

export function coreFrom(word: string): ProviderId | null {
  return CORE_NAMES[word.toLowerCase().replace(/\s+/g, " ").trim()] ?? null;
}

/* ---------------- the directives ---------------- */

type Args = Record<string, string>;
const yes = (v?: string): boolean => /^(yes|true|1)$/i.test(v ?? "");
const opt = <K extends string>(k: K, v: string | undefined): Partial<Record<K, string>> => (v ? ({ [k]: v } as Record<K, string>) : {});

interface Directive {
  /** As the model writes it. */
  name: string;
  /** Its arguments, as the model is shown them; "" for none. */
  use: string;
  /** What it does, as the model is told; "" for a spelling of another directive, told nothing. */
  doc: string;
  /** The action it becomes — null when what was written doesn't make one. */
  make(args: Args): Action | null;
}

export const DIRECTIVES: readonly Directive[] = [
  {
    name: "new_thread", use: 'title="…" ask="…" branch="yes" parent="…" group="…"',
    doc: "a new window, every argument optional: ask poses a question in it, answered there in turn; branch=\"yes\" makes it a subthread of the thread in front, parent=\"…\" of the thread named; group puts it in a group, made if needed. Several at once each get their own ask",
    make: (a) => ({ name: "new_thread", branch: yes(a.branch), ...opt("title", a.title), ...opt("ask", a.ask), ...opt("parent", a.parent), ...opt("group", a.group) }),
  },
  { name: "new_group", use: 'title="…" threads="title; title"', doc: "gathers two or more threads into a bubble",
    make: (a) => a.title ? { name: "new_group", title: a.title, ...(a.threads ? { threads: a.threads.split(/\s*[;|]\s*/).filter(Boolean) } : {}) } : null },
  { name: "move_thread", use: 'thread="…" group="…"', doc: "moves a thread into a group, made if needed",
    make: (a) => a.thread && a.group ? { name: "move_thread", thread: a.thread, group: a.group } : null },
  { name: "rename_group", use: 'group="…" title="…"', doc: "", make: (a) => a.group && a.title ? { name: "rename_group", group: a.group, title: a.title } : null },
  { name: "collapse_group", use: 'group="…|all"', doc: "folds a group to a single orb", make: (a) => a.group ? { name: "collapse_group", group: a.group } : null },
  { name: "expand_group", use: 'group="…|all"', doc: "opens it again", make: (a) => a.group ? { name: "expand_group", group: a.group } : null },
  { name: "archive_all", use: "", doc: "puts every thread away, recoverable", make: () => ({ name: "archive_all" }) },
  { name: "tidy_board", use: "", doc: "rearranges every window and group neatly, closing nothing", make: () => ({ name: "tidy_board" }) },
  { name: "link_threads", use: 'a="…" b="…" why="two or three words"', doc: "connects two threads; connected threads are put in the same group",
    make: (a) => a.a && a.b ? { name: "link_threads", a: a.a, b: a.b, ...opt("why", a.why) } : null },
  { name: "switch_thread", use: 'title="…"', doc: "brings a thread to the front", make: (a) => a.title ? { name: "switch_thread", title: a.title } : null },
  { name: "close_thread", use: 'title="…"', doc: "puts a thread away, recoverable — the one in front when no title is given", make: (a) => ({ name: "archive_thread", ...opt("title", a.title) }) },
  { name: "archive_thread", use: "", doc: "", make: (a) => ({ name: "archive_thread", ...opt("title", a.title) }) },
  { name: "restore_thread", use: 'title="…" or last="yes"', doc: "brings a put-away thread back",
    make: (a) => a.title ? { name: "restore_thread", title: a.title } : yes(a.last) ? { name: "restore_thread", title: "", last: true } : null },
  { name: "rename_thread", use: 'title="…" target="…"', doc: "renames the thread in front, or the one named as target",
    make: (a) => a.title ? { name: "rename_thread", title: a.title, ...opt("target", a.target) } : null },
  { name: "fold_thread", use: 'open="yes|no" title="…"', doc: "folds a window to its title bar (open=\"no\") or opens it again; folding one never disturbs another",
    make: (a) => ({ name: "fold_thread", open: /^(yes|true|1|open)$/i.test(a.open ?? ""), ...opt("title", a.title) }) },
  { name: "clear_thread", use: "", doc: "empties the thread in front; the user is asked to confirm", make: () => ({ name: "clear_thread" }) },
  { name: "title_thread", use: 'title="…"', doc: "", make: (a) => a.title ? { name: "title_thread", title: a.title } : null },
  { name: "switch_core", use: 'provider="gemini|chatgpt"', doc: "answers through the other service",
    make: (a) => { const p = coreFrom(a.provider ?? ""); return p ? { name: "switch_core", provider: p } : null; } },
  { name: "set_voice", use: 'name="…"', doc: "one of the voices offered in Configuration → Voice, named in the console snapshot", make: (a) => a.name ? { name: "set_voice", voice: a.name } : null },
  { name: "set_speed", use: 'value="0.7-1.3"', doc: "how fast he speaks", make: (a) => a.value && Number.isFinite(Number(a.value)) ? { name: "set_speed", value: Number(a.value) } : null },
  { name: "mute", use: "", doc: "spoken replies off", make: () => ({ name: "mute" }) },
  { name: "unmute", use: "", doc: "spoken replies on", make: () => ({ name: "unmute" }) },
  { name: "open_config", use: 'tab="connections|voice|access"', doc: "opens Configuration (access: the microphone, location and sound-on-opening permissions)",
    make: (a) => ({ name: "open_config", tab: CONFIG_TABS.find((t) => t === a.tab) ?? "connections" }) },
  { name: "open_setup", use: "", doc: "the first-run guide, when asked for it", make: () => ({ name: "open_setup" }) },
  { name: "sweep_network", use: "", doc: "sweeps the network — only when asked", make: () => ({ name: "sweep" }) },
  { name: "show_panel", use: `name="${PANEL_NAMES.join("|")}"`, doc: "opens an instrument panel (conversation: the transcript of what was said at the core)",
    make: (a) => PANEL_NAMES.includes(a.name as PanelName) ? { name: "show_panel", panel: a.name as PanelName } : null },
  { name: "hide_panel", use: 'name="…|all"', doc: "closes one, or all",
    make: (a) => a.name === "all" || PANEL_NAMES.includes(a.name as PanelName) ? { name: "hide_panel", panel: a.name as PanelName | "all" } : null },
];

/** A written directive as an action — or null: unknown, not for the model, or missing what it needs. */
export function directiveToAction(name: string, args: Args): Action | null {
  return DIRECTIVES.find((d) => d.name === name.toLowerCase())?.make(args) ?? null;
}

/** The directives as the persona tells the model about them. */
export function directiveCatalogue(): string {
  const list = DIRECTIVES.filter((d) => d.doc).map((d) => `${d.name}${d.use ? ` ${d.use}` : ""} — ${d.doc}`).join("; ");
  return `Actions: ${list}. You cannot delete threads or groups, answer a confirmation on the user's behalf, or change the model.`;
}
