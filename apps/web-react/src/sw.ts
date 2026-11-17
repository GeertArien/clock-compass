/// <reference lib="webworker" />
// Clock & Compass service worker: app-shell precache, font caching, and web push.
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Google Fonts: stylesheets refresh in the background, font files cache hard
// (immutable by URL) — so the Field Notes type works offline.
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new NetworkFirst({ cacheName: "google-fonts-styles" }),
);
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "google-fonts-files",
    plugins: [new ExpirationPlugin({ maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
);

// --- Web push -----------------------------------------------------------------

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Clock & Compass", {
      body: payload.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url ?? "/" },
    }),
  );
});

// A tap deep-links into the relevant screen, reusing an open tab when there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clients[0];
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: "navigate", url });
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
