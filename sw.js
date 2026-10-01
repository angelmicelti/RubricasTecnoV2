/* =====================================================================
   Service Worker — Rúbricas de Evaluación (Departamento de Tecnología)
   ---------------------------------------------------------------------
   Estrategia:
     · Navegación (la propia app): RED PRIMERO, con respaldo en caché
       para funcionamiento sin conexión. Así las actualizaciones de
       rubricas.html se aplican en cuanto haya red.
     · Recursos estáticos (iconos, PDFs, Tailwind CDN, SDK Firebase,
       Google Fonts): stale-while-revalidate (caché primero y
       actualización en segundo plano). Permite arrancar offline.
     · Base de datos Firebase (Realtime Database): SIEMPRE red, nunca
       se cachea (datos vivos del gestor de rúbricas).

   IMPORTANTE: si en el futuro se modifican los archivos de la app,
   sube también este sw.js cambiando VERSION (p. ej. 'v2') para que
   los clientes renueven su caché.
   ===================================================================== */
'use strict';

const VERSION = 'v6';
const CACHE = 'rubricas-app-' + VERSION;

/* Recursos básicos que se guardan al instalar (tolerante a fallos) */
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* Hosts de Firebase RTDB: siempre red, sin caché */
const HOSTS_SOLO_RED = [
  'firebaseio.com',
  'firebasedatabase.app'
];

function esSoloRed(hostname) {
  return HOSTS_SOLO_RED.some(h => hostname === h || hostname.endsWith('.' + h));
}

/* --- Instalación: precachear lo básico y activar enseguida ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CORE.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

/* --- Activación: limpiar cachés antiguos y tomar el control --------- */
// Solo borrar cachés de esta propia app (por prefijo): no tocar las cachés
// del portal ni las de otras apps alojadas en subcarpetas del mismo dominio.
const esCachePropia = (c) => c.startsWith('rubricas-app-');

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter(c => c !== CACHE && esCachePropia(c)).map(c => caches.delete(c)));
    await self.clients.claim();
  })());
});

/* --- Intercepción de peticiones -------------------------------------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Solo GET y solo http/https
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Firebase RTDB: datos en tiempo real → siempre red
  if (esSoloRed(url.hostname)) return;

  // Navegación (la app): red primero, caché como respaldo offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) ||
               (await cache.match('./rubricas.html')) ||
               (await cache.match('./')) ||
               new Response('<h1>Sin conexión</h1><p>No hay copia guardada de la aplicación.</p>',
                 { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // Resto de recursos: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    const actualizar = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(req, res.clone());
      }
      return res;
    }).catch(() => null);

    if (cached) {
      actualizar; // actualizar en segundo plano sin bloquear
      return cached;
    }
    const fresh = await actualizar;
    return fresh || new Response('', { status: 504, statusText: 'Offline' });
  })());
});
