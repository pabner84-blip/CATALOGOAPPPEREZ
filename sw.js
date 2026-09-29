/* =========================================================================
   SERVICE WORKER — CATÁLOGO
   Guarda los archivos de la app en caché para que abra como aplicación y
   funcione SIN INTERNET.
   Los productos y las fotos NO pasan por aquí: viven en IndexedDB.

   OJO: si se cambia index.html, app.js, styles.css o los iconos, hay que
   SUBIR el número de versión de CACHE. Si no, el navegador sigue usando
   la copia vieja que ya tenía guardada.
   ========================================================================= */

const CACHE = 'catalogo-tienda-v2';

const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(
        PRECACHE.map(u => cache.add(new Request(u, { cache: 'reload' })))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // nada externo que cachear

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Navegación y archivos de la app: primero la red (para traer cambios),
    // y si no hay internet, la copia guardada.
    const esNavegacion = req.mode === 'navigate';
    if (esNavegacion) {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        return (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               new Response('Sin conexión.', { status: 503 });
      }
    }

    const guardada = await cache.match(req);
    const red = fetch(req)
      .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => null);

    if (guardada) return guardada;
    return (await red) || new Response('', { status: 504 });
  })());
});
