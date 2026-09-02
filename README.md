# Pixel Police Department

**Play: https://jacobramirezsf.github.io/pixel-police/** (mobile + desktop)

Open-world, systems-driven police department sandbox inside a living pixel city.
You run the whole department — and can drop down into any single officer at any time.

**Working title.** Prototype / first vertical slice.

## Run

```bash
npm install
npm run dev        # → http://localhost:5173
npm run build      # static build in dist/ (deployable anywhere, GitHub Pages ready)
```

## What's in the slice

- **Living city**: one generated district (seeded), 4 neighborhoods with wealth/trust/crime/tension, ~140 civilians with homes, jobs, schedules, personalities, records and warrants; ambient traffic; day/night cycle.
- **Department**: 4 persistent officers (traits, skills, morale, injuries, arrest records), 2 patrol cars, budget with daily payroll and trust-based city funding, hiring/firing, armory purchases.
- **Dispatch**: procedural calls (noise, traffic, suspicious person, shoplifting, fight, burglary, robbery, armed robbery, shots fired, bank robbery, shootout) with **imperfect information** — what the caller reports is not always what's true, calls escalate while units travel, unanswered calls have consequences.
- **Play at any scale**: select/multi-select officers, tap map to move, send to calls, patrol areas — or CONTROL one officer directly: walk (WASD/joystick), talk / check ID / detain / arrest / release, enter a patrol car, drive with lights, draw a weapon, fight.
- **Combat**: data-driven weapons (pistols, carbine, shotgun, taser, beanbag, criminal guns, knives), LOS + cover, stray rounds hitting bystanders, injuries (minor→serious→incapacitated→dead), surrender/flee/fight AI by personality, officers pathing through doors to threats.
- **Consequences**: arrests vs wrongful arrests, complaints, lawsuits, neighborhood trust/tension, protests outside the station, officers hospitalized for days, morale, resignations, missed-call trust decay.
- **Sandbox/cheats**: money, god mode, infinite ammo, free equipment, heal/spawn officers and cars, trust min/max, consequence toggle, and one-tap incident spawning up to LARGE SHOOTOUT and BANK ROBBERY. Sandbox use marks saves.
- **Save/load** to localStorage (city regenerates from seed; people and history persist).
- **Mobile-first UI**: the city *is* the interface — compact bottom toolbar (DISPATCH / UNITS / DEPT / MAP / SANDBOX / MORE), contextual action bar, tap-to-jump alerts, touch joystick + action pad in direct control, pinch zoom, clean-view mode to just watch the city.

## Controls (desktop)

Click officer → select · click map → move order · click incident → send selected ·
shift-click → multi-select · wheel → zoom · drag → pan
While controlling: **WASD** move · **E** interact · **F** draw/holster · **R** reload ·
**G** enter/exit car · **L** lights · click → fire (when drawn) · **Esc** release · **Space** pause · **1/2/4** speed

## Docs

See `docs/HANDOFF.md` for architecture and where to take it next.
