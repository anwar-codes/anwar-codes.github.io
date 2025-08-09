const CACHE='rhythm-hero-lite-v6.0.4-full';
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.map(k=>k!==CACHE&&caches.delete(k))); await clients.claim();})());});
self.addEventListener('fetch',event=>{event.respondWith((async()=>{
  const req=event.request; const url=new URL(req.url);
  try{ const net=await fetch(req); const cache=await caches.open(CACHE); cache.put(req, net.clone()); return net; }
  catch(e){ const cache=await caches.open(CACHE); const res=await cache.match(req); if(res) return res; throw e; }
})());});
