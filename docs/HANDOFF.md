# Pixel Police Department — Handoff

Read this first when picking the project back up.

## Status (Sep 2026)

First vertical slice complete and playtested headlessly (Playwright): living city,
dispatch with uncertainty, officer orders + direct control, driving, combat that
resolves (surrender/flee/fight → arrest/booking), consequences (complaints,
lawsuits, trust, protests, hospital time), sandbox cheats, save/load, mobile UI.
`npm run build` and `npx tsc --noEmit` pass clean. No console errors during playtests.

## Stack

Vite + TypeScript, zero runtime deps. Plain canvas 2D, DOM for UI. Same shape as PixelWar.

## Architecture

Everything hangs off one `Game` object (`src/sim/types.ts`). Systems are modules of pure-ish functions taking `(g, ...)`:

| File | Owns |
|---|---|
| `src/sim/types.ts` | All interfaces, tile enum, `Game` state shape |
| `src/sim/data.ts` | Weapon defs (data-driven), names, incident titles |
| `src/sim/world.ts` | Seeded city generation (96×72 tiles, 4 hood quadrants, buildings w/ interiors+doors), A* (walk & drive cost fns), Bresenham LOS |
| `src/sim/agents.ts` | Civilian/officer/vehicle spawning + AI state machines, movement (`setPath`/`moveAlong`), arrests, vehicles (AI drive w/ yield-to-siren) |
| `src/sim/incidents.ts` | Ambient crime generation, incident lifecycle (queued→assigned→onscene→resolved), imperfect dispatch reports, escalation, suspect decisions (comply/flee/fight), sandbox spawns |
| `src/sim/combat.ts` | fireAt (LOS, cover, stray rounds), injuries, morale/surrender, no-LOS approach via pathfinding (this is what fixed the door-stalemate bug) |
| `src/sim/dept.ts` | Log, casualties→consequences, protests, daily budget/trust/crime drift, resignations |
| `src/render/render.ts` | Prerendered base map canvas + dynamic roofs (interiors reveal when someone's inside), entities, tracers, heatmap layers, day/night |
| `src/ui/ui.ts` | Toolbar/panels/ctxbar/alerts/control-HUD. Talks to main via `UIApi` |
| `src/main.ts` | Game loop, input (tap/pan/pinch/box/keys/joystick), direct control + car physics, interact menu, save/load, sandbox impl |

Key invariants:
- **Sim never depends on the controlled officer** — `updateOfficer` early-returns for `g.control`, main.ts integrates player input; everything else keeps simulating.
- Circular imports between sim modules are function-level only (safe under ESM).
- Time: 1 scaled real-second = 1 game minute. Speeds 0/1/2/4. Entity speeds are px/scaled-sec.
- Persistent IDs everywhere (`g.nextId`); cross-references are by id, never object refs, so save/load is plain JSON.
- Save = JSON of dynamic state + world **seed** (city regenerates deterministically via mulberry32).
- Dispatch reports intentionally lie sometimes (`reportedArmed` vs `armed`); never surface `truth` in UI.

## Testing

Headless playtest scripts live in the session scratchpad pattern — recreate as needed:
Playwright (borrow install from `../open-collections/node_modules/playwright`),
`window.game()` exposes state; drive DOM buttons + keyboard, screenshot, assert states.

## Known gaps / next steps

- **Vehicle pursuit** incident type is stubbed in types but has no generator (foot pursuit works).
- Traffic cars overlap at intersections (no real lane/queue model); peds aren't hit by cars.
- Interiors: suspects use them (bank/store/burglary) but civilians teleport-ish inside buildings rather than pathing room to room.
- Officer AI won't self-dispatch — player is the dispatcher (by design; a policy toggle "auto-dispatch low priority" would be a good DEPT policy first step).
- Department policies, corruption, investigations/detectives, K9/SWAT units: data structures ready (squad field, incident log), not implemented.
- `#secondary` tool row div exists in DOM but unused (panels have internal sub-tabs instead).
- Mobile fire control is aim-assist (FIRE button → nearest hostile); fine for now.
- No audio.
- Protest marchers walk straight lines (can clip buildings) — swap to `setPath` when touching dept.ts.
- Balance: with 4 officers many low-priority calls are missed (intended pressure, but tune `crimeTick` rate ~`dts * 0.04`).
