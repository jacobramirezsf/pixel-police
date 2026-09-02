import { T, TILE } from './types';
import type { Game, Civilian, Officer, Vehicle, Pt, World } from './types';
import { WEAPONS, FIRST, LAST, OFFICER_TRAITS, CIV_COLORS, SKIN, CAR_COLORS } from './data';
import { rng, ri, pick, findPath, walkCost, driveCost, tileAt, px2t, randomSidewalkPoint, randomRoadPoint, stationDoor, stationLot, hoodAt } from './world';
import { onOfficerArrive, reportShots } from './incidents';
import { updateCombatant } from './combat';
import { addLog } from './dept';

export const name2 = () => `${pick(FIRST)} ${pick(LAST)}`;

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const civById = (g: Game, id: number | null) => g.civs.find(c => c.id === id) || null;
export const offById = (g: Game, id: number | null) => g.officers.find(o => o.id === id) || null;
export const vehById = (g: Game, id: number | null) => g.vehicles.find(v => v.id === id) || null;

export const hourOf = (t: number) => (t / 60) % 24;
export const clock = (t: number) => {
  const h = Math.floor(hourOf(t)), m = Math.floor(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
export const dayOf = (t: number) => Math.floor(t / 1440) + 1;

// ---------- spawning ----------
export function makeCivilian(g: Game, x: number, y: number, hood: number): Civilian {
  const homes = g.world.buildings.filter(b => (b.kind === 'house' || b.kind === 'apartment'));
  const works = g.world.buildings.filter(b => b.kind !== 'house' && b.kind !== 'apartment' && b.kind !== 'station');
  const c: Civilian = {
    id: g.nextId++, kind: 'civ', name: name2(), x, y,
    home: homes.length ? pick(homes).id : -1,
    work: rng() < 0.7 && works.length ? pick(works).id : -1,
    hood, state: 'idle', path: null, target: null, speed: 26 + rng() * 10,
    color: pick(CIV_COLORS), skin: pick(SKIN),
    lawful: Math.min(1, 0.35 + rng() * 0.7 + g.world.hoods[hood].wealth * 0.15),
    aggression: rng() * 0.8, bravery: rng(),
    fear: 0, hp: 100, injury: 'healthy', record: [], incident: null, role: 'none',
    detainedBy: null, waitUntil: 0, lodTick: rng() * 2,
    weapon: null, ammo: 0, reserve: 0, drawn: false, cooldown: 0, reloading: 0,
    warrant: rng() < 0.05,
  };
  if (c.lawful < 0.45 && rng() < 0.35) { // some carry concealed
    c.weapon = pick(['chandgun', 'revolver', 'knife']);
    const wd = WEAPONS[c.weapon]; c.ammo = wd.mag; c.reserve = wd.mag;
  }
  if (c.warrant) c.record.push('outstanding warrant');
  if (c.lawful < 0.4 && rng() < 0.5) c.record.push(pick(['petty theft (2 yr ago)', 'assault (3 yr ago)', 'DUI (1 yr ago)', 'vandalism (4 yr ago)']));
  g.civs.push(c);
  return c;
}

export function makeOfficer(g: Game, atStation = true): Officer {
  const sd = stationDoor(g.world);
  const o: Officer = {
    id: g.nextId++, kind: 'off', name: `Ofc. ${name2()}`,
    x: sd.x + ri(-10, 10), y: sd.y + ri(-6, 20),
    state: 'idle', path: null, target: null, speed: 42,
    shooting: 0.35 + rng() * 0.45, driving: 0.3 + rng() * 0.6, talk: 0.3 + rng() * 0.6,
    trait: pick(OFFICER_TRAITS), morale: 70 + ri(-10, 15), fatigue: 0,
    hp: 100, injury: 'healthy', hospitalUntil: 0, incident: null, vehicle: null,
    escorting: null, pursuit: null, squad: null, arrests: 0, complaints: 0, shotsFired: 0,
    salary: 80, patrolHood: null, holdPos: null, color: '#2b57a8', aiShoot: 0,
    weapon: 'p9', ammo: WEAPONS.p9.mag, reserve: WEAPONS.p9.mag * 2, drawn: false, cooldown: 0, reloading: 0,
  };
  if (!atStation) { const p = randomSidewalkPoint(g.world); o.x = p.x; o.y = p.y; }
  g.officers.push(o);
  return o;
}

export function makeVehicle(g: Game, police: boolean, x: number, y: number): Vehicle {
  const v: Vehicle = {
    id: g.nextId++, kind: 'veh', police,
    name: police ? `Unit ${g.vehicles.filter(q => q.police).length + 1}` : 'Car',
    x, y, angle: 0, speed: 0, maxSpeed: police ? 150 : 105,
    color: police ? '#1d1d24' : pick(CAR_COLORS),
    driver: null, passengers: [], lights: false, path: null, target: null,
    parked: true, home: { x, y }, hp: 100, stolen: false,
  };
  g.vehicles.push(v);
  return v;
}

export function spawnPopulation(g: Game, count: number, cars: number) {
  for (let i = 0; i < count; i++) {
    const hood = ri(0, 3);
    const p = randomSidewalkPoint(g.world, hood);
    makeCivilian(g, p.x, p.y, hood);
  }
  for (let i = 0; i < cars; i++) {
    const p = randomRoadPoint(g.world);
    const v = makeVehicle(g, false, p.x, p.y);
    v.parked = false;
  }
  // patrol cars at station lot
  const lot = stationLot(g.world);
  for (let i = 0; i < 2; i++) makeVehicle(g, true, lot.x + i * 26, lot.y);
}

// ---------- movement ----------
export function setPath(g: Game, e: { x: number; y: number; path: Pt[] | null; target: Pt | null }, to: Pt, drive = false): boolean {
  const p = findPath(g.world, e.x, e.y, to.x, to.y, drive ? driveCost : walkCost);
  if (!p) { e.path = null; e.target = null; return false; }
  e.path = p; e.target = to;
  return true;
}

/** Move along path. Returns true when path finished. */
export function moveAlong(e: { x: number; y: number; path: Pt[] | null; speed?: number }, dts: number, spd: number): boolean {
  if (!e.path || e.path.length === 0) return true;
  let remaining = spd * dts;
  while (remaining > 0 && e.path.length) {
    const wp = e.path[0];
    const d = Math.hypot(wp.x - e.x, wp.y - e.y);
    if (d <= remaining) { e.x = wp.x; e.y = wp.y; e.path.shift(); remaining -= d; }
    else { e.x += ((wp.x - e.x) / d) * remaining; e.y += ((wp.y - e.y) / d) * remaining; remaining = 0; }
  }
  return e.path.length === 0;
}

// ---------- civilian AI ----------
export function updateCivilian(g: Game, c: Civilian, dts: number) {
  if (c.injury === 'dead') { c.state = 'down'; return; }
  if (c.injury === 'incap') { c.state = 'down'; return; }
  c.cooldown = Math.max(0, c.cooldown - dts);
  if (c.reloading > 0) c.reloading = Math.max(0, c.reloading - dts);
  c.fear = Math.max(0, c.fear - dts * 0.01);

  switch (c.state) {
    case 'hostile':
    case 'fight':
      updateCombatant(g, c, dts);
      return;
    case 'surrender':
    case 'detained':
      return; // held in place
    case 'down': return;
    case 'flee': {
      if (moveAlong(c, dts, c.speed * 2.1)) { c.state = 'idle'; c.waitUntil = g.time + ri(2, 8); }
      return;
    }
    case 'crime': return; // incidents.ts drives this
    case 'protest': {
      if (c.path) moveAlong(c, dts, c.speed);
      return;
    }
    case 'walk':
    case 'wander': {
      if (moveAlong(c, dts, c.speed * (c.fear > 0.5 ? 1.8 : 1))) {
        c.state = 'idle';
        c.waitUntil = g.time + ri(1, 10);
      }
      return;
    }
    case 'watch': {
      if (g.time > c.waitUntil) { c.state = 'idle'; }
      return;
    }
    default: { // idle — decide something
      if (g.time < c.waitUntil) return;
      // LOD: cheap decision
      const h = hourOf(g.time);
      let destB = -1;
      if (c.work >= 0 && h >= 8 && h < 17 && rng() < 0.6) destB = c.work;
      else if ((h >= 21 || h < 6) && c.home >= 0 && rng() < 0.75) destB = c.home;
      else if (rng() < 0.25 && g.world.storeIds.length) destB = pick(g.world.storeIds);
      if (destB >= 0) {
        const b = g.world.buildings.find(q => q.id === destB);
        if (b) {
          const inside = rng() < 0.6;
          const to = inside
            ? { x: (b.x + 1 + ri(0, Math.max(0, b.w - 3))) * TILE + 8, y: (b.y + 1 + ri(0, Math.max(0, b.h - 3))) * TILE + 8 }
            : { x: b.door.x * TILE + 8, y: (b.door.y + 1) * TILE + 8 };
          if (setPath(g, c, to)) { c.state = 'walk'; return; }
        }
      }
      const p = randomSidewalkPoint(g.world, rng() < 0.7 ? c.hood : undefined);
      if (setPath(g, c, p)) c.state = 'wander';
      else c.waitUntil = g.time + 5;
    }
  }
}

/** Panic civilians near a point (gunshots, etc). Returns whether anyone likely called it in. */
export function panicNear(g: Game, x: number, y: number, radius: number, police: boolean) {
  let witnesses = 0;
  for (const c of g.civs) {
    if (c.state === 'down' || c.state === 'detained' || c.state === 'arrested' || c.state === 'hostile') continue;
    const d = dist(c, { x, y });
    if (d > radius) continue;
    witnesses++;
    c.fear = Math.min(1, c.fear + 0.6);
    if (c.incident === null && c.state !== 'crime') {
      // run away from the point
      const ang = Math.atan2(c.y - y, c.x - x) + (rng() - 0.5);
      const to = { x: c.x + Math.cos(ang) * 140, y: c.y + Math.sin(ang) * 140 };
      to.x = Math.max(TILE, Math.min(g.world.w * TILE - TILE, to.x));
      to.y = Math.max(TILE, Math.min(g.world.h * TILE - TILE, to.y));
      if (setPath(g, c, to)) c.state = 'flee';
    }
  }
  return witnesses;
}

// ---------- officer AI ----------
export function orderMove(g: Game, o: Officer, to: Pt) {
  if (o.state === 'down' || o.state === 'hospital') return;
  if (o.vehicle !== null) {
    const v = vehById(g, o.vehicle);
    if (v) { setPath(g, v, to, true); v.parked = false; o.state = 'driving'; return; }
  }
  clearAssignment(g, o);
  if (setPath(g, o, to)) o.state = 'moving';
}

export function orderPatrol(g: Game, o: Officer, hood: number | null) {
  clearAssignment(g, o);
  o.patrolHood = hood;
  o.state = 'patrol';
  o.path = null;
}

export function clearAssignment(g: Game, o: Officer) {
  if (o.incident !== null) {
    const inc = g.incidents.find(i => i.id === o.incident);
    if (inc) inc.assigned = inc.assigned.filter(id => id !== o.id);
  }
  o.incident = null; o.pursuit = null; o.holdPos = null;
  if (o.escorting !== null) {
    const c = civById(g, o.escorting);
    if (c && c.state === 'detained') { c.detainedBy = null; }
    o.escorting = null;
  }
}

export function updateOfficer(g: Game, o: Officer, dts: number) {
  if (o.state === 'hospital') {
    if (g.time >= o.hospitalUntil) {
      o.state = 'idle'; o.hp = 80; o.injury = 'minor';
      const sd = stationDoor(g.world); o.x = sd.x; o.y = sd.y;
      addLog(g, `${o.name} returned to duty.`, 'good');
    }
    return;
  }
  if (o.injury === 'dead') { o.state = 'down'; return; }
  if (o.injury === 'incap') { o.state = 'down'; return; }
  o.cooldown = Math.max(0, o.cooldown - dts);
  if (o.reloading > 0) {
    o.reloading = Math.max(0, o.reloading - dts);
    if (o.reloading === 0 && o.weapon) {
      const wd = WEAPONS[o.weapon];
      const take = Math.min(wd.mag, g.cheats.infAmmo ? wd.mag : o.reserve);
      if (!g.cheats.infAmmo) o.reserve -= take;
      o.ammo = take;
    }
  }
  o.fatigue = Math.min(100, o.fatigue + dts * 0.01);

  const controlled = g.control === o.id;
  if (controlled) return; // player drives this one from main.ts

  // threat check: engage hostiles in range
  if (o.state !== 'driving') {
    const threat = nearestHostile(g, o, 260);
    if (threat && (o.state === 'combat' || dist(o, threat) < 200)) {
      o.state = 'combat';
      updateCombatant(g, o, dts, threat);
      return;
    } else if (o.state === 'combat') {
      // no more threats
      o.state = o.incident !== null ? 'onscene' : 'idle';
      o.drawn = false;
    }
  }

  switch (o.state) {
    case 'moving':
      if (moveAlong(o, dts, o.speed)) o.state = 'idle';
      break;
    case 'patrol': {
      if (!o.path || o.path.length === 0) {
        const p = randomSidewalkPoint(g.world, o.patrolHood ?? undefined);
        setPath(g, o, p);
      }
      moveAlong(o, dts, o.speed * 0.7);
      break;
    }
    case 'responding': {
      const inc = g.incidents.find(i => i.id === o.incident);
      if (!inc || inc.state === 'resolved') { o.state = 'idle'; o.incident = null; break; }
      if (!o.path) setPath(g, o, { x: inc.x, y: inc.y });
      if (moveAlong(o, dts, o.speed * 1.5) || dist(o, inc) < 26) {
        o.state = 'onscene'; o.path = null;
        onOfficerArrive(g, o, inc);
      }
      break;
    }
    case 'onscene': {
      const inc = g.incidents.find(i => i.id === o.incident);
      if (!inc || inc.state === 'resolved') { o.state = 'idle'; o.incident = null; o.drawn = false; }
      break;
    }
    case 'pursuing': {
      const s = civById(g, o.pursuit);
      if (!s || s.state === 'down' || s.state === 'surrender' || s.state === 'detained') {
        o.pursuit = null; o.state = o.incident !== null ? 'onscene' : 'idle'; break;
      }
      // chase directly
      const d = dist(o, s);
      if (d < 14) {
        // tackle / detain attempt
        const chance = 0.5 + o.talk * 0.2 + (s.fear * 0.3) - s.aggression * 0.25;
        if (rng() < chance) {
          s.state = 'detained'; s.detainedBy = o.id; s.path = null;
          o.pursuit = null; o.state = o.incident !== null ? 'onscene' : 'idle';
          addLog(g, `${o.name} caught ${s.name}.`, 'good');
        } else if (s.weapon && rng() < s.aggression * 0.5) {
          s.state = 'hostile'; s.drawn = true;
          g.notify('Suspect turned on officer!', 'bad', s.x, s.y);
        } else {
          // wriggled free, keep running
          s.fear = Math.min(1, s.fear + 0.2);
        }
      } else {
        if (!o.path || o.path.length === 0 || rng() < 0.1) setPath(g, o, { x: s.x, y: s.y });
        moveAlong(o, dts, o.speed * 1.6);
        // suspect keeps fleeing
        if ((!s.path || s.path.length === 0)) {
          const ang = Math.atan2(s.y - o.y, s.x - o.x) + (rng() - 0.5) * 0.8;
          const to = { x: s.x + Math.cos(ang) * 120, y: s.y + Math.sin(ang) * 120 };
          to.x = Math.max(TILE, Math.min(g.world.w * TILE - TILE, to.x));
          to.y = Math.max(TILE, Math.min(g.world.h * TILE - TILE, to.y));
          setPath(g, s, to);
        }
        moveAlong(s, dts, s.speed * 1.9);
      }
      break;
    }
    case 'escorting': {
      const s = civById(g, o.escorting);
      if (!s) { o.escorting = null; o.state = 'idle'; break; }
      const sd = stationDoor(g.world);
      if (!o.path) setPath(g, o, sd);
      moveAlong(o, dts, o.speed * 0.9);
      s.x = o.x + 6; s.y = o.y + 6;
      if (dist(o, sd) < 20) {
        finishArrest(g, o, s);
      }
      break;
    }
    case 'driving': {
      const v = vehById(g, o.vehicle);
      if (!v) { o.state = 'idle'; break; }
      // vehicle sim handles motion; check arrival
      if (o.incident !== null) {
        const inc = g.incidents.find(i => i.id === o.incident);
        if (inc && inc.state !== 'resolved' && dist(v, inc) < 60) {
          exitVehicle(g, o);
          o.state = 'responding';
          setPath(g, o, { x: inc.x, y: inc.y });
        } else if (inc && !v.path && dist(v, inc) >= 60) {
          setPath(g, v, { x: inc.x, y: inc.y }, true);
        }
        if (!inc || inc.state === 'resolved') { o.incident = null; o.state = 'driving'; v.lights = false; v.path = null; }
      } else if (v.path && v.path.length === 0) {
        v.parked = true; v.lights = false;
      }
      break;
    }
    default: {
      // idle: drift toward station occasionally
      if (rng() < 0.002 && dist(o, stationDoor(g.world)) > 200) {
        setPath(g, o, stationDoor(g.world)); o.state = 'moving';
      }
    }
  }
}

export function finishArrest(g: Game, o: Officer, s: Civilian) {
  s.state = 'arrested'; s.incident = null; s.detainedBy = null;
  s.x = -999; s.y = -999; // in holding
  o.escorting = null; o.state = 'idle'; o.path = null;
  o.arrests++; g.stats.arrests++;
  const wasCriminal = s.role === 'suspect' || s.warrant;
  if (!wasCriminal) {
    g.stats.wrongfulArrests++;
    g.stats.complaints++;
    const h = g.world.hoods[s.hood];
    if (!g.cheats.noConsequences) { h.trust = Math.max(0, h.trust - 4); h.tension += 5; }
    addLog(g, `${s.name} was arrested without cause. Complaint filed. Trust down in ${h.name}.`, 'bad');
    g.notify('Complaint filed: wrongful arrest', 'bad');
  } else {
    s.record.push('arrested');
    addLog(g, `${o.name} booked ${s.name}.`, 'good');
  }
}

export function nearestHostile(g: Game, from: { x: number; y: number }, range: number): Civilian | null {
  let best: Civilian | null = null, bd = range;
  for (const c of g.civs) {
    if (c.state !== 'hostile' && c.state !== 'fight') continue;
    if (c.injury === 'incap' || c.injury === 'dead') continue;
    const d = dist(from, c);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

export function enterVehicle(g: Game, o: Officer, v: Vehicle): boolean {
  if (v.driver !== null && v.driver !== o.id) return false;
  if (dist(o, v) > 30) return false;
  v.driver = o.id; v.parked = false;
  o.vehicle = v.id; o.state = 'driving';
  o.x = v.x; o.y = v.y;
  return true;
}

export function exitVehicle(g: Game, o: Officer) {
  const v = vehById(g, o.vehicle);
  if (!v) return;
  v.driver = null; v.speed = 0; v.parked = true; v.path = null;
  o.vehicle = null;
  o.x = v.x + Math.cos(v.angle + Math.PI / 2) * 18;
  o.y = v.y + Math.sin(v.angle + Math.PI / 2) * 18;
  o.state = 'idle';
}

// ---------- vehicle sim ----------
export function updateVehicle(g: Game, v: Vehicle, dts: number) {
  const drivenByPlayer = v.driver !== null && g.control !== null &&
    (offById(g, g.control)?.vehicle === v.id);
  if (drivenByPlayer) return; // main.ts integrates player driving

  if (v.police) {
    if (v.driver === null) { v.speed = 0; return; }
    // AI police driving along path
    aiDrive(g, v, dts, v.lights ? v.maxSpeed : v.maxSpeed * 0.6);
    return;
  }

  // civilian traffic
  if (v.driver === null && !v.stolen) {
    // ambient car: keep a destination
    if (!v.path || v.path.length === 0) {
      const p = randomRoadPoint(g.world);
      setPath(g, v, p, true);
    }
    // yield to nearby lights/sirens
    const near = g.vehicles.find(q => q.police && q.lights && dist(q, v) < 90);
    aiDrive(g, v, dts, near ? 20 : v.maxSpeed * (0.5 + (v.id % 5) * 0.08));
    return;
  }
  if (v.stolen) {
    // fleeing car handled like ai drive at max speed
    if (!v.path || v.path.length === 0) setPath(g, v, randomRoadPoint(g.world), true);
    aiDrive(g, v, dts, v.maxSpeed);
  }
}

function aiDrive(g: Game, v: Vehicle, dts: number, targetSpeed: number) {
  if (!v.path || v.path.length === 0) { v.speed = Math.max(0, v.speed - 200 * dts); return; }
  // brake if a vehicle directly ahead
  const aheadX = v.x + Math.cos(v.angle) * 26, aheadY = v.y + Math.sin(v.angle) * 26;
  for (const q of g.vehicles) {
    if (q === v) continue;
    if (Math.hypot(q.x - aheadX, q.y - aheadY) < 20) { targetSpeed = Math.min(targetSpeed, Math.max(0, q.speed - 10)); break; }
  }
  v.speed += Math.sign(targetSpeed - v.speed) * Math.min(Math.abs(targetSpeed - v.speed), 160 * dts);
  const wp = v.path[0];
  const want = Math.atan2(wp.y - v.y, wp.x - v.x);
  let da = want - v.angle;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  // slow down for sharp turns so corners aren't cut through blocks
  if (Math.abs(da) > 0.8) v.speed = Math.min(v.speed, 45);
  v.angle += Math.max(-5.2 * dts, Math.min(5.2 * dts, da));
  v.x += Math.cos(v.angle) * v.speed * dts;
  v.y += Math.sin(v.angle) * v.speed * dts;
  if (Math.hypot(wp.x - v.x, wp.y - v.y) < 10) v.path.shift();
  // run over check is intentionally omitted; cars stop for peds implicitly via low density
}
