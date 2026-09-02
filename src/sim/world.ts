import { T, TILE } from './types';
import type { World, Building, Neighborhood, Pt, BuildingKind } from './types';
import { HOOD_NAMES, STORE_NAMES, SHOP_NAMES, BAR_NAMES, OFFICE_NAMES } from './data';

export const GW = 96, GH = 72;

// ---------- seeded rng ----------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export let rng = mulberry32(1);
export function setRng(seed: number) { rng = mulberry32(seed); }
export const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
export const pick = <X,>(arr: X[]): X => arr[Math.floor(rng() * arr.length)];

// ---------- tile helpers ----------
export function tileAt(w: World, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return T.WALL;
  return w.tiles[ty * w.w + tx];
}
export function setTile(w: World, tx: number, ty: number, v: number) {
  if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return;
  w.tiles[ty * w.w + tx] = v;
}
export const px2t = (p: number) => Math.floor(p / TILE);

export function walkCost(t: number): number {
  switch (t) {
    case T.SIDEWALK: case T.DOOR: case T.FLOOR: return 1;
    case T.PARK: case T.LOT: return 1.2;
    case T.GRASS: return 1.6;
    case T.ROAD: return 3;
    default: return -1;
  }
}
export function driveCost(t: number): number {
  if (t === T.ROAD) return 1;
  if (t === T.LOT) return 1.6;
  return -1;
}
export function blocksSight(t: number): boolean {
  return t === T.WALL || t === T.COUNTER || t === T.TREE;
}
export function blocksMove(t: number): boolean {
  return t === T.WALL || t === T.COUNTER || t === T.TREE;
}

export function hoodAt(w: World, x: number, y: number): number {
  const tx = px2t(x), ty = px2t(y);
  for (const h of w.hoods) {
    if (tx >= h.rect.x && tx < h.rect.x + h.rect.w && ty >= h.rect.y && ty < h.rect.y + h.rect.h) return h.id;
  }
  return 0;
}

export function buildingAt(w: World, tx: number, ty: number): Building | null {
  for (const b of w.buildings) {
    if (tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h) return b;
  }
  return null;
}

export function insideBuilding(w: World, x: number, y: number): Building | null {
  const tx = px2t(x), ty = px2t(y);
  const t = tileAt(w, tx, ty);
  if (t !== T.FLOOR && t !== T.DOOR && t !== T.COUNTER) return null;
  return buildingAt(w, tx, ty);
}

// ---------- A* ----------
const openH: number[] = [];
function hpush(f: Float32Array, i: number) {
  openH.push(i);
  let c = openH.length - 1;
  while (c > 0) {
    const p = (c - 1) >> 1;
    if (f[openH[p]] <= f[openH[c]]) break;
    [openH[p], openH[c]] = [openH[c], openH[p]]; c = p;
  }
}
function hpop(f: Float32Array): number {
  const top = openH[0];
  const last = openH.pop()!;
  if (openH.length) {
    openH[0] = last;
    let c = 0;
    for (;;) {
      let m = c; const l = 2 * c + 1, r = l + 1;
      if (l < openH.length && f[openH[l]] < f[openH[m]]) m = l;
      if (r < openH.length && f[openH[r]] < f[openH[m]]) m = r;
      if (m === c) break;
      [openH[m], openH[c]] = [openH[c], openH[m]]; c = m;
    }
  }
  return top;
}

const gArr = new Float32Array(GW * GH);
const fArr = new Float32Array(GW * GH);
const fromArr = new Int32Array(GW * GH);
const closedArr = new Uint8Array(GW * GH);

/** A* in tile coords. Returns pixel-center waypoints or null. */
export function findPath(w: World, sx: number, sy: number, ex: number, ey: number, costFn: (t: number) => number): Pt[] | null {
  const stx = px2t(sx), sty = px2t(sy);
  let etx = px2t(ex), ety = px2t(ey);
  if (stx === etx && sty === ety) return [];
  // if destination not passable, find nearest passable neighbor
  if (costFn(tileAt(w, etx, ety)) < 0) {
    let found = false;
    outer: for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (costFn(tileAt(w, etx + dx, ety + dy)) >= 0) { etx += dx; ety += dy; found = true; break outer; }
      }
    }
    if (!found) return null;
  }
  gArr.fill(Infinity); closedArr.fill(0); openH.length = 0;
  const si = sty * GW + stx, ei = ety * GW + etx;
  gArr[si] = 0; fArr[si] = Math.abs(etx - stx) + Math.abs(ety - sty); fromArr[si] = -1;
  hpush(fArr, si);
  let iter = 0;
  while (openH.length && iter++ < 9000) {
    const cur = hpop(fArr);
    if (cur === ei) {
      const path: Pt[] = [];
      let n = cur;
      while (n !== si && n !== -1) {
        path.push({ x: (n % GW) * TILE + TILE / 2, y: Math.floor(n / GW) * TILE + TILE / 2 });
        n = fromArr[n];
      }
      path.reverse();
      // simplify collinear
      const out: Pt[] = [];
      for (let i2 = 0; i2 < path.length; i2++) {
        if (i2 > 0 && i2 < path.length - 1) {
          const a = path[i2 - 1], b = path[i2], c = path[i2 + 1];
          if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue;
        }
        out.push(path[i2]);
      }
      return out;
    }
    if (closedArr[cur]) continue;
    closedArr[cur] = 1;
    const cx = cur % GW, cy = Math.floor(cur / GW);
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (closedArr[ni]) continue;
      const c = costFn(w.tiles[ni]);
      if (c < 0) continue;
      const ng = gArr[cur] + c;
      if (ng < gArr[ni]) {
        gArr[ni] = ng;
        fArr[ni] = ng + Math.abs(etx - nx) + Math.abs(ety - ny);
        fromArr[ni] = cur;
        hpush(fArr, ni);
      }
    }
  }
  return null;
}

/** Bresenham line-of-sight over tiles. */
export function los(w: World, x1: number, y1: number, x2: number, y2: number): boolean {
  let tx = px2t(x1), ty = px2t(y1);
  const ex = px2t(x2), ey = px2t(y2);
  const dx = Math.abs(ex - tx), dy = Math.abs(ey - ty);
  const sx = tx < ex ? 1 : -1, sy = ty < ey ? 1 : -1;
  let err = dx - dy;
  for (let i = 0; i < 200; i++) {
    if (tx === ex && ty === ey) return true;
    if (!(tx === px2t(x1) && ty === px2t(y1)) && blocksSight(tileAt(w, tx, ty))) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; tx += sx; }
    if (e2 < dx) { err += dx; ty += sy; }
  }
  return false;
}

// ---------- city generation ----------
const VROADS = [8, 24, 40, 56, 72, 88];
const HROADS = [8, 24, 40, 56];

export function generateCity(seed: number): World {
  setRng(seed);
  const w: World = {
    seed, w: GW, h: GH,
    tiles: new Uint8Array(GW * GH).fill(T.GRASS),
    buildings: [], hoods: [], stationId: -1, bankId: -1, storeIds: [],
  };

  // neighborhoods (quadrants)
  const wealth = [0.85, 0.6, 0.2, 0.45];
  const trust0 = [72, 60, 34, 55];
  for (let i = 0; i < 4; i++) {
    w.hoods.push({
      id: i, name: HOOD_NAMES[i], wealth: wealth[i], trust: trust0[i], crime: i === 2 ? 40 : 15, tension: i === 2 ? 30 : 8,
      rect: { x: i % 2 === 0 ? 0 : 48, y: i < 2 ? 0 : 36, w: 48, h: 36 },
    });
  }

  // roads + sidewalks
  for (const c of VROADS) for (let y = 0; y < GH; y++) { setTile(w, c, y, T.ROAD); setTile(w, c + 1, y, T.ROAD); }
  for (const r of HROADS) for (let x = 0; x < GW; x++) { setTile(w, x, r, T.ROAD); setTile(w, x, r + 1, T.ROAD); }
  const sw = (x: number, y: number) => { if (tileAt(w, x, y) === T.GRASS) setTile(w, x, y, T.SIDEWALK); };
  for (const c of VROADS) for (let y = 0; y < GH; y++) { sw(c - 1, y); sw(c + 2, y); }
  for (const r of HROADS) for (let x = 0; x < GW; x++) { sw(x, r - 1); sw(x, r + 2); }

  // blocks: regions between roads
  const xs = [3, ...VROADS.map(c => c + 3)]; // block start columns
  const ys = [3, ...HROADS.map(r => r + 3)];
  const blockW = 12, blockH = 12;
  let bid = 0;
  const blocks: { x: number; y: number }[] = [];
  for (const by of ys) for (const bx of xs) {
    if (bx + blockW > GW - 1 || by + blockH > GH - 1) continue;
    blocks.push({ x: bx, y: by });
  }

  // choose special blocks
  const centerIdx = blocks.findIndex(b => b.x === 43 && b.y === 27);
  const stationBlock = centerIdx >= 0 ? centerIdx : Math.floor(blocks.length / 2);
  const parkBlock = (stationBlock + 3) % blocks.length;
  const bankBlock = (stationBlock + 1) % blocks.length;

  const addBuilding = (kind: BuildingKind, name: string, x: number, y: number, bw: number, bh: number): Building => {
    const b: Building = { id: bid++, kind, name, x, y, w: bw, h: bh, door: { x, y }, hood: 0 };
    // walls + floor
    for (let ty = y; ty < y + bh; ty++) for (let tx = x; tx < x + bw; tx++) {
      const edge = tx === x || ty === y || tx === x + bw - 1 || ty === y + bh - 1;
      setTile(w, tx, ty, edge ? T.WALL : T.FLOOR);
    }
    // door: face nearest sidewalk — pick side closest to a road
    let best: Pt = { x: x + Math.floor(bw / 2), y: y + bh - 1 };
    let bestD = Infinity;
    const sides: Pt[] = [
      { x: x + Math.floor(bw / 2), y: y + bh - 1 }, { x: x + Math.floor(bw / 2), y: y },
      { x: x, y: y + Math.floor(bh / 2) }, { x: x + bw - 1, y: y + Math.floor(bh / 2) },
    ];
    for (const s of sides) {
      for (const r of HROADS) { const d = Math.abs(s.y - r); if (d < bestD) { bestD = d; best = s; } }
      for (const c of VROADS) { const d = Math.abs(s.x - c); if (d < bestD) { bestD = d; best = s; } }
    }
    setTile(w, best.x, best.y, T.DOOR);
    b.door = best;
    b.hood = hoodAt(w, best.x * TILE, best.y * TILE);
    // path from door outward
    const dirx = best.x === x ? -1 : best.x === x + bw - 1 ? 1 : 0;
    const diry = best.y === y ? -1 : best.y === y + bh - 1 ? 1 : 0;
    let ox = best.x + dirx, oy = best.y + diry;
    while (tileAt(w, ox, oy) === T.GRASS) { setTile(w, ox, oy, T.SIDEWALK); ox += dirx; oy += diry; }
    w.buildings.push(b);
    return b;
  };

  let storeN = 0, shopN = 0, barN = 0, offN = 0, houseN = 0, aptN = 0;
  blocks.forEach((blk, i) => {
    const hood = hoodAt(w, (blk.x + 6) * TILE, (blk.y + 6) * TILE);
    if (i === parkBlock) {
      for (let ty = blk.y; ty < blk.y + blockH; ty++) for (let tx = blk.x; tx < blk.x + blockW; tx++) setTile(w, tx, ty, T.PARK);
      for (let k = 0; k < 8; k++) setTile(w, blk.x + ri(1, blockW - 2), blk.y + ri(1, blockH - 2), T.TREE);
      return;
    }
    if (i === stationBlock) {
      const b = addBuilding('station', 'Police Station', blk.x + 1, blk.y + 1, 9, 7);
      w.stationId = b.id;
      // parking lot below/right of station
      for (let ty = blk.y + 8; ty < blk.y + blockH; ty++) for (let tx = blk.x; tx < blk.x + blockW; tx++) setTile(w, tx, ty, T.LOT);
      for (let ty = blk.y + 1; ty < blk.y + 8; ty++) setTile(w, blk.x + 10, ty, T.LOT);
      setTile(w, blk.x + 10, blk.y + 8, T.LOT);
      // front desk counters inside
      for (let tx = blk.x + 3; tx <= blk.x + 6; tx++) setTile(w, tx, blk.y + 3, T.COUNTER);
      return;
    }
    if (i === bankBlock) {
      const b = addBuilding('bank', 'First Bay Bank', blk.x + 2, blk.y + 2, 8, 8);
      for (let tx = b.x + 2; tx <= b.x + 5; tx++) setTile(w, tx, b.y + 3, T.COUNTER);
      w.bankId = b.id;
      return;
    }
    // regular block: 2-3 buildings by neighborhood flavor
    const slots = [
      { x: blk.x, y: blk.y, w: 6, h: 6 }, { x: blk.x + 6, y: blk.y, w: 6, h: 6 },
      { x: blk.x, y: blk.y + 6, w: 6, h: 6 }, { x: blk.x + 6, y: blk.y + 6, w: 6, h: 6 },
    ];
    const n = ri(2, 4);
    for (let s = 0; s < n; s++) {
      const slot = slots[s];
      const bw2 = ri(5, 6), bh2 = ri(5, 6);
      let kind: BuildingKind; let name: string;
      const roll = rng();
      if (hood === 0) kind = roll < 0.55 ? 'house' : roll < 0.8 ? 'office' : 'shop';
      else if (hood === 1) kind = roll < 0.4 ? 'store' : roll < 0.7 ? 'office' : roll < 0.85 ? 'shop' : 'bar';
      else if (hood === 2) kind = roll < 0.3 ? 'apartment' : roll < 0.55 ? 'bar' : roll < 0.8 ? 'store' : 'shop';
      else kind = roll < 0.5 ? 'house' : roll < 0.75 ? 'apartment' : 'store';
      switch (kind) {
        case 'store': name = STORE_NAMES[storeN++ % STORE_NAMES.length]; break;
        case 'shop': name = SHOP_NAMES[shopN++ % SHOP_NAMES.length]; break;
        case 'bar': name = BAR_NAMES[barN++ % BAR_NAMES.length]; break;
        case 'office': name = OFFICE_NAMES[offN++ % OFFICE_NAMES.length]; break;
        case 'apartment': name = `Apt ${String.fromCharCode(65 + (aptN++ % 8))}`; break;
        default: name = `House ${++houseN}`;
      }
      const b = addBuilding(kind, name, slot.x, slot.y, Math.min(bw2, slot.w), Math.min(bh2, slot.h));
      if (kind === 'store' || kind === 'bar') {
        // counter inside for cover / register
        const cy = b.y + 2;
        for (let tx = b.x + 2; tx < b.x + b.w - 2; tx++) if (tileAt(w, tx, cy) === T.FLOOR) setTile(w, tx, cy, T.COUNTER);
        if (kind === 'store') w.storeIds.push(b.id);
      }
    }
    // scatter trees on leftover grass
    for (let k = 0; k < 3; k++) {
      const tx = blk.x + ri(0, blockW - 1), ty = blk.y + ri(0, blockH - 1);
      if (tileAt(w, tx, ty) === T.GRASS) setTile(w, tx, ty, T.TREE);
    }
  });

  return w;
}

export function stationDoor(w: World): Pt {
  const st = w.buildings.find(b => b.id === w.stationId)!;
  return { x: st.door.x * TILE + TILE / 2, y: (st.door.y + 1) * TILE + TILE / 2 };
}
export function stationLot(w: World): Pt {
  const st = w.buildings.find(b => b.id === w.stationId)!;
  return { x: (st.x + 2) * TILE, y: (st.y + st.h + 1) * TILE + TILE / 2 };
}
export function randomRoadPoint(w: World): Pt {
  for (let i = 0; i < 200; i++) {
    const tx = ri(2, GW - 3), ty = ri(2, GH - 3);
    if (tileAt(w, tx, ty) === T.ROAD) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  }
  return { x: 9 * TILE, y: 9 * TILE };
}
export function randomSidewalkPoint(w: World, hood?: number): Pt {
  for (let i = 0; i < 300; i++) {
    const tx = ri(2, GW - 3), ty = ri(2, GH - 3);
    if (tileAt(w, tx, ty) !== T.SIDEWALK) continue;
    if (hood !== undefined && hoodAt(w, tx * TILE, ty * TILE) !== hood) continue;
    return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  }
  return stationDoor(w);
}
