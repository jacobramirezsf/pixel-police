import type { WeaponDef } from './types';

export const WEAPONS: Record<string, WeaponDef> = {
  // police
  p9:      { id: 'p9',      name: 'P9 Service Pistol',  cls: 'sidearm',    dmg: 34, rof: 2.4, acc: 0.62, range: 170, mag: 15, reload: 1.6, lethal: true,  noise: 420, price: 500 },
  p45:     { id: 'p45',     name: 'M45 Compact',        cls: 'sidearm',    dmg: 44, rof: 1.8, acc: 0.58, range: 150, mag: 8,  reload: 1.8, lethal: true,  noise: 440, price: 650 },
  carbine: { id: 'carbine', name: 'C7 Patrol Carbine',  cls: 'rifle',      dmg: 55, rof: 3.5, acc: 0.74, range: 320, mag: 30, reload: 2.4, lethal: true,  noise: 600, price: 1800 },
  shotgun: { id: 'shotgun', name: 'D12 Shotgun',        cls: 'shotgun',    dmg: 70, rof: 1.0, acc: 0.66, range: 120, mag: 6,  reload: 3.0, lethal: true,  noise: 620, price: 900 },
  taser:   { id: 'taser',   name: 'Taser X2',           cls: 'lesslethal', dmg: 0,  rof: 0.5, acc: 0.60, range: 70,  mag: 2,  reload: 3.0, lethal: false, noise: 60,  price: 400 },
  beanbag: { id: 'beanbag', name: 'Beanbag Launcher',   cls: 'lesslethal', dmg: 8,  rof: 0.8, acc: 0.55, range: 140, mag: 4,  reload: 2.6, lethal: false, noise: 300, price: 700 },
  // civilian / criminal
  chandgun:{ id: 'chandgun',name: 'Handgun',            cls: 'sidearm',    dmg: 32, rof: 2.0, acc: 0.45, range: 160, mag: 12, reload: 2.0, lethal: true,  noise: 420, price: 0 },
  revolver:{ id: 'revolver',name: 'Revolver',           cls: 'sidearm',    dmg: 48, rof: 1.2, acc: 0.48, range: 150, mag: 6,  reload: 2.8, lethal: true,  noise: 450, price: 0 },
  cshotgun:{ id: 'cshotgun',name: 'Shotgun',            cls: 'shotgun',    dmg: 65, rof: 0.9, acc: 0.55, range: 110, mag: 5,  reload: 3.2, lethal: true,  noise: 620, price: 0 },
  crifle:  { id: 'crifle',  name: 'Rifle',              cls: 'rifle',      dmg: 52, rof: 2.8, acc: 0.55, range: 300, mag: 20, reload: 2.6, lethal: true,  noise: 640, price: 0 },
  knife:   { id: 'knife',   name: 'Knife',              cls: 'melee',      dmg: 30, rof: 1.2, acc: 0.75, range: 18,  mag: 999,reload: 0,   lethal: true,  noise: 0,   price: 0 },
};

export const CRIMINAL_GUNS = ['chandgun', 'chandgun', 'revolver', 'cshotgun', 'crifle'];

export const FIRST = ['Alex','Sam','Maya','Dre','Kim','Lena','Marco','Ray','Tessa','Omar','Nina','Cole','Ivy','Jules','Leo','Rosa','Owen','Priya','Nash','Vera','Milo','Dana','Eli','Faye','Gus','Hana','Iris','Jack','Kai','Lupe','Max','Noor','Otis','Pia','Quinn','Ruth','Seth','Tara','Uri','Wes','Xio','Yara','Zane','Beth','Carl','Dina','Erik','Flor','Gale','Hugo'];
export const LAST = ['Reyes','Ng','Okafor','Silva','Marsh','Kowalski','Tran','Booker','Alvarez','Kim','Osei','Petrov','Diaz','Han','Ferro','Walsh','Ito','Mbeki','Ortiz','Lund','Vega','Chow','Ruiz','Stein','Park','Cruz','Bell','Fox','Lane','Hart','Moss','Pike','Reed','Shaw','Tate','Vale','Webb','York','Cole','Dunn'];

export const OFFICER_TRAITS = ['calm','aggressive','observant','brave','cautious','empathetic','by-the-book','reckless','good driver','sharp shot','negotiator','rookie nerves'];

export const HOOD_NAMES = ['Harbor Heights', 'Midtown', 'Old Docks', 'Cedar Park'];

export const STORE_NAMES = ['QuickMart', 'Corner Deli', 'Bay Liquor', 'Pawn & Gold', 'Night Owl Mkt', 'Dollar Bin'];
export const SHOP_NAMES = ['Laundromat', 'Barber', 'Cafe Pico', 'Vinyl Shop', 'Nails 24', 'Hardware'];
export const BAR_NAMES = ['The Anchor', 'Neon Room', 'Dive 9'];
export const OFFICE_NAMES = ['Tax Office', 'Dental', 'Realty Co', 'Print Shop'];

export const CIV_COLORS = ['#c0553a','#3a6ec0','#4d9e58','#b08a3e','#7a4dab','#3e9e9e','#c04a7d','#8a8a5a','#5a7a9a','#a05a3a','#666a8f','#3f8f6f'];
export const SKIN = ['#e8b98f','#d29b6c','#b57a4a','#8a5a32','#6b4426','#f0cba6'];
export const CAR_COLORS = ['#8a2f2f','#2f4a8a','#4a4a4a','#8a8a8a','#3e6b3e','#7a6a3a','#efefef','#26262e','#6a3a7a'];

// per-piece response text used by dispatch
export const INCIDENT_TITLES: Record<string, string> = {
  noise: 'Noise complaint', suspicious: 'Suspicious person', traffic: 'Traffic stop',
  shoplift: 'Shoplifting', fight: 'Fight in progress', burglary: 'Burglary',
  robbery: 'Robbery', armed_robbery: 'Armed robbery', shots: 'Shots fired',
  pursuit: 'Pursuit', assault: 'Assault', bank_robbery: 'BANK ROBBERY',
  shootout: 'Shootout', protest_event: 'Crowd forming', welfare: 'Welfare check',
  raid: 'STRONGHOLD RAID', gang_attack: 'Officers under attack',
};
