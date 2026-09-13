/** A number held between two others — written once, for every edge on the board. */
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
