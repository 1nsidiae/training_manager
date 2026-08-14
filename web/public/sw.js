// v3: nieuw merk. De iconen worden cache-first geserveerd, dus zonder deze
// ophoging blijft het oude limoengroene icoon staan tot de cache vervalt.
const STATIC_CACHE = "training-manager-static-v3";
const STATIC_ASSETS = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !STATIC_ASSETS.includes(url.pathname)) return;

  if (url.pathname === "/manifest.json") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

// --- meldingen -------------------------------------------------------------
// De lading komt uit de Edge Function send-push. Wat er ook misgaat, er moet
// altijd íéts getoond worden: een push-event dat geen notificatie oplevert,
// laat sommige browsers "deze site draait op de achtergrond" tonen, en dat is
// verwarrender dan een lege melding.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Training Manager";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Meldingen van dezelfde soort vervangen elkaar in plaats van te stapelen:
    // drie keer "je schema is bijgesteld" is één bericht, geen drie.
    tag: payload.kind || "training-manager",
    renotify: true,
    data: { url: payload.url || "/", kind: payload.kind || null, ...(payload.data || {}) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Bestaat het venster al, dan navigeren we daarin. Anders krijg je bij
      // elke melding een nieuwe kopie van de app erbij.
      for (const client of clients) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      for (const client of clients) {
        if ("navigate" in client) return client.navigate(target).then((c) => c && c.focus());
      }
      return self.clients.openWindow(target);
    }),
  );
});
