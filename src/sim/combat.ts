import { TILE, T } from './types';
import type { Game, Civilian, Officer } from './types';
import { WEAPONS } from './data';
import { rng, los, tileAt, px2t, blocksMove, blocksSight, findPath, walkCost } from './world';
import { dist, panicNear, offById, civById, moveAlong } from './agents';
import { reportShots } from './incidents';
import { recordCasualty, addLog } from './dept';

type Fighter = Civilian | Officer;

const isOfficer = (e: Fighter): e is Officer => e.kind === 'off';

/** cover modifier for a target: 1 = fully exposed, lower = harder to hit */
export function coverMod(g: Game, tgt: { x: number; y: number }): number {
  const tx = px2t(tgt.x), ty = px2t(tgt.y);
  let cover = 1;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    if (blocksMove(tileAt(g.world, tx + dx, ty + dy))) cover = Math.min(cover, 0.6);
  }
  for (const v of g.vehicles) if (dist(v, tgt) < 26) { cover = Math.min(cover, 0.65); break; }
  return cover;
}

export function reload(g: Game, e: Fighter) {
  if (!e.weapon || e.reloading > 0) return;
  const wd = WEAPONS[e.weapon];
  const inf = isOfficer(e) && g.cheats.infAmmo;
  if (!inf && e.reserve <= 0) return;
  e.reloading = wd.reload;
}

function finishReloadCiv(g: Game, e: Fighter) {
  // civs share the same reload completion path as officers handled in agents.ts;
  // handle here for civilians
  if (e.reloading === 0 && e.weapon && e.ammo === 0 && e.kind === 'civ') {
    const wd = WEAPONS[e.weapon];
    const take = Math.min(wd.mag, e.reserve);
    e.reserve -= take; e.ammo = take;
  }
}

/** Fire toward a target entity. Applies noise/panic and possible bystander hits. */
export function fireAt(g: Game, shooter: Fighter, tgt: Fighter) {
  if (!shooter.weapon || shooter.reloading > 0 || shooter.cooldown > 0) return;
  const wd = WEAPONS[shooter.weapon];
  if (wd.cls === 'melee') {
    if (dist(shooter, tgt) > wd.range + 6) return;
    shooter.cooldown = 1 / wd.rof;
    if (rng() < wd.acc) applyDamage(g, tgt, wd.dmg * (0.7 + rng() * 0.6), shooter, false);
    return;
  }
  if (shooter.ammo <= 0) { reload(g, shooter); return; }
  const d = dist(shooter, tgt);
  if (d > wd.range * 1.3) return;
  if (!los(g.world, shooter.x, shooter.y, tgt.x, tgt.y)) return;
  shooter.cooldown = 1 / wd.rof;
  const inf = isOfficer(shooter) && g.cheats.infAmmo;
  if (!inf) shooter.ammo--;
  if (shooter.ammo <= 0 && !inf) reload(g, shooter);

  g.shots.push({ x1: shooter.x, y1: shooter.y, x2: tgt.x + (rng() - 0.5) * 8, y2: tgt.y + (rng() - 0.5) * 8, t: 0.12, police: isOfficer(shooter) });
  g.sfx?.('shot', shooter.x, shooter.y);
  g.stats.shotsFired++;
  if (isOfficer(shooter)) { shooter.shotsFired++; }

  if (wd.noise > 100) {
    panicNear(g, shooter.x, shooter.y, wd.noise, isOfficer(shooter));
    reportShots(g, shooter.x, shooter.y);
  }

  const skill = isOfficer(shooter) ? 0.75 + shooter.shooting * 0.5 : 0.85;
  const rangeMod = Math.max(0.35, 1 - d / (wd.range * 1.4));
  const hitChance = wd.acc * skill * rangeMod * coverMod(g, tgt);
  if (rng() < hitChance) {
    if (wd.id === 'taser') {
      subdue(g, tgt, shooter);
    } else {
      applyDamage(g, tgt, wd.dmg * (0.7 + rng() * 0.6), shooter, wd.lethal);
    }
  } else if (rng() < 0.06) {
    // stray round: possible bystander hit near the line of fire
    const victim = g.civs.find(c =>
      c.state !== 'down' && c.state !== 'arrested' && c.injury === 'healthy' &&
      c !== tgt && pointNearSegment(c.x, c.y, shooter.x, shooter.y, tgt.x, tgt.y, 14));
    if (victim && los(g.world, shooter.x, shooter.y, victim.x, victim.y)) {
      applyDamage(g, victim, wd.dmg * (0.6 + rng() * 0.5), shooter, wd.lethal, true);
    }
  }
}

/** Free fire toward an arbitrary point — no target lock, ray finds whatever is in the way. */
export function fireAtPoint(g: Game, shooter: Fighter, tx: number, ty: number) {
  if (!shooter.weapon || shooter.reloading > 0 || shooter.cooldown > 0) return;
  const wd = WEAPONS[shooter.weapon];
  const inf = isOfficer(shooter) && g.cheats.infAmmo;
  if (wd.cls === 'melee') {
    // swing toward the point
    const ang0 = Math.atan2(ty - shooter.y, tx - shooter.x);
    shooter.cooldown = 1 / wd.rof;
    const cands0: Fighter[] = [...g.civs, ...g.officers.filter(o => o !== shooter)];
    const hit = cands0.find(c => c.x > 0 && c.injury !== 'dead' &&
      dist(shooter, c) < wd.range + 8 &&
      Math.abs(Math.atan2(c.y - shooter.y, c.x - shooter.x) - ang0) < 0.9);
    if (hit && rng() < wd.acc) applyDamage(g, hit, wd.dmg * (0.7 + rng() * 0.6), shooter, false);
    return;
  }
  if (shooter.ammo <= 0 && !inf) { reload(g, shooter); return; }
  shooter.cooldown = 1 / wd.rof;
  if (!inf) { shooter.ammo--; if (shooter.ammo <= 0) reload(g, shooter); }

  // direction + spread
  let ang = Math.atan2(ty - shooter.y, tx - shooter.x);
  ang += (rng() - 0.5) * (1 - wd.acc) * 0.3;
  const maxD = wd.range * 1.15;
  const skill = isOfficer(shooter) ? 0.75 + (shooter as Officer).shooting * 0.5 : 0.85;
  const cands: Fighter[] = [
    ...g.civs.filter(c => c.x > 0 && c.state !== 'arrested' && c.injury !== 'dead'),
    ...g.officers.filter(o => o !== shooter && o.x > 0 && o.vehicle === null && o.injury !== 'dead'),
  ];
  let ex = shooter.x, ey = shooter.y;
  let victim: Fighter | null = null;
  for (let d = 6; d <= maxD; d += 4) {
    ex = shooter.x + Math.cos(ang) * d;
    ey = shooter.y + Math.sin(ang) * d;
    if (blocksSight(tileAt(g.world, px2t(ex), px2t(ey)))) break; // round hits a wall
    const idx = cands.findIndex(c => Math.hypot(c.x - ex, c.y - ey) < 6.5);
    if (idx >= 0) {
      const c = cands[idx];
      const rangeMod = Math.max(0.4, 1 - d / (wd.range * 1.5));
      if (rng() < wd.acc * skill * rangeMod * 1.15 * coverMod(g, c)) { victim = c; break; }
      cands.splice(idx, 1); // round snapped past them — keep flying
    }
  }
  g.shots.push({ x1: shooter.x, y1: shooter.y, x2: ex, y2: ey, t: 0.12, police: isOfficer(shooter) });
  g.sfx?.('shot', shooter.x, shooter.y);
  g.stats.shotsFired++;
  if (isOfficer(shooter)) (shooter as Officer).shotsFired++;
  if (wd.noise > 100) {
    panicNear(g, shooter.x, shooter.y, wd.noise, isOfficer(shooter));
    reportShots(g, shooter.x, shooter.y);
  }
  if (victim) {
    if (wd.id === 'taser') subdue(g, victim, shooter);
    else applyDamage(g, victim, wd.dmg * (0.7 + rng() * 0.6), shooter, wd.lethal);
    // shooting at someone makes an armed suspect of them fight back sometimes
    if (victim.kind === 'civ') {
      const c = victim as Civilian;
      if (c.weapon && c.state !== 'down' && c.injury !== 'dead' && c.injury !== 'incap' && rng() < c.aggression) {
        c.state = 'hostile'; c.drawn = true;
      }
    }
  }
}

function pointNearSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number, r: number): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return false;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) < r;
}

export function subdue(g: Game, tgt: Fighter, by: Fighter) {
  if (tgt.kind === 'civ') {
    const c = tgt as Civilian;
    c.state = 'surrender'; c.drawn = false; c.weapon = null; c.path = null;
    addLog(g, `${c.name} was subdued (less-lethal).`, 'good');
    g.stats.useOfForce++;
  }
}

export function applyDamage(g: Game, tgt: Fighter, dmg: number, by: Fighter | null, lethal: boolean, stray = false) {
  if (isOfficer(tgt) && g.cheats.god && g.control === tgt.id) return;
  if (isOfficer(tgt) && (tgt as Officer).armor) dmg *= (tgt as Officer).armor!;
  tgt.hp -= dmg;
  g.sfx?.('thud', tgt.x, tgt.y);
  const prev = tgt.injury;
  if (tgt.hp <= 0) tgt.injury = 'dead';
  else if (tgt.hp < 20) tgt.injury = 'incap';
  else if (tgt.hp < 45) tgt.injury = 'serious';
  else if (tgt.hp < 75) tgt.injury = 'minor';
  if (tgt.injury === prev) return;

  if (tgt.injury === 'dead' || tgt.injury === 'incap') {
    tgt.drawn = false;
    if (tgt.kind === 'civ') (tgt as Civilian).state = 'down';
    else (tgt as Officer).state = 'down';
    recordCasualty(g, tgt, by, stray);
  } else if (tgt.kind === 'civ' && (tgt as Civilian).state === 'hostile') {
    // wounded suspects reconsider
    const c = tgt as Civilian;
    if (rng() > c.bravery) { c.state = 'surrender'; c.drawn = false; c.path = null; addLog(g, `${c.name} surrendered after being wounded.`, 'good'); }
  }
}

/** Shared combat brain for hostile civilians and officers in combat. */
export function updateCombatant(g: Game, e: Fighter, dts: number, knownTarget?: Fighter | null) {
  finishReloadCiv(g, e);
  if (e.kind === 'civ') {
    const c = e as Civilian;
    // civil fistfight (two civs brawling)
    if (c.state === 'fight') {
      const other = g.civs.find(q => q.incident === c.incident && q !== c && (q.state === 'fight'));
      if (other) {
        if (dist(c, other) > 16) {
          c.x += Math.sign(other.x - c.x) * 20 * dts;
          c.y += Math.sign(other.y - c.y) * 20 * dts;
        } else if (c.cooldown <= 0) {
          c.cooldown = 1.4;
          if (rng() < 0.3) applyDamage(g, other, 8, c, false);
        }
      }
      return;
    }
    // hostile: fight the police
    const target = knownTarget ?? nearestOfficerTarget(g, c);
    if (!target) {
      // nobody to fight — flee
      c.state = 'flee';
      return;
    }
    c.drawn = true;
    // morale: surrender/flee check
    const officersNear = g.officers.filter(o => o.injury !== 'dead' && o.injury !== 'incap' && o.state !== 'hospital' && dist(o, c) < 220).length;
    const allies = g.civs.filter(q => q !== c && q.state === 'hostile' && dist(q, c) < 160).length;
    const pressure = officersNear * 0.15 + (c.hp < 60 ? 0.25 : 0) - allies * 0.1 - c.bravery * 0.35 - c.aggression * 0.15;
    if (c.aiShootCheck === undefined) (c as any).aiShootCheck = 0;
    (c as any).aiShootCheck -= dts;
    if ((c as any).aiShootCheck <= 0) {
      (c as any).aiShootCheck = 2 + rng() * 2;
      if (rng() < pressure) {
        if (rng() < 0.55) { c.state = 'surrender'; c.drawn = false; c.weapon = null; c.path = null; addLog(g, `${c.name} dropped the weapon and surrendered.`, 'good'); }
        else {
          c.state = 'flee'; c.drawn = false;
          const ang = Math.atan2(c.y - target.y, c.x - target.x);
          c.path = [{ x: c.x + Math.cos(ang) * 160, y: c.y + Math.sin(ang) * 160 }];
        }
        return;
      }
    }
    // move: keep some distance, shuffle to cover-ish spots
    const d = dist(c, target);
    const wd = c.weapon ? WEAPONS[c.weapon] : null;
    const cLos = los(g.world, c.x, c.y, target.x, target.y);
    if (wd && wd.cls === 'melee') {
      if (d > 14) moveToward(g, c, target.x, target.y, c.speed * 1.6 * dts);
    } else if (!cLos) {
      // aggressive suspects hunt; timid ones hold (barricade behavior)
      if (c.aggression > 0.35 && d < 300) approach(g, c, target.x, target.y, c.speed * dts, dts);
      else c.path = null;
    } else if (d < 60) {
      moveToward(g, c, c.x * 2 - target.x, c.y * 2 - target.y, c.speed * dts);
    }
    if (c.weapon && cLos) fireAt(g, c, target);
    return;
  }

  // officer
  const o = e as Officer;
  const target = knownTarget ?? null;
  if (!target) return;
  if (!o.drawn) o.drawn = true;
  const d = dist(o, target);
  const wd = o.weapon ? WEAPONS[o.weapon] : null;
  const hasLos = los(g.world, o.x, o.y, target.x, target.y);
  const ideal = wd ? Math.min(wd.range * 0.55, 120) : 90;
  if (!hasLos) {
    // can't see the threat — path toward it (through doors, around corners)
    approach(g, o, target.x, target.y, o.speed * dts, dts);
  } else if (d > ideal + 30) {
    o.path = null;
    moveToward(g, o, target.x, target.y, o.speed * dts);
  } else if (d < ideal - 40) {
    o.path = null;
    moveToward(g, o, o.x * 2 - target.x, o.y * 2 - target.y, o.speed * 0.8 * dts);
  } else o.path = null;
  if (hasLos && o.weapon && target.kind === 'civ' && (target as Civilian).state === 'hostile') {
    fireAt(g, o, target);
  }
}

/** pathfind toward a point (used when line of sight is blocked — finds doors, corners) */
function approach(g: Game, e: { x: number; y: number; path: any; repathIn?: number }, tx: number, ty: number, step: number, dts: number) {
  e.repathIn = (e.repathIn ?? 0) - dts;
  if (!e.path || e.path.length === 0 || e.repathIn <= 0) {
    e.path = findPath(g.world, e.x, e.y, tx, ty, walkCost);
    e.repathIn = 1.5;
  }
  if (e.path && e.path.length) moveAlong(e as any, dts, step / dts);
  else moveToward(g, e, tx, ty, step);
}

/** step toward a point with per-axis wall sliding + pathfinding fallback around buildings */
export function moveToward(g: Game, e: { x: number; y: number; path?: any; }, tx: number, ty: number, step: number) {
  const d = Math.hypot(tx - e.x, ty - e.y) || 1;
  const vx = ((tx - e.x) / d) * step, vy = ((ty - e.y) / d) * step;
  let moved = false;
  if (!blocksMove(tileAt(g.world, px2t(e.x + vx), px2t(e.y)))) { e.x += vx; moved = true; }
  if (!blocksMove(tileAt(g.world, px2t(e.x), px2t(e.y + vy)))) { e.y += vy; moved = true; }
  if (!moved) {
    // stuck on a wall — sidestep perpendicular
    const px = -vy, py = vx;
    if (!blocksMove(tileAt(g.world, px2t(e.x + px * 2), px2t(e.y + py * 2)))) { e.x += px * 2; e.y += py * 2; }
    else if (!blocksMove(tileAt(g.world, px2t(e.x - px * 2), px2t(e.y - py * 2)))) { e.x -= px * 2; e.y -= py * 2; }
  }
}

function nearestOfficerTarget(g: Game, c: Civilian): Officer | null {
  let best: Officer | null = null, bd = 400;
  for (const o of g.officers) {
    if (o.injury === 'dead' || o.injury === 'incap' || o.state === 'hospital') continue;
    if (o.x < 0) continue;
    const d = dist(c, o);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

declare module './types' {
  interface Civilian { aiShootCheck?: number }
}
