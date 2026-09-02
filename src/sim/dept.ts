import type { Game, Civilian, Officer } from './types';
import { rng, ri, stationDoor, randomSidewalkPoint } from './world';
import { TILE } from './types';

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
    const ok = c.path === null;
    if (ok) {
      // simple straight-ish march; setPath imported would cause cycle, walk via path assignment
      c.path = [to];
      c.waitUntil = g.protestUntil;
    }
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
    const payroll = g.officers.filter(o => o.injury !== 'dead').reduce((s, o) => s + o.salary, 0);
    const avgTrust = g.world.hoods.reduce((s, h) => s + h.trust, 0) / 4;
    const funding = Math.round(350 + avgTrust * 5);
    g.budget += funding - payroll;
    addLog(g, `Day ${day + 1}: city funding +$${funding}, payroll -$${payroll}.`, 'info');
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
