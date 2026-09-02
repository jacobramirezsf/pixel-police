import { T, TILE } from '../sim/types';
import type { Game, Building } from '../sim/types';
import { insideBuilding, VROADS, HROADS } from '../sim/world';
import { hourOf, civById, offById } from '../sim/agents';
import { WEAPONS } from '../sim/data';

export interface RenderOpts {
  layers: { trust: boolean; crime: boolean; hoods: boolean; incidents: boolean; units: boolean };
  cleanView: boolean;
}

let base: HTMLCanvasElement | null = null;

const TILE_COLORS: Record<number, string> = {
  [T.GRASS]: '#3d5233',
  [T.ROAD]: '#33333a',
  [T.SIDEWALK]: '#6d6d72',
  [T.WALL]: '#26262c',
  [T.FLOOR]: '#7d7266',
  [T.DOOR]: '#8a6b42',
  [T.PARK]: '#43663c',
  [T.LOT]: '#4a4a50',
  [T.COUNTER]: '#5c4a38',
  [T.TREE]: '#2c4426',
};

export function buildBase(g: Game) {
  base = document.createElement('canvas');
  base.width = g.world.w * TILE;
  base.height = g.world.h * TILE;
  const c = base.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  for (let ty = 0; ty < g.world.h; ty++) {
    for (let tx = 0; tx < g.world.w; tx++) {
      const t = g.world.tiles[ty * g.world.w + tx];
      c.fillStyle = TILE_COLORS[t] || '#f0f';
      c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      // texture details
      if (t === T.SIDEWALK) {
        c.fillStyle = '#65656a';
        c.fillRect(tx * TILE, ty * TILE + TILE - 1, TILE, 1);
      } else if (t === T.GRASS || t === T.PARK) {
        c.fillStyle = t === T.PARK ? '#4b7043' : '#455c39';
        c.fillRect(tx * TILE + ((tx * 7 + ty * 3) % 12), ty * TILE + ((tx * 3 + ty * 7) % 12), 2, 2);
      } else if (t === T.TREE) {
        c.fillStyle = '#3d5a33';
        c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        c.fillStyle = '#223a1c';
        c.beginPath(); c.arc(tx * TILE + 8, ty * TILE + 8, 7, 0, 7); c.fill();
        c.fillStyle = '#2f5426';
        c.beginPath(); c.arc(tx * TILE + 7, ty * TILE + 7, 5, 0, 7); c.fill();
      } else if (t === T.LOT) {
        if ((tx + ty) % 3 === 0) { c.fillStyle = '#5c5c62'; c.fillRect(tx * TILE, ty * TILE, 1, TILE); }
      } else if (t === T.FLOOR) {
        c.fillStyle = '#746a5e';
        if ((tx + ty) % 2 === 0) c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
  }
  // crosswalk zebras where sidewalk lines cross the roads
  c.fillStyle = '#b9b9be';
  for (const vc of VROADS) for (const hr of HROADS) {
    for (const cx of [vc, vc + 1]) {
      for (let s = 2; s < TILE - 2; s += 4) { // above + below the intersection
        c.fillRect(cx * TILE + s, (hr - 1) * TILE + 4, 2, 8);
        c.fillRect(cx * TILE + s, (hr + 2) * TILE + 4, 2, 8);
      }
    }
    for (const cy of [hr, hr + 1]) {
      for (let s = 2; s < TILE - 2; s += 4) { // left + right of the intersection
        c.fillRect((vc - 1) * TILE + 4, cy * TILE + s, 8, 2);
        c.fillRect((vc + 2) * TILE + 4, cy * TILE + s, 8, 2);
      }
    }
  }
  // street furniture
  for (const p of g.world.props) {
    if (p.kind === 'bench') {
      c.fillStyle = '#6b4a2e';
      c.fillRect(p.x - 6, p.y - 2, 12, 4);
      c.fillStyle = '#4a3420';
      c.fillRect(p.x - 5, p.y + 2, 2, 2); c.fillRect(p.x + 3, p.y + 2, 2, 2);
    } else if (p.kind === 'hydrant') {
      c.fillStyle = '#a03030';
      c.fillRect(p.x - 2, p.y - 3, 4, 6);
      c.fillRect(p.x - 3, p.y - 1, 6, 2);
    } else if (p.kind === 'lamp') {
      c.fillStyle = '#55555c';
      c.fillRect(p.x - 1, p.y - 8, 2, 10);
      c.fillStyle = '#8a8a70';
      c.fillRect(p.x - 2, p.y - 10, 4, 3);
    }
  }
  // road markings
  for (let ty = 0; ty < g.world.h; ty++) for (let tx = 0; tx < g.world.w; tx++) {
    const t = g.world.tiles[ty * g.world.w + tx];
    if (t !== T.ROAD) continue;
    const right = g.world.tiles[ty * g.world.w + tx + 1];
    const below = ((ty + 1) < g.world.h) ? g.world.tiles[(ty + 1) * g.world.w + tx] : -1;
    c.fillStyle = '#c9b23c';
    // vertical center line: this tile road, next tile road, tile to left not road
    if (right === T.ROAD && g.world.tiles[ty * g.world.w + tx - 1] !== T.ROAD && below === T.ROAD && ty % 2 === 0) {
      c.fillRect(tx * TILE + TILE - 1, ty * TILE + 2, 2, 8);
    }
    if (below === T.ROAD && (ty > 0 && g.world.tiles[(ty - 1) * g.world.w + tx] !== T.ROAD) && right === T.ROAD && tx % 2 === 0) {
      c.fillRect(tx * TILE + 2, ty * TILE + TILE - 1, 8, 2);
    }
  }
}

function roofColor(b: Building): string {
  switch (b.kind) {
    case 'station': return '#2b3f66';
    case 'bank': return '#5a5346';
    case 'store': return '#6b4a4a';
    case 'bar': return '#4a3a5a';
    case 'shop': return '#4a5a5a';
    case 'office': return '#50565e';
    case 'apartment': return '#5e5048';
    default: return '#5c4f42';
  }
}

export function draw(ctx: CanvasRenderingContext2D, g: Game, opts: RenderOpts, W: number, H: number, dtReal: number) {
  const cam = g.cam;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#181a1e';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  if (base) ctx.drawImage(base, 0, 0);

  // heatmap layers
  if (opts.layers.trust || opts.layers.crime || opts.layers.hoods) {
    for (const h of g.world.hoods) {
      const r = h.rect;
      if (opts.layers.trust) {
        const v = h.trust / 100;
        ctx.fillStyle = `rgba(${Math.round(220 * (1 - v))},${Math.round(200 * v)},60,0.18)`;
        ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      }
      if (opts.layers.crime) {
        ctx.fillStyle = `rgba(220,40,40,${(h.crime / 100) * 0.3})`;
        ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      }
      if (opts.layers.hoods) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x * TILE + 1, r.y * TILE + 1, r.w * TILE - 2, r.h * TILE - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '10px monospace';
        ctx.fillText(`${h.name}  trust ${Math.round(h.trust)}  crime ${Math.round(h.crime)}`, r.x * TILE + 6, r.y * TILE + 12);
      }
    }
  }

  // figure out which buildings are revealed (someone inside / active incident inside)
  const revealed = new Set<number>();
  for (const o of g.officers) {
    if (o.x < 0) continue;
    const b = insideBuilding(g.world, o.x, o.y);
    if (b) revealed.add(b.id);
  }
  const selCiv = civById(g, g.sel.civilian);
  if (selCiv) { const b = insideBuilding(g.world, selCiv.x, selCiv.y); if (b) revealed.add(b.id); }
  for (const inc of g.incidents) {
    if (inc.state === 'resolved') continue;
    if (inc.building !== null) revealed.add(inc.building);
  }

  // entities BELOW roofs (so hidden interiors hide people inside)
  drawEntities(g, ctx, revealed, opts);

  // roofs
  for (const b of g.world.buildings) {
    if (revealed.has(b.id)) {
      // outline only
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
      continue;
    }
    ctx.fillStyle = roofColor(b);
    ctx.fillRect(b.x * TILE + 1, b.y * TILE + 1, b.w * TILE - 2, b.h * TILE - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(b.x * TILE + 1, b.y * TILE + b.h * TILE - 5, b.w * TILE - 2, 4);
    // roof texture: AC units / skylights on bigger buildings, ridge line on houses
    if (b.kind === 'apartment' || b.kind === 'office' || b.kind === 'bank') {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (let wy = b.y + 2; wy < b.y + b.h - 1; wy += 2) {
        for (let wx = b.x + 1; wx < b.x + b.w - 1; wx += 2) {
          ctx.fillRect(wx * TILE + 5, wy * TILE + 5, 6, 6);
        }
      }
    } else if (b.kind === 'house') {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(b.x * TILE + 2, b.y * TILE + Math.floor(b.h * TILE / 2), b.w * TILE - 4, 2);
    }
    if (b.kind === 'station') {
      ctx.strokeStyle = '#7fb0ff'; ctx.lineWidth = 2;
      ctx.strokeRect(b.x * TILE + 3, b.y * TILE + 3, b.w * TILE - 6, b.h * TILE - 6);
    }
    // storefront awning over the door
    if (b.kind === 'store' || b.kind === 'shop' || b.kind === 'bar') {
      ctx.fillStyle = b.kind === 'bar' ? '#7a4dab' : b.kind === 'store' ? '#c0553a' : '#3e9e9e';
      for (let s = 0; s < 3; s++) {
        ctx.fillRect(b.door.x * TILE - 6 + s * 10, b.door.y * TILE + (b.door.y > b.y ? 12 : 0), 8, 4);
      }
    }
    // door marker
    ctx.fillStyle = '#c9a86b';
    ctx.fillRect(b.door.x * TILE + 4, b.door.y * TILE + 4, 8, 8);
    if (cam.zoom >= 1.2) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '7px monospace';
      const label = b.kind === 'station' ? 'POLICE' : b.name;
      ctx.fillText(label.slice(0, Math.floor((b.w * TILE - 6) / 4.2)), b.x * TILE + 4, b.y * TILE + 10);
    }
  }

  // shots (tracers + muzzle flash) — above roofs so battles read
  for (const s of g.shots) {
    ctx.strokeStyle = s.police ? 'rgba(255,240,150,0.9)' : 'rgba(255,150,90,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    if (s.t > 0.07) {
      ctx.fillStyle = 'rgba(255,220,120,0.9)';
      ctx.beginPath(); ctx.arc(s.x1, s.y1, 3.5, 0, 7); ctx.fill();
    }
  }

  // incident markers
  if (opts.layers.incidents && !opts.cleanView) {
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250);
    for (const inc of g.incidents) {
      if (inc.state === 'resolved') continue;
      const col = inc.priority === 3 ? '255,60,60' : inc.priority === 2 ? '255,170,40' : '90,180,255';
      ctx.strokeStyle = `rgba(${col},${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(inc.x, inc.y, 14 + pulse * 4, 0, 7); ctx.stroke();
      ctx.fillStyle = `rgba(${col},1)`;
      ctx.font = 'bold 9px monospace';
      ctx.fillText('!', inc.x - 2, inc.y - 16);
      if (cam.zoom >= 1.5) {
        ctx.font = '7px monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const tw = inc.title.length * 4.5 + 6;
        ctx.fillRect(inc.x - tw / 2, inc.y - 32, tw, 10);
        ctx.fillStyle = `rgba(${col},1)`;
        ctx.fillText(inc.title, inc.x - tw / 2 + 3, inc.y - 24);
      }
      if (g.sel.incident === inc.id) {
        ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.arc(inc.x, inc.y, 22, 0, 7); ctx.stroke();
      }
    }
  }

  // day/night tint
  const h24 = hourOf(g.time);
  let dark = 0;
  if (h24 < 5.5 || h24 > 20.5) dark = 0.45;
  else if (h24 < 7) dark = 0.45 * (7 - h24) / 1.5;
  else if (h24 > 19) dark = 0.45 * (h24 - 19) / 1.5;
  if (dark > 0.01) {
    ctx.fillStyle = `rgba(10,14,40,${dark})`;
    ctx.fillRect(cam.x - W / cam.zoom, cam.y - H / cam.zoom, (W * 2) / cam.zoom, (H * 2) / cam.zoom);
    // street lamps glow through the dark
    for (const p of g.world.props) {
      if (p.kind !== 'lamp') continue;
      ctx.fillStyle = `rgba(255,214,130,${0.13 * (dark / 0.45)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y - 8, 26, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,236,170,${0.85 * (dark / 0.45)})`;
      ctx.fillRect(p.x - 2, p.y - 10, 4, 3);
    }
  }

  // aim line while directly controlling with a drawn weapon
  const co = offById(g, g.control);
  if (co && co.drawn && co.weapon && co.vehicle === null && g.aim) {
    const wd = WEAPONS[co.weapon];
    const d = Math.hypot(g.aim.x - co.x, g.aim.y - co.y) || 1;
    const r = Math.min(d, wd.range);
    ctx.strokeStyle = 'rgba(255,120,120,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(co.x, co.y);
    ctx.lineTo(co.x + ((g.aim.x - co.x) / d) * r, co.y + ((g.aim.y - co.y) / d) * r);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawEntities(g: Game, ctx: CanvasRenderingContext2D, revealed: Set<number>, opts: RenderOpts) {
  const h24 = hourOf(g.time);
  const night = h24 < 6 || h24 > 20;
  // blood pools under the downed (before bodies so they layer under)
  for (const c of g.civs) {
    if (c.x < 0 || (c.state !== 'down' && c.injury !== 'dead')) continue;
    if (c.injury === 'serious' || c.injury === 'incap' || c.injury === 'dead') {
      ctx.fillStyle = 'rgba(110,20,20,0.55)';
      ctx.beginPath(); ctx.ellipse(c.x, c.y + 2, 7, 4, 0, 0, 7); ctx.fill();
    }
  }
  // vehicles
  for (const v of g.vehicles) {
    // headlights at night for moving cars
    if (night && Math.abs(v.speed) > 8) {
      ctx.fillStyle = 'rgba(255,240,180,0.14)';
      ctx.beginPath();
      const hx = v.x + Math.cos(v.angle) * 12, hy = v.y + Math.sin(v.angle) * 12;
      ctx.moveTo(hx, hy);
      ctx.arc(hx, hy, 34, v.angle - 0.45, v.angle + 0.45);
      ctx.closePath(); ctx.fill();
    }
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-11, -5, 23, 11);
    ctx.fillStyle = v.color;
    ctx.fillRect(-11, -6, 22, 12);
    ctx.fillStyle = v.police ? '#e8e8ee' : 'rgba(255,255,255,0.25)';
    if (v.police) { ctx.fillRect(-3, -6, 7, 12); }
    ctx.fillStyle = '#1a2a3a';
    ctx.fillRect(1, -4, 5, 8); // windshield
    if (v.police && v.lights) {
      const phase = Math.floor(performance.now() / 150) % 2;
      ctx.fillStyle = phase ? '#ff3030' : '#3060ff';
      ctx.fillRect(-2, phase ? -6 : 2, 4, 4);
      // glow
      ctx.fillStyle = phase ? 'rgba(255,40,40,0.25)' : 'rgba(60,90,255,0.25)';
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
    }
    ctx.restore();
    if (g.sel.vehicle === v.id && !opts.cleanView) {
      ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(v.x, v.y, 17, 0, 7); ctx.stroke();
    }
  }

  // civilians
  for (const c of g.civs) {
    if (c.x < 0) continue;
    if (c.injury === 'dead' || c.state === 'down') {
      ctx.fillStyle = c.injury === 'dead' ? '#5a1f1f' : '#8a4a3a';
      ctx.fillRect(c.x - 4, c.y - 2, 8, 4);
      ctx.fillStyle = c.skin;
      ctx.fillRect(c.x + 3, c.y - 2, 3, 3);
      continue;
    }
    drawPerson(ctx, c.x, c.y - personBob(c), c.color, c.skin, false);
    if (c.dog) {
      const bob2 = personBob(c);
      ctx.fillStyle = '#6b4a2e';
      ctx.fillRect(c.x - 9, c.y + 1 - bob2, 6, 3);
      ctx.fillRect(c.x - 10, c.y - 1 - bob2, 3, 3); // head
      ctx.fillRect(c.x - 4, c.y - 1 - bob2, 1, 2);  // tail
    }
    if (c.drawn) {
      ctx.fillStyle = '#111';
      ctx.fillRect(c.x + 2, c.y - 2, 4, 2);
    }
    if (c.state === 'hostile') {
      ctx.fillStyle = '#ff5050';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('!', c.x - 2, c.y - 12);
    } else if (c.emote && g.time < (c.emoteUntil ?? 0)) {
      ctx.fillStyle = 'rgba(240,240,245,0.92)';
      ctx.fillRect(c.x + 3, c.y - 17, 11, 9);
      ctx.fillRect(c.x + 4, c.y - 8, 3, 2);
      ctx.fillStyle = '#22242c';
      ctx.font = '7px monospace';
      ctx.fillText(c.emote, c.x + 5, c.y - 10);
    }
    if (c.state === 'surrender') {
      ctx.fillStyle = '#fff'; ctx.font = '8px monospace'; ctx.fillText('✋', c.x - 3, c.y - 8);
    }
    if (c.state === 'detained' || c.state === 'arrested') {
      ctx.strokeStyle = '#ccc'; ctx.strokeRect(c.x - 4, c.y - 7, 8, 12);
    }
    if (c.state === 'protest') {
      ctx.fillStyle = '#e8d44a';
      ctx.fillRect(c.x - 3, c.y - 12, 6, 4);
      ctx.fillStyle = '#7a6a3a';
      ctx.fillRect(c.x - 1, c.y - 8, 1, 4);
    }
    if (g.sel.civilian === c.id && !opts.cleanView) {
      ctx.strokeStyle = '#ffd07f'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c.x, c.y - 2, 8, 0, 7); ctx.stroke();
    }
  }

  // officers
  for (const o of g.officers) {
    if (o.x < 0 || o.vehicle !== null) continue;
    if (o.injury === 'dead' || o.state === 'down') {
      ctx.fillStyle = '#22315a';
      ctx.fillRect(o.x - 4, o.y - 2, 8, 4);
      ctx.fillStyle = '#d0a67c';
      ctx.fillRect(o.x + 3, o.y - 2, 3, 3);
      continue;
    }
    drawPerson(ctx, o.x, o.y - personBob(o), '#2b57a8', '#d8b28c', true);
    if (o.drawn) { ctx.fillStyle = '#111'; ctx.fillRect(o.x + 2, o.y - 2, 5, 2); }
    if (!opts.cleanView) {
      const selected = g.sel.officers.includes(o.id);
      const controlled = g.control === o.id;
      if (controlled) {
        ctx.strokeStyle = '#4aff88'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(o.x, o.y - 2, 9, 0, 7); ctx.stroke();
      } else if (selected) {
        ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(o.x, o.y - 2, 8, 0, 7); ctx.stroke();
      }
      // path preview for selected
      if ((selected || controlled) && o.path && o.path.length) {
        ctx.strokeStyle = 'rgba(127,208,255,0.4)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(o.x, o.y);
        for (const p of o.path) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // state chip
      if (opts.layers.units && g.cam.zoom >= 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.font = '6px monospace';
        const s = o.state === 'responding' || o.state === 'driving' ? 'RESP' :
          o.state === 'combat' ? 'CBT!' : o.state === 'pursuing' ? 'PURS' :
          o.state === 'onscene' ? 'SCNE' : o.state === 'patrol' ? 'PTRL' : '';
        if (s) {
          ctx.fillRect(o.x - 9, o.y - 16, 20, 7);
          ctx.fillStyle = o.state === 'combat' ? '#ff8080' : '#9fd0ff';
          ctx.fillText(s, o.x - 7, o.y - 10);
        }
      }
    }
  }
}

function personBob(e: { id: number; path: any[] | null }): number {
  const moving = (e.path && e.path.length) || (performance.now() - ((e as any).lastMove || 0) < 150);
  return moving ? Math.floor(performance.now() / 130 + e.id) % 2 : 0;
}

function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, body: string, skin: string, cop: boolean) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 3, y + 3, 6, 2);
  ctx.fillStyle = body;
  ctx.fillRect(x - 3, y - 3, 6, 7);
  ctx.fillStyle = skin;
  ctx.fillRect(x - 2, y - 7, 4, 4);
  if (cop) {
    ctx.fillStyle = '#1a2a50';
    ctx.fillRect(x - 3, y - 8, 6, 2);
  }
}
