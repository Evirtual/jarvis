/** The viewer asked their system for less motion; animations hold still. */
export const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
