// Service worker de Eco — patrón estándar del ecosistema Dotrino.
// Navegación (HTML): network-first con fallback a caché.
// Resto de assets: cache-first con refresco en segundo plano.
const CACHE = 'eco-v2'
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return // no cachear terceros (vault iframe, proxy, geo)

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy))
        return res
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    )
    return
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy))
        return res
      }).catch(() => cached)
      return cached || network
    })
  )
})

// Web Push del proxy: despierta la app (drena su cola) y, si no hay ventana
// visible, muestra una notificación genérica (sin contenido del usuario).
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of cs) { try { c.postMessage({ type: 'cc-push-ring' }) } catch (_) {} }
    const visible = cs.some((c) => c.visibilityState === 'visible')
    if (visible) return
    let title = 'Eco', body = 'Tienes actividad nueva'
    try { const d = e.data && e.data.json(); if (d) { title = d.title || title; body = d.body || body } } catch (_) {}
    await self.registration.showNotification(title, { body, icon: './icon-192.png', badge: './icon-192.png', tag: 'eco-activity' })
  })())
})

// Enfocar/abrir al clickear la notificación.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(clients.matchAll({ type: 'window' }).then((cs) => {
    for (const c of cs) { if ('focus' in c) return c.focus() }
    if (clients.openWindow) return clients.openWindow('./')
  }))
})
