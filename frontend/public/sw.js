const CACHE_NAME = "kwalify-static-v3";
const STATIC_ASSETS = [
  "/styles/base.css",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/og-image.svg",
  "/pages/app.js",
  "/lib/shared.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isHtmlNavigation(request) {
  return request.mode === "navigate" ||
    (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/benchmark") ||
    url.pathname.startsWith("/js/")
  ) {
    event.respondWith(fetch(request));
    return;
  }

  if (isHtmlNavigation(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match("/") || caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
