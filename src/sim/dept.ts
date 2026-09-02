import type { Game, Civilian, Officer, Contract, SurplusOffer } from './types';
import { rng, ri, pick, stationDoor, stationLot } from './world';
import { setPath, makeVehicle } from './agents';
import { WEAPONS, HOOD_NAMES } from './data';

export function addLog(g: Game, text: string, cls = 'info') {
  g.log.push({ t: g.time, text, cls });
  if (g.log.length > 300) g.log.shift();
}

export function recordCasualty(g: Game, victim: Civilian | Officer, by: (Civilian | Officer) | null, stray: boolean) {
  const dead = victim.injury === 'dead';
  const byPolice = by?.kind === 'off';
  if (victim.kind === 'off') {
    const o = victim as Officer;
    if (dead) {
      g.stats.offDead++;
      addLog(g, `OFFICER DOWN: ${o.name} was killed.`, 'bad');
      g.notify(`OFFICER DOWN — ${o.name}`, 'bad', o.x, o.y);
      if (!g.cheats.noConsequences) {
        for (const h of g.world.hoods) h.tension = Math.min(100, h.tension + 8);
        for (const q of g.officers) q.morale = Math.max(0, q.morale - 18);
      }
    } else {
      g.stats.offInjured++;
      const days = ri(2, 9);
      o.hospitalUntil = g.time + days * 1440;
      o.state = 'hospital';
      o.x = -999; o.y = -999;
      o.incident = null; o.vehicle = null; o.escorting = null; o.pursuit = null;
      addLog(g, `${o.name} was seriously injured — out ~${days} days.`, 'bad');
      g.notify(`OFFICER INJURED — ${o.name}`, 'bad');
      if (!g.cheats.noConsequences) for (const q of g.officers) q.morale = Math.max(0, q.morale - 8);
    }
    return;
  }

  const c = victim as Civilian;
  const wasThreat = c.role === 'suspect' && c.weapon !== null;
  const h = g.world.hoods[c.hood];
  if (c.gang != null && byPolice) {
    const gg = g.world.gangs[c.gang];
    if (gg && !gg.cleared) {
      gg.hostility = Math.min(100, gg.hostility + (dead ? 25 : 8));
      if (dead) g.notify(`${gg.name} will want payback.`, 'warn');
    }
  }
  if (dead) {
    g.stats.civDead++;
    if (byPolice) {
      g.stats.useOfForce++;
      addLog(g, `${c.name} was killed by police${stray ? ' (stray round)' : ''} in ${h.name}.`, 'bad');
      if (!g.cheats.noConsequences) {
        const dTrust = wasThreat && !stray ? 4 : 14;
        h.trust = Math.max(0, h.trust - dTrust);
        h.tension = Math.min(100, h.tension + (wasThreat && !stray ? 6 : 20));
        g.stats.complaints++;
        if (!wasThreat || stray) {
          g.stats.lawsuits++;
          g.budget -= 2000;
          addLog(g, `Family of ${c.name} is filing a lawsuit. Legal reserve -$2,000.`, 'bad');
          g.notify('Lawsuit filed against the department', 'bad');
          maybeProtest(g, c.hood);
        }
      }
    } else {
      addLog(g, `${c.name} was killed in ${h.name}.`, 'bad');
      if (!g.cheats.noConsequences) { h.crime = Math.min(100, h.crime + 4); h.trust = Math.max(0, h.trust - 2); }
    }
  } else {
    g.stats.civInjured++;
    if (byPolice) {
      g.stats.useOfForce++;
      if (!g.cheats.noConsequences) {
        h.trust = Math.max(0, h.trust - (wasThreat && !stray ? 1 : 6));
        if (!wasThreat || stray) { g.stats.complaints++; addLog(g, `${c.name} (bystander) was shot and wounded by police. Complaint filed.`, 'bad'); }
        else addLog(g, `${c.name} was wounded by police during the incident.`, 'warn');
      }
    } else {
      addLog(g, `${c.name} was wounded in ${h.name}.`, 'warn');
    }
  }
}

export function maybeProtest(g: Game, hood: number) {
  const h = g.world.hoods[hood];
  if (h.trust > 40 || g.time < g.protestUntil) return;
  g.protestUntil = g.time + 300; // 5h protest
  g.protestHood = hood;
  const sd = stationDoor(g.world);
  let n = 0;
  for (const c of g.civs) {
    if (n >= 10) break;
    if (c.hood !== hood || c.state !== 'idle' && c.state !== 'wander' && c.state !== 'walk') continue;
    c.state = 'protest';
    c.path = null;
    const to = { x: sd.x + ri(-40, 40), y: sd.y + ri(10, 50) };
    if (!setPath(g, c, to)) c.path = [to];
    c.waitUntil = g.protestUntil;
    n++;
  }
  addLog(g, `Residents of ${h.name} are protesting outside the station.`, 'warn');
  g.notify(`PROTEST FORMING outside the station`, 'warn', sd.x, sd.y);
}

export function updateDept(g: Game, dts: number) {
  // protest end
  if (g.protestUntil && g.time > g.protestUntil) {
    g.protestUntil = 0;
    for (const c of g.civs) if (c.state === 'protest') { c.state = 'idle'; c.waitUntil = g.time + 5; }
  }

  // daily economics
  const day = Math.floor(g.time / 1440);
  if (day > g.dayPaid) {
    g.dayPaid = day;
    tickRelations(g);
    const payroll = g.officers.filter(o => o.injury !== 'dead').reduce((s, o) => s + o.salary, 0);
    const avgTrust = g.world.hoods.reduce((s, h) => s + h.trust, 0) / 4;
    // council relationship scales the city's check: 0.6x when hated, 1.4x when loved
    const funding = Math.round((350 + avgTrust * 5) * (0.6 + (g.city.council / 100) * 0.8));
    g.budget += funding - payroll;
    addLog(g, `Day ${day + 1}: city funding +$${funding} (council ${Math.round(g.city.council)}/100), payroll -$${payroll}.`, 'info');
    if (g.budget < 0) {
      addLog(g, `Department is over budget. City council is not pleased.`, 'bad');
      if (!g.cheats.noConsequences) for (const h of g.world.hoods) h.trust = Math.max(0, h.trust - 1);
    }
    // slow drift: tension cools, crime follows trust
    for (const h of g.world.hoods) {
      h.tension = Math.max(0, h.tension - 3);
      const target = 50 - h.trust * 0.35 + (1 - h.wealth) * 20;
      h.crime += Math.sign(target - h.crime) * Math.min(2, Math.abs(target - h.crime));
      h.crime = Math.max(0, Math.min(100, h.crime));
    }
    for (const o of g.officers) {
      o.fatigue = Math.max(0, o.fatigue - 40);
      o.morale = Math.min(100, o.morale + 1);
      // resignations under terrible morale
      if (o.morale < 20 && rng() < 0.1 && o.state !== 'hospital') {
        addLog(g, `${o.name} resigned from the department.`, 'bad');
        g.officers = g.officers.filter(q => q.id !== o.id);
      }
    }
  }
}

export const HIRE_COST = 500;
export const CAR_COST = 3000;
export const SWAT_COST = 6000;

// ---------- city contracts ----------
function completeContract(g: Game, ct: Contract) {
  ct.state = 'done';
  g.budget += ct.reward;
  g.city.council = Math.min(100, g.city.council + 4);
  g.city.mayor = Math.min(100, g.city.mayor + 4);
  addLog(g, `Contract complete: ${ct.title} — paid $${ct.reward.toLocaleString()}.`, 'good');
  g.notify(`CONTRACT PAID: +$${ct.reward.toLocaleString()}`, 'good');
  g.sfx?.('chime');
}

function failContract(g: Game, ct: Contract, why: string) {
  ct.state = 'failed';
  g.city.council = Math.max(0, g.city.council - 5);
  addLog(g, `Contract failed (${why}): ${ct.title}. City hall noticed.`, 'bad');
  g.notify(`Contract failed: ${ct.title}`, 'bad');
}

export function contractCallResolved(g: Game) {
  for (const ct of g.contracts) {
    if (ct.state === 'active' && ct.kind === 'response') {
      ct.progress++;
      if (ct.progress >= ct.target) completeContract(g, ct);
    }
  }
}
export function contractCallMissed(g: Game) {
  for (const ct of g.contracts) {
    if (ct.state === 'active' && ct.kind === 'response') failContract(g, ct, 'a call went unanswered');
  }
}

function offerContract(g: Game) {
  const id = g.nextId++;
  const day = 1440;
  const boost = 1 + g.city.council / 200; // better relations, better money
  const kinds: Contract['kind'][] = ['patrol', 'response'];
  const worstHood = [...g.world.hoods].sort((a, b) => b.crime - a.crime)[0];
  if (worstHood.crime > 30) kinds.push('crime');
  const raidable = g.world.gangs.find(gg => !gg.cleared && gg.hostility > 45);
  if (raidable && kinds.length < 4) kinds.push('raid');
  const kind = pick(kinds);
  let ct: Contract;
  if (kind === 'patrol') {
    const hood = ri(0, 3);
    ct = {
      id, kind, hood, gang: -1,
      title: `Visible patrols: ${HOOD_NAMES[hood]}`,
      desc: `Council wants boots on the ground. Keep an officer on patrol in ${HOOD_NAMES[hood]} for a total of 5 hours.`,
      target: 300, progress: 0, deadline: g.time + 2 * day, reward: Math.round(900 * boost),
      state: 'offered', offeredUntil: g.time + day,
    };
  } else if (kind === 'crime') {
    ct = {
      id, kind, hood: worstHood.id, gang: -1,
      title: `Crime push: ${worstHood.name}`,
      desc: `Get crime in ${worstHood.name} below ${Math.max(15, Math.round(worstHood.crime - 12))} within 3 days. Arrests and cleared calls there count.`,
      target: Math.max(15, Math.round(worstHood.crime - 12)), progress: 0,
      deadline: g.time + 3 * day, reward: Math.round(1800 * boost),
      state: 'offered', offeredUntil: g.time + day,
    };
  } else if (kind === 'raid') {
    const gg = raidable!;
    ct = {
      id, kind, hood: gg.hood, gang: gg.id,
      title: `Clear the ${gg.name} stronghold`,
      desc: `The mayor wants the ${gg.name} out of ${HOOD_NAMES[gg.hood]}. Clear their stronghold within 4 days. Expect armed resistance.`,
      target: 1, progress: 0, deadline: g.time + 4 * day, reward: Math.round(3000 * boost),
      state: 'offered', offeredUntil: g.time + 2 * day,
    };
  } else {
    ct = {
      id, kind: 'response', hood: -1, gang: -1,
      title: 'Response guarantee',
      desc: `Resolve 6 calls without letting a single one go unanswered. One missed call voids the contract.`,
      target: 6, progress: 0, deadline: g.time + 2 * day, reward: Math.round(1200 * boost),
      state: 'offered', offeredUntil: g.time + day,
    };
  }
  g.contracts.push(ct);
  g.notify(`NEW CITY CONTRACT: ${ct.title} ($${ct.reward.toLocaleString()})`, 'info');
  addLog(g, `City hall offered a contract: ${ct.title} — $${ct.reward.toLocaleString()}.`, 'info');
}

export function acceptContract(g: Game, id: number): boolean {
  const ct = g.contracts.find(q => q.id === id && q.state === 'offered');
  if (!ct) return false;
  ct.state = 'active';
  addLog(g, `Contract accepted: ${ct.title}.`, 'info');
  return true;
}

function tickContracts(g: Game, dts: number) {
  for (const ct of g.contracts) {
    if (ct.state === 'offered' && g.time > ct.offeredUntil) { ct.state = 'failed'; continue; }
    if (ct.state !== 'active') continue;
    switch (ct.kind) {
      case 'patrol': {
        const covered = g.officers.some(o => o.state === 'patrol' && o.patrolHood === ct.hood && o.injury !== 'dead');
        if (covered) ct.progress += dts; // dts is game-minutes
        if (ct.progress >= ct.target) { completeContract(g, ct); continue; }
        break;
      }
      case 'crime':
        if (g.world.hoods[ct.hood].crime <= ct.target) { completeContract(g, ct); continue; }
        break;
      case 'raid':
        if (g.world.gangs[ct.gang]?.cleared) { completeContract(g, ct); continue; }
        break;
    }
    if (g.time > ct.deadline) failContract(g, ct, 'deadline passed');
  }
  if (g.contracts.length > 20) g.contracts = g.contracts.filter(c => c.state === 'offered' || c.state === 'active').concat(g.contracts.filter(c => c.state === 'done' || c.state === 'failed').slice(-8));

  // new offers roll in every day or so, when there's room
  const nextAt = (g as any).nextContractAt ?? ((g as any).nextContractAt = g.time + 60);
  if (g.time >= nextAt) {
    (g as any).nextContractAt = g.time + 1000 + ri(0, 800);
    const open = g.contracts.filter(c => c.state === 'offered').length;
    const active = g.contracts.filter(c => c.state === 'active').length;
    if (open < 2 && active < 3) offerContract(g);
  }
}

// ---------- government surplus ----------
function offerSurplus(g: Game) {
  const id = g.nextId++;
  const kinds: SurplusOffer['kind'][] = ['car', 'carbines', 'armor'];
  if (g.city.mayor > 65) kinds.push('grant', 'grant');
  const kind = pick(kinds);
  const day = 1440;
  const offers: Record<SurplusOffer['kind'], SurplusOffer> = {
    grant: { id, kind: 'grant', title: 'Federal safety grant', desc: `A one-time grant of $${(2000 + Math.round(g.city.mayor) * 20).toLocaleString()} — the mayor pulled strings.`, cost: 0, expires: g.time + 2 * day },
    car: { id, kind: 'car', title: 'Surplus patrol car', desc: 'A county-surplus cruiser, $800 instead of $3,000. Runs fine, smells like donuts.', cost: 800, expires: g.time + 2 * day },
    carbines: { id, kind: 'carbines', title: 'Military surplus carbines', desc: 'Two C7 patrol carbines, free. Equips your two most senior unarmed-with-rifle officers.', cost: 0, expires: g.time + 2 * day },
    armor: { id, kind: 'armor', title: 'Surplus vest shipment', desc: 'Ballistic vests for the whole patrol roster — every non-SWAT officer takes 20% less damage.', cost: 0, expires: g.time + 2 * day },
  };
  g.surplus.push(offers[kind]);
  g.notify(`GOV SURPLUS OFFER: ${offers[kind].title}`, 'info');
  addLog(g, `Government surplus available: ${offers[kind].title}.`, 'info');
}

export function acceptSurplus(g: Game, id: number): string | null {
  const of2 = g.surplus.find(q => q.id === id);
  if (!of2) return null;
  if (g.budget < of2.cost) return 'Not enough budget';
  g.budget -= of2.cost;
  switch (of2.kind) {
    case 'grant': {
      const amt = 2000 + Math.round(g.city.mayor) * 20;
      g.budget += amt;
      addLog(g, `Federal grant received: +$${amt.toLocaleString()}.`, 'good');
      break;
    }
    case 'car': {
      const lot = stationLot(g.world);
      makeVehicle(g, true, lot.x + ri(0, 80), lot.y + ri(-8, 8));
      addLog(g, 'Surplus patrol car added to the fleet.', 'good');
      break;
    }
    case 'carbines': {
      let n = 0;
      for (const o of g.officers) {
        if (n >= 2) break;
        if (o.weapon !== 'carbine' && o.unit !== 'swat') {
          o.weapon = 'carbine'; o.ammo = WEAPONS.carbine.mag; o.reserve = WEAPONS.carbine.mag * 3; n++;
          addLog(g, `${o.name} issued a surplus carbine.`, 'good');
        }
      }
      break;
    }
    case 'armor': {
      for (const o of g.officers) if (o.unit !== 'swat') o.armor = Math.min(o.armor ?? 1, 0.8);
      addLog(g, 'Patrol vests issued to the whole roster.', 'good');
      break;
    }
  }
  g.surplus = g.surplus.filter(q => q.id !== id);
  return null;
}

function tickSurplus(g: Game) {
  g.surplus = g.surplus.filter(q => g.time < q.expires);
  const nextAt = (g as any).nextSurplusAt ?? ((g as any).nextSurplusAt = g.time + 1800);
  if (g.time >= nextAt) {
    (g as any).nextSurplusAt = g.time + 2200 + ri(0, 1400);
    if (g.surplus.length < 2 && g.city.mayor > 45) offerSurplus(g);
  }
}

// ---------- city relations ----------
function tickRelations(g: Game) {
  // daily: compare against yesterday's stats
  const prev = (g as any).prevStats ?? g.stats;
  const d = {
    missed: g.stats.callsMissed - (prev.callsMissed ?? 0),
    lawsuits: g.stats.lawsuits - (prev.lawsuits ?? 0),
    complaints: g.stats.complaints - (prev.complaints ?? 0),
    resolved: g.stats.callsResolved - (prev.callsResolved ?? 0),
    arrests: g.stats.arrests - (prev.arrests ?? 0),
    civDead: g.stats.civDead - (prev.civDead ?? 0),
  };
  (g as any).prevStats = { ...g.stats };
  const avgTrust = g.world.hoods.reduce((s, h) => s + h.trust, 0) / 4;
  const c = g.city;
  c.council += d.resolved * 0.4 + d.arrests * 0.2 - d.missed * 1.2 - d.lawsuits * 6 - d.complaints * 1 - d.civDead * 3 + (avgTrust - 50) * 0.05;
  c.mayor += d.resolved * 0.2 - d.missed * 0.6 - d.lawsuits * 8 - d.civDead * 5 + (avgTrust - 50) * 0.1;
  c.council = Math.max(0, Math.min(100, c.council));
  c.mayor = Math.max(0, Math.min(100, c.mayor));
  if (c.council < 25) addLog(g, 'City council is openly hostile to the department. Expect thin funding.', 'bad');
}

export function updateGrowth(g: Game, dts: number) {
  tickContracts(g, dts);
  tickSurplus(g);
}
