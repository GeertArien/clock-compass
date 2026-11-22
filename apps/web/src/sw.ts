/// <reference lib="webworker" />
// Clock & Compass service worker: app-shell precache, font caching, and web push.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

// Apply updates at once: a new worker activates without waiting for every
// window of the app to close, then takes over the open pages. The page side
// (registerSW, registerType "autoUpdate") reloads when that happens, so an
// installed app picks up a new deploy on its next update check.
self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Every screen has its own path (/compass/people, …): navigations to them are
// answered with the precached app shell, so a deep reload works offline. The
// server's own pages stay on the network: the API and its docs.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api(\/|$)/, /^\/docs(\/|$)/],
  }),
);

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

// The assistant's chunk (issue #62) is not precached: installs and updates do
// not download it for people who never open the assistant. It is cached on
// first open instead; its name carries a content hash, so a cached copy is
// never stale, and after that first open the sheet opens offline too.
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin && request.destination === "script" && /^\/assets\/AssistantSheet-[\w-]+\.js$/.test(url.pathname),
  new CacheFirst({
    cacheName: "assistant-chunk",
    plugins: [new ExpirationPlugin({ maxEntries: 2 })],
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
