/* LSH HR Mock Calls as an installed app (its own window, icon and taskbar entry).
   Calls need the network, so nothing is cached for use offline: pages and the API always come from the
   site. Only a short "you're offline" page is kept, for when the computer has no connection. */
const OFFLINE = 'hrmc-offline-v1';
const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LSH HR Mock Calls</title>
<body style="margin:0;font-family:Arial,sans-serif;background:#081226;color:#fff;display:grid;place-items:center;height:100vh;text-align:center">
<div><div style="font-size:42px">☎</div><h1 style="font-size:20px">LSH HR Mock Calls is offline</h1><p style="color:#cbd5e1">This computer isn't connected to the internet. Calls need a connection.</p>
<button onclick="location.reload()" style="background:#f97316;border:0;border-radius:10px;padding:10px 18px;font-weight:700;cursor:pointer">Try again</button></div></body>`;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(OFFLINE).then((c) => c.put('/__offline', new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== OFFLINE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;   // everything else goes straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match('/__offline')));
});
