// Service worker : le site s'installe comme une appli (PWA) et s'ouvre même hors ligne.
// - pages : réseau d'abord (toujours la dernière version publiée), sinon la copie en cache ;
// - fichiers de /assets/ : leur nom change à chaque version, donc cache d'abord ;
// - autres fichiers du site : cache, mis à jour en arrière-plan.
// Rien n'est mis en cache pour les autres domaines (Supabase : scores, points, salons).

const CACHE = 'notes-v1';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (res.ok) await cache.put('./', res.clone());
          return res;
        } catch {
          return (await cache.match('./')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const refresh = fetch(req).then(
        (res) => {
          if (res.ok) void cache.put(req, res.clone());
          return res;
        },
        () => null,
      );
      if (hit && url.pathname.includes('/assets/')) return hit;
      if (hit) {
        e.waitUntil(refresh);
        return hit;
      }
      return (await refresh) ?? Response.error();
    })(),
  );
});
