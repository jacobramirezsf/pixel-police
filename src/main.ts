import './style.css';
import { TILE, T } from './sim/types';
import type { Game, Officer, Civilian, IncidentType, Pt } from './sim/types';
import { WEAPONS } from './sim/data';
import { generateCity, tileAt, px2t, blocksMove, stationDoor, stationLot, rng, ri, setRng } from './sim/world';
import {
  spawnPopulation, makeOfficer, makeVehicle, makeCivilian, updateCivilian, updateOfficer, updateVehicle,
  civById, offById, vehById, dist, setPath, orderMove, orderPatrol, clearAssignment,
  enterVehicle, exitVehicle, finishArrest, nearestHostile,
} from './sim/agents';
import { crimeTick, updateIncidents, assignOfficer, spawnIncidentType, resolveIncident, dispatchNearestOfficer, spawnPursuit } from './sim/incidents';
import { updateDept, addLog, HIRE_COST, CAR_COST } from './sim/dept';
import { fireAt, reload as reloadWeaponFn, applyDamage } from './sim/combat';
import { buildBase, draw } from './render/render';
import type { RenderOpts } from './render/render';
import { initUI, addAlert, refreshPanel, refreshHUD, refreshCtxBar, refreshControlHud, setTab, getTab } from './ui/ui';
import type { UIApi } from './ui/ui';
import { initAudio, sfx } from './sound';

// ================= game construction =================
function newGameState(seed: number): Game {
  const world = generateCity(seed);
  const g: Game = {
    world,
    civs: [], officers: [], vehicles: [], incidents: [], shots: [],
    time: 7 * 60, speed: 1, prevSpeed: 1,
    budget: 12000,
    stats: {
      arrests: 0, wrongfulArrests: 0, citations: 0, warnings: 0,
      callsResolved: 0, callsUnresolved: 0, callsMissed: 0,
      civInjured: 0, civDead: 0, offInjured: 0, offDead: 0,
      complaints: 0, lawsuits: 0, shotsFired: 0, useOfForce: 0, crimesOccurred: 0,
    },
    log: [], sel: { officers: [], vehicle: null, civilian: null, incident: null },
    control: null,
    cheats: { enabled: false, god: false, infAmmo: false, noConsequences: false, freeStuff: false, usedEver: false },
    nextId: 1,
    cam: { x: 0, y: 0, zoom: 2 },
    dayPaid: -1, protestUntil: 0, protestHood: 0,
    policy: { autoDispatch: 'off' },
    notify: (t, c, x, y) => addAlert(t, c, x, y),
  };
  spawnPopulation(g, 140, 14);
  for (let i = 0; i < 4; i++) makeOfficer(g);
  const sd = stationDoor(g.world);
  g.cam.x = sd.x; g.cam.y = sd.y;
  g.dayPaid = Math.floor(g.time / 1440);
  addLog(g, 'Bayview PD is on duty. 4 officers, 2 cars, one small city.', 'info');
  return g;
}

let g: Game = newGameState((Math.random() * 1e9) | 0);
buildBase(g);

// ================= canvas =================
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const renderOpts: RenderOpts = {
  layers: { trust: false, crime: false, hoods: false, incidents: true, units: true },
  cleanView: false,
};

// ================= camera helpers =================
function screenToWorld(sx: number, sy: number): Pt {
  return { x: (sx - W / 2) / g.cam.zoom + g.cam.x, y: (sy - H / 2) / g.cam.zoom + g.cam.y };
}
function clampCam() {
  const ww = g.world.w * TILE, wh = g.world.h * TILE;
  g.cam.zoom = Math.max(0.7, Math.min(4.5, g.cam.zoom));
  g.cam.x = Math.max(0, Math.min(ww, g.cam.x));
  g.cam.y = Math.max(0, Math.min(wh, g.cam.y));
}

// ================= input state =================
const keys = new Set<string>();
const joy = { active: false, dx: 0, dy: 0, pid: -1 };
let panPointer: { id: number; sx: number; sy: number; camX: number; camY: number; moved: boolean } | null = null;
const pinch = new Map<number, { x: number; y: number }>();
let pinchDist0 = 0, pinchZoom0 = 1;

const api: UIApi = {
  layers: renderOpts.layers,
  multiSelectMode: false,
  centerOn(x, y) { g.cam.x = x; g.cam.y = y; clampCam(); },
  selectOfficer(id, additive = false) {
    if (!additive) g.sel = { officers: [id], vehicle: null, civilian: null, incident: null };
    else if (!g.sel.officers.includes(id)) g.sel.officers.push(id);
    refreshCtxBar();
  },
  selectAllOfficers() {
    g.sel = { officers: g.officers.filter(o => o.injury !== 'dead' && o.state !== 'hospital').map(o => o.id), vehicle: null, civilian: null, incident: null };
    refreshCtxBar();
  },
  takeControl(id) {
    g.control = id;
    g.sel.officers = [id];
    if (g.speed > 1) { g.prevSpeed = g.speed; g.speed = 1; }
    const o = offById(g, id);
    if (o) { clearAssignmentSafely(o); api.centerOn(o.x, o.y); }
    setTab(null);
    refreshControlHud(); refreshCtxBar();
  },
  releaseControl() {
    const o = offById(g, g.control);
    if (o && o.state !== 'driving' && o.state !== 'down') o.state = 'idle';
    g.control = null;
    hideInteractMenu();
    refreshControlHud(); refreshCtxBar();
  },
  dispatchSelected(incId) {
    const inc = g.incidents.find(i => i.id === incId);
    if (!inc) return;
    let n = 0;
    for (const id of g.sel.officers) {
      const o = offById(g, id);
      if (o && o.injury !== 'dead' && o.state !== 'hospital') { assignOfficer(g, o, inc); n++; }
    }
    if (n) addAlert(`${n} unit(s) responding to ${inc.title}`, 'info');
    refreshCtxBar();
  },
  dispatchNearest(incId) {
    const inc = g.incidents.find(i => i.id === incId);
    if (!inc) return;
    const sent = dispatchNearestOfficer(g, inc, g.control);
    if (sent) addAlert(`${sent.name} responding to ${inc.title}`, 'info');
    else addAlert('No available units', 'warn');
  },
  orderDetain(civId) {
    const c = civById(g, civId);
    if (!c) return;
    let pool = g.sel.officers.map(id => offById(g, id)).filter(o => o && o.injury !== 'dead' && o.state !== 'hospital' && o.id !== g.control) as Officer[];
    if (!pool.length) pool = g.officers.filter(o => o.injury !== 'dead' && o.state !== 'hospital' && o.state !== 'down' && o.id !== g.control && (o.state === 'idle' || o.state === 'patrol' || o.state === 'moving'));
    if (!pool.length) { addAlert('No available officer to send', 'warn'); return; }
    pool.sort((a, b) => dist(a, c) - dist(b, c));
    const o = pool[0];
    clearAssignment(g, o);
    o.pursuit = c.id; o.state = 'pursuing'; o.path = null;
    addAlert(`${o.name} moving to detain ${c.name}`, 'info');
  },
  patrolSelected() {
    for (const id of g.sel.officers) {
      const o = offById(g, id);
      if (o) orderPatrol(g, o, hoodOfPoint(g.cam.x, g.cam.y));
    }
    addAlert('Patrol assigned', 'info');
  },
  holdSelected() {
    for (const id of g.sel.officers) {
      const o = offById(g, id);
      if (o) { clearAssignment(g, o); o.state = 'idle'; o.path = null; }
    }
  },
  enterNearestCar() {
    const o = offById(g, g.control) ?? offById(g, g.sel.officers[0]);
    if (!o) return;
    const car = g.vehicles.filter(v => v.police && v.driver === null).sort((a, b) => dist(a, o) - dist(b, o))[0];
    if (!car) { addAlert('No free patrol car', 'warn'); return; }
    if (dist(o, car) > 30) {
      if (g.control === o.id) { addAlert('Walk closer to the car', 'warn'); return; }
      // order: walk to car, then get in (simple: walk, player re-issues)
      orderMove(g, o, { x: car.x, y: car.y });
      addAlert(`${o.name} heading to ${car.name}`, 'info');
      return;
    }
    enterVehicle(g, o, car);
    refreshControlHud();
  },
  exitCar() {
    const o = offById(g, g.control);
    if (o && o.vehicle !== null) { exitVehicle(g, o); refreshControlHud(); }
  },
  toggleWeapon() {
    const o = offById(g, g.control);
    if (o && o.weapon) { o.drawn = !o.drawn; refreshControlHud(); }
  },
  reloadWeapon() {
    const o = offById(g, g.control);
    if (o) reloadWeaponFn(g, o);
  },
  fireAssist() {
    const o = offById(g, g.control);
    if (!o || !o.drawn || !o.weapon) return;
    const t = nearestHostile(g, o, WEAPONS[o.weapon].range * 1.2);
    if (t) fireAt(g, o, t);
    else addAlert('No hostile target in range', 'warn');
  },
  interactNearby(action) { showInteractMenu(); },
  hire() {
    const cost = g.cheats.freeStuff ? 0 : HIRE_COST;
    if (g.budget < cost) { addAlert('Not enough budget', 'warn'); return; }
    g.budget -= cost;
    const o = makeOfficer(g);
    addLog(g, `Hired ${o.name} (${o.trait}).`, 'good');
    addAlert(`Hired ${o.name}`, 'good');
    refreshPanel();
  },
  fire(id) {
    const o = offById(g, id);
    if (!o) return;
    if (!confirm(`Fire ${o.name}?`)) return;
    g.officers = g.officers.filter(q => q.id !== id);
    if (g.control === id) api.releaseControl();
    g.sel.officers = g.sel.officers.filter(q => q !== id);
    addLog(g, `${o.name} was let go.`, 'warn');
    if (!g.cheats.noConsequences) for (const q of g.officers) q.morale = Math.max(0, q.morale - 4);
    refreshPanel();
  },
  buyCar() {
    const cost = g.cheats.freeStuff ? 0 : CAR_COST;
    if (g.budget < cost) { addAlert('Not enough budget', 'warn'); return; }
    g.budget -= cost;
    const lot = stationLot(g.world);
    makeVehicle(g, true, lot.x + ri(0, 60), lot.y + ri(-8, 8));
    addLog(g, 'Purchased a patrol car.', 'good');
    refreshPanel();
  },
  buyWeapon(officerId, weaponId) {
    const o = offById(g, officerId);
    const w = WEAPONS[weaponId];
    if (!o || !w) return;
    const cost = g.cheats.freeStuff ? 0 : w.price;
    if (g.budget < cost) { addAlert('Not enough budget', 'warn'); return; }
    g.budget -= cost;
    o.weapon = weaponId; o.ammo = w.mag; o.reserve = w.mag * 3; o.reloading = 0;
    addAlert(`${o.name} equipped ${w.name}`, 'good');
    refreshPanel();
  },
  saveGame() { saveGame(); addAlert(g.cheats.usedEver ? 'Saved (sandbox save)' : 'Game saved', 'good'); },
  loadGame() { return loadGame(); },
  newGame() {
    g = newGameState((Math.random() * 1e9) | 0);
    buildBase(g);
    rebindNotify();
    refreshPanel();
  },
  setSpeed(n) { g.speed = n; refreshHUD(); },
  sandboxSpawn(type) {
    g.cheats.usedEver = true;
    if (type === 'pursuit') { const inc = spawnPursuit(g); api.centerOn(inc.x, inc.y); setTab(null); return; }
    const p = findSpawnPoint();
    spawnIncidentType(g, type, p.x, p.y);
    setTab(null);
  },
  sandbox(action) {
    g.cheats.usedEver = true;
    const c = g.cheats;
    switch (action) {
      case 'money10k': g.budget += 10000; break;
      case 'money100k': g.budget += 100000; break;
      case 'freestuff': c.freeStuff = !c.freeStuff; break;
      case 'god': c.god = !c.god; break;
      case 'infammo': c.infAmmo = !c.infAmmo; break;
      case 'healall':
        for (const o of g.officers) { o.hp = 100; o.injury = 'healthy'; o.morale = Math.max(o.morale, 70); if (o.state === 'down' || o.state === 'hospital') { o.state = 'idle'; const sd = stationDoor(g.world); o.x = sd.x; o.y = sd.y; } }
        break;
      case 'maxmorale': for (const o of g.officers) o.morale = 100; break;
      case 'spawnofficer': { const o = makeOfficer(g); addAlert(`${o.name} reported for duty`, 'good'); break; }
      case 'spawncar': { const lot = stationLot(g.world); makeVehicle(g, true, lot.x + ri(0, 80), lot.y + ri(-8, 8)); break; }
      case 'maxtrust': for (const h of g.world.hoods) h.trust = 100; break;
      case 'zerotrust': for (const h of g.world.hoods) h.trust = 0; break;
      case 'clearcomplaints': g.stats.complaints = 0; g.stats.lawsuits = 0; break;
      case 'consequences': c.noConsequences = !c.noConsequences; break;
      case 'hour': g.time += 60; break;
      case 'clearcalls': for (const i of g.incidents) if (i.state !== 'resolved') resolveIncident(g, i, 'cleared'); break;
    }
    refreshPanel();
  },
  deselect() { g.sel = { officers: [], vehicle: null, civilian: null, incident: null }; refreshCtxBar(); },
  setCleanView(v) {
    renderOpts.cleanView = v;
    for (const id of ['hud', 'bottomui', 'alerts', 'controlhud', 'joystick', 'actionpad']) {
      document.getElementById(id)!.classList.toggle('hidden', v);
    }
    document.getElementById('cleanexit')!.classList.toggle('hidden', !v);
  },
};

function clearAssignmentSafely(o: Officer) {
  if (o.state === 'responding' || o.state === 'moving' || o.state === 'patrol') { o.path = null; o.state = 'idle'; }
}
function hoodOfPoint(x: number, y: number): number {
  const tx = px2t(x), ty = px2t(y);
  for (const h of g.world.hoods) if (tx >= h.rect.x && tx < h.rect.x + h.rect.w && ty >= h.rect.y && ty < h.rect.y + h.rect.h) return h.id;
  return 0;
}
function findSpawnPoint(): Pt {
  // near camera center on a walkable tile
  for (let r = 0; r < 20; r++) {
    const x = g.cam.x + ri(-80, 80), y = g.cam.y + ri(-80, 80);
    const t = tileAt(g.world, px2t(x), px2t(y));
    if (t === T.SIDEWALK || t === T.LOT || t === T.PARK) return { x, y };
  }
  return { x: g.cam.x, y: g.cam.y };
}

function rebindNotify() {
  g.notify = (t, c, x, y) => {
    addAlert(t, c, x, y);
    if (c === 'bad') g.sfx?.('alarm');
    else if (c === 'warn' || c === 'info') g.sfx?.('blip');
  };
  g.sfx = (type, x, y) => {
    let vol = 1;
    if (x !== undefined && y !== undefined) {
      const d = Math.hypot(x - g.cam.x, y - g.cam.y);
      vol = Math.max(0, 1 - d / 700);
    }
    sfx(type, vol);
  };
}
rebindNotify();
window.addEventListener('pointerdown', () => initAudio(), { once: false });

initUI(g, api);

// ================= interact menu (direct control) =================
const imenu = document.createElement('div');
imenu.id = 'interactmenu';
imenu.style.cssText = 'position:absolute;right:76px;bottom:calc(130px + env(safe-area-inset-bottom));display:none;flex-direction:column;gap:4px;z-index:45;background:rgba(18,19,24,.95);border:1px solid #3a3d46;padding:6px;';
document.getElementById('app')!.appendChild(imenu);

function hideInteractMenu() { imenu.style.display = 'none'; }

function nearestCivTo(o: Officer, range: number): Civilian | null {
  let best: Civilian | null = null, bd = range;
  for (const c of g.civs) {
    if (c.x < 0 || c.state === 'arrested') continue;
    const d = dist(o, c);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function showInteractMenu() {
  const o = offById(g, g.control);
  if (!o) return;
  const c = nearestCivTo(o, 38);
  imenu.innerHTML = '';
  if (!c) { addAlert('Nobody close enough to interact with', 'warn'); return; }
  const title = document.createElement('div');
  title.style.cssText = 'font-size:10px;color:#9fc6ff;padding:2px;';
  title.textContent = `${c.name} — ${c.injury !== 'healthy' ? c.injury : c.state}`;
  imenu.appendChild(title);
  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label; b.style.fontSize = '10px';
    b.addEventListener('click', () => { fn(); hideInteractMenu(); refreshControlHud(); });
    imenu.appendChild(b);
  };
  mk('TALK', () => talkTo(o, c));
  mk('CHECK ID', () => checkId(o, c));
  if (c.state === 'detained' && c.detainedBy === o.id) {
    mk('ARREST → STATION', () => { o.escorting = c.id; addAlert(`Walk ${c.name} to the station to book them.`, 'info'); });
    mk('RELEASE', () => { c.state = 'idle'; c.detainedBy = null; c.waitUntil = g.time + 3; addAlert(`${c.name} released.`, 'info'); });
  } else if (c.state === 'surrender' || c.state === 'down') {
    mk('DETAIN', () => { c.state = 'detained'; c.detainedBy = o.id; c.path = null; addAlert(`${c.name} detained.`, 'good'); });
  } else if (c.state !== 'hostile') {
    mk('DETAIN', () => detainAttempt(o, c));
  }
  imenu.style.display = 'flex';
}

function talkTo(o: Officer, c: Civilian) {
  const h = g.world.hoods[c.hood];
  const coop = c.fear < 0.5 && (h.trust / 100) * 0.7 + o.talk * 0.3 > rng() * 0.8;
  if (!coop) { addAlert(`${c.name}: "I didn't see anything."`, 'info'); return; }
  // share info about a nearby active incident
  const inc = g.incidents.find(i => i.state !== 'resolved' && dist(i, c) < 200);
  if (inc && inc.suspects.length) {
    const s = civById(g, inc.suspects[0]);
    if (s) { addAlert(`${c.name}: "The one you want ${s.state === 'flee' ? 'ran off' : 'is still around'} — ${s.weapon ? 'I think they had a weapon!' : 'didn\'t see a weapon.'}"`, 'info'); return; }
  }
  addAlert(`${c.name}: "${['Quiet day, officer.', 'Everything okay?', 'Stay safe out there.', 'Haven\'t seen anything strange.'][ri(0, 3)]}"`, 'info');
}

function checkId(o: Officer, c: Civilian) {
  c.known = c.known || {}; c.known.idShown = true;
  if (c.warrant) addAlert(`${c.name}: OUTSTANDING WARRANT`, 'bad');
  else if (c.record.length) addAlert(`${c.name}: record — ${c.record.join(', ')}`, 'warn');
  else addAlert(`${c.name}: no record`, 'info');
  refreshCtxBar();
}

function detainAttempt(o: Officer, c: Civilian) {
  const chance = 0.65 + o.talk * 0.2 - c.aggression * 0.35 - (c.role === 'suspect' ? 0.15 : 0);
  if (rng() < chance) {
    c.state = 'detained'; c.detainedBy = o.id; c.path = null;
    addAlert(`${c.name} detained.`, 'good');
  } else if (c.weapon && rng() < c.aggression * 0.6) {
    c.state = 'hostile'; c.drawn = true;
    addAlert(`${c.name} is resisting — weapon out!`, 'bad');
  } else {
    c.state = 'flee';
    setPath(g, c, { x: c.x + ri(-150, 150), y: c.y + ri(-150, 150) });
    addAlert(`${c.name} is running!`, 'warn');
  }
}

// ================= pointer input =================
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch.size === 2) {
    const [a, b] = [...pinch.values()];
    pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y);
    pinchZoom0 = g.cam.zoom;
    panPointer = null;
    return;
  }
  panPointer = { id: e.pointerId, sx: e.clientX, sy: e.clientY, camX: g.cam.x, camY: g.cam.y, moved: false };
});

canvas.addEventListener('pointermove', (e) => {
  if (pinch.has(e.pointerId)) pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch.size === 2) {
    const [a, b] = [...pinch.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist0 > 0) { g.cam.zoom = pinchZoom0 * (d / pinchDist0); clampCam(); }
    return;
  }
  if (panPointer && e.pointerId === panPointer.id) {
    const dx = e.clientX - panPointer.sx, dy = e.clientY - panPointer.sy;
    if (Math.hypot(dx, dy) > 8) panPointer.moved = true;
    if (panPointer.moved && g.control === null) {
      g.cam.x = panPointer.camX - dx / g.cam.zoom;
      g.cam.y = panPointer.camY - dy / g.cam.zoom;
      clampCam();
    }
  }
});

canvas.addEventListener('pointerup', (e) => {
  pinch.delete(e.pointerId);
  if (!panPointer || e.pointerId !== panPointer.id) return;
  const wasTap = !panPointer.moved;
  panPointer = null;
  if (!wasTap) return;
  const p = screenToWorld(e.clientX, e.clientY);
  handleTap(p, e.shiftKey);
});
canvas.addEventListener('pointercancel', (e) => { pinch.delete(e.pointerId); if (panPointer?.id === e.pointerId) panPointer = null; });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const before = screenToWorld(e.clientX, e.clientY);
  g.cam.zoom *= e.deltaY < 0 ? 1.12 : 0.89;
  clampCam();
  const after = screenToWorld(e.clientX, e.clientY);
  g.cam.x += before.x - after.x; g.cam.y += before.y - after.y;
  clampCam();
}, { passive: false });

function handleTap(p: Pt, additive: boolean) {
  if (renderOpts.cleanView) return;
  const co = offById(g, g.control);
  if (co) {
    // direct control: tap = fire (if drawn) at nearby entity
    if (co.drawn && co.weapon && co.vehicle === null) {
      firePoint(co, p);
    }
    return;
  }
  // hit test: officers > vehicles > incidents > civilians
  const off = g.officers.filter(o => o.x > 0 && o.vehicle === null).sort((a, b) => dist(a, p) - dist(b, p))[0];
  if (off && dist(off, p) < 12) {
    api.selectOfficer(off.id, additive || api.multiSelectMode);
    return;
  }
  const veh = g.vehicles.filter(v => v.police).sort((a, b) => dist(a, p) - dist(b, p))[0];
  if (veh && dist(veh, p) < 16) {
    const drv = offById(g, veh.driver);
    if (drv) { api.selectOfficer(drv.id, additive || api.multiSelectMode); return; }
    // officer selected + tap car = send them to it / in it
    if (g.sel.officers.length === 1) {
      const o = offById(g, g.sel.officers[0])!;
      if (dist(o, veh) < 30) { enterVehicle(g, o, veh); refreshCtxBar(); return; }
      orderMove(g, o, { x: veh.x, y: veh.y });
      return;
    }
    g.sel = { officers: [], vehicle: veh.id, civilian: null, incident: null };
    refreshCtxBar();
    return;
  }
  const inc = g.incidents.filter(i => i.state !== 'resolved').sort((a, b) => dist(a, p) - dist(b, p))[0];
  if (inc && dist(inc, p) < 22) {
    if (g.sel.officers.length) { api.dispatchSelected(inc.id); return; }
    g.sel = { officers: [], vehicle: null, civilian: null, incident: inc.id };
    refreshCtxBar();
    return;
  }
  const civ = g.civs.filter(c => c.x > 0).sort((a, b) => dist(a, p) - dist(b, p))[0];
  if (civ && dist(civ, p) < 10) {
    g.sel = { officers: g.sel.officers, vehicle: null, civilian: civ.id, incident: null };
    refreshCtxBar();
    return;
  }
  // ground tap: order selected officers
  if (g.sel.officers.length) {
    let i = 0;
    for (const id of g.sel.officers) {
      const o = offById(g, id);
      if (o) orderMove(g, o, { x: p.x + (i % 3) * 12 - 12, y: p.y + Math.floor(i / 3) * 12 });
      i++;
    }
    return;
  }
  if (!api.multiSelectMode) { api.deselect(); }
}

function firePoint(o: Officer, p: Pt) {
  const w = WEAPONS[o.weapon!];
  // find entity near tap
  const targets: (Civilian | Officer)[] = [...g.civs.filter(c => c.x > 0 && c.injury !== 'dead'), ...g.officers.filter(q => q.id !== o.id && q.x > 0)];
  targets.sort((a, b) => dist(a, p) - dist(b, p));
  const t = targets[0];
  if (t && dist(t, p) < 14 && dist(o, t) < w.range * 1.3) {
    fireAt(g, o, t);
  } else {
    addAlert('No target there', 'warn');
  }
  refreshControlHud();
}

// ================= joystick =================
const joyEl = document.getElementById('joystick')!;
const knob = document.getElementById('joyknob')!;
joyEl.addEventListener('pointerdown', (e) => { joy.active = true; joy.pid = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyMove(e); });
joyEl.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.pid) joyMove(e); });
const joyEnd = (e: PointerEvent) => {
  if (e.pointerId !== joy.pid) return;
  joy.active = false; joy.dx = 0; joy.dy = 0;
  knob.style.left = '30px'; knob.style.top = '30px';
};
joyEl.addEventListener('pointerup', joyEnd);
joyEl.addEventListener('pointercancel', joyEnd);
function joyMove(e: PointerEvent) {
  const r = joyEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2);
  let dy = e.clientY - (r.top + r.height / 2);
  const m = Math.hypot(dx, dy);
  const max = r.width / 2;
  if (m > max) { dx = (dx / m) * max; dy = (dy / m) * max; }
  joy.dx = dx / max; joy.dy = dy / max;
  knob.style.left = `${30 + dx * 0.6}px`;
  knob.style.top = `${30 + dy * 0.6}px`;
}

// ================= keyboard =================
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  keys.add(e.key.toLowerCase());
  const o = offById(g, g.control);
  switch (e.key.toLowerCase()) {
    case ' ': e.preventDefault(); g.speed = g.speed === 0 ? (g.prevSpeed || 1) : (g.prevSpeed = g.speed, 0); refreshHUD(); break;
    case '1': api.setSpeed(1); break;
    case '2': api.setSpeed(2); break;
    case '4': api.setSpeed(4); break;
    case 'f': if (o) api.toggleWeapon(); break;
    case 'r': if (o) api.reloadWeapon(); break;
    case 'e': if (o) showInteractMenu(); break;
    case 'g': if (o) { o.vehicle !== null ? api.exitCar() : api.enterNearestCar(); } break;
    case 'l': if (o && o.vehicle !== null) { const v = vehById(g, o.vehicle); if (v) v.lights = !v.lights; } break;
    case 'escape':
      hideInteractMenu();
      if (g.control !== null) api.releaseControl();
      else { api.deselect(); setTab(null); }
      break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// ================= direct control integration =================
function updatePlayerControl(dts: number) {
  const o = offById(g, g.control);
  if (!o) return;
  if (o.injury === 'dead' || o.injury === 'incap') {
    addAlert(`${o.name} is down!`, 'bad');
    api.releaseControl();
    return;
  }
  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  if (joy.active) { mx = joy.dx; my = joy.dy; }

  if (o.vehicle !== null) {
    const v = vehById(g, o.vehicle)!;
    // arcade car: my = throttle (up = forward), mx = steer
    const throttle = -my;
    v.speed += throttle * 220 * dts;
    v.speed *= (1 - 1.2 * dts);
    v.speed = Math.max(-60, Math.min(v.maxSpeed, v.speed));
    if (Math.abs(v.speed) > 4) v.angle += mx * 2.6 * dts * Math.sign(v.speed);
    const nx = v.x + Math.cos(v.angle) * v.speed * dts;
    const ny = v.y + Math.sin(v.angle) * v.speed * dts;
    const fx = nx + Math.cos(v.angle) * 12 * Math.sign(v.speed || 1);
    const fy = ny + Math.sin(v.angle) * 12 * Math.sign(v.speed || 1);
    const t = tileAt(g.world, px2t(fx), px2t(fy));
    if (blocksMove(t)) { v.speed = 0; }
    else { v.x = nx; v.y = ny; }
    o.x = v.x; o.y = v.y;
    g.cam.x += (v.x - g.cam.x) * Math.min(1, 5 * dts);
    g.cam.y += (v.y - g.cam.y) * Math.min(1, 5 * dts);
    clampCam();
    return;
  }

  const m = Math.hypot(mx, my);
  if (m > 0.05) {
    (o as any).lastMove = performance.now();
    const spd = o.speed * 1.7 * Math.min(1, m);
    const vx = (mx / m) * spd * dts, vy = (my / m) * spd * dts;
    // per-axis collision
    if (!blocksMove(tileAt(g.world, px2t(o.x + vx), px2t(o.y)))) o.x += vx;
    if (!blocksMove(tileAt(g.world, px2t(o.x), px2t(o.y + vy)))) o.y += vy;
    o.x = Math.max(4, Math.min(g.world.w * TILE - 4, o.x));
    o.y = Math.max(4, Math.min(g.world.h * TILE - 4, o.y));
  }
  // escort follows
  if (o.escorting !== null) {
    const c = civById(g, o.escorting);
    if (c && c.state === 'detained') {
      c.x += (o.x + 8 - c.x) * Math.min(1, 6 * dts);
      c.y += (o.y + 8 - c.y) * Math.min(1, 6 * dts);
      const sd = stationDoor(g.world);
      if (dist(o, sd) < 24) { finishArrest(g, o, c); g.control = o.id; o.state = 'idle'; addAlert('Suspect booked.', 'good'); refreshControlHud(); }
    } else o.escorting = null;
  }
  g.cam.x += (o.x - g.cam.x) * Math.min(1, 5 * dts);
  g.cam.y += (o.y - g.cam.y) * Math.min(1, 5 * dts);
  clampCam();
  if (g.cheats.god) { o.hp = 100; o.injury = 'healthy'; }
}

// ================= save / load =================
const SAVE_KEY = 'pixelpolice.save.v1';
function saveGame() {
  const data = {
    v: 2, seed: g.world.seed, time: g.time, budget: g.budget, dayPaid: g.dayPaid,
    stats: g.stats, cheats: g.cheats, nextId: g.nextId, policy: g.policy,
    hoods: g.world.hoods.map(h => ({ trust: h.trust, crime: h.crime, tension: h.tension })),
    officers: g.officers, vehicles: g.vehicles,
    civs: g.civs, log: g.log.slice(-100),
    incidents: g.incidents.filter(i => i.state === 'resolved').slice(-30),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { addAlert('Save failed (storage)', 'bad'); }
}
function loadGame(): boolean {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { /* ignore */ }
  if (!raw) return false;
  try {
    const d = JSON.parse(raw);
    const world = generateCity(d.seed);
    g = {
      ...g,
      world,
      time: d.time, budget: d.budget, dayPaid: d.dayPaid, stats: d.stats,
      cheats: d.cheats, nextId: d.nextId,
      officers: d.officers, vehicles: d.vehicles, civs: d.civs,
      incidents: d.incidents || [], shots: [], log: d.log || [],
      sel: { officers: [], vehicle: null, civilian: null, incident: null },
      control: null, speed: 1, protestUntil: 0, protestHood: 0,
      policy: d.policy || { autoDispatch: 'off' },
    };
    d.hoods?.forEach((h: any, i: number) => {
      if (g.world.hoods[i]) { g.world.hoods[i].trust = h.trust; g.world.hoods[i].crime = h.crime; g.world.hoods[i].tension = h.tension; }
    });
    // clear dangling incident refs
    for (const o of g.officers) { o.incident = null; o.pursuit = null; o.escorting = null; if (o.state !== 'hospital' && o.state !== 'down') o.state = 'idle'; o.path = null; }
    for (const c of g.civs) { if (c.incident !== null) { c.incident = null; if (c.state !== 'down' && c.state !== 'arrested') c.state = 'idle'; } c.path = null; }
    for (const v of g.vehicles) { v.path = null; }
    buildBase(g);
    rebindNotify();
    addAlert(`Loaded save${g.cheats.usedEver ? ' (sandbox)' : ''}`, 'good');
    refreshPanel();
    return true;
  } catch (err) {
    console.error(err);
    addAlert('Save was corrupted', 'bad');
    return false;
  }
}

// ================= main loop =================
let last = performance.now();
let uiTimer = 0;
let panelTimer = 0;
function frame(now: number) {
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dts = realDt * g.speed;

  if (dts > 0) {
    g.time += dts; // 1 game minute per scaled second
    crimeTick(g, dts);
    updateIncidents(g, dts);
    for (const c of g.civs) updateCivilian(g, c, dts);
    for (const o of g.officers) updateOfficer(g, o, dts);
    for (const v of g.vehicles) updateVehicle(g, v, dts);
    updateDept(g, dts);
    updatePlayerControl(dts);
    for (const s of g.shots) s.t -= realDt;
    g.shots = g.shots.filter(s => s.t > 0);
  } else {
    // allow camera work while paused
    updatePlayerControl(0);
  }

  draw(ctx, g, renderOpts, W, H, realDt);

  uiTimer -= realDt;
  panelTimer -= realDt;
  if (uiTimer <= 0) {
    uiTimer = 0.4;
    refreshHUD();
    refreshCtxBar();
    refreshControlHud();
  }
  if (panelTimer <= 0) {
    panelTimer = 1.5;
    // only live tabs auto-rebuild; static tabs (map/sandbox/more) redraw on interaction
    const tab = getTab();
    if ((tab === 'dispatch' || tab === 'units' || tab === 'dept') && g.speed > 0) refreshPanel();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ================= first-run onboarding =================
try {
  if (!localStorage.getItem('pp.seen')) {
    const ob = document.createElement('div');
    ob.id = 'onboard';
    ob.innerHTML = `
      <div class="ob-box">
        <h2>PIXEL POLICE DEPARTMENT</h2>
        <p>A little city is living its life. You run its police department — 4 officers, 2 cars, one budget.</p>
        <p><b>Dispatch:</b> calls come in with incomplete information. Tap an alert to jump there, tap an incident and SEND a unit.</p>
        <p><b>Get personal:</b> select an officer and hit CONTROL to walk, drive, question, and arrest — or fight, if it comes to that.</p>
        <p><b>It all counts:</b> missed calls, wrongful arrests, and stray bullets follow you. SANDBOX has cheats when you just want chaos.</p>
        <button id="ob-go">START SHIFT</button>
      </div>`;
    document.getElementById('app')!.appendChild(ob);
    document.getElementById('ob-go')!.addEventListener('click', () => {
      ob.remove();
      try { localStorage.setItem('pp.seen', '1'); } catch { /* ignore */ }
    });
  }
} catch { /* storage unavailable */ }

// expose for debugging in devtools
(window as any).game = () => g;
