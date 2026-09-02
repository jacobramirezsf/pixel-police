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

## Pass 2 additions (same day)

- **Vehicle pursuits**: `spawnPursuit` (ambient ~3% of crime rolls + sandbox button). Fleeing stolen car, assigned units grab patrol cars (jogging to one first via `wantCar`), chase-heat model → driver yields or crashes → on-foot scene. Escape timer at 25 game-min.
- **Auto-dispatch policy** (DEPT → POLICY): off / low-priority-only / all calls. Runs through `dispatchNearestOfficer`.
- **Strategic DETAIN**: select a civilian → "DETAIN (send unit)" sends nearest officer through the pursuing→detain→auto-escort→booking chain.
- **EMS/coroner sweep**: downed civilians are transported once the scene is quiet (state `gone`).
- **Sound** (`src/sound.ts`): synthesized shot/blip/chime/thud/alarm, distance-attenuated via `g.sfx`, toggle in MORE, AudioContext unlocked on first pointer.
- **Polish**: onboarding overlay (localStorage `pp.seen`), queued-call badge on DISPATCH tab, muzzle flashes, blood pools, night headlight cones, roof skylights, walk bob, incident labels at zoom ≥1.5.
- **Bugs fixed**: officers no longer lock into `combat` against fistfights (nearestHostile is `hostile`-only); the intermittent crimeTick crash was `find(q => q.id === pick(storeIds))` re-picking per element (~36% miss) — pick hoisted; city gen now guarantees ≥2 stores; traffic got front-hemisphere braking + deadlock creep.

## Pass 3 (feel + free fire, Sep 2 2026 response to Jacob's playtest)

Jacob's feedback: controls clunky, incidents too fast to respond to, world not alive, shooting too restricted.

- **Free fire**: `fireAtPoint` in combat.ts — press-and-hold anywhere fires real rays with spread; rounds stop on walls/trees, hit whoever is in the path (bystanders and other officers included), targets nothing. Old tap-near-a-target restriction and "No target there" removed. Aim line renders while drawn (`g.aim`). Held pointer autofires at weapon rate; pinch cancels fire.
- **Pacing overhaul**: crime chance `dts * 0.03 * (1+pressure)` with 8-game-min gap + 4-active cap (≈1 call/30s real at 1x, verified 60s soak: 2 calls, 0 missed). Queue timeouts 25/45/90 game-min by priority. Escalations 9-18 min. Scene assessment 6-11s. Pursuit yield 5s heat / 40 min escape. Officers speed 55 (respond ×1.7), police cars 175.
- **Liveliness**: 190 civs + 20 cars; crosswalk zebras, benches/hydrants/lampposts (`world.props`, lamps glow at night); chat "…" pairs, bar "♪", panic "!" emotes; dog walkers (12%); park loitering; bar trips 19:00-02:00; stuck-car honks.
- Debug note: an "impossible" miss streak in hit testing was bullets legitimately stopping on tree tiles / crowd bodies — check the ray environment before suspecting the math.

## Pass 4 (territory + SWAT + department growth, Sep 2 2026)

Mobile-first is the explicit priority for all controls/UX (Jacob's directive).

- **Gang territory** (`world.gangs`, gen in world.ts; pressure in `updateGangs`): two gangs (Dockside 9 / Eastside Kings), each with a stronghold building ("the projects") and a territory rect. Hostility (15–100) rises on member arrests (+12), woundings (+8), killings (+25), raids (+20); cools slowly. Above ~40, officers on foot in territory get jumped (`gang_attack` p3 incidents); entering the stronghold wakes armed defenders. Members hold their block, wear gang colors, mostly armed.
- **SWAT**: ESTABLISH SWAT TEAM in DEPT→GROW ($6k) → 4 heavy officers (carbines, armor ×0.55 damage, dark sprites) + van. Deploy per-call (SWAT button on p2+ dispatch cards / incident ctx), whole-team select in UNITS, RAID STRONGHOLD per gang. Raid = p3 incident with 4-6 defenders pulled inside; clearing it (all neutralized/held) flips `gang.cleared` → crime drop, members disband, contract payout.
- **Map overlay**: GANG TURF layer (on by default) — tinted dashed territory + stronghold label w/ live heat.
- **Growth loop** (dept.ts): city relations (`g.city.council/mayor`, daily drift from resolved/missed/lawsuits/deaths/trust), council scales daily funding 0.6×–1.4×; **contracts** (patrol hours / crime reduction / response guarantee / stronghold raid) offered every ~1 day, accept in DEPT→CONTRACTS, pay $900–$3.8k; **surplus** offers when mayor >45 (grant, cheap car, carbines, vests=armor 0.8). DEPT panel is sub-tabbed: OVERVIEW / GROW / CONTRACTS / CITY HALL, all thumb-sized rows.
- **Bugs fixed**: enterVehicle tolerance mismatch left responders stuck 'driving' with no car (self-heals now); A* iter cap 9000→22000 (long paths failed); drive-path failure now ditches the car and walks; all-suspects-down resolved as 'suspect gone' instead of 'cleared'; dead officers now get End of Watch + roster removal.

## Deploy

GitHub Pages via `.github/workflows/ci.yml` (same as PixelWar): push to main → typecheck, build, deploy.
Live at https://jacobramirezsf.github.io/pixel-police/

## Known gaps / next steps

- Traffic cars still overlap sometimes (no real lane/queue model); peds aren't hit by cars.
- Interiors: suspects use them (bank/store/burglary) but civilians teleport-ish inside buildings rather than pathing room to room.
- Officer AI won't self-dispatch — player is the dispatcher (by design; a policy toggle "auto-dispatch low priority" would be a good DEPT policy first step).
- Department policies, corruption, investigations/detectives, K9/SWAT units: data structures ready (squad field, incident log), not implemented.
- `#secondary` tool row div exists in DOM but unused (panels have internal sub-tabs instead).
- Mobile fire control is aim-assist (FIRE button → nearest hostile); fine for now.
- No audio.
- Protest marchers walk straight lines (can clip buildings) — swap to `setPath` when touching dept.ts.
- Balance: with 4 officers many low-priority calls are missed (intended pressure, but tune `crimeTick` rate ~`dts * 0.04`).
