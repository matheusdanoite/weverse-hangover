importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging-compat.js');

// To receive push notifications, the service worker needs the Firebase config.
// Since we don't have modules here easily, we will expect the frontend to register
// the service worker and pass the config, or we fetch it from the same API endpoint.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// We need to fetch the config to initialize Firebase in the background
let messaging = null;

async function initFirebase() {
  if (messaging) return messaging;
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    
    firebase.initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId
    });
    
    messaging = firebase.messaging();
    
    messaging.onBackgroundMessage((payload) => {
      console.log('[firebase-messaging-sw.js] Received background message ', payload);
      const notificationTitle = payload.notification.title;
      const notificationOptions = {
        body: payload.notification.body,
        icon: '/favicon.ico' // Ensure you have an icon, or fallback to default
      };

      self.registration.showNotification(notificationTitle, notificationOptions);
    });
    return messaging;
  } catch (err) {
    console.error('Failed to init Firebase in SW:', err);
  }
}

// Intercept push to ensure firebase is initialized
self.addEventListener('push', (event) => {
  event.waitUntil(initFirebase());
});
