(function () {
  "use strict";

  const DATA = window.FAMILY_DATA;
  const people = DATA.people;
  const byId = new Map(people.map((p) => [p.id, p]));
  const cities = DATA.cities || {};

  const CW = 262, CH = 96;
  const STEP = 0.42;          // seconds between generations in the hover cascade
  const SLIDE_MS = 3200;      // background slideshow interval

  const $ = (s, el = document) => el.querySelector(s);
  const svgNS = "http://www.w3.org/2000/svg";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------------------------------------------ helpers
  const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const MONTHS_LONG = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const fem = (p) => p.gender === "f";
  const g = (p, m, f) => (fem(p) ? f : m); // Italian gendered words
  function fmtDate(d, long) {
    if (!d) return "";
    const [y, m, day] = String(d).split("-").map(Number);
    const names = long ? MONTHS_LONG : MONTHS;
    if (day) return `${day} ${names[m - 1]} ${y}`;
    if (m) return `${names[m - 1]} ${y}`;
    return String(y);
  }
  function age(p) {
    if (!p.born || !p.born.date) return null;
    const b = String(p.born.date).split("-").map(Number);
    let e;
    if (p.died && p.died.date) e = String(p.died.date).split("-").map(Number);
    else if (p.died) return null;
    else { const n = new Date(); e = [n.getFullYear(), n.getMonth() + 1, n.getDate()]; }
    let a = e[0] - b[0];
    if (b[1] && e[1] && (e[1] < b[1] || (e[1] === b[1] && b[2] && e[2] && e[2] < b[2]))) a--;
    return a > 110 ? null : a;
  }
  const assetURL = (path) => (window.FT_BLOBS && window.FT_BLOBS[path]) || path;
  const photoOf = (x) => (typeof x === "string" ? { src: x } : x || {});
  const cityOf = (key) => (key && cities[key]) || (key ? { name: key, photos: [] } : null);
  const cityName = (key) => { const c = cityOf(key); return c ? c.name : ""; };
  const fullName = (p) => `${p.firstName || ""} ${p.lastName || ""}`.trim();
  const initials = (p) => ((p.firstName || "?")[0] + ((p.lastName || "")[0] || "")).toUpperCase();
  function photoHTML(p, cls) {
    if (p.photo) return `<img class="${cls}" src="${esc(assetURL(p.photo))}" alt="" draggable="false" data-initials="${esc(initials(p))}">`;
    return `<div class="initials">${esc(initials(p))}</div>`;
  }

  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!img || img.tagName !== "IMG" || !img.dataset.initials) return;
    const d = document.createElement("div"); d.className = "initials"; d.textContent = img.dataset.initials;
    img.replaceWith(d);
  }, true);

  // ------------------------------------------------------------------ layout
  const L = FamilyLayout.compute(people, { cardW: CW, cardH: CH, gap: 30, partnerGap: 28, rowGap: 120 });
  const world = $("#world"), cardsEl = $("#cards"), svg = $("#links");
  const linkLayer = $("#link-layer"), particleLayer = $("#particle-layer"), axisLayer = $("#axis-layer");
  const PAD = 80;
  svg.style.left = -PAD + "px"; svg.style.top = -PAD + "px";
  [linkLayer, particleLayer, axisLayer].forEach((g) => g.setAttribute("transform", `translate(${PAD},${PAD})`));

  document.title = DATA.title || "Albero genealogico";
  $("#title").textContent = DATA.title || "Albero genealogico";
  $("#subtitle").textContent = DATA.subtitle || "";

  // generation labels (tree view)
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  const genLabels = [];
  for (let g = 0; g < L.generations; g++) {
    const el = document.createElement("div");
    el.className = "gen-label";
    el.textContent = `Generazione ${ROMAN[g] || g + 1}`;
    el.style.top = g * (CH + 120) + CH / 2 - 10 + "px";
    el.style.left = "-150px";
    cardsEl.appendChild(el);
    genLabels.push(el);
  }

  // ------------------------------------------------------------------ timeline years
  // Known birth years are used as they are. Missing ones are estimated from
  // relatives (parents +GEN years, children −GEN years, partners ≈ same year).
  const GEN_YEARS = 28;
  const yearOf = (d) => (d ? parseInt(String(d).slice(0, 4), 10) : NaN);
  const birthYear = new Map(), estimated = new Set();
  (function estimateYears() {
    const genOf = (id) => L.positions.get(id).gen;
    const known = people.filter((p) => p.born && !isNaN(yearOf(p.born.date)));
    known.forEach((p) => birthYear.set(p.id, yearOf(p.born.date)));
    const anchor = known.length ? known.reduce((s, p) => s + yearOf(p.born.date) - genOf(p.id) * GEN_YEARS, 0) / known.length : 1900;
    const unknown = people.filter((p) => !birthYear.has(p.id)).map((p) => p.id);
    unknown.forEach((id) => { birthYear.set(id, anchor + genOf(id) * GEN_YEARS); estimated.add(id); });
    for (let it = 0; it < 200; it++) {
      unknown.forEach((id) => {
        const c = [];
        (L.parentsOf.get(id) || []).forEach((q) => c.push(birthYear.get(q) + GEN_YEARS));
        (L.childrenOf.get(id) || []).forEach((q) => c.push(birthYear.get(q) - GEN_YEARS));
        L.partners.get(id).forEach((q) => c.push(birthYear.get(q)));
        if (c.length) birthYear.set(id, c.reduce((s, v) => s + v, 0) / c.length);
      });
    }
    unknown.forEach((id) => birthYear.set(id, Math.round(birthYear.get(id))));
  })();
  const PX_PER_YEAR = 11;
  const years = [...birthYear.values()];
  const minYear = Math.floor((Math.min(...years) - 4) / 10) * 10;
  const maxYear = Math.ceil((Math.max(...years) + 4) / 10) * 10;
  const yearY = (y) => (y - minYear) * PX_PER_YEAR;

  const treePos = new Map(), timePos = new Map();
  people.forEach((p) => {
    const t = L.positions.get(p.id);
    treePos.set(p.id, { x: t.x, y: t.y });
    timePos.set(p.id, { x: t.x, y: yearY(birthYear.get(p.id)) - CH / 2 });
  });
  // keep cards from overlapping: cards that would collide are nudged down a little
  (function resolveOverlaps() {
    const GAPY = 14, GAPX = 6;
    const ids = people.map((p) => p.id).sort((a, b) => timePos.get(a).y - timePos.get(b).y);
    const placed = [];
    ids.forEach((id) => {
      const p = timePos.get(id);
      let moved = true;
      while (moved) {
        moved = false;
        for (const q of placed) {
          if (p.x < q.x + CW + GAPX && q.x < p.x + CW + GAPX && p.y < q.y + CH + GAPY && q.y < p.y + CH + GAPY) {
            p.y = q.y + CH + GAPY; moved = true;
          }
        }
      }
      placed.push(p);
    });
  })();
  const boundsOf = (pos) => {
    let w = 0, h = 0;
    pos.forEach((v) => { w = Math.max(w, v.x + CW); h = Math.max(h, v.y + CH); });
    return { w, h };
  };
  const views = { tree: { pos: treePos, ...boundsOf(treePos) }, timeline: { pos: timePos, ...boundsOf(timePos) } };
  svg.setAttribute("width", Math.max(views.tree.w, views.timeline.w) + PAD * 2);
  svg.setAttribute("height", Math.max(views.tree.h, views.timeline.h) + PAD * 2);

  // year ruler (timeline view)
  (function drawAxis() {
    const w = views.timeline.w;
    let html = "";
    for (let y = minYear; y <= maxYear; y += 10) {
      const yy = yearY(y), major = y % 50 === 0;
      html += `<line x1="-130" x2="${w + 40}" y1="${yy}" y2="${yy}" class="grid${major ? " major" : ""}"/>` +
              `<text x="-140" y="${yy + 5}" class="grid-label${major ? " major" : ""}">${y}</text>`;
    }
    axisLayer.innerHTML = html;
  })();

  // marriages
  const marriages = L.marriages.map((m) => {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("class", "marriage");
    linkLayer.appendChild(line);
    const ring = document.createElementNS(svgNS, "circle");
    ring.setAttribute("r", 6); ring.setAttribute("class", "marriage-ring");
    linkLayer.appendChild(ring);
    return { a: m.a, b: m.b, line, ring };
  });

  // parent → child links
  const links = L.links.map((lk) => {
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("class", "link" + (byId.get(lk.child).adopted ? " adopted" : ""));
    g.innerHTML =
      `<path class="link-base" marker-end="url(#arrow)"/>` +
      `<path class="link-flow"/>` +
      `<path class="link-hot" marker-end="url(#arrow-hot)"/>`;
    linkLayer.appendChild(g);
    return { ...lk, g, paths: [...g.children], path: g.lastChild, len: 0 };
  });

  // geometry for any set of card positions
  function coupleAnchor(a, b, pos) {
    let A = pos.get(a), B = pos.get(b);
    if (A.x > B.x) [A, B] = [B, A];
    return { x1: A.x + CW, y1: A.y + CH / 2, x2: B.x, y2: B.y + CH / 2, low: Math.max(A.y, B.y) };
  }
  function linkPath(lk, pos) {
    const c = pos.get(lk.child);
    const tx = c.x + CW / 2, ty = c.y;
    let sx, sy, yb;
    if (lk.couple) {
      const m = coupleAnchor(lk.parents[0], lk.parents[1], pos);
      sx = (m.x1 + m.x2) / 2; sy = (m.y1 + m.y2) / 2 + 9;
      yb = Math.max(sy, m.low + CH + 21);
      if (yb > ty - 30) yb = sy;
    } else {
      const p = pos.get(lk.parents[0]);
      sx = p.x + CW / 2; sy = p.y + CH; yb = sy;
    }
    const k = Math.max(40, (ty - yb) * 0.55);
    return `M${sx},${sy} L${sx},${yb} C${sx},${yb + k} ${tx},${ty - k} ${tx},${ty - 2}`;
  }
  function applyPositions(pos) {
    cardEls.forEach((el, id) => { const p = pos.get(id); el.style.left = p.x + "px"; el.style.top = p.y + "px"; });
    marriages.forEach((m) => {
      const a = coupleAnchor(m.a, m.b, pos);
      m.line.setAttribute("x1", a.x1); m.line.setAttribute("y1", a.y1);
      m.line.setAttribute("x2", a.x2); m.line.setAttribute("y2", a.y2);
      m.ring.setAttribute("cx", (a.x1 + a.x2) / 2); m.ring.setAttribute("cy", (a.y1 + a.y2) / 2);
    });
    links.forEach((lk) => {
      const d = linkPath(lk, pos);
      lk.paths.forEach((p) => p.setAttribute("d", d));
    });
  }
  function measureLinks() {
    links.forEach((lk) => {
      lk.len = lk.path.getTotalLength();
      lk.path.style.strokeDasharray = lk.len;
      lk.path.style.strokeDashoffset = lk.len;
      lk.path.style.setProperty("--len", lk.len);
    });
  }

  function cardHTML(p) {
    const born = p.born || {}, died = p.died;
    return `
      ${photoHTML(p, "photo")}
      <div class="info">
        <div class="name">${esc(p.firstName)} <span class="surname">${esc(p.lastName)}</span></div>
        ${born.date || born.city ? `<div class="meta"><b>*</b>${[fmtDate(born.date), cityName(born.city)].filter(Boolean).map(esc).join(" · ")}</div>` : ""}
        ${died ? `<div class="meta"><b>†</b>${esc(fmtDate(died.date)) || "—"}${died.city && died.city !== born.city ? " · " + esc(cityName(died.city)) : ""}</div>` : ""}
      </div>
      <div class="year-badge${estimated.has(p.id) ? " est" : ""}" title="${estimated.has(p.id) ? "Stimato in base ai parenti" : "Anno di nascita"}">${estimated.has(p.id) ? "≈ " : ""}${birthYear.get(p.id)}</div>`;
  }

  // cards
  const cardEls = new Map();
  people.forEach((p) => {
    const el = document.createElement("div");
    el.className = "card" + (p.died ? " deceased" : "") + (p.placeholder ? " placeholder" : "");
    el.dataset.id = p.id;
    el.innerHTML = cardHTML(p);
    el.title = fullName(p);
    el.tabIndex = 0; el.setAttribute("role", "button");
    cardsEl.appendChild(el);
    cardEls.set(p.id, el);
  });

  // ------------------------------------------------------------------ view switching
  let view = "tree";
  try { if (localStorage.getItem("ft-view") === "timeline") view = "timeline"; } catch (e) {}
  let curPos = new Map([...views[view].pos].map(([k, v]) => [k, { ...v }]));
  applyPositions(curPos); measureLinks();
  document.body.classList.toggle("timeline", view === "timeline");

  function setView(next) {
    if (next === view) return;
    view = next;
    try { localStorage.setItem("ft-view", view); } catch (e) {}
    document.body.classList.toggle("timeline", view === "timeline");
    document.querySelectorAll("#view-switch button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    clearTrace(); clearCity();
    const from = curPos, to = views[view].pos, t0 = performance.now(), DUR = 900;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    (function step(now) {
      const t = Math.min(1, (now - t0) / DUR), e = ease(t);
      const pos = new Map();
      from.forEach((a, id) => { const b = to.get(id); pos.set(id, { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }); });
      applyPositions(pos); curPos = pos;
      if (t < 1) requestAnimationFrame(step); else { measureLinks(); refit(); }
    })(t0);
  }
  document.querySelectorAll("#view-switch button").forEach((b) => {
    b.classList.toggle("on", b.dataset.view === view);
    b.onclick = () => setView(b.dataset.view);
  });

  // ------------------------------------------------------------------ hover trace
  let traceState = null;
  function trace(id) {
    clearTrace();
    const depth = new Map([[id, 0]]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift();
      (L.childrenOf.get(cur) || []).forEach((k) => {
        if (!depth.has(k)) { depth.set(k, depth.get(cur) + 1); queue.push(k); }
      });
    }
    document.body.classList.add("tracing");
    cardEls.get(id).classList.add("source");
    L.partners.get(id).forEach((q) => cardEls.get(q).classList.add("partner"));
    depth.forEach((d, pid) => {
      if (pid === id) return;
      const el = cardEls.get(pid);
      el.style.setProperty("--delay", (d - 1) * STEP + 0.55 + "s");
      el.classList.add("lit");
    });
    const active = [];
    links.forEach((lk) => {
      if (!depth.has(lk.child)) return;
      const src = lk.parents.find((p) => depth.has(p));
      if (src === undefined) return;
      const delay = depth.get(src) * STEP;
      lk.g.style.setProperty("--delay", delay + "s");
      lk.g.classList.add("active");
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("r", 4.5); dot.setAttribute("class", "particle"); dot.style.opacity = 0;
      particleLayer.appendChild(dot);
      active.push({ lk, delay, dot });
    });
    const maxDepth = Math.max(0, ...depth.values());
    traceState = { active, start: performance.now(), period: (maxDepth + 1) * STEP + 1.4 };
    if (active.length) requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!traceState) return;
    const t = (now - traceState.start) / 1000;
    const cyc = t % traceState.period;
    const DUR = 0.75;
    traceState.active.forEach(({ lk, delay, dot }) => {
      const ph = (cyc - delay) / DUR;
      if (ph < 0 || ph > 1) { dot.style.opacity = 0; return; }
      const e = 1 - Math.pow(1 - ph, 2);
      const pt = lk.path.getPointAtLength(e * lk.len);
      dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y);
      dot.style.opacity = ph > 0.85 ? (1 - ph) / 0.15 : 1;
    });
    requestAnimationFrame(tick);
  }
  function clearTrace() {
    traceState = null;
    document.body.classList.remove("tracing");
    cardEls.forEach((el) => { el.classList.remove("lit", "source", "partner"); el.style.removeProperty("--delay"); });
    links.forEach((lk) => lk.g.classList.remove("active"));
    particleLayer.innerHTML = "";
  }

  // ------------------------------------------------------------------ city backdrop
  const bgA = $("#bgA"), bgB = $("#bgB"), caption = $("#city-caption");
  let bgFront = bgA, bgTimer = null, bgCity = null, bgIndex = 0;
  const preloaded = new Set();
  function preload(src) { if (!preloaded.has(src)) { preloaded.add(src); const i = new Image(); i.src = src; } }
  Object.values(cities).forEach((c) => (c.photos || []).slice(0, 1).forEach((x) => preload(photoOf(x).src)));

  const ccCredit = $(".cc-credit", caption);
  function showBg(photo, cityKey, tries = 0) {
    const c = cityOf(cityKey);
    // load first, so a missing or unreachable photo is skipped instead of showing a blank
    const img = new Image();
    img.onload = () => { if (bgCity === cityKey) swapBg(photo); };
    img.onerror = () => {
      if (bgCity !== cityKey || !c || tries >= c.photos.length - 1) return;
      bgIndex = (bgIndex + 1) % c.photos.length;
      showBg(photoOf(c.photos[bgIndex]), cityKey, tries + 1);
    };
    img.src = photo.src;
  }
  function swapBg(photo) {
    const src = photo.src;
    ccCredit.textContent = photo.credit ? "Foto: " + photo.credit : "";
    const back = bgFront === bgA ? bgB : bgA;
    back.style.backgroundImage = `url("${src}")`;
    back.classList.remove("show"); void back.offsetWidth; back.classList.add("show");
    bgFront.classList.remove("show");
    bgFront = back;
  }
  function setCity(key) {
    if (key === bgCity) return;
    bgCity = key;
    clearInterval(bgTimer);
    const c = cityOf(key);
    if (!c || !c.photos || !c.photos.length) {
      bgA.classList.remove("show"); bgB.classList.remove("show");
      caption.classList.toggle("show", !!c);
      if (c) $(".cc-name", caption).textContent = c.name + (c.country ? `, ${c.country}` : "");
      return;
    }
    c.photos.forEach((x) => preload(photoOf(x).src));
    bgIndex = 0;
    ccCredit.textContent = "";
    showBg(photoOf(c.photos[0]), key);
    $(".cc-name", caption).textContent = c.name + (c.country ? `, ${c.country}` : "");
    caption.classList.add("show");
    if (c.photos.length > 1)
      bgTimer = setInterval(() => { bgIndex = (bgIndex + 1) % c.photos.length; showBg(photoOf(c.photos[bgIndex]), key); }, SLIDE_MS);
  }
  function clearCity() {
    bgCity = null; clearInterval(bgTimer);
    bgA.classList.remove("show"); bgB.classList.remove("show");
    caption.classList.remove("show");
  }

  let leaveTimer = null, enterTimer = null;
  cardsEl.addEventListener("pointerover", (e) => {
    const card = e.target.closest(".card");
    if (!card || drag.active || relMode) return;
    clearTimeout(leaveTimer); clearTimeout(enterTimer);
    const id = card.dataset.id;
    if (traceState && card.classList.contains("source")) return;
    enterTimer = setTimeout(() => {
      trace(id);
      const p = byId.get(id);
      setCity(p.born && p.born.city);
    }, 60);
  });
  cardsEl.addEventListener("pointerout", (e) => {
    const card = e.target.closest(".card");
    if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
    clearTimeout(enterTimer);
    leaveTimer = setTimeout(() => { clearTrace(); clearCity(); }, 220);
  });

  let activeSurname = null; // surname filter (set further down)

  // ------------------------------------------------------------------ pan & zoom
  const viewport = $("#viewport");
  const cam = { x: 0, y: 0, k: 1 };
  const apply = () => {
    world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.k})`;
    // when zoomed far out, enlarge the names and hide the small print so cards stay readable
    const boost = Math.max(1, Math.min(1.4, 0.8 / cam.k));
    world.style.setProperty("--boost", boost.toFixed(2));
    world.classList.toggle("far", boost > 1.25);
  };
  function animateTo(x, y, k) {
    world.classList.add("animate");
    cam.x = x; cam.y = y; cam.k = k; apply();
    setTimeout(() => world.classList.remove("animate"), 720);
  }
  function fit(animate = true, minK = 0) {
    const narrow = innerWidth < 700;
    if (narrow) minK = Math.max(minK, 0.3);       // phones: start readable, pan to explore
    const vw = innerWidth, vh = innerHeight, top = narrow ? 150 : 100, bottom = narrow ? 70 : 96, side = narrow ? 10 : 40;
    const LABEL = narrow ? 0 : 150; // room for the "Generazione I" labels on the left
    const W = views[view].w, H = views[view].h;
    const k = Math.max(minK, Math.min((vw - side * 2) / (W + LABEL), (vh - top - bottom) / H, 1.15));
    const x = (vw - (W + LABEL) * k) / 2 + LABEL * k, y = top + (vh - top - bottom - H * k) / 2;
    animate ? animateTo(x, y, k) : (Object.assign(cam, { x, y, k }), apply());
  }
  function fitTo(ids) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ids.forEach((id) => { const p = curPos.get(id); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + CW); y1 = Math.max(y1, p.y + CH); });
    if (!isFinite(x0)) return fit();
    const vw = innerWidth, vh = innerHeight, top = 110, bottom = 110, side = 80, w = x1 - x0, h = y1 - y0;
    const k = Math.min((vw - side * 2) / w, (vh - top - bottom) / h, 1.4);
    animateTo(vw / 2 - (x0 + w / 2) * k, top + (vh - top - bottom) / 2 - (y0 + h / 2) * k, k);
  }
  function zoomAt(factor, cx, cy) {
    const k = Math.min(3, Math.max(0.1, cam.k * factor));
    const f = k / cam.k;
    cam.x = cx - (cx - cam.x) * f; cam.y = cy - (cy - cam.y) * f; cam.k = k; apply();
  }
  function centerOn(id) {
    const pos = curPos.get(id);
    const k = Math.max(cam.k, 0.9);
    animateTo(innerWidth / 2 - (pos.x + CW / 2) * k, innerHeight / 2 - (pos.y + CH / 2) * k, k);
  }
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY);
  }, { passive: false });

  const drag = { active: false, moved: false, sx: 0, sy: 0, vx: 0, vy: 0, pointers: new Map(), pinch: null };
  viewport.addEventListener("pointerdown", (e) => {
    drag.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag.pointers.size === 2) {
      const [p1, p2] = [...drag.pointers.values()];
      drag.pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), k: cam.k };
      return;
    }
    drag.active = true; drag.moved = false;
    drag.sx = e.clientX; drag.sy = e.clientY; drag.vx = cam.x; drag.vy = cam.y;
  });
  addEventListener("pointermove", (e) => {
    if (drag.pointers.has(e.pointerId)) drag.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag.pinch && drag.pointers.size === 2) {
      const [p1, p2] = [...drag.pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      zoomAt((drag.pinch.k * d / drag.pinch.d) / cam.k, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      drag.moved = true;
      return;
    }
    if (!drag.active) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 5) {
      drag.moved = true; viewport.classList.add("dragging");
      clearTrace(); clearCity();
    }
    if (drag.moved) { cam.x = drag.vx + dx; cam.y = drag.vy + dy; apply(); }
  });
  const endDrag = (e) => {
    drag.pointers.delete(e.pointerId);
    if (drag.pointers.size < 2) drag.pinch = null;
    drag.active = false; viewport.classList.remove("dragging");
  };
  addEventListener("pointerup", endDrag);
  addEventListener("pointercancel", endDrag);

  $("#zoom-in").onclick = () => { world.classList.add("animate"); zoomAt(1.25, innerWidth / 2, innerHeight / 2); setTimeout(() => world.classList.remove("animate"), 720); };
  $("#zoom-out").onclick = () => { world.classList.add("animate"); zoomAt(0.8, innerWidth / 2, innerHeight / 2); setTimeout(() => world.classList.remove("animate"), 720); };
  $("#fit").onclick = () => { if (activeSurname) setSurname(null); else fit(); };
  // fit the whole tree, or the selected family when a surname filter is on
  function refit(animate = true) {
    const fam = activeSurname
      ? people.filter((p) => (p.lastName || "").trim() === activeSurname).map((p) => p.id) : null;
    fam ? fitTo(fam) : fit(animate);
  }
  addEventListener("resize", () => refit(false));

  // ------------------------------------------------------------------ search
  const search = $("#search"), dl = $("#people-list");
  people.forEach((p) => { const o = document.createElement("option"); o.value = fullName(p); dl.appendChild(o); });
  let lastQuery = "", searchTurn = 0;
  function doSearch() {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    let hits = people.filter((x) => fullName(x).toLowerCase() === q);
    if (!hits.length) hits = people.filter((x) => fullName(x).toLowerCase().includes(q));
    if (!hits.length) return;
    searchTurn = q === lastQuery ? searchTurn + 1 : 0; lastQuery = q;
    const p = hits[searchTurn % hits.length];
    centerOn(p.id);
    const el = cardEls.get(p.id);
    el.classList.remove("found"); void el.offsetWidth; el.classList.add("found");
  }
  search.addEventListener("change", doSearch);
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  // ------------------------------------------------------------------ modal
  const root = $("#modal-root"), modal = $(".modal", root);
  let openId = null;

  function fillModal(p) {
    const born = p.born || {}, died = p.died;
    const bc = cityOf(born.city);
    $(".m-hero-bg", modal).style.backgroundImage = bc && bc.photos && bc.photos[0] ? `url("${photoOf(bc.photos[0]).src}")` : "none";
    const photo = $(".m-photo", modal);
    photo.src = p.photo ? assetURL(p.photo) : ""; photo.style.visibility = p.photo ? "visible" : "hidden";
    $("#m-name").textContent = fullName(p);
    const a = age(p);
    $(".m-life", modal).textContent =
      (born.date || (died && died.date) ? (fmtDate(born.date, true) || "?") + (died ? "  —  " + (fmtDate(died.date, true) || "?") : "") : died ? g(p, "Deceduto", "Deceduta") : "") +
      (a !== null ? `  ·  ${a} anni` : "");
    const places = [];
    if (born.city) places.push(`${g(p, "Nato", "Nata")} a ${cityName(born.city)}${bc && bc.country ? ", " + bc.country : ""}`);
    if (p.adopted) places.push(g(p, "adottato", "adottata"));
    if (died && died.city) { const dc = cityOf(died.city); places.push(`${g(p, "morto", "morta")} a ${dc.name}${dc.country ? ", " + dc.country : ""}`); }
    $(".m-places", modal).textContent = places.join("  ·  ");

    // relations
    const chip = (id) => { const q = byId.get(id); return q ? `<button class="chip" data-goto="${esc(id)}">${q.photo ? `<img src="${esc(assetURL(q.photo))}" alt="">` : ""}${esc(fullName(q))}${q.adopted && (L.parentsOf.get(id) || []).includes(p.id) ? ` <em>(${g(q, "adottato", "adottata")})</em>` : ""}</button>` : ""; };
    const groups = [
      ["Genitori", L.parentsOf.get(p.id) || []],
      [L.partners.get(p.id).size > 1 ? "Coniugi" : "Coniuge", [...L.partners.get(p.id)]],
      ["Figli", L.childrenOf.get(p.id) || []],
    ].filter(([, ids]) => ids.length);
    $(".m-relations", modal).innerHTML = groups
      .map(([label, ids]) => `<div class="rel-group"><span class="rel-label">${label}</span>${ids.map(chip).join("")}</div>`).join("");

    // audio
    const audioWrap = $(".m-audio", modal), audio = $("audio", audioWrap);
    audio.pause();
    if (p.audio) { audio.src = p.audio; audioWrap.hidden = false; } else { audio.removeAttribute("src"); audioWrap.hidden = true; }

    // bio
    const bio = Array.isArray(p.bio) ? p.bio : p.bio ? [p.bio] : [];
    $(".m-bio", modal).innerHTML = `<h3>Biografia</h3>` +
      (bio.length ? bio.map((t) => `<p>${esc(t)}</p>`).join("") : `<p class="empty">Biografia non ancora scritta.</p>`);

    // gallery
    const gal = p.gallery || [];
    $(".m-gallery", modal).innerHTML = gal.length
      ? gal.map((g, i) => `<figure data-i="${i}" style="--rot:${((i * 37) % 7) - 3}deg"><img src="${esc(assetURL(g.src))}" alt="" loading="lazy"><figcaption>${esc(g.caption || "")}</figcaption></figure>`).join("")
      : `<p class="empty">Nessuna foto o ricordo, per ora.</p>`;
    document.dispatchEvent(new CustomEvent("ft:modal", { detail: { id: p.id } }));
  }

  function flipFrom(rect) {
    modal.classList.remove("flip");
    modal.style.transform = "none";
    const f = modal.getBoundingClientRect();
    modal.style.transform = `translate(${rect.left - f.left}px,${rect.top - f.top}px) scale(${rect.width / f.width},${rect.height / f.height})`;
    modal.style.borderRadius = "60px";
    void modal.offsetWidth;
    modal.classList.add("flip");
    modal.style.transform = "none";
    modal.style.borderRadius = "20px";
  }

  function openPerson(id, animateFromCard = true) {
    const p = byId.get(id);
    if (!p) return;
    clearTrace(); clearCity();
    const wasOpen = openId !== null;
    openId = id;
    fillModal(p);
    $(".modal-scroll", modal).scrollTop = 0;
    if (history.replaceState) history.replaceState(null, "", "#" + encodeURIComponent(id));
    if (wasOpen) return;
    root.hidden = false;
    if (animateFromCard) flipFrom(cardEls.get(id).getBoundingClientRect());
    requestAnimationFrame(() => { root.classList.add("open"); $(".modal-close", root).focus({ preventScroll: true }); });
  }
  function closeModal() {
    if (openId === null) return;
    const card = cardEls.get(openId);
    root.classList.remove("open");
    $("audio", modal).pause();
    const r = card.getBoundingClientRect(), f = modal.getBoundingClientRect();
    modal.classList.add("flip");
    modal.style.transform = `translate(${r.left - f.left}px,${r.top - f.top}px) scale(${r.width / f.width},${r.height / f.height})`;
    modal.style.borderRadius = "60px";
    const id = openId;
    openId = null;
    setTimeout(() => { if (openId === null) { root.hidden = true; modal.style.transform = ""; } }, 480);
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    card.classList.remove("found"); void card.offsetWidth;
    if (id) card.classList.add("found");
    card.focus({ preventScroll: true });
  }

  cardsEl.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card || drag.moved) return;
    if (relMode) { pickRel(card.dataset.id); return; }
    openPerson(card.dataset.id);
  });
  cardsEl.addEventListener("keydown", (e) => {
    const card = e.target.closest(".card");
    if (!card || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    relMode ? pickRel(card.dataset.id) : openPerson(card.dataset.id);
  });
  $(".modal-close", root).onclick = closeModal;
  $(".modal-backdrop", root).onclick = closeModal;
  $(".m-relations", modal).addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (!b) return;
    const id = b.dataset.goto;
    centerOn(id);
    openPerson(id);
  });

  // ------------------------------------------------------------------ lightbox
  const lb = $("#lightbox");
  let lbItems = [], lbIndex = 0;
  function showLb(i) {
    lbIndex = (i + lbItems.length) % lbItems.length;
    const it = lbItems[lbIndex];
    $("img", lb).src = assetURL(it.src); $("figcaption", lb).textContent = it.caption || "";
    $(".lb-prev", lb).style.display = $(".lb-next", lb).style.display = lbItems.length > 1 ? "" : "none";
  }
  $(".m-gallery", modal).addEventListener("click", (e) => {
    const fig = e.target.closest("figure");
    if (!fig || document.body.classList.contains("editing")) return;
    lbItems = byId.get(openId).gallery || [];
    lb.hidden = false; showLb(+fig.dataset.i);
  });
  $(".lb-close", lb).onclick = () => (lb.hidden = true);
  $(".lb-prev", lb).onclick = () => showLb(lbIndex - 1);
  $(".lb-next", lb).onclick = () => showLb(lbIndex + 1);
  lb.addEventListener("click", (e) => { if (e.target === lb) lb.hidden = true; });

  addEventListener("keydown", (e) => {
    if (!lb.hidden) {
      if (e.key === "Escape") lb.hidden = true;
      if (e.key === "ArrowLeft") showLb(lbIndex - 1);
      if (e.key === "ArrowRight") showLb(lbIndex + 1);
      return;
    }
    if (e.key === "Escape") closeModal();
  });

  // ------------------------------------------------------------------ surname filter
  const surnameBar = $("#surnames");
  const surnames = new Map();
  people.forEach((p) => {
    const n = (p.lastName || "").trim();
    if (n) surnames.set(n, (surnames.get(n) || 0) + 1);
  });
  [...surnames.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([name, count]) => {
    const b = document.createElement("button");
    b.className = "surname-chip"; b.dataset.name = name;
    b.innerHTML = `${esc(name)} <span>${count}</span>`;
    b.title = `Evidenzia la famiglia ${name}`;
    b.onclick = () => setSurname(activeSurname === name ? null : name);
    surnameBar.appendChild(b);
  });
  const titleEl = $("#title");
  let titleTarget = titleEl.textContent;
  function setTitle(text) {
    if (titleTarget === text) return;
    titleTarget = text;
    titleEl.classList.add("swap");
    setTimeout(() => { titleEl.textContent = titleTarget; titleEl.classList.remove("swap"); }, 250);
  }
  function setSurname(name) {
    activeSurname = name;
    clearTrace();
    document.body.classList.toggle("surname-filter", !!name);
    surnameBar.querySelectorAll(".surname-chip").forEach((b) => b.classList.toggle("on", b.dataset.name === name));
    const fam = new Set(people.filter((p) => name && (p.lastName || "").trim() === name).map((p) => p.id));
    cardEls.forEach((el, id) => el.classList.toggle("fam", fam.has(id)));
    links.forEach((lk) => lk.g.classList.toggle("fam", fam.has(lk.child) && lk.parents.some((q) => fam.has(q))));
    marriages.forEach((m) => {
      const on = fam.has(m.a) && fam.has(m.b);
      m.line.classList.toggle("fam", on); m.ring.classList.toggle("fam", on);
    });
    setTitle(name ? `La famiglia ${name}` : DATA.title || "Albero Genealogico");
    name ? setTimeout(() => fitTo(fam), 250) : fit();
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && activeSurname && root.hidden) setSurname(null); });

  // ------------------------------------------------------------------ relationship finder (Parentela)
  const relBtn = document.createElement("button");
  relBtn.className = "pill-btn"; relBtn.id = "rel-toggle"; relBtn.innerHTML = `<span>⇄</span><span class="lb">Parentela</span>`;
  relBtn.title = "Parentela: scegli due persone"; relBtn.setAttribute("aria-label", "Parentela");
  $(".tools").insertBefore(relBtn, $("#zoom-group"));
  const relBanner = document.createElement("div"); relBanner.id = "rel-banner"; document.body.appendChild(relBanner);
  const relPanel = document.createElement("aside"); relPanel.id = "rel-panel"; relPanel.hidden = true; document.body.appendChild(relPanel);
  let relMode = false, relPick = [];

  const isF = (id) => byId.get(id).gender === "f";
  const G = (id, m, f) => (isF(id) ? f : m);
  const spousesOf = (id) => [...L.partners.get(id)];
  function ancestors(id) {
    const d = new Map([[id, 0]]), q = [id];
    while (q.length) { const c = q.shift(); (L.parentsOf.get(c) || []).forEach((p) => { if (!d.has(p)) { d.set(p, d.get(c) + 1); q.push(p); } }); }
    return d;
  }
  function blood(a, b) {
    const A = ancestors(a), B = ancestors(b); let best = null;
    A.forEach((da, k) => { if (B.has(k)) { const s = da + B.get(k); if (!best || s < best.a + best.b) best = { a: da, b: B.get(k), c: k }; } });
    return best;
  }
  function bloodTerm(id, r, half) {
    const { a, b } = r, g = (m, f) => G(id, m, f);
    if (a === 0) return [g("padre", "madre"), g("nonno", "nonna"), g("bisnonno", "bisnonna"), g("trisnonno", "trisnonna")][b - 1] || `${g("antenato", "antenata")} (${b} generazioni)`;
    if (b === 0) return [g("figlio", "figlia"), "nipote", "pronipote", "bis-pronipote"][a - 1] || `discendente (${a} generazioni)`;
    if (a === 1 && b === 1) return g("fratello", "sorella") + (half ? ` (per parte di ${half})` : "");
    if (a === 1) return [null, g("zio", "zia"), g("prozio", "prozia"), g("bisprozio", "bisprozia")][b - 1] || `parente di ${a + b}° grado`;
    if (b === 1) return [null, "nipote", "pronipote", "bis-pronipote"][a - 1] || `parente di ${a + b}° grado`;
    if (a === b) return a === 2 ? g("cugino", "cugina") : `${g("cugino", "cugina")} di ${a - 1}° grado`;
    return `parente di ${a + b}° grado`;
  }
  function halfSibling(x, y) {
    const px = L.parentsOf.get(x) || [], py = L.parentsOf.get(y) || [];
    const common = px.filter((p) => py.includes(p));
    if (common.length === 1 && px.length > 1 && py.length > 1) return isF(common[0]) ? "madre" : "padre";
    return null;
  }
  // shortest chain through parents/children/partners, described in words
  function chainTerm(x, y) {
    const prev = new Map([[x, null]]), q = [x];
    while (q.length && !prev.has(y)) {
      const c = q.shift();
      const nb = [...(L.parentsOf.get(c) || []), ...(L.childrenOf.get(c) || []), ...spousesOf(c)];
      nb.forEach((n) => { if (!prev.has(n)) { prev.set(n, c); q.push(n); } });
    }
    if (!prev.has(y)) return null;
    const path = [y]; while (path[0] !== x) path.unshift(prev.get(path[0]));
    const label = (u, v) => (L.parentsOf.get(v) || []).includes(u) ? G(u, "padre", "madre")
      : (L.childrenOf.get(v) || []).includes(u) ? G(u, "figlio", "figlia") : G(u, "marito", "moglie");
    let s = label(path[0], path[1]);
    for (let i = 1; i < path.length - 1; i++) s += (isF(path[i]) ? " della " : " del ") + label(path[i], path[i + 1]);
    return { text: (isF(x) ? "la " : "il ") + s, path };
  }
  function kinship(x, y) {
    if (x === y) return "la stessa persona";
    if (spousesOf(x).includes(y)) return G(x, "marito", "moglie");
    const r = blood(x, y);
    if (r) return bloodTerm(x, r, r.a === 1 && r.b === 1 ? halfSibling(x, y) : null);
    for (const s of spousesOf(y)) {               // x related to y's partner
      const q = blood(x, s); if (!q) continue;
      if (q.a === 0 && q.b === 1) return G(x, "suocero", "suocera");
      if (q.b === 0) break;                       // child of a parent's partner: describe it
      if (q.a === 1 && q.b === 1) return G(x, "cognato", "cognata");
      return bloodTerm(x, q) + " " + G(x, "acquisito", "acquisita");
    }
    for (const s of spousesOf(x)) {               // x's partner related to y
      const q = blood(s, y); if (!q) continue;
      if (q.a === 1 && q.b === 0) return G(x, "genero", "nuora");
      if (q.a === 1 && q.b === 1) return G(x, "cognato", "cognata");
      if (q.a === 0) break;                       // partner of a parent/ancestor: describe it
      return bloodTerm(x, q) + " " + G(x, "acquisito", "acquisita");
    }
    const c = chainTerm(x, y);
    return c ? c.text : "nessuna parentela registrata";
  }
  function relPath(x, y) {
    const r = blood(x, y), path = new Set([x, y]);
    const climb = (from, to) => { // walk up from `from` to ancestor `to`
      let cur = from;
      while (cur !== to) { const ps = (L.parentsOf.get(cur) || []).filter((p) => ancestors(p).has(to)); cur = ps[0]; if (!cur) break; path.add(cur); }
    };
    if (r) { climb(x, r.c); climb(y, r.c); spousesOf(r.c).forEach((s) => { if ((L.childrenOf.get(s) || []).some((k) => path.has(k))) path.add(s); }); }
    else { const c = chainTerm(x, y); if (c) c.path.forEach((p) => path.add(p)); }
    return path;
  }

  const findNote = (x, y) => (DATA.relationships || []).find((r) => r.between && r.between.includes(x) && r.between.includes(y) && x !== y);
  function renderRel() {
    const [x, y] = relPick; if (!y) return;
    const nx = fullName(byId.get(x)), ny = fullName(byId.get(y));
    const tx = kinship(x, y), ty = kinship(y, x);
    const note = findNote(x, y);
    const editing = document.body.classList.contains("editing") && window.FamilyEditor;
    const face = (id) => { const q = byId.get(id); return q.photo
      ? `<img src="${esc(assetURL(q.photo))}" alt="">` : `<div class="initials">${esc(initials(q))}</div>`; };
    const life = (id) => { const q = byId.get(id), b = (q.born || {}).date, d = q.died && q.died.date;
      return [b && fmtDate(b), d && "† " + fmtDate(d)].filter(Boolean).join("  ·  "); };
    relPanel.innerHTML = `
      <div class="rel-card">
        <button class="rel-close" aria-label="Chiudi">×</button>
        <h3>Parentela</h3>
        <div class="rel-people">
          <figure>${face(x)}<figcaption><b>${esc(nx)}</b><small>${esc(life(x))}</small></figcaption></figure>
          <div class="rel-link">
            <p><b>${esc(byId.get(x).firstName)}</b> è <em>${esc(tx)}</em> di <b>${esc(byId.get(y).firstName)}</b></p>
            <span class="rel-arrows">⇄</span>
            <p><b>${esc(byId.get(y).firstName)}</b> è <em>${esc(ty)}</em> di <b>${esc(byId.get(x).firstName)}</b></p>
          </div>
          <figure>${face(y)}<figcaption><b>${esc(ny)}</b><small>${esc(life(y))}</small></figcaption></figure>
        </div>
        <div class="rel-note">${editing
          ? `<textarea placeholder="Aggiungi una nota su questo legame…">${esc(note ? note.note : "")}</textarea><button class="rel-save">Salva nota</button>`
          : note && note.note ? `<p>${esc(note.note)}</p>`
          : `<p class="muted">Nessuna nota.${window.FamilyEditor ? " Attiva ✎ per aggiungerne una." : ""}</p>`}</div>
        <div class="rel-actions"><button class="rel-again">Nuova ricerca</button><button class="rel-path">Mostra nell'albero</button></div>
      </div>`;
    relPanel.hidden = false;
    $(".rel-close", relPanel).onclick = () => setRelMode(false);
    $(".rel-again", relPanel).onclick = () => { setRelMode(false); setRelMode(true); };
    $(".rel-path", relPanel).onclick = () => { relPanel.hidden = true; fitTo(relPath(x, y)); };
    relPanel.onclick = (e) => { if (e.target === relPanel) { relPanel.hidden = true; fitTo(relPath(x, y)); } };
    const save = $(".rel-save", relPanel);
    if (save) save.onclick = () => {
      const text = $("textarea", relPanel).value.trim();
      DATA.relationships = (DATA.relationships || []).filter((r) => r !== note);
      if (text) DATA.relationships.push({ between: [x, y], note: text });
      window.FamilyEditor.save();
    };
    const path = relPath(x, y);
    document.body.classList.add("rel-result");
    cardEls.forEach((el, id) => el.classList.toggle("rel-on", path.has(id)));
    links.forEach((lk) => lk.g.classList.toggle("rel-on", path.has(lk.child) && lk.parents.some((p) => path.has(p))));
    marriages.forEach((m) => { const on = path.has(m.a) && path.has(m.b); m.line.classList.toggle("rel-on", on); m.ring.classList.toggle("rel-on", on); });
  }
  function setRelMode(on) {
    relMode = on; relPick = [];
    relBtn.classList.toggle("on", on);
    document.body.classList.toggle("rel-mode", on);
    document.body.classList.remove("rel-result");
    document.querySelectorAll(".rel-on, .rel-picked").forEach((e) => e.classList.remove("rel-on", "rel-picked"));
    relPanel.hidden = true;
    relBanner.textContent = on ? "Parentela: scegli la prima persona" : "";
    relBanner.classList.toggle("show", on);
    if (on) { clearTrace(); clearCity(); if (activeSurname) setSurname(null); }
  }
  function pickRel(id) {
    if (relPick.length >= 2) { setRelMode(true); }
    relPick.push(id); cardEls.get(id).classList.add("rel-picked");
    if (relPick.length === 1) relBanner.textContent = "Ora scegli la seconda persona";
    else { relBanner.classList.remove("show"); renderRel(); }
  }
  relBtn.onclick = () => setRelMode(!relMode);
  document.addEventListener("ft:editmode", () => { if (relPick.length === 2) renderRel(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && relMode && root.hidden) setRelMode(false); });

  // ------------------------------------------------------------------ hooks for js/editor.js
  window.FamilyApp = {
    DATA, byId, esc,
    current: () => openId,
    refresh(id) {
      const p = byId.get(id), el = cardEls.get(id);
      if (el) el.innerHTML = cardHTML(p);
      if (openId === id) fillModal(p);
    },
  };

  // ------------------------------------------------------------------ start
  fit(false); // start with the whole tree in view
  const fromHash = () => { const id = decodeURIComponent(location.hash.slice(1)); if (byId.has(id) && openId !== id) openPerson(id); };
  setTimeout(fromHash, 300);
  addEventListener("hashchange", fromHash);
})();
