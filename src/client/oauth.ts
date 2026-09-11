/**
 * OpenRouter's one-click connection (OAuth with PKCE): no key to find or
 * copy. Connect opens OpenRouter in a new tab to sign in — or to make a free
 * account — so the console you were using stays as it was. OpenRouter sends
 * that tab back here with a one-time code, which becomes a key: on the PC the
 * server fetches and keeps it (it never reaches the browser); in the web
 * version the page fetches it and keeps it on the device. The sign-in tab then
 * tells the original one it's connected, and closes.
 */

import { api } from "./api.js";

// Kept in local storage, not session storage: the sign-in happens in another tab.
const PENDING = "jarvis.openrouterSignIn";
const CHANNEL = "jarvis-openrouter";

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Off to OpenRouter, in a new tab. The secret half of the exchange stays on this device until it comes back. */
export async function startOpenRouter(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  // S256 wherever the page is a secure context; the plain method only where it isn't (an http address on the network)
  let challenge = verifier;
  let method: "S256" | "plain" = "plain";
  if (crypto.subtle) {
    challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    method = "S256";
  }
  const remember = (newTab: boolean): void => {
    try { localStorage.setItem(PENDING, JSON.stringify({ verifier, method, at: Date.now(), newTab })); } catch { /* private mode */ }
  };
  const back = `${location.origin}${location.pathname}`;
  const url = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(back)}&code_challenge=${challenge}&code_challenge_method=${method}`;
  // A new tab keeps this console as it is; if the browser won't open one, go in this tab instead.
  remember(true);
  if (!window.open(url, "_blank")) { remember(false); location.href = url; }
}

/** The original tab: told when the sign-in tab has connected. */
export function onOpenRouterConnected(f: () => void): void {
  try { new BroadcastChannel(CHANNEL).onmessage = (e: MessageEvent<{ t?: string }>) => { if (e.data?.t === "connected") f(); }; } catch { /* no BroadcastChannel: refresh on focus instead */ }
}

/**
 * Back from OpenRouter: turn the code into a connection. "none" when this
 * page load isn't a return from OpenRouter; otherwise what happened, in words.
 */
export async function finishOpenRouter(): Promise<"none" | "connected" | "connected-elsewhere" | string> {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  if (!code) return "none";
  // the code is single-use: take it out of the address bar and the history
  url.searchParams.delete("code");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  let pending: string | null = null;
  try { pending = localStorage.getItem(PENDING); localStorage.removeItem(PENDING); } catch { /* private mode */ }
  if (!pending) return "OpenRouter sent a sign-in back, but it wasn't started on this device — press Connect with OpenRouter again.";
  const { verifier, method, at, newTab } = JSON.parse(pending) as { verifier: string; method: "S256" | "plain"; at?: number; newTab?: boolean };
  if (at && Date.now() - at > 30 * 60 * 1000) return "That OpenRouter sign-in took too long and has lapsed — press Connect with OpenRouter again.";
  try {
    await api.connectOpenRouter(code, verifier, method);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  // Tell the tab that started it; if this tab was opened for the sign-in, it has done its job.
  let told = false;
  try { new BroadcastChannel(CHANNEL).postMessage({ t: "connected" }); told = true; } catch { /* none */ }
  if (told && newTab) {
    window.close(); // allowed only for a tab a script opened; if it stays, it says it can be closed
    return "connected-elsewhere";
  }
  return "connected";
}
