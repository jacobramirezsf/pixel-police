// Shared types for the whole simulation.

export const TILE = 16;

export enum T {
  GRASS = 0,
  ROAD = 1,
  SIDEWALK = 2,
  WALL = 3,
  FLOOR = 4,
  DOOR = 5,
  PARK = 6,
  LOT = 7, // parking lot
  COUNTER = 8, // interior cover / blocks movement
  TREE = 9,
}

export interface Pt { x: number; y: number }

export type BuildingKind =
  | 'station' | 'store' | 'house' | 'apartment' | 'office' | 'bank' | 'bar' | 'shop';

export interface Building {
  id: number;
  kind: BuildingKind;
  name: string;
  x: number; y: number; w: number; h: number; // tile rect incl. walls
  door: Pt;      // door tile
  hood: number;  // neighborhood index
  robbedUntil?: number;
}

export interface Neighborhood {
  id: number;
  name: string;
  wealth: number;      // 0..1
  trust: number;       // 0..100
  crime: number;       // rolling crime pressure 0..100
  tension: number;     // 0..100
  rect: { x: number; y: number; w: number; h: number };
}

export type InjuryState = 'healthy' | 'minor' | 'serious' | 'incap' | 'dead';

export interface WeaponDef {
  id: string;
  name: string;
  cls: 'sidearm' | 'rifle' | 'shotgun' | 'lesslethal' | 'melee';
  dmg: number;         // per hit
  rof: number;         // shots per second
  acc: number;         // base hit chance 0..1
  range: number;       // px
  mag: number;
  reload: number;      // seconds
  lethal: boolean;
  noise: number;       // px radius heard
  price: number;
}

export interface Armed {
  weapon: string | null;   // weapon id
  ammo: number;            // in magazine
  reserve: number;
  drawn: boolean;
  cooldown: number;
  reloading: number;       // seconds remaining
}

export type CivState =
  | 'idle' | 'walk' | 'wander' | 'flee' | 'watch'
  | 'crime' | 'fight' | 'hostile' | 'surrender' | 'detained' | 'arrested'
  | 'down' | 'protest';

export interface Civilian extends Armed {
  id: number;
  kind: 'civ';
  name: string;
  x: number; y: number;
  home: number; work: number;   // building ids (-1 none)
  hood: number;
  state: CivState;
  path: Pt[] | null;
  target: Pt | null;
  speed: number;
  color: string; skin: string;
  // personality 0..1
  lawful: number; aggression: number; bravery: number;
  fear: number;                 // 0..1 current
  hp: number; injury: InjuryState;
  record: string[];             // legal history
  incident: number | null;      // incident participating in
  role: 'none' | 'suspect' | 'victim' | 'witness' | 'caller';
  detainedBy: number | null;    // officer id
  waitUntil: number;            // sim time to idle until
  lodTick: number;
  known?: { idShown?: boolean; warrant?: boolean };
  warrant: boolean;
}

export type OfficerState =
  | 'offduty' | 'idle' | 'patrol' | 'moving' | 'responding' | 'onscene'
  | 'pursuing' | 'combat' | 'escorting' | 'driving' | 'down' | 'hospital';

export interface Officer extends Armed {
  id: number;
  kind: 'off';
  name: string;
  x: number; y: number;
  state: OfficerState;
  path: Pt[] | null;
  target: Pt | null;
  speed: number;
  // skills 0..1
  shooting: number; driving: number; talk: number;
  trait: string;
  morale: number;   // 0..100
  fatigue: number;
  hp: number; injury: InjuryState;
  hospitalUntil: number;      // sim time when back
  incident: number | null;
  vehicle: number | null;     // vehicle id if inside
  escorting: number | null;   // civilian id being escorted
  pursuit: number | null;     // civilian id chased
  squad: number | null;
  arrests: number; complaints: number; shotsFired: number;
  salary: number;
  patrolHood: number | null;
  holdPos: Pt | null;
  color: string;
  aiShoot: number; // cooldown for ai decisions
}

export interface Vehicle {
  id: number;
  kind: 'veh';
  police: boolean;
  name: string;
  x: number; y: number;
  angle: number;
  speed: number;
  maxSpeed: number;
  color: string;
  driver: number | null;      // officer id (police) or civ id
  passengers: number[];
  lights: boolean;
  path: Pt[] | null;          // road path for AI driving
  target: Pt | null;
  parked: boolean;
  home: Pt;                   // parking spot
  hp: number;
  stolen: boolean;
}

export type IncidentType =
  | 'noise' | 'suspicious' | 'traffic' | 'shoplift' | 'fight' | 'burglary'
  | 'robbery' | 'armed_robbery' | 'shots' | 'pursuit' | 'assault' | 'bank_robbery'
  | 'shootout' | 'protest_event' | 'welfare';

export type IncidentState = 'queued' | 'assigned' | 'onscene' | 'resolving' | 'resolved';

export interface Incident {
  id: number;
  type: IncidentType;
  title: string;
  reported: string;        // what dispatch says (may be wrong)
  truth: string;           // what is actually happening (hidden)
  x: number; y: number;
  hood: number;
  building: number | null;
  state: IncidentState;
  created: number;         // sim time
  assigned: number[];      // officer ids
  suspects: number[];      // civ ids
  victims: number[];
  priority: 1 | 2 | 3;     // 3 = highest
  armed: boolean;          // truth
  reportedArmed: boolean;  // what caller said
  escalateAt: number;      // sim time; 0 = never
  escalated: boolean;
  resolveTimer: number;
  outcome: string;
  log: string[];
}

export interface Shot {
  x1: number; y1: number; x2: number; y2: number; t: number; police: boolean;
}

export interface Stats {
  arrests: number; wrongfulArrests: number; citations: number; warnings: number;
  callsResolved: number; callsUnresolved: number; callsMissed: number;
  civInjured: number; civDead: number; offInjured: number; offDead: number;
  complaints: number; lawsuits: number; shotsFired: number; useOfForce: number;
  crimesOccurred: number;
}

export interface LogEvent { t: number; text: string; cls: string }

export interface Selection {
  officers: number[];
  vehicle: number | null;
  civilian: number | null;
  incident: number | null;
}

export interface Cheats {
  enabled: boolean;
  god: boolean;
  infAmmo: boolean;
  noConsequences: boolean;
  freeStuff: boolean;
  usedEver: boolean;
}

export interface World {
  seed: number;
  w: number; h: number;
  tiles: Uint8Array;
  buildings: Building[];
  hoods: Neighborhood[];
  stationId: number;
  bankId: number;
  storeIds: number[];
}

export interface Game {
  world: World;
  civs: Civilian[];
  officers: Officer[];
  vehicles: Vehicle[];
  incidents: Incident[];
  shots: Shot[];
  time: number;           // sim minutes since start (day 0, 07:00)
  speed: number;          // 0,1,2,4
  prevSpeed: number;
  budget: number;
  stats: Stats;
  log: LogEvent[];
  sel: Selection;
  control: number | null; // directly controlled officer id
  cheats: Cheats;
  nextId: number;
  cam: { x: number; y: number; zoom: number };
  dayPaid: number;
  protestUntil: number;
  protestHood: number;
  notify: (text: string, cls: string, x?: number, y?: number) => void;
}
