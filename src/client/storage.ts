/**
 * What the console keeps in this browser, under one set of names. Every key
 * is here, so a rename is done here once (migrateStorage) and nowhere else
 * reads an old name.
 */

/** Every name the console stores under. */
export const KEY = {
  /** The board: threads, groups, which is in front (workspace.ts). */
  workspace: "jarvis.workspace",
  /** The one stacking order of windows, groups and panels (stack.ts). */
  stack: "jarvis.stack",
  /** Phone: the order the threads were dragged into (stage.ts). */
  phoneOrder: "jarvis.phoneOrder",
  /** The conversation at the core (core-chat.ts). */
  conversation: "jarvis.conversation",
  /** The web version's keys, and what each can reach (browser-core.ts). */
  cores: "jarvis.cores",
  coresChecked: "jarvis.coresChecked",
  /** The instrument panels: which are open, where they sit, the radar's height. */
  panelsOpen: "jarvis.panels.open",
  panelsSeats: "jarvis.panels.seats",
  radarH: "jarvis.panels.radarH",
  /** The voice: the device voice by name, which kind speaks, timbre, cadence, on/off. */
  voiceDevice: "jarvis.voice.device",
  voiceKind: "jarvis.voice.kind",
  voicePitch: "jarvis.voice.pitch",
  voiceRate: "jarvis.voice.rate",
  voiceOn: "jarvis.voice.on",
  /** Listening: whether a tap on JARVIS speaks, how long a pause ends it, or a tap. */
  tapSpeaks: "jarvis.voice.tapSpeaks",
  listenPause: "jarvis.voice.listenPause",
  manualStop: "jarvis.voice.manualStop",
  /** Sir or ma'am. */
  address: "jarvis.address",
  /** The first-run guide was seen or dismissed. */
  setupDone: "jarvis.setupDone",
  /** The readiness card: what was marked not needed; a service was once connected. */
  readinessSkip: "jarvis.readiness.skip",
  readinessSeenReady: "jarvis.readiness.seenReady",
} as const;

/** The voice chosen for a service, by its id: "jarvis.voice.gemini", "jarvis.voice.openai". */
export const voiceKeyFor = (provider: string): string => `jarvis.voice.${provider}`;

/** Names these keys had before, each moved to its current name once, at boot. */
const RENAMED: Record<string, string> = {
  "jarvis.core": KEY.conversation,
  "jarvis.pitch": KEY.voicePitch,
  "jarvis.rate": KEY.voiceRate,
  "jarvis.voiceOn": KEY.voiceOn,
  "jarvis.tapSpeaks": KEY.tapSpeaks,
  "jarvis.listenPause": KEY.listenPause,
  "jarvis.manualStop": KEY.manualStop,
  "jarvis.panelsOpen": KEY.panelsOpen,
  "jarvis.panelSeats": KEY.panelsSeats,
  "jarvis.radarH": KEY.radarH,
  "jarvis.readinessSkip": KEY.readinessSkip,
  "jarvis.readinessSeenReady": KEY.readinessSeenReady,
};

/**
 * Move each value kept under an old name to its current name — only where
 * nothing is kept under the current name yet — and drop the old one. Run
 * once, before anything reads.
 */
export function migrateStorage(): void {
  try {
    for (const [old, now] of Object.entries(RENAMED)) {
      const v = localStorage.getItem(old);
      if (v === null) continue;
      if (localStorage.getItem(now) === null) localStorage.setItem(now, v);
      localStorage.removeItem(old);
    }
  } catch { /* storage blocked: nothing to move */ }
}

/**
 * Keep a value in this browser's storage. False when it was refused — the
 * storage is full, or blocked (some private windows) — so a caller that
 * matters can say so rather than lose it quietly.
 */
export function store(k: string, v: string): boolean {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}

/** A value kept in this browser's storage, or null. */
export function recall(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
