// Weapons: definitions live in state.js; this module owns firing cadence,
// spread/recoil, reload, the buy menu economy, and grenade throws.
// Spread grows with movement and with sustained fire (bloom) and recovers
// when the shooter stops — standing still and tapping beats spraying.
import { WEAPONS, GRENADE_PRICE } from './state.js';
import { clamp } from './util.js';

export function weaponDef(a) { return WEAPONS[a.weapon]; }

// Current spread in radians for a shot right now.
export function currentSpread(a, groundSpeed) {
  const w = WEAPONS[a.weapon];
  const move = clamp(groundSpeed / 5.4, 0, 1);
  return w.spread + w.moveSpread * move + a.spreadBloom;
}

export function canFire(a) {
  return a.alive && a.reloadT <= 0 && a.fireT <= 0 && a.mag > 0;
}

// Consume one trigger pull. Returns the weapon def, or null if it cannot fire.
export function fireWeapon(a) {
  if (!canFire(a)) return null;
  const w = WEAPONS[a.weapon];
  a.mag -= 1;
  a.fireT = w.rate;
  a.spreadBloom = Math.min(0.05, a.spreadBloom + w.kick * 1.6);
  return w;
}

export function startReload(a) {
  const w = WEAPONS[a.weapon];
  if (a.reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
  a.reloadT = w.reload;
  return true;
}

export function stepWeapon(a, dt) {
  if (a.fireT > 0) a.fireT -= dt;
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a.reloadT <= 0) {
      const w = WEAPONS[a.weapon];
      const need = w.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take;
      a.reserve -= take;
      a.reloadT = 0;
    }
  }
  // bloom recovers fast when not firing
  a.spreadBloom = Math.max(0, a.spreadBloom - dt * 0.045);
}

export function giveWeapon(a, id) {
  const w = WEAPONS[id];
  a.weapon = id;
  a.mag = w.mag;
  a.reserve = w.reserve;
  a.reloadT = 0;
  a.fireT = 0;
  a.spreadBloom = 0;
}

// Buy menu. Returns a message string, or '' when nothing was bought.
export function buy(a, id, state) {
  if (id === 'he' || id === 'smoke') {
    if (a.money < GRENADE_PRICE) return 'Not enough money.';
    if (id === 'he' && a.he >= 2) return 'Already carrying 2 HE grenades.';
    if (id === 'smoke' && a.smoke >= 2) return 'Already carrying 2 smoke grenades.';
    a.money -= GRENADE_PRICE;
    if (id === 'he') a.he += 1; else a.smoke += 1;
    return (id === 'he' ? 'HE grenade' : 'Smoke grenade') + ' bought.';
  }
  const w = WEAPONS[id];
  if (!w) return '';
  if (id === 'p9') { giveWeapon(a, 'p9'); return 'P9 equipped.'; }
  if (a.money < w.price) return 'Not enough money for the ' + w.name + '.';
  a.money -= w.price;
  giveWeapon(a, id);
  return w.name + ' bought.';
}

// Throw a grenade from an agent's eye along its aim direction.
export function throwGrenade(state, a, kind, random) {
  if (kind === 'he' && a.he <= 0) return null;
  if (kind === 'smoke' && a.smoke <= 0) return null;
  const dir = {
    x: -Math.sin(a.yaw) * Math.cos(a.pitch),
    y: Math.sin(a.pitch),
    z: -Math.cos(a.yaw) * Math.cos(a.pitch),
  };
  const g = {
    kind,
    owner: a,
    x: a.pos.x + dir.x * 0.5,
    y: a.pos.y + a.eyeH,
    z: a.pos.z + dir.z * 0.5,
    vx: dir.x * 13 + (random() - 0.5) * 0.4,
    vy: dir.y * 13 + 4.5,
    vz: dir.z * 13 + (random() - 0.5) * 0.4,
    fuse: kind === 'he' ? 1.6 : 1.1,
    bounced: 0,
  };
  if (kind === 'he') a.he -= 1; else a.smoke -= 1;
  state.grenades.push(g);
  return g;
}
