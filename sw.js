const CACHE_NAME = 'am4-alert-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Install: cache assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first strategy
self.addEventListener('fetch', e => {
  // Don't cache external requests (scraping)
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Background sync for price checking
self.addEventListener('sync', e => {
  if (e.tag === 'check-prices') {
    e.waitUntil(checkPricesAndNotify());
  }
});

// Periodic background sync
self.addEventListener('periodicsync', e => {
  if (e.tag === 'am4-price-check') {
    e.waitUntil(checkPricesAndNotify());
  }
});

async function checkPricesAndNotify() {
  try {
    // Read thresholds from cache storage
    const db = await getSettings();
    const fuelThreshold = db.fuelThreshold || 600;
    const co2Threshold  = db.co2Threshold  || 150;

    const prices = await fetchPrices();
    if (!prices) return;

    const { fuel, co2 } = prices;
    const bothCheap = fuel < fuelThreshold && co2 < co2Threshold;

    if (bothCheap) {
      // Check if we already notified for these prices
      const lastAlert = db.lastAlert || {};
      if (lastAlert.fuel === fuel && lastAlert.co2 === co2) return;

      await self.registration.showNotification('✈️ AM4 — Preços Baratos!', {
        body: `⛽ Combustível: $${fuel}  •  🌿 CO2: $${co2}\nCompre agora!`,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: 'am4-price-alert',
        renotify: true,
        vibrate: [200, 100, 200],
        data: { fuel, co2 },
        actions: [
          { action: 'open', title: '✈️ Abrir AM4' }
        ]
      });

      // Save last alert
      await saveSettings({ ...db, lastAlert: { fuel, co2 } });
    }
  } catch (err) {
    console.error('[SW] checkPricesAndNotify error:', err);
  }
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'open') {
    e.waitUntil(clients.openWindow('https://www.airlinemanager.com'));
  }
});

// --- Helpers ---

async function fetchPrices() {
  try {
    const resp = await fetch('https://am4info.com/', { mode: 'cors' });
    const text = await resp.text();

    const fuelMatch = text.match(/Fuel[^$\d]*\$?\s*(\d{3,4})/i);
    const co2Match  = text.match(/CO.?2[^$\d]*\$?\s*(\d{2,3})/i);

    if (fuelMatch && co2Match) {
      return { fuel: parseInt(fuelMatch[1]), co2: parseInt(co2Match[1]) };
    }
    return null;
  } catch {
    return null;
  }
}

async function getSettings() {
  try {
    const cache = await caches.open('am4-settings');
    const resp  = await cache.match('settings');
    if (resp) return await resp.json();
  } catch {}
  return {};
}

async function saveSettings(data) {
  try {
    const cache = await caches.open('am4-settings');
    await cache.put('settings', new Response(JSON.stringify(data)));
  } catch {}
}
