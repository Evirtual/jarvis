/**
 * OpenRouter's one-click connection (OAuth with PKCE): no key to find or
 * copy. Connect sends you to OpenRouter to sign in — or to make a free
 * account — and OpenRouter sends you back here with a one-time code, which
 * becomes a key: on the PC the server fetches and keeps it (it never reaches
 * the browser); in the web version the page fetches it and keeps it on the
 * device.
 */

import { api } from "./api.js";

const PENDING = "jarvis.openrouterSignIn";

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Off to OpenRouter. The secret half of the exchange stays in this tab until it comes back. */
export async function startOpenRouter(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  // S256 wherever the page is a secure context; the plain method only where it isn't (an http address on the network)
  let challenge = verifier;
  let method: "S256" | "plain" = "plain";
  if (crypto.subtle) {
    challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    method = "S256";
  }
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, method }));
  const back = `${location.origin}${location.pathname}`;
  location.href = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(back)}&code_challenge=${challenge}&code_challenge_method=${method}`;
}

/**
 * Back from OpenRouter: turn the code into a connection. "none" when this
 * page load isn't a return from OpenRouter; otherwise what happened, in words.
 */
export async function finishOpenRouter(): Promise<"none" | "connected" | string> {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  if (!code) return "none";
  // the code is single-use: take it out of the address bar and the history
  url.searchParams.delete("code");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  const pending = sessionStorage.getItem(PENDING);
  sessionStorage.removeItem(PENDING);
  if (!pending) return "OpenRouter sent a sign-in back, but it wasn't started from this tab — press Connect with OpenRouter again.";
  const { verifier, method } = JSON.parse(pending) as { verifier: string; method: "S256" | "plain" };
  try {
    await api.connectOpenRouter(code, verifier, method);
    return "connected";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
