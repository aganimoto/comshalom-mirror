// Service Worker para notificações push

const CACHE_NAME = 'comshalom-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/icon-192x192.png',
  '/badge-72x72.png'
];

// Instalação do Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

// Ativação do Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Intercepta requisições para cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});

// Polling para verificar novas notificações
let lastCheckTime = 0;
const WORKER_URL = self.location.origin.includes('localhost') 
  ? 'http://localhost:8787'
  : 'https://comshalom-rss-monitor.tominaga.workers.dev';

async function checkForNotifications() {
  try {
    const response = await fetch(`${WORKER_URL}/api/push/check`, {
      headers: {
        'X-Last-Check': String(lastCheckTime)
      }
    });
    
    if (!response.ok) {
      return;
    }
    
    const data = await response.json();
    
    if (data.hasNew && data.notification) {
      const notification = data.notification;
      lastCheckTime = notification.timestamp || Date.now();
      
      await self.registration.showNotification(notification.title, {
        body: notification.body,
        icon: notification.icon || '/icon-192x192.png',
        badge: '/badge-72x72.png',
        data: {
          url: notification.url || '/',
          timestamp: notification.timestamp
        },
        tag: 'new-communique',
        requireInteraction: false,
        vibrate: [200, 100, 200],
        actions: [
          {
            action: 'open',
            title: 'Abrir'
          },
          {
            action: 'close',
            title: 'Fechar'
          }
        ]
      });
    }
  } catch (error) {
    console.error('Erro ao verificar notificações:', error);
  }
}

// Verifica notificações a cada 30 segundos quando o Service Worker está ativo
setInterval(checkForNotifications, 30000);

// Recebe mensagens push (se Web Push estiver configurado)
self.addEventListener('push', (event) => {
  let data = {};
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Novo Comunicado', body: event.data.text() };
    }
  }

  const options = {
    title: data.title || 'Novo Comunicado Detectado',
    body: data.body || 'Um novo comunicado foi detectado no RSS',
    icon: data.icon || '/icon-192x192.png',
    badge: '/badge-72x72.png',
    data: {
      url: data.url || '/',
      timestamp: Date.now()
    },
    tag: 'new-communique',
    requireInteraction: false,
    vibrate: [200, 100, 200],
    actions: [
      {
        action: 'open',
        title: 'Abrir'
      },
      {
        action: 'close',
        title: 'Fechar'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(options.title, options)
  );
});

// Clique na notificação
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    const urlToOpen = event.notification.data?.url || '/';
    
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Verifica se já existe uma janela aberta
          for (let i = 0; i < clientList.length; i++) {
            const client = clientList[i];
            if (client.url === urlToOpen && 'focus' in client) {
              return client.focus();
            }
          }
          // Abre nova janela se não existir
          if (clients.openWindow) {
            return clients.openWindow(urlToOpen);
          }
        })
    );
  }
});

