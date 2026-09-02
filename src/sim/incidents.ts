import { TILE } from './types';
import type { Game, Incident, IncidentType, Civilian, Officer, Pt } from './types';
import { INCIDENT_TITLES, CRIMINAL_GUNS, WEAPONS } from './data';
import { rng, ri, pick, hoodAt, randomSidewalkPoint } from './world';
import { makeCivilian, civById, dist, setPath, panicNear, enterVehicle, vehById } from './agents';
import { addLog } from './dept';

let streetNo = 100;
const addr = () => `${streetNo = (streetNo + ri(3, 41)) % 900 + 100} ${pick(['Oak', 'Bay', 'Cedar', 'Pine', 'Dock', 'Market', 'Hill', '3rd', '7th'])} St`;

// ---------- creation ----------
export function createIncident(g: Game, type: IncidentType, x: number, y: number, opts: {
  suspects?: number[]; victims?: number[]; armed?: boolean; building?: number | null; silent?: boolean;
} = {}): Incident {
  const armed = opts.armed ?? false;
  // dispatch info is imperfect
  let reportedArmed = armed;
  if (armed && rng() < 0.3) reportedArmed = false;          // caller missed the weapon
  if (!armed && rng() < 0.15) reportedArmed = true;         // caller thought they saw one
  const pr: 1 | 2 | 3 =
    type === 'bank_robbery' || type === 'shootout' || type === 'shots' || type === 'armed_robbery' ? 3 :
    type === 'robbery' || type === 'fight' || type === 'burglary' || type === 'pursuit' || type === 'assault' ? 2 : 1;
  const nS = (opts.suspects ?? []).length;
  const inc: Incident = {
    id: g.nextId++, type,
    title: INCIDENT_TITLES[type] || type,
    reported: buildReport(type, reportedArmed, nS),
    truth: `${nS} suspect(s), ${armed ? 'armed' : 'unarmed'}`,
    x, y, hood: hoodAt(g.world, x, y), building: opts.building ?? null,
    state: 'queued', created: g.time, assigned: [],
    suspects: opts.suspects ?? [], victims: opts.victims ?? [],
    priority: pr, armed, reportedArmed,
    escalateAt: 0, escalated: false, resolveTimer: 0, outcome: '', log: [],
  };
  for (const sid of inc.suspects) { const s = civById(g, sid); if (s) { s.incident = inc.id; s.role = 'suspect'; } }
  g.incidents.push(inc);
  if (!opts.silent) {
    g.notify(`${inc.title} — ${inc.reported}`, pr === 3 ? 'bad' : pr === 2 ? 'warn' : 'info', x, y);
    addLog(g, `DISPATCH: ${inc.title}. ${inc.reported}`, pr === 3 ? 'bad' : 'info');
  }
  g.stats.crimesOccurred++;
  return inc;
}

function buildReport(type: IncidentType, reportedArmed: boolean, nS: number): string {
  const a = addr();
  const armedTxt = reportedArmed ? ' Caller reports a possible weapon.' : '';
  switch (type) {
    case 'noise': return `Neighbor reports loud shouting near ${a}.${armedTxt}`;
    case 'suspicious': return `Caller reports a person acting strangely near ${a}.${armedTxt}`;
    case 'traffic': return `Erratic driver reported near ${a}.`;
    case 'shoplift': return `Store reports a shoplifter, ${a}.${armedTxt}`;
    case 'fight': return `Multiple callers report a fight near ${a}.${armedTxt}`;
    case 'burglary': return `Possible break-in at ${a}. Caller unsure if anyone is inside.`;
    case 'robbery': return `Robbery reported at ${a}. Suspect description unclear.${armedTxt}`;
    case 'armed_robbery': return `Armed robbery in progress, ${a}. ${nS > 1 ? 'Possibly multiple suspects.' : 'One suspect reported.'}`;
    case 'shots': return `Shots heard near ${a}. No further information.`;
    case 'assault': return `Caller reports someone was attacked near ${a}.${armedTxt}`;
    case 'bank_robbery': return `Silent alarm at First Bay Bank. Tellers report multiple armed suspects. Possible hostages.`;
    case 'shootout': return `Multiple callers report sustained gunfire near ${a}. Numbers unknown.`;
    case 'pursuit': return `Vehicle failed to stop near ${a}. Fleeing at speed.`;
    case 'welfare': return `Request to check on a resident at ${a}. No answer at the door.`;
    default: return `See ${a}.`;
  }
}

// find or create a suspect near a point
function suspectNear(g: Game, x: number, y: number, forceArm: string | null): Civilian {
  let s = g.civs.find(c => c.state !== 'down' && c.state !== 'arrested' && c.incident === null &&
    c.lawful < 0.5 && dist(c, { x, y }) < 220);
  if (!s) {
    s = makeCivilian(g, x + ri(-10, 10), y + ri(-10, 10), hoodAt(g.world, x, y));
    s.lawful = rng() * 0.35;
  }
  s.x = x + ri(-14, 14); s.y = y + ri(-14, 14);
  s.state = 'crime'; s.path = null; s.role = 'suspect';
  if (forceArm) {
    s.weapon = forceArm;
    const wd = WEAPONS[forceArm]; s.ammo = wd.mag; s.reserve = wd.mag * 2;
  }
  return s;
}

// ---------- ambient crime generation ----------
export function crimeTick(g: Game, dts: number) {
  // expected: roughly one minor event every ~3 game-minutes, scaled by neighborhood crime pressure
  const pressure = g.world.hoods.reduce((s, h) => s + h.crime, 0) / 100;
  if (rng() > dts * 0.04 * (1 + pressure)) return;
  const roll = rng();
  const hood = weightedHood(g);
  const p = randomSidewalkPoint(g.world, hood);
  if (roll < 0.2) {
    createIncident(g, 'noise', p.x, p.y, {});
  } else if (roll < 0.32) {
    // traffic violation: reported near a moving civilian car
    const car = g.vehicles.find(v => !v.police && !v.parked);
    createIncident(g, 'traffic', car ? car.x : p.x, car ? car.y : p.y, {});
  } else if (roll < 0.48) {
    const s = suspectNear(g, p.x, p.y, null);
    s.state = 'wander';
    createIncident(g, 'suspicious', p.x, p.y, { suspects: [s.id], armed: !!s.weapon });
  } else if (roll < 0.62 && g.world.storeIds.length) {
    const b = g.world.buildings.find(q => q.id === pick(g.world.storeIds))!;
    const s = suspectNear(g, b.door.x * TILE + 8, (b.door.y + 1) * TILE + 8, null);
    createIncident(g, 'shoplift', s.x, s.y, { suspects: [s.id], building: b.id });
  } else if (roll < 0.78) {
    const a = suspectNear(g, p.x, p.y, null);
    const b2 = suspectNear(g, p.x + 14, p.y, null);
    a.state = 'fight'; b2.state = 'fight';
    const inc = createIncident(g, 'fight', p.x, p.y, { suspects: [a.id, b2.id], armed: false });
    a.incident = inc.id; b2.incident = inc.id;
    inc.escalateAt = g.time + ri(4, 9);
  } else if (roll < 0.9) {
    const homes = g.world.buildings.filter(b => b.kind === 'house' || b.kind === 'store');
    const b = pick(homes);
    const s = suspectNear(g, b.door.x * TILE + 8, b.door.y * TILE + 8, rng() < 0.25 ? pick(CRIMINAL_GUNS) : null);
    // suspect goes inside
    s.x = (b.x + 1 + ri(0, Math.max(0, b.w - 3))) * TILE + 8; s.y = (b.y + 1 + ri(0, Math.max(0, b.h - 3))) * TILE + 8;
    createIncident(g, 'burglary', s.x, s.y, { suspects: [s.id], armed: !!s.weapon, building: b.id });
  } else {
    // robbery, sometimes armed
    const b = g.world.buildings.find(q => q.id === pick(g.world.storeIds))!;
    const armed = rng() < 0.55;
    const s = suspectNear(g, (b.x + 2) * TILE, (b.y + b.h - 2) * TILE, armed ? pick(CRIMINAL_GUNS) : null);
    s.x = (b.x + 2) * TILE + 8; s.y = (b.y + b.h - 2) * TILE + 8;
    const inc = createIncident(g, armed ? 'armed_robbery' : 'robbery', s.x, s.y, { suspects: [s.id], armed, building: b.id });
    inc.escalateAt = g.time + ri(3, 6);
  }
}

function weightedHood(g: Game): number {
  const weights = g.world.hoods.map(h => 10 + h.crime);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < 4; i++) { r -= weights[i]; if (r <= 0) return i; }
  return 3;
}

// ---------- shots-fired reporting ----------
let lastShotsReport = -999;
export function reportShots(g: Game, x: number, y: number) {
  if (g.time - lastShotsReport < 2) return;
  // merge into an existing nearby active incident
  const near = g.incidents.find(i => i.state !== 'resolved' && dist(i, { x, y }) < 200);
  if (near) {
    if (!near.escalated && !near.armed) {
      near.escalated = true;
      near.reported += ' UPDATE: caller now reports gunshots.';
      near.priority = 3;
      g.notify(`UPDATE: shots fired at ${near.title}`, 'bad', x, y);
    }
    return;
  }
  lastShotsReport = g.time;
  createIncident(g, 'shots', x, y, { armed: true });
}

// ---------- dispatch ----------
export function assignOfficer(g: Game, o: Officer, inc: Incident) {
  if (o.state === 'down' || o.state === 'hospital') return;
  if (o.incident !== null && o.incident !== inc.id) {
    const old = g.incidents.find(i => i.id === o.incident);
    if (old) old.assigned = old.assigned.filter(id => id !== o.id);
  }
  o.incident = inc.id;
  o.pursuit = null; o.escorting = null;
  if (!inc.assigned.includes(o.id)) inc.assigned.push(o.id);
  if (inc.state === 'queued') inc.state = 'assigned';
  // take a car if it's far and one is nearby
  const d = dist(o, inc);
  if (o.vehicle === null && d > 260) {
    const car = g.vehicles.find(v => v.police && v.driver === null && dist(v, o) < 130);
    if (car && enterVehicle(g, o, car)) {
      car.lights = inc.priority >= 2;
      setPath(g, car, { x: inc.x, y: inc.y }, true);
      o.state = 'driving';
      return;
    }
  }
  if (o.vehicle !== null) {
    const v = vehById(g, o.vehicle)!;
    v.lights = inc.priority >= 2;
    setPath(g, v, { x: inc.x, y: inc.y }, true);
    o.state = 'driving';
    return;
  }
  o.state = 'responding';
  setPath(g, o, { x: inc.x, y: inc.y });
}

// ---------- arrival + resolution ----------
export function onOfficerArrive(g: Game, o: Officer, inc: Incident) {
  if (inc.state === 'resolved') return;
  inc.state = 'onscene';
  inc.resolveTimer = 3 + rng() * 4; // seconds of assessment
  inc.log.push(`${o.name} arrived on scene.`);
}

export function updateIncidents(g: Game, dts: number) {
  for (const inc of g.incidents) {
    if (inc.state === 'resolved') continue;

    // queued too long → caller gives up
    if (inc.state === 'queued') {
      const limit = inc.priority === 3 ? 10 : inc.priority === 2 ? 16 : 25; // game minutes
      if (g.time - inc.created > limit) {
        resolveIncident(g, inc, 'missed');
        continue;
      }
    }

    // escalation
    if (inc.escalateAt && !inc.escalated && g.time >= inc.escalateAt && inc.state !== 'onscene') {
      inc.escalated = true;
      if (inc.type === 'fight') {
        const s = civById(g, inc.suspects[0]);
        if (s && rng() < 0.4) {
          s.weapon = s.weapon || 'knife'; s.drawn = true;
          inc.armed = true; inc.priority = 2;
          inc.reported += ' UPDATE: caller reports a knife.';
          g.notify('UPDATE: weapon reported in fight', 'warn', inc.x, inc.y);
        }
      } else if (inc.type === 'armed_robbery' || inc.type === 'robbery') {
        // robbers finish and flee if police too slow
        for (const sid of inc.suspects) {
          const s = civById(g, sid);
          if (s && s.state === 'crime') {
            s.state = 'flee';
            setPath(g, s, randomSidewalkPoint(g.world));
          }
        }
        inc.reported += ' UPDATE: suspect may have fled the scene.';
      }
    }

    // active scene resolution
    if (inc.state === 'onscene') {
      const present = inc.assigned.map(id => g.officers.find(q => q.id === id)).filter(q => q && dist(q, inc) < 90) as Officer[];
      if (present.length === 0) {
        // officers left/are down: if hostiles remain, stays active
        if (!inc.suspects.some(id => { const s = civById(g, id); return s && (s.state === 'hostile' || s.state === 'crime' || s.state === 'fight'); })) {
          inc.state = 'assigned';
        }
        continue;
      }
      const anyHostile = inc.suspects.some(id => { const s = civById(g, id); return s && s.state === 'hostile'; });
      if (anyHostile) continue; // combat plays out first
      inc.resolveTimer -= dts;
      if (inc.resolveTimer <= 0) resolveScene(g, inc, present[0]);
    }
  }
  // trim resolved + old
  if (g.incidents.length > 120) {
    g.incidents = g.incidents.filter(i => i.state !== 'resolved' || g.time - i.created < 600);
  }
}

/** First on-scene assessment: suspects choose comply / flee / fight. */
function resolveScene(g: Game, inc: Incident, o: Officer) {
  const suspects = inc.suspects.map(id => civById(g, id)).filter(Boolean) as Civilian[];
  const live = suspects.filter(s => s.state !== 'down' && s.state !== 'arrested' && s.injury !== 'dead' && s.injury !== 'incap');
  const fledOrGone = live.filter(s => dist(s, inc) > 160 && s.state === 'flee');

  // no suspects at all (noise, traffic, shots that fizzled, welfare)
  if (suspects.length === 0) {
    if (inc.type === 'traffic') {
      const r = rng();
      if (r < 0.55) { g.stats.citations++; resolveIncident(g, inc, 'citation issued'); }
      else if (r < 0.9) { g.stats.warnings++; resolveIncident(g, inc, 'warning given'); }
      else resolveIncident(g, inc, 'suspect gone');
      return;
    }
    if (inc.type === 'shots' && rng() < 0.35) {
      // something real was here — spawn a hostile
      const s = suspectNear(g, inc.x, inc.y, pick(CRIMINAL_GUNS));
      s.state = 'hostile'; s.drawn = true; s.incident = inc.id; inc.suspects.push(s.id);
      g.notify('Armed subject located!', 'bad', inc.x, inc.y);
      inc.resolveTimer = 5;
      return;
    }
    resolveIncident(g, inc, rng() < 0.8 ? 'cleared' : 'unfounded');
    return;
  }

  if (live.length === 0 || live.every(s => dist(s, inc) > 300)) {
    resolveIncident(g, inc, 'suspect gone');
    return;
  }

  // surrendered/detained suspects → arrest by escort
  const held = live.find(s => s.state === 'surrender' || s.state === 'detained');
  if (held) {
    held.state = 'detained'; held.detainedBy = o.id;
    o.escorting = held.id; o.state = 'escorting'; o.path = null;
    inc.log.push(`${o.name} is transporting ${held.name}.`);
    // resolve when nothing else pending
    if (live.filter(s => s !== held && s.state !== 'arrested').length === 0) {
      resolveIncident(g, inc, 'arrest');
    } else inc.resolveTimer = 4;
    return;
  }

  // each active suspect decides
  let anyAction = false;
  for (const s of live) {
    if (s.state === 'flee' || s.state === 'hostile') { anyAction = true; continue; }
    const fightBias = (s.weapon ? 0.3 : 0.02) + s.aggression * 0.3 + (inc.type === 'bank_robbery' || inc.type === 'shootout' ? 0.35 : 0);
    const fleeBias = 0.35 + (1 - s.bravery) * 0.2 + (inc.type === 'shoplift' || inc.type === 'burglary' ? 0.25 : 0);
    const r = rng();
    if (r < fightBias) {
      s.state = 'hostile'; s.drawn = true;
      if (!s.weapon) { s.weapon = 'knife'; s.ammo = 999; }
      g.notify(`${inc.title}: suspect is fighting!`, 'bad', s.x, s.y);
      anyAction = true;
    } else if (r < fightBias + fleeBias) {
      s.state = 'flee';
      setPath(g, s, randomSidewalkPoint(g.world));
      o.pursuit = s.id; o.state = 'pursuing';
      g.notify(`${inc.title}: suspect fleeing on foot`, 'warn', s.x, s.y);
      anyAction = true;
    } else {
      s.state = 'surrender'; s.drawn = false; s.path = null;
      inc.log.push(`${s.name} complied.`);
      anyAction = true;
    }
  }
  inc.resolveTimer = 6;
  if (!anyAction) resolveIncident(g, inc, 'cleared');
}

export function resolveIncident(g: Game, inc: Incident, outcome: string) {
  if (inc.state === 'resolved') return;
  inc.state = 'resolved';
  inc.outcome = outcome;
  const h = g.world.hoods[inc.hood];
  const noCon = g.cheats.noConsequences;

  for (const oid of inc.assigned) {
    const o = g.officers.find(q => q.id === oid);
    if (o && (o.state === 'responding' || o.state === 'onscene')) { o.state = 'idle'; o.incident = null; o.drawn = false; }
    else if (o) o.incident = null;
  }
  for (const sid of inc.suspects) {
    const s = civById(g, sid);
    if (s && s.state === 'crime') { s.state = 'idle'; s.incident = null; }
    if (s && s.state === 'fight') { s.state = 'idle'; s.incident = null; }
  }

  switch (outcome) {
    case 'missed':
      g.stats.callsMissed++;
      if (!noCon) { h.trust = Math.max(0, h.trust - (inc.priority === 3 ? 5 : 2)); h.crime = Math.min(100, h.crime + 2); }
      addLog(g, `No unit responded to ${inc.title} in ${h.name}. Caller gave up.`, 'bad');
      break;
    case 'arrest':
      g.stats.callsResolved++;
      if (!noCon) { h.trust = Math.min(100, h.trust + 1.5); h.crime = Math.max(0, h.crime - 1.5); }
      addLog(g, `${inc.title} resolved with an arrest.`, 'good');
      break;
    case 'suspect gone':
      g.stats.callsUnresolved++;
      if (!noCon) h.crime = Math.min(100, h.crime + 1);
      addLog(g, `${inc.title}: suspect was gone on arrival.`, 'warn');
      break;
    case 'unfounded':
      g.stats.callsResolved++;
      addLog(g, `${inc.title}: unfounded.`, 'info');
      break;
    default:
      g.stats.callsResolved++;
      if (!noCon) h.trust = Math.min(100, h.trust + 0.5);
      addLog(g, `${inc.title} cleared.`, 'good');
  }
}

// ---------- sandbox / scripted spawns ----------
export function spawnIncidentType(g: Game, type: IncidentType, x: number, y: number, opts: { suspects?: number; armed?: boolean } = {}): Incident {
  const n = opts.suspects ?? (type === 'shootout' ? 5 : type === 'bank_robbery' ? 3 : type === 'armed_robbery' ? 2 : 1);
  const armed = opts.armed ?? (type === 'armed_robbery' || type === 'bank_robbery' || type === 'shootout' || type === 'shots');
  const ids: number[] = [];
  if (type !== 'noise' && type !== 'welfare' && type !== 'traffic') {
    for (let i = 0; i < n; i++) {
      const s = suspectNear(g, x + ri(-20, 20), y + ri(-20, 20), armed ? pick(CRIMINAL_GUNS) : null);
      if (type === 'shootout') { s.state = 'hostile'; s.drawn = true; s.bravery = 0.7 + rng() * 0.3; }
      ids.push(s.id);
    }
  }
  const b = type === 'bank_robbery' ? g.world.bankId : null;
  const inc = createIncident(g, type, x, y, { suspects: ids, armed, building: b });
  if (type === 'shootout') panicNear(g, x, y, 300, false);
  if (type === 'fight') {
    ids.forEach(id => { const s = civById(g, id); if (s) { s.state = 'fight'; s.incident = inc.id; } });
  }
  if (type === 'bank_robbery') {
    // move suspects inside the bank, panic civilians inside as hostages
    const bank = g.world.buildings.find(q => q.id === g.world.bankId)!;
    ids.forEach((id, i) => {
      const s = civById(g, id)!;
      s.x = (bank.x + 2 + i) * TILE + 8; s.y = (bank.y + 2) * TILE + 8;
      s.state = 'crime';
    });
    inc.x = bank.door.x * TILE + 8; inc.y = (bank.door.y + 1) * TILE + 8;
    inc.escalateAt = g.time + 8;
  }
  return inc;
}
