// Combat: hitscan shots against walls and fighters, grenade flight and
// explosions, and damage. Hit tests use two spheres per fighter — head and
// torso — so headshots pay more. No allocations in the hot path: one shared
// raycaster and a handful of scratch vectors.
import * as THREE from 'three';
import { WEAPONS } from './state.js';
import { V1, V2, V3, V4, RAY, clamp } from './util.js';
import { losClear } from './world.js';

const HEAD_R = 0.24;
const BODY_R = 0.46;

// Ray vs sphere. Returns distance along the ray, or Infinity.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Fire one pellet from `shooter` along `dir`. Returns a hit record or null.
// The record is reused (module-level) — callers must read it before the next shot.
const hitRec = { target: null, head: false, dist: 0, point: new THREE.Vector3(), wallDist: Infinity };
export function shootPellet(world, state, shooter, dir, spread, random) {
  const w = WEAPONS[shooter.weapon];
  const ox = shooter.pos.x;
  const oy = shooter.pos.y + shooter.eyeH;
  const oz = shooter.pos.z;
  // spread: perturb direction in a small cone
  V1.set(dir.x, dir.y, dir.z);
  V2.set(-dir.z, 0, dir.x).normalize(); // right
  V3.crossVectors(V1, V2).normalize(); // up
  const a1 = (random() * 2 - 1) * spread;
  const a2 = (random() * 2 - 1) * spread;
  V1.addScaledVector(V2, a1).addScaledVector(V3, a2).normalize();
  const dx = V1.x, dy = V1.y, dz = V1.z;

  // wall distance via three.js raycast against solid meshes
  RAY.set(V4.set(ox, oy, oz), V1);
  RAY.far = w.range;
  const wallHits = RAY.intersectObjects(world.solids, false);
  const wallDist = wallHits.length ? wallHits[0].distance : w.range;
  hitRec.wallDist = wallDist;
  hitRec.target = null;

  let best = wallDist;
  let bestHead = false;
  let bestAgent = null;
  for (const a of state.agents) {
    if (a === shooter || !a.alive) continue;
    const headY = a.pos.y + a.eyeH - 0.12;
    const bodyY = a.pos.y + 0.95;
    const th = raySphere(ox, oy, oz, dx, dy, dz, a.pos.x, headY, a.pos.z, HEAD_R);
    if (th < best) { best = th; bestHead = true; bestAgent = a; }
    const tb = raySphere(ox, oy, oz, dx, dy, dz, a.pos.x, bodyY, a.pos.z, BODY_R);
    if (tb < best) { best = tb; bestHead = false; bestAgent = a; }
  }
  if (!bestAgent) return null;
  hitRec.target = bestAgent;
  hitRec.head = bestHead;
  hitRec.dist = best;
  hitRec.point.set(ox + dx * best, oy + dy * best, oz + dz * best);
  return hitRec;
}

export function applyDamage(state, target, amount, attacker, head) {
  if (!target.alive) return false;
  target.hp -= amount;
  target.flashT = 0.12;
  target.lastDamageFrom = attacker;
  if (target.hp > 0) return false;
  target.hp = 0;
  target.alive = false;
  const atkName = attacker ? attackerName(attacker) : '—';
  state.feed.unshift({ text: atkName + '  ✕  ' + agentName(target) + (head ? '  (headshot)' : ''), t: state.time });
  if (state.feed.length > 5) state.feed.pop();
  if (attacker && attacker.isPlayer) state.kills += 1;
  if (target.isPlayer) state.deaths += 1;
  return true;
}

export function agentName(a) {
  return a.isPlayer ? 'You' : a.name;
}
export function attackerName(a) { return agentName(a); }

// Grenade flight (gravity + wall bounce) and detonation.
export function stepGrenades(world, state, dt, random) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.vy -= 18 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.12) {
      g.y = 0.12;
      g.vy = Math.abs(g.vy) * 0.35;
      g.vx *= 0.6; g.vz *= 0.6;
      g.bounced += 1;
    }
    // crude wall bounce: clamp inside bounds
    if (g.x < -23.5 || g.x > 23.5) { g.vx *= -0.4; g.x = clamp(g.x, -23.5, 23.5); }
    if (g.z < -17.5 || g.z > 17.5) { g.vz *= -0.4; g.z = clamp(g.z, -17.5, 17.5); }
    g.fuse -= dt;
    if (g.fuse > 0) continue;
    state.grenades.splice(i, 1);
    if (g.kind === 'he') {
      explode(state, g, random);
    } else {
      state.smokes.push({ x: g.x, y: 1.2, z: g.z, r: 3.4, t: 14 });
      state.events.push({ type: 'smoke', x: g.x, y: g.y, z: g.z });
    }
  }
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    state.smokes[i].t -= dt;
    if (state.smokes[i].t <= 0) state.smokes.splice(i, 1);
  }
}

function explode(state, g, random) {
  state.events.push({ type: 'explosion', x: g.x, y: g.y, z: g.z });
  for (const a of state.agents) {
    if (!a.alive) continue;
    const dx = a.pos.x - g.x, dy = (a.pos.y + 1) - g.y, dz = a.pos.z - g.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 7) continue;
    const dmg = Math.round(115 * (1 - d / 8));
    if (applyDamage(state, a, Math.max(12, dmg), g.owner, false) && g.owner && g.owner.isPlayer) {
      g.owner.money += 300;
    }
  }
}

// Visibility between two fighters (eye to chest), smoke-aware.
export function canSee(world, state, a, b) {
  return losClear(world, state.smokes,
    a.pos.x, a.pos.y + a.eyeH - 0.1, a.pos.z,
    b.pos.x, b.pos.y + 1.0, b.pos.z);
}
