// Ativação imediata do Service Worker
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', function(event) {
  let data = {};
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      // Fallback para caso o dado venha como string simples
      data = { title: 'Nova notificação', body: event.data.text() };
    }
  }

  const title = data.title || "Backstage Control";
  const options = {
    body: data.body || "Você tem uma nova atualização da banda.",
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    vibrate: [200, 100, 200],
    // Garante que o app abra na URL correta, ou na raiz caso não venha URL
    data: { 
      url: data.url || '/' 
    },
    // Melhora a experiência em dispositivos Android
    tag: 'backstage-notification', 
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  const urlToOpen = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(windowClients) {
        // Se o app já estiver aberto, foca nele em vez de abrir nova aba
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // Se não estiver aberto, abre a URL
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});