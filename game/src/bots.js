// Bots: low-poly fighters and the AI that drives them. One brain per bot, a
// small state machine: spawn -> advance (waypoint route) -> hold (scan) ->
// engage (visible enemy) -> plant / defuse / retreat. Bots react to what they
// see (line of sight + reaction time) and hear (gunshots pull them to investigate).
import * as THREE from 'three';
import { PLANT_TIME, DEFUSE_TIME } from './state.js';
import { mulberry32 } from './util.js';
import { nearestWaypoint, findPath } from './world.js';
import { canSee } from './combat.js';
import { startReload, giveWeapon } from './weapons.js';

const REACT_MIN = 0.35;
const REACT_MAX = 0.85;

export function makeBotBrain(seed, role) {
  return {
    role, // 'atk' rushes sites, 'def' holds near a site
    state: 'spawn',
    path: [],
    pathI: 0,
    holdT: 0,
    holdNode: -1,
    target: null,
    reactT: 0,
    aimErr: 0,
    strafeDir: 1,
    strafeT: 0,
    investigate: null, // {x, z, t}
    plantT: 0,
    defuseT: 0,
    siteKey: null,
    planT: 0, // replan cooldown
    random: mulberry32(seed),
  };
}

// Build a bot's low-poly body: torso, head, legs, gun. Team-coloured.
export function buildBotMesh(scene, team) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: team === 'atk' ? 0xc96a2e : 0x2e7f8a, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), suit);
  torso.position.y = 1.15;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.4), dark);
  vest.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skin);
  head.position.y = 1.68;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  helmet.position.y = 1.7;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.26), dark);
  legL.position.set(-0.16, 0.39, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7), dark);
  gun.position.set(0.25, 1.25, -0.35);
  g.add(torso, vest, head, helmet, legL, legR, gun);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  g.userData.legs = [legL, legR];
  scene.add(g);
  return g;
}

function pickSite(brain, state) {
  // attackers split between A and B; defenders guard the nearer site
  return brain.random() < 0.5 ? 'A' : 'B';
}

function setPath(bot, world, toNode) {
  const from = nearestWaypoint(world, bot.pos.x, bot.pos.z);
  bot.bot.path = findPath(world, from, toNode);
  bot.bot.pathI = 0;
}

function nodeForSite(world, key) {
  const s = world.sites[key];
  return nearestWaypoint(world, s.x, s.z);
}

// Choose where this bot wants to go right now.
function chooseGoal(bot, world, state) {
  const brain = bot.bot;
  const bomb = state.bomb;
  if (bot.team === 'atk') {
    if (bomb.state === 'planted') {
      // fall back and hold a defensive angle near the planted site
      brain.siteKey = bomb.site;
      return { node: nodeForSite(world, bomb.site), mode: 'hold', hold: 6 + brain.random() * 6 };
    }
    if (bot.hasBomb) {
      brain.siteKey = brain.siteKey || state.atkSite;
      return { node: nodeForSite(world, brain.siteKey), mode: 'plant' };
    }
    if (bomb.state === 'dropped') {
      return { node: nearestWaypoint(world, bomb.x, bomb.z), mode: 'pickup' };
    }
    if (!brain.siteKey) brain.siteKey = state.atkSite;
    return { node: nodeForSite(world, brain.siteKey), mode: 'advance' };
  }
  // defenders
  if (bomb.state === 'planted') {
    brain.siteKey = bomb.site;
    return { node: nodeForSite(world, bomb.site), mode: 'defuse' };
  }
  if (!brain.siteKey) brain.siteKey = pickSite(brain, state);
  return { node: nodeForSite(world, brain.siteKey), mode: 'hold', hold: 8 + brain.random() * 8 };
}

// Step one bot for one fixed tick. Returns a fire request when it shoots.
export function stepBot(bot, world, state, mover, dt) {
  const brain = bot.bot;
  if (!bot.alive) return null;
  brain.planT -= dt;

  // --- perception: nearest visible living enemy ---
  let seen = null;
  let seenD = Infinity;
  for (const a of state.agents) {
    if (a.team === bot.team || !a.alive) continue;
    const d = Math.hypot(a.pos.x - bot.pos.x, a.pos.z - bot.pos.z);
    if (d < seenD && d < 55 && canSee(world, state, bot, a)) { seen = a; seenD = d; }
  }
  if (seen && brain.target !== seen) {
    brain.target = seen;
    brain.reactT = REACT_MIN + brain.random() * (REACT_MAX - REACT_MIN);
    brain.aimErr = 0.02 + brain.random() * 0.05;
  }
  if (!seen) brain.target = null;

  // hearing: a recent gunshot nearby becomes an investigate point
  if (brain.investigate && state.time - brain.investigate.t > 6) brain.investigate = null;

  const wantFire = brain.target && brain.reactT <= 0;
  if (brain.reactT > 0) brain.reactT -= dt;

  // --- bomb actions ---
  const bomb = state.bomb;
  if (bot.team === 'def' && bomb.state === 'planted') {
    const d = Math.hypot(bomb.x - bot.pos.x, bomb.z - bot.pos.z);
    // Defuse when no enemy is in sight — or when the fuse is nearly out, in
    // which case the defender takes the risk and defuses under fire.
    if (d < 1.6 && (!brain.target || bomb.fuse < 8)) {
      brain.defuseT += dt;
      if (brain.defuseT >= DEFUSE_TIME) {
        brain.defuseT = 0;
        return { type: 'defused' };
      }
      mover.step(dt, { x: 0, z: 0 }, false);
      return wantFire ? { type: 'fire', target: brain.target } : null;
    }
    brain.defuseT = 0;
  }
  if (bot.team === 'atk' && bot.hasBomb && brain.state === 'plant') {
    const s = world.sites[brain.siteKey];
    const d = Math.hypot(s.x - bot.pos.x, s.z - bot.pos.z);
    if (d < s.r && !brain.target) {
      brain.plantT += dt;
      if (brain.plantT >= PLANT_TIME) {
        brain.plantT = 0;
        return { type: 'planted', site: brain.siteKey };
      }
      mover.step(dt, { x: 0, z: 0 }, false);
      return null;
    }
    brain.plantT = 0;
  }
  if (bomb.state === 'dropped' && bot.team === 'atk') {
    const d = Math.hypot(bomb.x - bot.pos.x, bomb.z - bot.pos.z);
    if (d < 1.0) {
      bot.hasBomb = true;
      bomb.state = 'carry';
      bomb.carrier = bot;
      brain.siteKey = null;
    }
  }

  // --- movement ---
  let wish = { x: 0, z: 0 };
  if (brain.target) {
    // engage: strafe sideways, keep facing the enemy, crouch sometimes
    brain.strafeT -= dt;
    if (brain.strafeT <= 0) { brain.strafeDir *= -1; brain.strafeT = 0.7 + brain.random() * 1.2; }
    const tx = brain.target.pos.x - bot.pos.x;
    const tz = brain.target.pos.z - bot.pos.z;
    const len = Math.hypot(tx, tz) || 1;
    // face the target, strafe perpendicular, close in if far
    bot.yaw = Math.atan2(-tx, -tz);
    const px = -tz / len * brain.strafeDir;
    const pz = tx / len * brain.strafeDir;
    const close = seenD > 14 ? 0.7 : 0;
    wish = { x: px * 0.8 - (tx / len) * close, z: pz * 0.8 - (tz / len) * close };
    mover.step(dt, wish, seenD > 18 && brain.random() < 0.002);
  } else {
    if (brain.planT <= 0 || brain.state === 'spawn') {
      const goal = chooseGoal(bot, world, state);
      brain.state = goal.mode === 'hold' ? 'hold' : 'advance';
      brain.holdT = goal.hold || 0;
      brain.mode = goal.mode;
      setPath(bot, world, goal.node);
      brain.planT = 2.5;
    }
    if (brain.state === 'hold') {
      brain.holdT -= dt;
      // scan: slow yaw sweep
      bot.yaw += Math.sin(state.time * 0.5 + bot.id) * dt * 0.4;
      if (brain.holdT <= 0) { brain.planT = 0; brain.state = 'advance'; }
    } else if (brain.path.length > 0) {
      const node = world.waypoints[brain.path[brain.pathI]];
      const dx = node[0] - bot.pos.x;
      const dz = node[1] - bot.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) {
        brain.pathI += 1;
        if (brain.pathI >= brain.path.length) {
          brain.state = brain.mode === 'plant' ? 'plant' : 'hold';
          brain.holdT = brain.mode === 'plant' ? 0.5 : 3 + brain.random() * 4;
        }
      } else {
        wish = { x: dx / d, z: dz / d };
        bot.yaw = Math.atan2(-dx, -dz);
      }
    }
    mover.step(dt, wish, false);
  }

  // reload when dry and not in a fight
  if (bot.mag === 0 && !brain.target) startReload(bot);

  if (wantFire && brain.target) {
    return { type: 'fire', target: brain.target };
  }
  return null;
}

// Aim a bot's shot: direction from its eye toward the target with error that
// shrinks as it stands still and grows with distance.
export function botAim(bot, target, random) {
  const dx = target.pos.x - bot.pos.x;
  const dy = (target.pos.y + 1.0) - (bot.pos.y + bot.eyeH);
  const dz = target.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const err = bot.bot.aimErr * (0.5 + dist / 40) * (bot.bot.state === 'hold' ? 0.7 : 1);
  return {
    x: dx / dist + (random() * 2 - 1) * err,
    y: dy / dist + (random() * 2 - 1) * err,
    z: dz / dist + (random() * 2 - 1) * err,
  };
}

// Give bots their buy-phase loadout by budget, like a player would.
export function botBuy(bot, state, random) {
  const budget = 800 + state.round * 700 + (bot.team === 'atk' ? 300 : 0);
  bot.money = budget;
  if (budget >= 2700 && random() < 0.7) giveWeapon(bot, 'ar77');
  else if (budget >= 1500) giveWeapon(bot, 'vk9');
  else giveWeapon(bot, 'p9');
}

export function botNames(team) {
  return team === 'atk' ? ['Rook', 'Havoc'] : ['Wren', 'Bishop', 'Sable'];
}
