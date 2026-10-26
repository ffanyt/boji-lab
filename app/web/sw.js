/* 薄肌研究所 service worker: an offline copy of the page, and notifications.

   Offline: network first, the cache when the network fails. Only the page itself (/ and /index.html) and its static
   files (scripts, styles, fonts, icons, launch screens, the manifest) are kept; nothing under /api/ (records, photos,
   the account) is ever cached, nor /sw.js, the login and sign-up pages or the Shortcut download. Every request goes to
   the network as before (the server revalidates scripts and pages with ETags), so a deploy shows on the next load and
   nothing asks to "update"; a copy is only rewritten when its ETag changed. Opened without a connection, the page
   comes from the cache and shows its own 「连不上服务器」 banner. A new VERSION drops the old caches when it activates.

   Notifications: the server sends empty pushes; what to show comes from GET /api/push/next with this person's cookie,
   so nothing about them passes through the push service. Every push shows a notification (iOS takes the subscription
   away from a page whose pushes show nothing). A tap focuses the open 薄肌研究所 window and sends it where the message
   points (/#claude …), or opens a new one. */
'use strict';

const VERSION = '2026-10-16.1';
const CACHE = `lsj-static-${VERSION}`;
// Fetched when the worker installs, so the first offline start already works (each on its own: one missing file
// doesn't stop the rest). The page (/) only when signed in: a redirect to /login is never kept.
const PRECACHE = ['/', '/app.js', '/app.css', '/stats.js', '/stats.css', '/claude.js', '/claude.css', '/voice.js', '/abstract.css',
  '/manifest.webmanifest', '/fonts/barlow-condensed-500.woff2', '/fonts/barlow-condensed-600.woff2', '/fonts/barlow-condensed-700.woff2',
  '/icons/icon-180.png', '/icons/icon-192.png', '/icons/favicon.svg', '/icons/favicon-32.png'];
const ICON = '/icons/icon-192.png';
const FALLBACK = { title: '薄肌研究所：有新消息', body: '打开看看', url: '/' };

// The key a request is kept under, or null when it is never cached.
function cacheKey(url) {
  if (url.origin !== self.location.origin) return null;
  const p = url.pathname;
  if (p === '/' || p === '/index.html') return '/';
  if (p === '/sw.js' || p === '/login.js') return null;
  if (/^\/[A-Za-z0-9_-]{1,64}\.(js|css)$/.test(p)) return p;
  if (/^\/fonts\/[\w\-.]+\.woff2$/.test(p) || /^\/(icons|splash)\/[A-Za-z0-9_-]{1,80}\.(png|svg)$/.test(p)) return p;
  if (p === '/manifest.webmanifest') return p;
  return null;
}
const keepable = res => res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected;
// Store a fresh copy unless the one kept has the same ETag (then nothing is rewritten).
async function keep(cache, key, res) {
  try {
    const old = await cache.match(key), tag = res.headers.get('ETag');
    if (old && tag && old.headers.get('ETag') === tag) return;
    await cache.put(key, res);
  } catch (e) { /* storage full or refused: the network copy was still used */ }
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(PRECACHE.map(async p => {
      const res = await fetch(p, { credentials: 'same-origin', cache: 'no-cache' });
      if (keepable(res)) await keep(cache, cacheKey(new URL(p, self.location.origin)), res);
    }));
  })().catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('lsj-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (err) { return; }
  const key = cacheKey(url);
  if (!key) return;  // the browser handles it as if there were no worker
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (keepable(res)) e.waitUntil(keep(cache, key, res.clone()));
      else if (res.status >= 500) { const hit = await cache.match(key); if (hit) return hit; }  // the server is down behind the proxy
      return res;
    } catch (err) {
      const hit = await cache.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});

// Only paths on this site: anything else becomes the home page.
function sitePath(url) {
  try {
    const u = new URL(typeof url === 'string' && url ? url : '/', self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/';
  } catch (e) { return '/'; }
}

async function nextMessage() {
  try {
    const r = await fetch('/api/push/next', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (r.status !== 200) return null;  // 204: nothing waiting; 401: signed out
    const m = await r.json();
    return m && typeof m.title === 'string' && m.title ? m : null;
  } catch (e) { return null; }
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const m = await nextMessage();
    const msg = m || FALLBACK;
    return self.registration.showNotification(msg.title, {
      body: typeof msg.body === 'string' ? msg.body : '',
      icon: ICON, badge: ICON,
      tag: m && m.id != null ? `lsj-${m.id}` : 'lsj',
      timestamp: m && m.at ? Date.parse(m.at) || Date.now() : Date.now(),
      data: { url: sitePath(msg.url) },
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = sitePath(e.notification.data && e.notification.data.url);
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(c => new URL(c.url).origin === self.location.origin);
    if (win) {
      try { await win.focus(); } catch (err) { /* not allowed: the message still moves it */ }
      win.postMessage({ type: 'lsj-open', url });  // the page switches to that tab (app.js openFromPush)
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

// The browser replaced the subscription (expired or rotated): subscribe again with the server's key and hand it over.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const k = await fetch('/api/push/key', { credentials: 'include', cache: 'no-store' }).then(r => r.ok ? r.json() : null);
      if (!k || !k.key) return;
      const t = k.key.replace(/-/g, '+').replace(/_/g, '/'), raw = atob(t + '='.repeat((4 - t.length % 4) % 4));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
      const json = { 'Content-Type': 'application/json' };
      await fetch('/api/push/subscribe', { method: 'POST', credentials: 'include', headers: json, body: JSON.stringify(sub.toJSON()) });
      const old = e.oldSubscription && e.oldSubscription.endpoint;
      if (old && old !== sub.endpoint) await fetch('/api/push/subscribe', { method: 'DELETE', credentials: 'include', headers: json, body: JSON.stringify({ endpoint: old }) });
    } catch (err) { /* the page hands the subscription over again the next time it opens */ }
  })());
});
