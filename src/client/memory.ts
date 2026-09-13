/**
 * The board's room in this browser's storage.
 *
 * Every message is kept — a thread is as long as the conversation — in the
 * browser's own storage, which most browsers allow about 5 MB per site
 * (some more). That is thousands of messages, so in ordinary use nothing
 * here ever speaks. It is for the edge:
 *
 *   • past four fifths of that room, JARVIS says so once, and how to make room;
 *   • if a save is ever refused, he says so at once — the board on screen is
 *     intact, but it won't survive a reload until there is room — and again
 *     when saving works once more.
 *
 * Nothing is ever trimmed or deleted on his own initiative: making room is
 * the user's call ("clear the put-away threads", which asks first).
 */

import { graph } from "./state.js";
import { notice } from "./say.js";

/** Characters: the allowance of the least generous common browser. */
const ROOM = 5_000_000;
const WARN_AT = 0.8 * ROOM;

let warned = false;
let refused = false;

graph.onSaved = (kept: boolean, size: number): void => {
  if (!kept) {
    if (!refused) {
      refused = true;
      notice("This browser's storage is full, sir — the latest changes aren't saved. Everything on screen stays until you close the page; say “clear the put-away threads” to make room.");
    }
    return;
  }
  if (refused) {
    refused = false;
    notice("There's room again, sir — everything is saved.");
  }
  if (size > WARN_AT && !warned) {
    warned = true;
    notice("The board has used most of the room this browser gives it, sir. Say “clear the put-away threads” when you'd like to make space.");
  }
};
