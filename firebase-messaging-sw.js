// Service Worker de push para o painel admin do Weverse Hangover.
// Não usa Firebase no SW — lê o payload diretamente da Web Push API,
// que é o formato entregue pelo FCM HTTP v1. Isso elimina a race condition
// onde firebase.messaging() era registrado tarde demais para interceptar
// o evento push já em execução.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let title = 'Weverse Hangover';
  let body  = 'Nova atividade no painel.';
  let link  = '/adm/';

  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.notification?.title || title;
      body  = payload.notification?.body  || body;
      link  = payload.webpush?.fcm_options?.link || link;
    } catch {}
  }

  event.waitUntil((async () => {
    // Avisa abas abertas do /adm/ via BroadcastChannel (notificação em foreground)
    const bc = new BroadcastChannel('hangul-push');
    bc.postMessage({ title, body });
    bc.close();

    // Exibe notificação push somente se nenhuma aba do /adm/ estiver visível
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const hasVisibleAdm = windowClients.some(
      c => c.url.includes('/adm/') && c.visibilityState === 'visible'
    );
    if (!hasVisibleAdm) {
      await self.registration.showNotification(title, {
        body,
        icon:  '/icon.png',
        badge: '/icon.png',
        data:  { link },
      });
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const link = event.notification.data?.link || '/adm/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(all => {
      const adm = all.find(c => c.url.includes('/adm/'));
      return adm ? adm.focus() : clients.openWindow(link);
    })
  );
});
