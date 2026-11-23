/*
 * Family tree layout.
 *
 * Handles any mix of families: several root couples, in-laws who marry in
 * with or without their own parents, single parents, multiple generations.
 *
 *  1. Generations are derived from parent links (children one row below their
 *     deepest parent, partners on the same row, root couples pulled down to sit
 *     right above their children).
 *  2. Partners are grouped into "units" that are laid out side by side.
 *  3. Horizontal positions are refined by alternating top-down passes (centre
 *     children under their parents) and bottom-up passes (centre parents over
 *     their children). Each row is packed without overlaps using isotonic
 *     regression, so units stay as close as possible to where they want to be.
 */
(function (global) {
  "use strict";

  function compute(people, opts) {
    const CW = opts.cardW, CH = opts.cardH;
    const GAP = opts.gap, PGAP = opts.partnerGap, ROW = opts.rowGap;

    const byId = new Map(people.map((p) => [p.id, p]));
    const order = new Map(people.map((p, i) => [p.id, i]));
    const partners = new Map(people.map((p) => [p.id, new Set()]));
    people.forEach((p) =>
      (p.partners || []).forEach((q) => {
        if (byId.has(q) && q !== p.id) { partners.get(p.id).add(q); partners.get(q).add(p.id); }
      })
    );
    const parentsOf = new Map(people.map((p) => [p.id, (p.parents || []).filter((x) => byId.has(x))]));
    const childrenOf = new Map(people.map((p) => [p.id, []]));
    people.forEach((p) => parentsOf.get(p.id).forEach((par) => childrenOf.get(par).push(p.id)));
    const birthKey = (id) => (byId.get(id).born && byId.get(id).born.date) || "9999";
    childrenOf.forEach((list) => list.sort((a, b) => birthKey(a).localeCompare(birthKey(b))));

    // ---------- 1. generations
    const gen = new Map(people.map((p) => [p.id, 0]));
    for (let it = 0; it < 200; it++) {
      let changed = false;
      const raise = (id, v) => { if (v > gen.get(id)) { gen.set(id, v); changed = true; } };
      people.forEach((p) => {
        const ps = parentsOf.get(p.id);
        if (ps.length) raise(p.id, Math.max(...ps.map((x) => gen.get(x))) + 1);
      });
      people.forEach((p) => partners.get(p.id).forEach((q) => {
        const v = Math.max(gen.get(p.id), gen.get(q)); raise(p.id, v); raise(q, v);
      }));
      people.forEach((p) => {
        if (parentsOf.get(p.id).length) return;
        if ([...partners.get(p.id)].some((q) => parentsOf.get(q).length)) return;
        const kids = childrenOf.get(p.id);
        if (kids.length) raise(p.id, Math.min(...kids.map((k) => gen.get(k))) - 1);
      });
      if (!changed) break;
    }
    const minGen = Math.min(...gen.values());
    gen.forEach((v, k) => gen.set(k, v - minGen));
    const maxGen = Math.max(...gen.values());

    // ---------- 2. units (partner groups)
    const unitOf = new Map();
    const units = [];
    people.forEach((p) => {
      if (unitOf.has(p.id)) return;
      const members = [], stack = [p.id];
      while (stack.length) {
        const id = stack.pop();
        if (unitOf.has(id)) continue;
        unitOf.set(id, units.length); members.push(id);
        partners.get(id).forEach((q) => stack.push(q));
      }
      members.sort((a, b) => order.get(a) - order.get(b));
      units.push({ idx: units.length, members, gen: gen.get(p.id), x: 0 });
    });
    const unitWidth = (u) => u.members.length * CW + (u.members.length - 1) * PGAP;

    // initial order: depth-first from root units, children by birth date
    const rows = Array.from({ length: maxGen + 1 }, () => []);
    const seen = new Set();
    const visit = (u) => {
      if (seen.has(u.idx)) return;
      seen.add(u.idx); rows[u.gen].push(u);
      const kids = [];
      u.members.forEach((m) => childrenOf.get(m).forEach((k) => { if (!kids.includes(k)) kids.push(k); }));
      kids.sort((a, b) => birthKey(a).localeCompare(birthKey(b)));
      kids.forEach((k) => visit(units[unitOf.get(k)]));
    };
    units.filter((u) => u.members.every((m) => !parentsOf.get(m).length)).forEach(visit);
    units.forEach(visit);

    const personX = (id) => {
      const u = units[unitOf.get(id)];
      const i = u.members.indexOf(id);
      return u.x - unitWidth(u) / 2 + i * (CW + PGAP) + CW / 2;
    };
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

    // pack one row: keep order, no overlaps, minimise squared distance to desired
    function pack(row, desired) {
      if (!row.length) return;
      const off = [0];
      for (let i = 1; i < row.length; i++)
        off[i] = off[i - 1] + (unitWidth(row[i - 1]) + unitWidth(row[i])) / 2 + GAP;
      const blocks = [];
      row.forEach((u, i) => {
        blocks.push({ start: i, end: i, sum: desired[i] - off[i], n: 1 });
        while (blocks.length > 1) {
          const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
          if (a.sum / a.n <= b.sum / b.n) break;
          a.end = b.end; a.sum += b.sum; a.n += b.n; blocks.pop();
        }
      });
      blocks.forEach((b) => { for (let i = b.start; i <= b.end; i++) row[i].x = off[i] + b.sum / b.n; });
    }
    function sortAndPack(g, desiredOf) {
      const row = rows[g];
      const d = new Map(row.map((u) => [u.idx, desiredOf(u)]));
      row.sort((a, b) => d.get(a.idx) - d.get(b.idx));
      pack(row, row.map((u) => d.get(u.idx)));
    }

    // A unit with someone married more than once (A — B — C) is laid out as a
    // chain, so every couple stands next to each other.
    function chainOf(u) {
      const inUnit = (m) => [...partners.get(m)].filter((q) => u.members.includes(q));
      const ends = u.members.filter((m) => inUnit(m).length === 1);
      if (ends.length !== 2 || u.members.some((m) => inUnit(m).length > 2)) return null;
      const chain = [ends[0]];
      while (chain.length < u.members.length) {
        const next = inUnit(chain[chain.length - 1]).find((q) => !chain.includes(q));
        if (!next) return null;
        chain.push(next);
      }
      return chain;
    }
    function orderMembers(u) {
      if (u.members.length < 2) return;
      const key = new Map();
      u.members.forEach((m) => {
        const ps = parentsOf.get(m);
        key.set(m, ps.length ? mean(ps.map(personX)) : null);
      });
      const known = [...key.values()].filter((v) => v !== null);
      if (u.members.length > 2) {
        const chain = chainOf(u);
        if (chain) {
          const m0 = known.length ? mean(known) : 0;
          const score = (c) => c.reduce((s, m, i) => s + (key.get(m) === null ? 0 : (key.get(m) - m0) * i), 0);
          const rev = chain.slice().reverse();
          u.members = score(rev) > score(chain) ? rev : chain;
          return;
        }
      }
      const fallback = known.length ? mean(known) + 0.5 : 0;
      u.members.sort((a, b) => (key.get(a) ?? fallback) - (key.get(b) ?? fallback) || order.get(a) - order.get(b));
    }

    function topDown() {
      for (let g = 1; g <= maxGen; g++) {
        rows[g].forEach(orderMembers);
        sortAndPack(g, (u) => {
          const w = unitWidth(u), wants = [];
          u.members.forEach((m, i) => {
            const ps = parentsOf.get(m);
            if (ps.length) wants.push(mean(ps.map(personX)) - (-w / 2 + i * (CW + PGAP) + CW / 2));
          });
          return wants.length ? mean(wants) : u.x;
        });
      }
    }
    function bottomUp() {
      for (let g = maxGen - 1; g >= 0; g--) {
        sortAndPack(g, (u) => {
          const kids = new Set();
          u.members.forEach((m) => childrenOf.get(m).forEach((k) => kids.add(k)));
          return kids.size ? mean([...kids].map(personX)) : u.x;
        });
      }
    }

    rows.forEach((row) => pack(row, row.map(() => 0)));
    for (let i = 0; i < 10; i++) { topDown(); bottomUp(); }
    topDown();

    // ---------- output
    let minX = Infinity, maxX = -Infinity;
    units.forEach((u) => { minX = Math.min(minX, u.x - unitWidth(u) / 2); maxX = Math.max(maxX, u.x + unitWidth(u) / 2); });
    const pos = new Map();
    people.forEach((p) => pos.set(p.id, { x: personX(p.id) - CW / 2 - minX, y: gen.get(p.id) * (CH + ROW), gen: gen.get(p.id) }));

    const marriages = [];
    units.forEach((u) => {
      for (let i = 0; i < u.members.length - 1; i++) {
        if (!partners.get(u.members[i]).has(u.members[i + 1])) continue;
        const a = pos.get(u.members[i]), b = pos.get(u.members[i + 1]);
        marriages.push({ a: u.members[i], b: u.members[i + 1], x1: a.x + CW, x2: b.x, y: a.y + CH / 2 });
      }
    });

    const links = [];
    people.forEach((c) => {
      const ps = parentsOf.get(c.id);
      if (!ps.length) return;
      const cp = pos.get(c.id);
      const to = { x: cp.x + CW / 2, y: cp.y };
      if (ps.length === 2 && unitOf.get(ps[0]) === unitOf.get(ps[1])) {
        const u = units[unitOf.get(ps[0])];
        if (Math.abs(u.members.indexOf(ps[0]) - u.members.indexOf(ps[1])) === 1) {
          const a = pos.get(ps[0]), b = pos.get(ps[1]);
          const x = (Math.min(a.x, b.x) + CW + Math.max(a.x, b.x)) / 2;
          links.push({ child: c.id, parents: ps.slice(), from: { x, y: a.y + CH / 2 + 9 }, to, couple: true });
          return;
        }
      }
      ps.forEach((par) => {
        const pp = pos.get(par);
        links.push({ child: c.id, parents: [par], from: { x: pp.x + CW / 2, y: pp.y + CH }, to, couple: false });
      });
    });

    return {
      positions: pos, links, marriages,
      width: maxX - minX, height: (maxGen + 1) * CH + maxGen * ROW,
      generations: maxGen + 1, childrenOf, parentsOf, partners,
    };
  }

  global.FamilyLayout = { compute };
})(window);
