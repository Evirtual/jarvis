/**
 * The device's own voices: which of them sound most like him, and how to
 * name one. Pure, so the ranking can be tested without a browser.
 */

/** What a device voice looks like, as far as this module cares. */
export interface DeviceVoice { name: string; lang: string }

const GB_MALE = /(george|ryan|thomas|oliver|arthur|daniel|james|brian|guy|edward|male)/i;
const FEMALE = /(zira|hazel|susan|libby|sonia|maisie|olivia|female|samantha|karen|moira|tessa|fiona|catherine|aria|jenny)/i;
const NOVELTY = /(novelty|whisper|zarvox|trinoids|bells|bad news|good news|cellos|organ|bubbles|boing|jester|superstar|wobble|rocko|shelley|grandma|grandpa|eddy|flo|sandy|reed|junior|albert|fred|ralph|kathy|princess|deranged|hysterical|bahh)/i;

const langOf = (v: DeviceVoice): string => String(v.lang || "").replace("_", "-");

/** How JARVIS-like a voice is: British, male, natural; never a novelty. */
export function scoreVoice(v: DeviceVoice): number {
  let s = 0;
  const lang = langOf(v);
  const n = String(v.name || "");
  if (/^en-GB/i.test(lang)) s += 120;
  else if (/^en-(IE|AU|NZ|ZA)/i.test(lang)) s += 55;
  else if (/^en/i.test(lang)) s += 15;
  else s -= 400;
  if (GB_MALE.test(n)) s += 45;
  if (FEMALE.test(n)) s -= 65;
  if (/natural|neural|online/i.test(n)) s += 35;
  if (NOVELTY.test(n)) s -= 400;
  return s;
}

/** "Microsoft Ryan Online (Natural) - English (United Kingdom)" → "Ryan Online ✦". */
export function shortName(v: { name: string }): string {
  return v.name
    .replace(/^(Microsoft|Google|Apple)\s+/i, "")
    .replace(/\s*[-–]\s*English.*$/i, "")
    .replace(/\s*\((Natural|Enhanced|Premium)\)\s*/i, " ✦ ")
    .trim();
}

/** The English voices, the most JARVIS-like first — or every voice, where none is English. */
export function rankDeviceVoices<T extends DeviceVoice>(all: T[]): T[] {
  const en = all.filter((v) => /^en/i.test(langOf(v)));
  return (en.length ? en : all).slice().sort((a, b) => scoreVoice(b) - scoreVoice(a));
}
