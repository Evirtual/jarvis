/**
 * Every drawn icon in the console, in one place, so a close button on a
 * thread and on a panel are the same glyph, and a reading in the deck, its
 * row in More and its panel's title bar share one picture.
 *
 * 24px grid, stroke only, currentColor. Drawn, not typed: at these sizes
 * typed glyphs read as smudges. Sizes come from CSS (--ic for title bars).
 */

const draw = (body: string, weight: number, cls?: string): string =>
  `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Window furniture: title-bar buttons on threads, groups and panels. */
export const ICON = {
  chev: draw('<path d="M6 9.5 12 15.5 18 9.5"/>', 1.7),
  web: draw('<circle cx="12" cy="12" r="2.4"/><circle cx="5" cy="6.5" r="1.8"/><circle cx="19" cy="6.5" r="1.8"/><circle cx="12" cy="20" r="1.8"/><path d="M6.4 7.8 10 10.4M17.6 7.8 14 10.4M12 14.4V18"/>', 1.7),
  branch: draw('<circle cx="7" cy="5.5" r="1.9"/><circle cx="7" cy="18.5" r="1.9"/><circle cx="17" cy="12" r="1.9"/><path d="M7 7.4v9.2M8.9 5.9c4 .6 5.3 2.4 6.3 5.2M8.9 18.1c4-.6 5.3-2.4 6.3-5.2"/>', 1.7),
  close: draw('<path d="M7 7l10 10M17 7 7 17"/>', 1.7),
  delete: draw('<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 12.2h9l1-12.2M10 10.5v6M14 10.5v6"/>', 1.7),
  plus: draw('<path d="M12 6v12M6 12h12"/>', 1.7),
} as const;

/** One picture per instrument (and the threads list), finer-lined. */
const INSTRUMENT: Record<string, string> = {
  conversation: '<path d="M4 5.5h16v10.5H9.5L5 19.5v-3.5H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  threads: '<circle cx="12" cy="12" r="3"/><circle cx="4.5" cy="6" r="1.8"/><circle cx="19.5" cy="6" r="1.8"/><circle cx="12" cy="20.5" r="1.8"/><path d="M6 7l3.6 3M18 7l-3.6 3M12 15v3.7"/>',
  compute: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
  graphics: '<rect x="2.5" y="6.5" width="19" height="10" rx="1.5"/><circle cx="9" cy="11.5" r="2.8"/><path d="M14.5 9.5h4M14.5 12h4M14.5 14.5h2.5M5 16.5v2.5"/>',
  storage: '<ellipse cx="12" cy="6" rx="7.5" ry="2.5"/><path d="M4.5 6v12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V6M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  perimeter: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/><circle cx="15.5" cy="9.5" r=".9"/>',
  uplink: '<path d="M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9 16.5a4 4 0 0 1 6 0"/><circle cx="12" cy="19.5" r=".9"/>',
  environment: '<path d="M7.5 4v1.5M3.3 5.8l1 1M2 10h1.5"/><path d="M11 7.7a4 4 0 0 0-7 3"/><path d="M8.5 19.5h9a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.4 1.8 2.6 2.6 0 0 0 1.1 5.2z"/>',
};

export const instrumentIcon = (name: string): string => draw(INSTRUMENT[name] ?? "", 1.4, "mi-ic");

/** Two sheets, one over the other: copy. And the tick that replaces it for a moment once done. */
export const COPY_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 5.5V3.7A1.2 1.2 0 0 0 9.3 2.5H3.7A1.2 1.2 0 0 0 2.5 3.7v5.6a1.2 1.2 0 0 0 1.2 1.2h1.8"/></svg>`;
export const TICK_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>`;
