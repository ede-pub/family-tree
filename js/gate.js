/* Lock screen for the published (encrypted) site.
 *
 * The invitation is a secret key carried in the link / QR code after the "#"
 * (https://…/#k=<key>). Browsers never send that part to the server. The key is checked
 * against a tiny encrypted test file, stored in this browser (IndexedDB, non-extractable),
 * and the service worker (sw.js) then decrypts the data and photos transparently.
 * Only after that are the normal scripts of the site loaded. */
(function () {
  "use strict";
  const SCRIPTS = (document.currentScript.dataset.scripts || "").split(",").filter(Boolean);
  const DB = "ft-gate", STORE = "keys";
  const KEY_RE = /[A-Za-z0-9_-]{43}/;

  /* ---------- helpers ---------- */
  const b64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const blobName = async (path) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ft1:" + path))).slice(0, 32);
  const idb = () => new Promise((res, rej) => { const o = indexedDB.open(DB, 1); o.onupgradeneeded = () => o.result.createObjectStore(STORE); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
  const idbGet = async () => { const db = await idb(); return new Promise((res, rej) => { const g = db.transaction(STORE).objectStore(STORE).get("k"); g.onsuccess = () => res(g.result || null); g.onerror = () => rej(g.error); }); };
  const idbPut = async (k) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).put(k, "k"); t.oncomplete = res; t.onerror = () => rej(t.error); }); };
  const idbDel = async () => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).delete("k"); t.oncomplete = res; t.onerror = () => rej(t.error); }); };

  /* ---------- lock screen ---------- */
  const css = document.createElement("style");
  css.textContent = `
  #gate{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 30%,#1c2540 0%,#0f1420 70%);color:#f6efe2;font-family:var(--sans,system-ui,sans-serif);text-align:center}
  #gate .g-box{max-width:420px;width:100%}
  #gate h1{font-family:var(--serif,Georgia,serif);font-weight:600;font-size:2.4rem;margin:.2em 0 .1em;color:#ffcf7a;letter-spacing:.01em}
  #gate .g-sub{margin:0 0 1.6em;color:#d6a85b;letter-spacing:.18em;text-transform:uppercase;font-size:.72rem}
  #gate .g-emblem{width:54px;height:54px;margin:0 auto 6px;color:#d6a85b}
  #gate p{line-height:1.55;color:#cfc6b6;margin:.4em 0}
  #gate form{display:flex;gap:8px;margin-top:1.4em}
  #gate input{flex:1;min-width:0;padding:.75em .9em;border-radius:10px;border:1px solid rgba(214,168,91,.45);background:rgba(255,255,255,.06);color:#f6efe2;font:inherit;font-size:.95rem}
  #gate input:focus-visible,#gate button:focus-visible{outline:2px solid #ffcf7a;outline-offset:2px}
  #gate button{padding:.75em 1.2em;border-radius:10px;border:0;background:#d6a85b;color:#1a1408;font:inherit;font-weight:600;cursor:pointer}
  #gate button:hover{background:#ffcf7a}
  #gate .g-err{min-height:1.4em;color:#ff9b8a;font-size:.9rem;margin-top:.8em}
  #gate .g-busy{animation:gpulse 1.6s ease-in-out infinite}
  @keyframes gpulse{50%{opacity:.45}}
  @media (prefers-reduced-motion:reduce){#gate .g-busy{animation:none}}
  #lock-btn{margin-left:2px}`;
  document.head.appendChild(css);

  const gate = document.createElement("div");
  gate.id = "gate";
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-label", "Accesso su invito");
  const emblem = '<svg class="g-emblem" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M24 42V24M24 24c0-8-8-8-8-16M24 24c0-8 8-8 8-16M24 32c-6 0-10-3-12-8M24 32c6 0 10-3 12-8"/><circle cx="16" cy="8" r="2.5"/><circle cx="32" cy="8" r="2.5"/><circle cx="12" cy="24" r="2.5"/><circle cx="36" cy="24" r="2.5"/></svg>';
  const view = (html) => { gate.innerHTML = '<div class="g-box">' + emblem + "<h1>Albero Genealogico</h1>" + html + "</div>"; };
  document.body.appendChild(gate);

  const busy = () => view('<p class="g-sub">Accesso su invito</p><p class="g-busy" role="status">Apertura dell’albero…</p>');
  function ask(error) {
    view('<p class="g-sub">Accesso su invito</p>' +
      "<p>Scansiona il codice QR che hai ricevuto, oppure incolla qui il codice o il link di invito.</p>" +
      '<form><input type="text" id="g-in" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Codice di invito" placeholder="Codice di invito"><button type="submit">Entra</button></form>' +
      '<div class="g-err" role="alert"></div>');
    gate.querySelector(".g-err").textContent = error || "";
    const input = gate.querySelector("#g-in");
    gate.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const m = KEY_RE.exec(input.value.trim());
      if (!m) { gate.querySelector(".g-err").textContent = "Il codice non sembra corretto."; return; }
      start(m[0]);
    });
    input.focus();
  }

  /* ---------- unlocking ---------- */
  async function verify(key) {
    try {
      const res = await fetch("e/" + (await blobName("__check")) + ".bin", { cache: "no-store" });
      if (!res.ok) return false;
      const buf = await res.arrayBuffer();
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
      return new TextDecoder().decode(plain) === "ok";
    } catch (e) { return false; }
  }
  async function check(keyBytes) {
    if (keyBytes.length !== 32) return null;
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    return (await verify(key)) ? key : null;
  }

  async function openSite(key) {
    await idbPut(key);
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => { navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }); setTimeout(r, 4000); });
    }
    if (!navigator.serviceWorker.controller) {
      if (!sessionStorage.getItem("ft-gate-reload")) { sessionStorage.setItem("ft-gate-reload", "1"); location.reload(); return; }
      throw new Error("sw");
    }
    sessionStorage.removeItem("ft-gate-reload");
    navigator.serviceWorker.controller.postMessage({ type: "reset" });
    for (const src of SCRIPTS) {
      await new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.async = false; s.onload = res; s.onerror = () => rej(new Error(src)); document.body.appendChild(s); });
    }
    gate.remove();
    const tools = document.querySelector(".tools");
    if (tools) {
      const b = document.createElement("button");
      b.id = "lock-btn"; b.className = "pill-btn"; b.type = "button";
      b.title = "Dimentica il codice su questo dispositivo"; b.textContent = "Esci";
      b.addEventListener("click", async () => {
        await idbDel();
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        location.reload();
      });
      tools.appendChild(b);
    }
  }

  async function start(code) {
    busy();
    try {
      const key = await check(b64u(code));
      if (!key) { await idbDel(); ask("Codice non valido o non più in uso."); return; }
      await openSite(key);
    } catch (e) {
      ask("Non riesco ad aprire l’albero. Riprova, o usa un altro browser.");
    }
  }

  /* ---------- entry ---------- */
  (async function boot() {
    if (!window.isSecureContext || !navigator.serviceWorker || !window.crypto || !crypto.subtle || !window.indexedDB) {
      view("<p>Questo browser non può aprire l’albero in modo sicuro.<br>Prova con una versione aggiornata di Safari, Chrome o Firefox, fuori dalla navigazione privata.</p>");
      return;
    }
    // 1) key in the link:  …/#k=<key>   (removed from the address bar right away)
    const m = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash);
    if (m) {
      const rest = location.hash.slice(1).split("&").filter((p) => !p.startsWith("k=")).join("&");
      history.replaceState(null, "", location.pathname + location.search + (rest ? "#" + rest : ""));
      return start(m[1]);
    }
    // 2) key remembered in this browser
    try {
      const stored = await idbGet();
      if (stored) {
        busy();
        if (await verify(stored)) { try { await openSite(stored); return; } catch (e) { /* fall through */ } }
        else await idbDel();
      }
    } catch (e) { /* ignore */ }
    // 3) ask for it
    ask();
  })();
})();
