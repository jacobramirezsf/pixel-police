import type { Game, Incident, IncidentType, Officer } from '../sim/types';
import { WEAPONS } from '../sim/data';
import { clock, dayOf, civById, offById, vehById, dist } from '../sim/agents';
import { HIRE_COST, CAR_COST } from '../sim/dept';

export interface UIApi {
  centerOn(x: number, y: number): void;
  selectOfficer(id: number, additive?: boolean): void;
  selectAllOfficers(): void;
  takeControl(id: number): void;
  releaseControl(): void;
  dispatchSelected(incId: number): void;
  dispatchNearest(incId: number): void;
  patrolSelected(): void;
  holdSelected(): void;
  enterNearestCar(): void;
  exitCar(): void;
  toggleWeapon(): void;
  reloadWeapon(): void;
  fireAssist(): void;
  interactNearby(action: string): void;
  hire(): void;
  fire(id: number): void;
  buyCar(): void;
  buyWeapon(officerId: number, weaponId: string): void;
  saveGame(): void;
  loadGame(): boolean;
  newGame(): void;
  setSpeed(n: number): void;
  sandboxSpawn(type: IncidentType): void;
  sandbox(action: string): void;
  deselect(): void;
  layers: { trust: boolean; crime: boolean; hoods: boolean; incidents: boolean; units: boolean };
  setCleanView(v: boolean): void;
  multiSelectMode: boolean;
}

let g: Game;
let api: UIApi;
let activeTab: string | null = null;
let dispatchSub = 'active';
const $ = (id: string) => document.getElementById(id)!;

export function initUI(game: Game, a: UIApi) {
  g = game; api = a;
  for (const btn of $('toolbar').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab!;
      activeTab = activeTab === tab ? null : tab;
      renderTabs();
    });
  }
  for (const n of [0, 1, 2, 4]) {
    $(`spd-${n}`).addEventListener('click', () => api.setSpeed(n));
  }
  $('btn-clean').addEventListener('click', () => api.setCleanView(true));
  $('cleanexit').addEventListener('click', () => api.setCleanView(false));
  renderTabs();
}

export function setTab(tab: string | null) { activeTab = tab; renderTabs(); }
export function getTab() { return activeTab; }

export function addAlert(text: string, cls: string, x?: number, y?: number) {
  const alerts = $('alerts');
  const el = document.createElement('div');
  el.className = `alert ${cls}`;
  el.textContent = text;
  if (x !== undefined && y !== undefined) {
    el.addEventListener('click', () => { api.centerOn(x, y); el.remove(); });
  } else {
    el.addEventListener('click', () => el.remove());
  }
  alerts.prepend(el);
  while (alerts.children.length > 4) alerts.lastChild!.remove();
  setTimeout(() => el.remove(), 9000);
}

// ---------- HUD ----------
export function refreshHUD() {
  $('hud-budget').textContent = `$${Math.round(g.budget).toLocaleString()}`;
  const avail = g.officers.filter(o => o.state === 'idle' || o.state === 'patrol' || o.state === 'moving').length;
  const total = g.officers.filter(o => o.injury !== 'dead').length;
  $('hud-officers').textContent = `👮 ${avail}/${total}`;
  const active = g.incidents.filter(i => i.state !== 'resolved').length;
  const hi = $('hud-incidents');
  hi.textContent = `🚨 ${active}`;
  hi.classList.toggle('hot', g.incidents.some(i => i.state !== 'resolved' && i.priority === 3));
  $('hud-clock').textContent = `Day ${dayOf(g.time)} ${clock(g.time)}`;
  for (const n of [0, 1, 2, 4]) $(`spd-${n}`).classList.toggle('on', g.speed === n);
}

// ---------- tabs / panel ----------
function renderTabs() {
  for (const btn of $('toolbar').querySelectorAll('button')) {
    btn.classList.toggle('on', (btn as HTMLElement).dataset.tab === activeTab);
  }
  const panel = $('panel'), sec = $('secondary');
  if (!activeTab) { panel.classList.remove('open'); sec.classList.remove('open'); return; }
  panel.classList.add('open');
  sec.classList.remove('open');
  renderPanel();
}

export function refreshPanel() { if (activeTab) renderPanel(); refreshCtxBar(); refreshHUD(); refreshControlHud(); }

function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
}

function btn(label: string, cls: string, fn: () => void): HTMLElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', fn);
  return b;
}

function renderPanel() {
  const p = $('panel');
  p.innerHTML = '';
  switch (activeTab) {
    case 'dispatch': return renderDispatch(p);
    case 'units': return renderUnits(p);
    case 'dept': return renderDept(p);
    case 'map': return renderMap(p);
    case 'sandbox': return renderSandbox(p);
    case 'more': return renderMore(p);
  }
}

function renderDispatch(p: HTMLElement) {
  const row = el(`<div class="row"></div>`);
  for (const s of ['active', 'history']) {
    row.appendChild(btn(s.toUpperCase(), dispatchSub === s ? 'on' : '', () => { dispatchSub = s; renderPanel(); }));
  }
  p.appendChild(row);
  if (dispatchSub === 'active') {
    const list = g.incidents.filter(i => i.state !== 'resolved').sort((a, b) => b.priority - a.priority || a.created - b.created);
    if (!list.length) p.appendChild(el(`<div class="muted">No active calls. The city is quiet… for now.</div>`));
    for (const inc of list) p.appendChild(incidentCard(inc));
  } else {
    const list = g.incidents.filter(i => i.state === 'resolved').slice(-25).reverse();
    if (!list.length) p.appendChild(el(`<div class="muted">No history yet.</div>`));
    for (const inc of list) {
      p.appendChild(el(`<div class="card"><div class="grow"><b class="pr${inc.priority}">${inc.title}</b><div class="sub">${clock(inc.created)} — ${inc.outcome}</div></div></div>`));
    }
  }
}

function incidentCard(inc: Incident): HTMLElement {
  const age = Math.max(0, Math.round(g.time - inc.created));
  const card = el(`<div class="card ${g.sel.incident === inc.id ? 'sel' : ''}">
    <div class="grow"><b class="pr${inc.priority}">${inc.title}</b> <span class="sub">${g.world.hoods[inc.hood].name} · ${age}m · ${inc.state}${inc.assigned.length ? ` · ${inc.assigned.length} unit(s)` : ''}</span>
    <div class="sub">${inc.reported}</div></div>
  </div>`);
  card.appendChild(btn('VIEW', '', () => { g.sel.incident = inc.id; api.centerOn(inc.x, inc.y); }));
  if (g.sel.officers.length) card.appendChild(btn('SEND SEL', 'good', () => api.dispatchSelected(inc.id)));
  card.appendChild(btn('NEAREST', '', () => api.dispatchNearest(inc.id)));
  return card;
}

function renderUnits(p: HTMLElement) {
  p.appendChild(el(`<h3>OFFICERS</h3>`));
  const rowAll = el(`<div class="row"></div>`);
  rowAll.appendChild(btn('SELECT ALL', '', () => api.selectAllOfficers()));
  p.appendChild(rowAll);
  for (const o of g.officers) {
    const stateTxt = o.state === 'hospital' ? `hospital (back day ${dayOf(o.hospitalUntil)})` : o.state;
    const card = el(`<div class="card ${g.sel.officers.includes(o.id) ? 'sel' : ''}">
      <div class="grow"><b>${o.name}</b> <span class="sub">${o.trait}</span>
      <div class="sub">${stateTxt} · ${o.injury} · morale ${Math.round(o.morale)} · ${o.weapon ? WEAPONS[o.weapon].name : 'unarmed'} · arrests ${o.arrests}</div></div>
    </div>`);
    if (o.injury !== 'dead' && o.state !== 'hospital') {
      card.appendChild(btn('SELECT', '', () => { api.selectOfficer(o.id); api.centerOn(o.x, o.y); }));
      card.appendChild(btn('CONTROL', 'good', () => api.takeControl(o.id)));
    }
    p.appendChild(card);
  }
  p.appendChild(el(`<h3>VEHICLES</h3>`));
  for (const v of g.vehicles.filter(q => q.police)) {
    const drv = offById(g, v.driver);
    const card = el(`<div class="card"><div class="grow"><b>${v.name}</b><div class="sub">${drv ? `driver: ${drv.name}` : v.parked ? 'parked' : 'idle'}${v.lights ? ' · LIGHTS' : ''}</div></div></div>`);
    card.appendChild(btn('VIEW', '', () => { g.sel.vehicle = v.id; api.centerOn(v.x, v.y); }));
    p.appendChild(card);
  }
}

function renderDept(p: HTMLElement) {
  p.appendChild(el(`<h3>BUDGET</h3>`));
  const payroll = g.officers.reduce((s, o) => s + o.salary, 0);
  p.appendChild(el(`<div class="sub">Balance <b style="color:#ffd94a">$${Math.round(g.budget).toLocaleString()}</b> · daily payroll $${payroll} · daily city funding depends on trust</div>`));
  const row = el(`<div class="row"></div>`);
  row.appendChild(btn(`HIRE OFFICER ($${HIRE_COST})`, '', () => api.hire()));
  row.appendChild(btn(`BUY PATROL CAR ($${CAR_COST})`, '', () => api.buyCar()));
  p.appendChild(row);

  p.appendChild(el(`<h3>ARMORY</h3>`));
  p.appendChild(el(`<div class="muted">Buy for the selected officer (${g.sel.officers.length ? offById(g, g.sel.officers[0])?.name : 'none selected'})</div>`));
  const arow = el(`<div class="row"></div>`);
  for (const wid of ['p9', 'p45', 'shotgun', 'carbine', 'taser', 'beanbag']) {
    const w = WEAPONS[wid];
    arow.appendChild(btn(`${w.name} $${g.cheats.freeStuff ? 0 : w.price}`, '', () => {
      if (g.sel.officers.length) api.buyWeapon(g.sel.officers[0], wid);
    }));
  }
  p.appendChild(arow);

  p.appendChild(el(`<h3>ROSTER</h3>`));
  for (const o of g.officers) {
    const card = el(`<div class="card"><div class="grow"><b>${o.name}</b><div class="sub">shooting ${pct(o.shooting)} · driving ${pct(o.driving)} · talk ${pct(o.talk)} · complaints ${o.complaints} · $${o.salary}/day</div></div></div>`);
    card.appendChild(btn('FIRE', 'danger', () => api.fire(o.id)));
    p.appendChild(card);
  }

  p.appendChild(el(`<h3>DEPARTMENT RECORD</h3>`));
  const s = g.stats;
  p.appendChild(el(`<div>
    <span class="stat">arrests <b>${s.arrests}</b></span><span class="stat">wrongful <b>${s.wrongfulArrests}</b></span>
    <span class="stat">citations <b>${s.citations}</b></span><span class="stat">warnings <b>${s.warnings}</b></span>
    <span class="stat">calls resolved <b>${s.callsResolved}</b></span><span class="stat">missed <b>${s.callsMissed}</b></span>
    <span class="stat">complaints <b>${s.complaints}</b></span><span class="stat">lawsuits <b>${s.lawsuits}</b></span>
    <span class="stat">shots fired <b>${s.shotsFired}</b></span><span class="stat">use of force <b>${s.useOfForce}</b></span>
    <span class="stat">civ injured <b>${s.civInjured}</b></span><span class="stat">civ deaths <b>${s.civDead}</b></span>
    <span class="stat">officers injured <b>${s.offInjured}</b></span><span class="stat">officers killed <b>${s.offDead}</b></span>
  </div>`));
  p.appendChild(el(`<h3>NEIGHBORHOODS</h3>`));
  for (const h of g.world.hoods) {
    p.appendChild(el(`<div class="sub">${h.name}: trust <b>${Math.round(h.trust)}</b> · crime ${Math.round(h.crime)} · tension ${Math.round(h.tension)}</div>`));
  }
}

const pct = (v: number) => `${Math.round(v * 100)}`;

function renderMap(p: HTMLElement) {
  p.appendChild(el(`<h3>MAP LAYERS</h3>`));
  const L = api.layers;
  const row = el(`<div class="row"></div>`);
  const mk = (key: keyof typeof L, label: string) => {
    const b = btn(label, L[key] ? 'on' : '', () => { L[key] = !L[key]; renderPanel(); });
    row.appendChild(b);
  };
  mk('incidents', 'INCIDENTS'); mk('units', 'UNIT TAGS'); mk('trust', 'TRUST'); mk('crime', 'CRIME'); mk('hoods', 'DISTRICTS');
  p.appendChild(row);
  p.appendChild(el(`<h3>JUMP TO</h3>`));
  const jrow = el(`<div class="row"></div>`);
  jrow.appendChild(btn('STATION', '', () => {
    const st = g.world.buildings.find(b => b.id === g.world.stationId)!;
    api.centerOn((st.x + st.w / 2) * 16, (st.y + st.h / 2) * 16);
  }));
  for (const h of g.world.hoods) {
    jrow.appendChild(btn(h.name.toUpperCase(), '', () => api.centerOn((h.rect.x + h.rect.w / 2) * 16, (h.rect.y + h.rect.h / 2) * 16)));
  }
  p.appendChild(jrow);
}

function renderSandbox(p: HTMLElement) {
  if (!g.cheats.enabled) {
    p.appendChild(el(`<h3>SANDBOX MODE</h3>`));
    p.appendChild(el(`<div class="muted">Cheats let you experiment freely. Saves made after enabling are marked as sandbox saves.</div>`));
    p.appendChild(btn('ENABLE SANDBOX TOOLS', 'good', () => { g.cheats.enabled = true; g.cheats.usedEver = true; renderPanel(); }));
    return;
  }
  p.appendChild(el(`<h3>MONEY</h3>`));
  const m = el(`<div class="row"></div>`);
  m.appendChild(btn('+$10,000', '', () => api.sandbox('money10k')));
  m.appendChild(btn('+$100,000', '', () => api.sandbox('money100k')));
  m.appendChild(btn(`FREE EQUIPMENT ${g.cheats.freeStuff ? '✓' : ''}`, g.cheats.freeStuff ? 'on' : '', () => api.sandbox('freestuff')));
  p.appendChild(m);

  p.appendChild(el(`<h3>PLAYER / OFFICERS</h3>`));
  const o = el(`<div class="row"></div>`);
  o.appendChild(btn(`GOD MODE ${g.cheats.god ? '✓' : ''}`, g.cheats.god ? 'on' : '', () => api.sandbox('god')));
  o.appendChild(btn(`INF AMMO ${g.cheats.infAmmo ? '✓' : ''}`, g.cheats.infAmmo ? 'on' : '', () => api.sandbox('infammo')));
  o.appendChild(btn('HEAL ALL', '', () => api.sandbox('healall')));
  o.appendChild(btn('SPAWN OFFICER', '', () => api.sandbox('spawnofficer')));
  o.appendChild(btn('SPAWN PATROL CAR', '', () => api.sandbox('spawncar')));
  o.appendChild(btn('MAX MORALE', '', () => api.sandbox('maxmorale')));
  p.appendChild(o);

  p.appendChild(el(`<h3>SPAWN INCIDENT (at screen center)</h3>`));
  const i1 = el(`<div class="row"></div>`);
  const types: [IncidentType, string][] = [
    ['shoplift', 'SHOPLIFT'], ['fight', 'FIGHT'], ['burglary', 'BURGLARY'], ['robbery', 'ROBBERY'],
    ['armed_robbery', 'ARMED ROBBERY'], ['shots', 'SHOTS FIRED'], ['bank_robbery', 'BANK ROBBERY'], ['shootout', 'LARGE SHOOTOUT'],
  ];
  for (const [t, label] of types) i1.appendChild(btn(label, t === 'shootout' || t === 'bank_robbery' ? 'danger' : '', () => api.sandboxSpawn(t)));
  p.appendChild(i1);

  p.appendChild(el(`<h3>WORLD / REPUTATION</h3>`));
  const w = el(`<div class="row"></div>`);
  w.appendChild(btn('MAX TRUST', '', () => api.sandbox('maxtrust')));
  w.appendChild(btn('ZERO TRUST', 'danger', () => api.sandbox('zerotrust')));
  w.appendChild(btn('CLEAR COMPLAINTS', '', () => api.sandbox('clearcomplaints')));
  w.appendChild(btn(`CONSEQUENCES ${g.cheats.noConsequences ? 'OFF' : 'ON'}`, g.cheats.noConsequences ? 'danger' : 'on', () => api.sandbox('consequences')));
  w.appendChild(btn('ADVANCE 1 HOUR', '', () => api.sandbox('hour')));
  w.appendChild(btn('CLEAR ACTIVE CALLS', '', () => api.sandbox('clearcalls')));
  p.appendChild(w);
}

function renderMore(p: HTMLElement) {
  p.appendChild(el(`<h3>GAME</h3>`));
  const row = el(`<div class="row"></div>`);
  row.appendChild(btn('SAVE', 'good', () => { api.saveGame(); }));
  row.appendChild(btn('LOAD', '', () => { if (!api.loadGame()) addAlert('No save found', 'warn'); }));
  row.appendChild(btn('NEW GAME', 'danger', () => { if (confirm('Start a new city? Unsaved progress is lost.')) api.newGame(); }));
  p.appendChild(row);
  if (g.cheats.usedEver) p.appendChild(el(`<div class="muted">⚠ sandbox tools have been used — saves are marked as sandbox saves.</div>`));
  p.appendChild(el(`<h3>EVENT LOG</h3>`));
  const logs = g.log.slice(-40).reverse();
  for (const l of logs) p.appendChild(el(`<div class="logline ${l.cls}">[D${dayOf(l.t)} ${clock(l.t)}] ${l.text}</div>`));
  p.appendChild(el(`<h3>ABOUT</h3>`));
  p.appendChild(el(`<div class="muted">PIXEL POLICE DEPARTMENT — prototype. Select officers and tap the map to move them. Tap an incident, then SEND. CONTROL an officer to walk, drive, talk, and fight directly. Desktop: WASD move · E interact · F weapon · R reload · G car · Esc release · Space pause.</div>`));
}

// ---------- contextual bar ----------
export function refreshCtxBar() {
  const bar = $('ctxbar');
  bar.innerHTML = '';
  const controlled = g.control !== null;
  if (controlled) { bar.classList.remove('open'); return; }

  const selOff = g.sel.officers.map(id => offById(g, id)).filter(Boolean) as Officer[];
  const inc = g.incidents.find(i => i.id === g.sel.incident && i.state !== 'resolved');
  const civ = civById(g, g.sel.civilian);
  const veh = vehById(g, g.sel.vehicle);

  const add = (label: string, cls: string, fn: () => void) => bar.appendChild(btn(label, cls, fn));
  let any = false;

  if (selOff.length) {
    any = true;
    bar.appendChild(el(`<span class="ctx-label">${selOff.length === 1 ? selOff[0].name : `${selOff.length} officers`}</span>`));
    bar.appendChild(el(`<span class="ctx-label muted">tap map = move</span>`));
    if (selOff.length === 1) add('CONTROL', 'good', () => api.takeControl(selOff[0].id));
    if (inc) add('RESPOND→CALL', 'good', () => api.dispatchSelected(inc.id));
    add('PATROL HERE', '', () => api.patrolSelected());
    add('STOP', '', () => api.holdSelected());
    if (selOff.length === 1) add('ENTER CAR', '', () => api.enterNearestCar());
    add(api.multiSelectMode ? 'MULTI ✓' : 'MULTI', api.multiSelectMode ? 'on' : '', () => { api.multiSelectMode = !api.multiSelectMode; refreshCtxBar(); });
    add('✕', '', () => api.deselect());
  } else if (inc) {
    any = true;
    bar.appendChild(el(`<span class="ctx-label pr${inc.priority}">${inc.title}</span>`));
    add('SEND NEAREST', 'good', () => api.dispatchNearest(inc.id));
    add('VIEW', '', () => api.centerOn(inc.x, inc.y));
    add('✕', '', () => api.deselect());
  } else if (civ) {
    any = true;
    const knows = civ.known?.idShown;
    bar.appendChild(el(`<span class="ctx-label">${civ.name}</span>`));
    bar.appendChild(el(`<span class="ctx-label muted">${civ.injury !== 'healthy' ? civ.injury : knows ? (civ.warrant ? 'WARRANT!' : civ.record.length ? civ.record.join(', ') : 'no record') : 'civilian'}</span>`));
    add('✕', '', () => api.deselect());
  } else if (veh) {
    any = true;
    bar.appendChild(el(`<span class="ctx-label">${veh.name}</span>`));
    add('✕', '', () => api.deselect());
  }
  bar.classList.toggle('open', any);
}

// ---------- direct control hud + pad ----------
export function refreshControlHud() {
  const hud = $('controlhud');
  const o = offById(g, g.control);
  const pad = $('actionpad'), joy = $('joystick');
  if (!o) {
    hud.classList.remove('open'); pad.classList.remove('open'); joy.classList.remove('open');
    return;
  }
  hud.classList.add('open');
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const w = o.weapon ? WEAPONS[o.weapon] : null;
  const inCar = o.vehicle !== null;
  hud.innerHTML = `<b>${o.name}</b><br>
    <span class="hp ${o.hp < 45 ? 'low' : ''}">HP ${Math.max(0, Math.round(o.hp))}</span> · ${o.injury}<br>
    ${w ? `${w.name} ${o.reloading > 0 ? 'RELOADING' : `${g.cheats.infAmmo ? '∞' : o.ammo}/${g.cheats.infAmmo ? '∞' : o.reserve}`} ${o.drawn ? '· DRAWN' : '· holstered'}` : 'unarmed'}
    ${inCar ? '<br>IN VEHICLE — tap map to steer' : ''}`;

  // build action pad (mobile + clickable on desktop too); joystick only on touch
  pad.classList.add('open');
  joy.classList.toggle('open', touch);
  pad.innerHTML = '';
  const mk = (label: string, cls: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label; b.className = cls;
    b.addEventListener('click', fn);
    pad.appendChild(b);
  };
  mk('EXIT CTRL', '', () => api.releaseControl());
  if (inCar) {
    mk('LIGHTS', '', () => { const v = vehById(g, o.vehicle); if (v) v.lights = !v.lights; });
    mk('EXIT CAR', '', () => api.exitCar());
  } else {
    mk('CAR (G)', '', () => api.enterNearestCar());
    mk(o.drawn ? 'HOLSTER' : 'DRAW (F)', '', () => api.toggleWeapon());
    if (o.drawn) {
      mk('RELOAD', '', () => api.reloadWeapon());
      mk('FIRE', 'fire', () => api.fireAssist());
    }
    mk('INTERACT', '', () => api.interactNearby('menu'));
  }
}
