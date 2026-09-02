import type { Game, Incident, IncidentType, Officer } from '../sim/types';
import { WEAPONS, HOOD_NAMES } from '../sim/data';
import { clock, dayOf, civById, offById, vehById, dist } from '../sim/agents';
import { HIRE_COST, CAR_COST, SWAT_COST } from '../sim/dept';
import { soundEnabled, setSound } from '../sound';

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
  orderDetain(civId: number): void;
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
  unlockSwat(): void;
  deploySwat(incId: number): void;
  raidGang(gangId: number): void;
  acceptContract(id: number): void;
  acceptSurplus(id: number): void;
  layers: { trust: boolean; crime: boolean; hoods: boolean; incidents: boolean; units: boolean; gangs: boolean };
  setCleanView(v: boolean): void;
  multiSelectMode: boolean;
}

let g: Game;
let api: UIApi;
let activeTab: string | null = null;
let dispatchSub = 'active';
let deptSub = 'overview';
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
  // unanswered-call badge on the DISPATCH tab
  const queued = g.incidents.filter(i => i.state === 'queued').length;
  const db = $('toolbar').querySelector('[data-tab="dispatch"]') as HTMLElement;
  let badge = db.querySelector('.badge') as HTMLElement | null;
  if (queued > 0) {
    if (!badge) { badge = document.createElement('i'); badge.className = 'badge'; db.appendChild(badge); }
    badge.textContent = String(queued);
  } else if (badge) badge.remove();
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
  if (g.swat && inc.priority >= 2) card.appendChild(btn('SWAT', 'danger', () => api.deploySwat(inc.id)));
  return card;
}

function renderUnits(p: HTMLElement) {
  if (g.swat) {
    p.appendChild(el(`<h3>SWAT TEAM</h3>`));
    const srow = el(`<div class="row"></div>`);
    srow.appendChild(btn('SELECT TEAM', 'on', () => {
      g.sel = { officers: g.officers.filter(o => o.unit === 'swat' && o.injury !== 'dead' && o.state !== 'hospital').map(o => o.id), vehicle: null, civilian: null, incident: null };
      const first = offById(g, g.sel.officers[0]);
      if (first) api.centerOn(first.x, first.y);
      refreshCtxBar();
    }));
    const inc = g.incidents.find(i => i.id === g.sel.incident && i.state !== 'resolved');
    if (inc) srow.appendChild(btn('DEPLOY → SELECTED CALL', 'danger', () => api.deploySwat(inc.id)));
    p.appendChild(srow);
  }
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
  // sub-tabs: mobile-first horizontal row
  const row = el(`<div class="row"></div>`);
  for (const [key, label] of [['overview', 'OVERVIEW'], ['grow', 'GROW'], ['contracts', 'CONTRACTS'], ['city', 'CITY HALL']]) {
    row.appendChild(btn(label, deptSub === key ? 'on' : '', () => { deptSub = key; renderPanel(); }));
  }
  p.appendChild(row);
  if (deptSub === 'overview') renderDeptOverview(p);
  else if (deptSub === 'grow') renderDeptGrow(p);
  else if (deptSub === 'contracts') renderDeptContracts(p);
  else renderDeptCity(p);
}

function meter(label: string, v: number, color: string): HTMLElement {
  return el(`<div class="meter-row"><span class="meter-label">${label}</span>
    <span class="meter"><i style="width:${Math.round(v)}%;background:${color}"></i></span>
    <b>${Math.round(v)}</b></div>`);
}

function renderDeptOverview(p: HTMLElement) {
  const payroll = g.officers.reduce((s, o) => s + o.salary, 0);
  const avgTrust = g.world.hoods.reduce((s, h) => s + h.trust, 0) / 4;
  const funding = Math.round((350 + avgTrust * 5) * (0.6 + (g.city.council / 100) * 0.8));
  p.appendChild(el(`<h3>BUDGET</h3>`));
  p.appendChild(el(`<div class="sub">Balance <b style="color:#ffd94a">$${Math.round(g.budget).toLocaleString()}</b> · tomorrow ≈ +$${funding} funding − $${payroll} payroll</div>`));
  p.appendChild(meter('COUNCIL', g.city.council, '#7fb0e0'));
  p.appendChild(meter('MAYOR', g.city.mayor, '#c9a2e0'));
  const active = g.contracts.filter(c => c.state === 'active').length;
  const offered = g.contracts.filter(c => c.state === 'offered').length;
  if (offered) p.appendChild(el(`<div class="sub" style="color:#9cffb8">${offered} contract offer(s) waiting → CONTRACTS tab</div>`));
  if (active) p.appendChild(el(`<div class="sub">${active} contract(s) in progress</div>`));
  if (g.surplus.length) p.appendChild(el(`<div class="sub" style="color:#9cffb8">${g.surplus.length} surplus offer(s) → CITY HALL tab</div>`));

  p.appendChild(el(`<h3>POLICY</h3>`));
  const prow = el(`<div class="row"></div>`);
  for (const [val, label] of [['off', 'MANUAL DISPATCH'], ['low', 'AUTO: LOW PRIORITY'], ['all', 'AUTO: ALL CALLS']] as const) {
    prow.appendChild(btn(label, g.policy.autoDispatch === val ? 'on' : '', () => { g.policy.autoDispatch = val; renderPanel(); }));
  }
  p.appendChild(prow);

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
    const gg = g.world.gangs.find(q => q.hood === h.id && !q.cleared);
    p.appendChild(el(`<div class="sub">${h.name}: trust <b>${Math.round(h.trust)}</b> · crime ${Math.round(h.crime)} · tension ${Math.round(h.tension)}${gg ? ` · <span style="color:${gg.color}">${gg.name} heat ${Math.round(gg.hostility)}</span>` : ''}</div>`));
  }
}

function renderDeptGrow(p: HTMLElement) {
  p.appendChild(el(`<h3>PERSONNEL & FLEET</h3>`));
  const row = el(`<div class="row"></div>`);
  row.appendChild(btn(`HIRE OFFICER ($${g.cheats.freeStuff ? 0 : HIRE_COST})`, 'good', () => api.hire()));
  row.appendChild(btn(`BUY PATROL CAR ($${g.cheats.freeStuff ? 0 : CAR_COST})`, '', () => api.buyCar()));
  p.appendChild(row);

  p.appendChild(el(`<h3>SWAT</h3>`));
  if (!g.swat) {
    p.appendChild(el(`<div class="sub">Stand up a 4-officer tactical team with carbines, heavy armor, and a van. For strongholds, barricades, and the calls patrol can't win.</div>`));
    p.appendChild(btn(`ESTABLISH SWAT TEAM ($${g.cheats.freeStuff ? 0 : SWAT_COST})`, 'good', () => api.unlockSwat()));
  } else {
    const team = g.officers.filter(o => o.unit === 'swat');
    p.appendChild(el(`<div class="sub">Team of ${team.length} · ${team.filter(o => o.state !== 'hospital' && o.injury !== 'dead').length} fit for duty. Deploy from a call's SWAT button, or raid below.</div>`));
    for (const gg of g.world.gangs) {
      if (gg.cleared) { p.appendChild(el(`<div class="sub" style="color:#9cffb8">${gg.name} stronghold — CLEARED</div>`)); continue; }
      const card = el(`<div class="card"><div class="grow"><b style="color:${gg.color}">${gg.name}</b><div class="sub">${HOOD_NAMES[gg.hood]} · heat ${Math.round(gg.hostility)}/100</div></div></div>`);
      card.appendChild(btn('RAID STRONGHOLD', 'danger', () => { if (confirm(`Raid the ${gg.name} stronghold? Expect a fight.`)) api.raidGang(gg.id); }));
      p.appendChild(card);
    }
  }

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
    const card = el(`<div class="card"><div class="grow"><b>${o.unit === 'swat' ? '🛡 ' : ''}${o.name}</b><div class="sub">shooting ${pct(o.shooting)} · talk ${pct(o.talk)} · ${o.weapon ? WEAPONS[o.weapon].name : 'unarmed'}${o.armor ? ' · vest' : ''} · complaints ${o.complaints} · $${o.salary}/day</div></div></div>`);
    card.appendChild(btn('FIRE', 'danger', () => api.fire(o.id)));
    p.appendChild(card);
  }
}

function renderDeptContracts(p: HTMLElement) {
  p.appendChild(el(`<h3>CITY CONTRACTS</h3>`));
  const offered = g.contracts.filter(c => c.state === 'offered');
  const active = g.contracts.filter(c => c.state === 'active');
  const past = g.contracts.filter(c => c.state === 'done' || c.state === 'failed').slice(-6).reverse();
  if (!offered.length && !active.length) p.appendChild(el(`<div class="muted">No contracts on the table. City hall offers work when they think you can deliver — keep resolving calls.</div>`));
  for (const ct of offered) {
    const card = el(`<div class="card"><div class="grow"><b style="color:#ffd94a">$${ct.reward.toLocaleString()}</b> — <b>${ct.title}</b><div class="sub">${ct.desc}</div><div class="sub">Offer expires D${dayOf(ct.offeredUntil)} ${clock(ct.offeredUntil)}</div></div></div>`);
    card.appendChild(btn('ACCEPT', 'good', () => { api.acceptContract(ct.id); renderPanel(); }));
    p.appendChild(card);
  }
  for (const ct of active) {
    const prog = ct.kind === 'patrol' ? `${Math.round(ct.progress)}/${ct.target} min patrolled`
      : ct.kind === 'response' ? `${ct.progress}/${ct.target} calls resolved`
      : ct.kind === 'crime' ? `crime now ${Math.round(g.world.hoods[ct.hood].crime)}, need ≤ ${ct.target}`
      : g.world.gangs[ct.gang]?.cleared ? 'cleared!' : 'stronghold still active';
    p.appendChild(el(`<div class="card"><div class="grow"><b>${ct.title}</b> <span class="sub">$${ct.reward.toLocaleString()}</span><div class="sub">${prog} · due D${dayOf(ct.deadline)} ${clock(ct.deadline)}</div></div></div>`));
  }
  if (past.length) p.appendChild(el(`<h3>HISTORY</h3>`));
  for (const ct of past) {
    p.appendChild(el(`<div class="sub" style="color:${ct.state === 'done' ? '#9cffb8' : '#ff9c9c'}">${ct.state === 'done' ? '✓' : '✗'} ${ct.title} — $${ct.reward.toLocaleString()}</div>`));
  }
}

function renderDeptCity(p: HTMLElement) {
  p.appendChild(el(`<h3>CITY HALL</h3>`));
  p.appendChild(meter('COUNCIL', g.city.council, '#7fb0e0'));
  p.appendChild(meter('MAYOR', g.city.mayor, '#c9a2e0'));
  p.appendChild(el(`<div class="sub">Council sets your daily funding (0.6×–1.4×). The mayor unlocks grants and surplus gear. Resolving calls and finishing contracts builds both; missed calls, lawsuits, and dead civilians burn them fast.</div>`));
  p.appendChild(el(`<h3>GOVERNMENT SURPLUS</h3>`));
  if (!g.surplus.length) p.appendChild(el(`<div class="muted">Nothing on offer right now. Offers show up when the mayor likes you (above ~45).</div>`));
  for (const of2 of g.surplus) {
    const card = el(`<div class="card"><div class="grow"><b>${of2.title}</b> ${of2.cost ? `<span class="sub">$${of2.cost}</span>` : '<span class="sub" style="color:#9cffb8">FREE</span>'}<div class="sub">${of2.desc}</div><div class="sub">Expires D${dayOf(of2.expires)} ${clock(of2.expires)}</div></div></div>`);
    card.appendChild(btn('ACCEPT', 'good', () => { api.acceptSurplus(of2.id); renderPanel(); }));
    p.appendChild(card);
  }
  p.appendChild(el(`<h3>GANG TERRITORY</h3>`));
  for (const gg of g.world.gangs) {
    p.appendChild(el(`<div class="sub"><b style="color:${gg.color}">${gg.name}</b> — ${HOOD_NAMES[gg.hood]} · ${gg.cleared ? '<span style="color:#9cffb8">stronghold cleared</span>' : `heat ${Math.round(gg.hostility)}/100 — ${gg.hostility > 60 ? 'officers WILL be attacked on their turf' : gg.hostility > 40 ? 'officers get pressed on their turf' : 'quiet for now'}`}</div>`));
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
  mk('incidents', 'INCIDENTS'); mk('units', 'UNIT TAGS'); mk('gangs', 'GANG TURF'); mk('trust', 'TRUST'); mk('crime', 'CRIME'); mk('hoods', 'DISTRICTS');
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
  o.appendChild(btn(g.swat ? 'SWAT ✓' : 'FREE SWAT TEAM', g.swat ? 'on' : '', () => api.sandbox('freeswat')));
  p.appendChild(o);
  p.appendChild(el(`<h3>GANGS</h3>`));
  const grow2 = el(`<div class="row"></div>`);
  grow2.appendChild(btn('MAX GANG HEAT', 'danger', () => api.sandbox('gangmax')));
  grow2.appendChild(btn('COOL GANGS', '', () => api.sandbox('gangcool')));
  grow2.appendChild(btn('+$ CONTRACT NOW', '', () => api.sandbox('contract')));
  p.appendChild(grow2);

  p.appendChild(el(`<h3>SPAWN INCIDENT (at screen center)</h3>`));
  const i1 = el(`<div class="row"></div>`);
  const types: [IncidentType, string][] = [
    ['shoplift', 'SHOPLIFT'], ['fight', 'FIGHT'], ['burglary', 'BURGLARY'], ['robbery', 'ROBBERY'],
    ['armed_robbery', 'ARMED ROBBERY'], ['shots', 'SHOTS FIRED'], ['pursuit', 'PURSUIT'], ['bank_robbery', 'BANK ROBBERY'], ['shootout', 'LARGE SHOOTOUT'],
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
  row.appendChild(btn(`SOUND ${soundEnabled() ? 'ON' : 'OFF'}`, soundEnabled() ? 'on' : '', () => { setSound(!soundEnabled()); renderPanel(); }));
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
    if (civ.state !== 'down' && civ.state !== 'arrested' && civ.state !== 'gone' && civ.state !== 'detained') {
      add('DETAIN (send unit)', '', () => api.orderDetain(civ.id));
    }
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
