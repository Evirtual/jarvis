/**
 * Where the console's back end is.
 *
 * On the PC the page is served by the console's own server, which reads the
 * machine, sweeps the network, runs the voice and keeps the keys. Published as
 * a web page (GitHub Pages) there is no server: the browser does that work
 * itself — see browser-core.ts and sensors.ts. The published build sets
 * VITE_JARVIS_SERVERLESS=1.
 */

export const SERVERLESS = import.meta.env.VITE_JARVIS_SERVERLESS === "1";
