/**
 * Where the console's server is.
 *
 * Normally the page is served by the server itself, and every call is a
 * relative `/api/...`. Published elsewhere — on GitHub Pages, say — the page
 * is built with VITE_JARVIS_SERVER, the https address of the server at home,
 * and every call goes there instead, carrying the browser's cookies so an
 * access check in front of it (Cloudflare Access or similar) still applies.
 */

const configured = (import.meta.env.VITE_JARVIS_SERVER as string | undefined)?.trim().replace(/\/+$/, "") ?? "";

/** The server's origin, or "" when this page came from it. */
export const SERVER = configured && new URL(configured, location.href).origin !== location.origin ? configured : "";

/** Whether calls leave this page's origin. */
export const CROSS_ORIGIN = SERVER !== "";

export const apiUrl = (path: string): string => SERVER + path;

/** Cookies go along only when they must: an access check on the far side needs them. */
export const CREDENTIALS: RequestCredentials = CROSS_ORIGIN ? "include" : "same-origin";
