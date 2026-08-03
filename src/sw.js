import { precacheAndRoute } from 'workbox-precaching';

// 1. INJEÇÃO AUTOMÁTICA DO VITE
// O vite-plugin-pwa substituirá self.__WB_MANIFEST pelos arquivos estáticos compilados com Hash
precacheAndRoute(self.__WB_MANIFEST || []);

const CACHE_NAME = 'coeng-tools-cache-v6';

// INSTALAÇÃO
self.addEventListener('install', () => {
  console.log('PWA: Novo Service Worker Instalado (VitePWA)');
  self.skipWaiting();
});

// ATIVAÇÃO: Limpa caches customizados de versões antigas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          // Cuidado para limpar apenas os nossos antigos, e não os do Workbox (workbox-precache-v2-...)
          if (name.startsWith('coeng-tools-cache') && name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// INTERCEPTAÇÃO RUNTIME: Estratégia "Stale-While-Revalidate"
// (O precacheAndRoute acima já responde pelos arquivos principais em cache.
// O que não estiver lá cai nesse fetch dinâmico)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (
    requestUrl.pathname === '/manifest.json' ||
    (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') ||
    requestUrl.origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    caches
      .match(event.request)
      .then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            const responseClone = networkResponse.clone();

            return caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, responseClone))
              .catch(() => undefined)
              .then(() => networkResponse);
          })
          .catch(() => cachedResponse || Response.error());

        return cachedResponse || fetchPromise;
      })
      .catch(() => Response.error())
  );
});
