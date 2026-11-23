/*
 * Photo editor — add, remove and caption photos, and change portraits,
 * directly on the page. Changes are written straight into the project folder
 * (data/family.js and assets/), so afterwards you only need to commit & push.
 *
 * Shown only when the site is opened locally (file:// or localhost) or with
 * ?edit in the address. Needs Chrome or Edge (File System Access API).
 */
(function () {
  "use strict";
  const app = window.FamilyApp;
  if (!app) return;
  const local = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!local && !/[?&]edit\b/.test(location.search)) return;

  window.FT_BLOBS = window.FT_BLOBS || {};
  const supported = "showDirectoryPicker" in window;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = app.esc;
  let editing = false, dir = null;

  // ---------------------------------------------------------------- UI
  const btn = document.createElement("button");
  btn.className = "icon-btn"; btn.id = "edit-toggle"; btn.textContent = "✎";
  btn.title = "Modifica foto"; btn.setAttribute("aria-label", "Modifica foto");
  $(".tools").insertBefore(btn, $("#zoom-group"));

  const toastEl = document.createElement("div");
  toastEl.id = "toast"; document.body.appendChild(toastEl);
  let toastTimer;
  function toast(msg, kind = "") {
    toastEl.textContent = msg; toastEl.className = "show " + kind;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (toastEl.className = ""), kind === "error" ? 6000 : 2600);
  }

  btn.onclick = () => {
    if (!supported) { toast("Per modificare serve Chrome o Edge: le modifiche vengono salvate direttamente nella cartella del progetto.", "error"); return; }
    editing = !editing;
    document.body.classList.toggle("editing", editing);
    btn.classList.toggle("on", editing);
    toast(editing ? "Modalità modifica attiva: apri una persona per aggiungere o togliere foto" : "Modalità modifica disattivata");
    const id = app.current();
    if (id) app.refresh(id);
    document.dispatchEvent(new Event("ft:editmode"));
  };

  // ---------------------------------------------------------------- folder access (remembered between visits)
  const idb = (mode, fn) => new Promise((res, rej) => {
    const r = indexedDB.open("family-tree-editor", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => { const tx = r.result.transaction("kv", mode); const q = fn(tx.objectStore("kv")); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); };
    r.onerror = () => rej(r.error);
  });
  async function getDir() {
    if (dir) return dir;
    try {
      const saved = await idb("readonly", (s) => s.get("dir"));
      if (saved && ((await saved.queryPermission({ mode: "readwrite" })) === "granted" ||
                    (await saved.requestPermission({ mode: "readwrite" })) === "granted")) return (dir = saved);
    } catch (e) { /* fall through to the picker */ }
    toast("Scegli la cartella del progetto family-tree");
    const h = await window.showDirectoryPicker({ id: "family-tree", mode: "readwrite" });
    try { await (await h.getDirectoryHandle("data")).getFileHandle("family.js"); }
    catch (e) { throw new Error("In questa cartella non c'è data/family.js: scegli la cartella del progetto family-tree."); }
    try { await idb("readwrite", (s) => s.put(h, "dir")); } catch (e) {}
    return (dir = h);
  }
  async function walk(path, create) {
    const parts = path.split("/");
    let d = await getDir();
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create });
    return [d, parts[parts.length - 1]];
  }
  async function writeFile(path, data) {
    const [d, name] = await walk(path, true);
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(data); await w.close();
  }
  async function removeFile(path) {
    try { const [d, name] = await walk(path, false); await d.removeEntry(name); } catch (e) { /* already gone */ }
  }
  async function saveData() {
    const [d, name] = await walk("data/family.js", false);
    const fh = await d.getFileHandle(name);
    const old = await (await fh.getFile()).text();
    const m = /^window\.FAMILY_DATA = \{/m.exec(old);
    const header = m ? old.slice(0, m.index) : "";
    const w = await fh.createWritable();
    await w.write(header + "window.FAMILY_DATA = " + JSON.stringify(app.DATA, null, 2) + ";\n");
    await w.close();
  }

  // ---------------------------------------------------------------- images
  async function toJpeg(file, max, square) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) * 0.3; sw = sh = s; }
    const k = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement("canvas");
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    c.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, "image/jpeg", 0.84));
  }
  const usedElsewhere = (src) => app.DATA.people.some((p) => p.photo === src || (p.gallery || []).some((g) => g.src === src));

  // ---------------------------------------------------------------- actions
  async function run(label, fn) {
    try { toast(label + "…"); await fn(); toast("Salvato ✓", "ok"); }
    catch (e) { if (e.name !== "AbortError") { console.error(e); toast(e.message || String(e), "error"); } }
  }
  function addPhotos(id, files) {
    return run(files.length > 1 ? `Aggiungo ${files.length} foto` : "Aggiungo la foto", async () => {
      const p = app.byId.get(id);
      p.gallery = p.gallery || [];
      for (const f of files) {
        const blob = await toJpeg(f, 1600, false);
        const path = `assets/gallery/${id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.jpg`;
        await writeFile(path, blob);
        window.FT_BLOBS[path] = URL.createObjectURL(blob);
        p.gallery.push({ src: path, caption: f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") });
      }
      await saveData(); app.refresh(id);
    });
  }
  function removePhoto(id, i) {
    return run("Tolgo la foto", async () => {
      const p = app.byId.get(id);
      const [g] = p.gallery.splice(i, 1);
      await saveData();
      if (g && !usedElsewhere(g.src)) await removeFile(g.src);
      app.refresh(id);
    });
  }
  function setCaption(id, i, text) {
    const p = app.byId.get(id);
    if (!p.gallery[i] || p.gallery[i].caption === text) return;
    p.gallery[i].caption = text;
    return run("Salvo la didascalia", saveData);
  }
  function setPortrait(id, file) {
    return run("Aggiorno il ritratto", async () => {
      const p = app.byId.get(id);
      const blob = await toJpeg(file, 480, true);
      const path = `assets/people/${id}.jpg`;
      await writeFile(path, blob);
      window.FT_BLOBS[path] = URL.createObjectURL(blob);
      const old = p.photo; p.photo = path;
      await saveData();
      if (old && old !== path && old.endsWith(".svg") && !usedElsewhere(old)) await removeFile(old);
      app.refresh(id);
    });
  }

  // used by the relationship panel to save notes
  window.FamilyEditor = { save: () => run("Salvo la nota", saveData) };

  // ---------------------------------------------------------------- decorate the open person window
  document.addEventListener("ft:modal", (e) => {
    if (!editing) return;
    const id = e.detail.id, p = app.byId.get(id);
    const gal = $(".m-gallery");
    const empty = $(".empty", gal); if (empty) empty.remove();

    gal.querySelectorAll("figure").forEach((fig) => {
      const i = +fig.dataset.i;
      const del = document.createElement("button");
      del.className = "fig-del"; del.title = "Togli questa foto"; del.textContent = "×";
      del.onclick = (ev) => {
        ev.stopPropagation();
        if (!del.classList.contains("confirm")) {
          del.classList.add("confirm"); del.textContent = "Togliere?";
          setTimeout(() => { del.classList.remove("confirm"); del.textContent = "×"; }, 3000);
          return;
        }
        removePhoto(id, i);
      };
      fig.appendChild(del);
      const cap = $("figcaption", fig);
      cap.contentEditable = "true"; cap.spellcheck = false; cap.title = "Clicca per modificare la didascalia";
      cap.addEventListener("click", (ev) => ev.stopPropagation());
      cap.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); cap.blur(); } });
      cap.addEventListener("blur", () => setCaption(id, i, cap.textContent.trim()));
    });

    const add = document.createElement("label");
    add.className = "fig-add";
    add.innerHTML = `<input type="file" accept="image/*" multiple hidden><span class="plus">+</span><span>Aggiungi foto</span>`;
    $("input", add).onchange = (ev) => { const files = [...ev.target.files]; if (files.length) addPhotos(id, files); };
    add.addEventListener("dragover", (ev) => { ev.preventDefault(); add.classList.add("over"); });
    add.addEventListener("dragleave", () => add.classList.remove("over"));
    add.addEventListener("drop", (ev) => {
      ev.preventDefault(); add.classList.remove("over");
      const files = [...ev.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) addPhotos(id, files);
    });
    gal.appendChild(add);

    const hero = $(".m-hero-inner");
    const pe = document.createElement("label");
    pe.className = "m-photo-edit"; pe.title = `Cambia il ritratto di ${esc(p.firstName)}`;
    pe.innerHTML = `<input type="file" accept="image/*" hidden><span>Cambia<br>ritratto</span>`;
    $("input", pe).onchange = (ev) => { const f = ev.target.files[0]; if (f) setPortrait(id, f); };
    hero.appendChild(pe);
  });
})();
