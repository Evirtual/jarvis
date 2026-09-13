/**
 * The board in this browser's storage: loaded once, brought forward from an
 * older save if that is what is there, and saved after every change. Owns
 * the Workspace the stage draws.
 */

import { KEY, recall, store } from "./storage.js";
import { Workspace, migrate, type WorkspaceData } from "./workspace.js";

export class BoardStore {
  readonly ws: Workspace;
  /** After every save: whether the browser kept it, and its size in characters (memory.ts). */
  onSaved: ((kept: boolean, size: number) => void) | null = null;

  constructor() {
    this.ws = new Workspace(BoardStore.load());
  }

  /**
   * The saved workspace, or the older flat list of threads brought forward.
   * The old key is left untouched, so nothing is ever lost to a migration.
   */
  private static load(): WorkspaceData {
    try {
      const raw = recall(KEY.workspace);
      if (raw) return migrate(JSON.parse(raw));
    } catch { /* corrupt — fall through to the older save */ }
    try {
      const legacy = localStorage.getItem("jarvis.threads");
      if (legacy) return migrate(JSON.parse(legacy), localStorage.getItem("jarvis.activeThread"));
    } catch { /* nothing usable */ }
    return migrate(null);
  }

  save(): void {
    const json = JSON.stringify(this.ws.data);
    this.onSaved?.(store(KEY.workspace, json), json.length);
  }

  /**
   * Older saves measured positions from the stage centre, so every window
   * slid about whenever the screen changed width. Measure from the top-left
   * corner instead — as the instrument panels do — converting once, where
   * things are on this screen now.
   */
  anchorToCorner(width: number, height: number): void {
    const d = this.ws.data;
    if (d.anchor === "corner") return;
    const dx = Math.round(width / 2), dy = Math.round(height / 2);
    for (const p of [...d.groups, ...d.threads]) {
      if (p.x !== undefined) p.x += dx;
      if (p.y !== undefined) p.y += dy;
    }
    d.anchor = "corner";
  }
}
