// Service worker: só recebe push do coletor e mostra a notificação
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json() } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.t || 'Apuração das Eleições 2026', {
    body: d.b || '', tag: d.tag || 'apuracao', renotify: true, icon: '/favicon.svg', badge: '/favicon.svg',
    requireInteraction: !!d.flip, vibrate: d.flip ? [300, 100, 300, 100, 600] : [120]
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => l.length ? l[0].focus() : self.clients.openWindow('/')));
});
