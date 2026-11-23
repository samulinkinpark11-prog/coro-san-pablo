// Red primero (para recibir siempre las mejoras); caché solo si no hay cobertura.
const CACHE = 'coro-v34';
const FILES = ['./', './index.html', './app.js', './config.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).catch(()=>{})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Librerías y letra de internet: primero la copia guardada (así la app abre sin cobertura)
  if (['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return res; })));
    return;
  }
  if (url.origin !== location.origin) return;   // Supabase y EmailJS van directos
  e.respondWith(fetch(e.request, {cache:'no-cache'}).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, {ignoreSearch:true}).then(r => r || caches.match('./index.html'))));
});

// ---------- Avisos al móvil ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Coro San Pablo', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag, renotify: !!d.tag,
    data: { url: d.url || self.registration.scope }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const base = (e.notification.data && e.notification.data.url) || self.registration.scope;
  // Abrir directamente donde toca según el tipo de aviso
  const tag = e.notification.tag || '';
  let hash = '';
  const m = tag.match(/^(quedada|recordatorio|alarma)-(.+)$/);
  if (m) hash = '#cal=' + m[2];
  else if (/^pago-/.test(tag)) hash = '#yo';
  else if (/^solicitud-/.test(tag)) hash = '#coro';
  else if (/^aviso-/.test(tag)) hash = '#avisos';
  const url = base.split('#')[0] + hash;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) {
      if (w.url.startsWith(self.registration.scope) && 'focus' in w) { w.postMessage({ deepLink: hash }); return w.focus(); }
    }
    return clients.openWindow(url);
  }));
});
