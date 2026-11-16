// Central state: one object owns every mutable value the simulation touches.
// Modules read and write fields of `state`; nothing else keeps a second copy.
import * as THREE from 'three';

export const STEP = 1 / 60;
export const ROUND_TIME = 100; // seconds of live round
export const BUY_TIME = 14; // seconds of buy phase
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5.0;
export const BOMB_FUSE = 35;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

// Weapon catalogue. damage is per body hit; headshots multiply by headMult.
export const WEAPONS = {
  p9:   { name: 'P9',     kind: 'pistol',  price: 0,    damage: 26, headMult: 3, rate: 0.16, mag: 12, reserve: 48, reload: 1.1, spread: 0.011, moveSpread: 0.030, auto: false, pellets: 1, range: 60, kick: 0.006, zoom: 1 },
  vk9:  { name: 'VK-9',   kind: 'smg',     price: 1500, damage: 22, headMult: 3, rate: 0.085, mag: 30, reserve: 120, reload: 1.9, spread: 0.016, moveSpread: 0.042, auto: true,  pellets: 1, range: 55, kick: 0.007, zoom: 1 },
  ar77: { name: 'AR-77',  kind: 'rifle',   price: 2700, damage: 34, headMult: 3, rate: 0.11,  mag: 30, reserve: 90,  reload: 2.2, spread: 0.008, moveSpread: 0.038, auto: true,  pellets: 1, range: 80, kick: 0.011, zoom: 1.25 },
  m590: { name: 'M590',   kind: 'shotgun', price: 1700, damage: 13, headMult: 2, rate: 0.85,  mag: 6,  reserve: 24,  reload: 2.6, spread: 0.055, moveSpread: 0.075, auto: false, pellets: 8, range: 26, kick: 0.03, zoom: 1 },
  lr50: { name: 'LR-50',  kind: 'sniper',  price: 4750, damage: 110, headMult: 3, rate: 1.4,  mag: 5,  reserve: 15,  reload: 3.0, spread: 0.001, moveSpread: 0.09, auto: false, pellets: 1, range: 120, kick: 0.035, zoom: 2.6 },
};
export const GRENADE_PRICE = 300;

export function makeState() {
  return {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    phaseT: 0, // seconds left in current phase
    round: 1,
    score: { atk: 0, def: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    bomb: { state: 'carry', x: 0, y: 0, z: 0, fuse: 0, carrier: null, planter: null, site: null },
    atkSite: 'A', // the site this round's attacker push targets (both bots go together)
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    message: '',
    messageT: 0,
    time: 0, // simulation clock
    seed: 1,
    agents: [], // all fighters incl. player (player is agents[0])
    grenades: [],
    smokes: [],
    feed: [], // kill feed entries {text, t}
    events: [], // one-frame event flags consumed by audio/effects
    stats: { shots: 0, hits: 0, headshots: 0 },
  };
}

// A fighter: player or bot. pos is feet position; eye = pos.y + eyeH.
export function makeAgent(id, team, isPlayer, x, z, yaw) {
  return {
    id, team, isPlayer,
    pos: new THREE.Vector3(x, 0, z),
    vel: new THREE.Vector3(),
    yaw, pitch: 0,
    hp: 100,
    alive: true,
    crouch: false,
    eyeH: 1.62,
    radius: 0.38,
    speed: 0,
    weapon: 'p9',
    mag: 12,
    reserve: 48,
    reloadT: 0,
    fireT: 0,
    spreadBloom: 0,
    hasBomb: false,
    he: 0, // grenade counts
    smoke: 0,
    money: 800,
    // bot brain (unused by player)
    bot: null,
    // visuals
    mesh: null,
    viewmodel: null,
    lastDamageFrom: null,
    flashT: 0,
  };
}

export function resetAgentForRound(a, x, z, yaw) {
  a.pos.set(x, 0, z);
  a.vel.set(0, 0, 0);
  a.yaw = yaw;
  a.pitch = 0;
  a.hp = 100;
  a.alive = true;
  a.crouch = false;
  a.eyeH = 1.62;
  a.reloadT = 0;
  a.fireT = 0;
  a.spreadBloom = 0;
  a.hasBomb = false;
  a.flashT = 0;
  if (a.bot) a.bot.state = 'spawn';
}
