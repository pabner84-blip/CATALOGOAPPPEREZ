/* =========================================================================
   SERVICE WORKER — CATÁLOGO PARA CLIENTES
   Guarda los archivos de la página en caché para que abra como aplicación
   y funcione SIN INTERNET (una vez que ya se cargó al menos una vez).

   Los productos viven en datos.json: también se dejan en caché, pero se
   intenta traer de la red primero para que los clientes siempre vean la
   última versión.

   OJO: si se cambia index.html, app.js, styles.css o los iconos, hay que
   SUBIR el número de versión de CACHE. Si no, el navegador sigue usando
   la copia vieja que ya tenía guardada.
   ========================================================================= */

const CACHE = 'catalogo-clientes-v1';

const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './icono-192.png',
  './icono-512.png'
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

    // datos.json SIEMPRE intenta la red primero: así el cliente ve las
    // últimas fotos apenas se actualizan, y si no hay internet usa la copia.
    if (url.pathname.endsWith('/datos.json')) {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        return (await cache.match(req)) || new Response('{"productos":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

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