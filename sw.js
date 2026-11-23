/* Decrypts the family data and photos on the fly.
 *
 * The published site holds only encrypted blobs (e/<hash>.bin). The page asks for the
 * usual paths (data/family.js, assets/...); this worker fetches the matching blob and
 * decrypts it with the key the visitor unlocked the site with (kept in IndexedDB as a
 * non-extractable CryptoKey). Without the key every such request answers 401. */
"use strict";

const DB = "ft-gate", STORE = "keys";
let keyPromise = null;

function getKey() {
  if (!keyPromise) {
    keyPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const get = open.result.transaction(STORE).objectStore(STORE).get("k");
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => reject(get.error);
      };
    }).then((k) => { if (!k) keyPromise = null; return k; }, (e) => { keyPromise = null; throw e; });
  }
  return keyPromise;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function blobName(path) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ft1:" + path));
  return hex(d).slice(0, 32);
}

const TYPES = {
  js: "text/javascript", json: "application/json", svg: "image/svg+xml",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4",
};

async function serve(request, rel) {
  const key = await getKey();
  if (!key) return new Response("Accesso su invito", { status: 401 });
  const base = new URL("./", self.registration.scope).href;
  const res = await fetch(base + "e/" + (await blobName(rel)) + ".bin");
  if (!res.ok) return new Response("Non trovato", { status: 404 });
  const buf = await res.arrayBuffer();
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
  } catch (e) {
    return new Response("Codice non valido", { status: 403 });
  }
  const ext = rel.split(".").pop().toLowerCase();
  const headers = { "Content-Type": TYPES[ext] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  // Safari only plays audio/video when byte ranges are honoured.
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
  if (m && (m[1] || m[2])) {
    const size = plain.byteLength;
    let start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
    let end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
    headers["Content-Range"] = "bytes " + start + "-" + end + "/" + size;
    return new Response(plain.slice(start, end + 1), { status: 206, headers });
  }
  return new Response(plain, { status: 200, headers });
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => { if (e.data && e.data.type === "reset") keyPromise = null; });

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  let rel;
  try { rel = decodeURIComponent(url.pathname.slice(scope.pathname.length)); } catch (e) { return; }
  if (rel === "data/family.js" || rel.startsWith("assets/")) event.respondWith(serve(req, rel));
});
