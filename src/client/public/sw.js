/* global self */

// What makes the console installable on a phone or desktop. It caches
// nothing: JARVIS is live readings, live answers and a live voice, so every
// request goes straight to the network, exactly as if there were no worker.
// (An empty fetch handler leaves each request to the browser.)
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {});
