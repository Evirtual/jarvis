/**
 * Where a reply goes, from the model's word at the head of it (parseRoute):
 * the core, the thread in front, a thread it named, or a thread opened for
 * it. Pure, so the rule can be tested on its own; ask.ts makes the place
 * ready and writes there.
 */

import type { Route } from "./commands.js";
import type { Thread } from "./workspace.js";

export type Destination =
  | { kind: "core" }
  | { kind: "thread"; thread: Thread }
  | { kind: "new"; title?: string };

/**
 * `[[at: new "…"]]` opens a thread; `[[at: thread]]` is the thread named, else
 * the one in front — and with none in front, a follow-up is conversation; no
 * word, or `[[at: core]]`, is the core.
 */
export function whereTo(route: Route | null, front: Thread | null, byTitle: (title: string) => Thread | null): Destination {
  if (route?.at === "new") return { kind: "new", ...(route.title ? { title: route.title } : {}) };
  if (route?.at === "thread") {
    const thread = (route.title ? byTitle(route.title) : null) ?? front;
    return thread ? { kind: "thread", thread } : { kind: "core" };
  }
  return { kind: "core" };
}
