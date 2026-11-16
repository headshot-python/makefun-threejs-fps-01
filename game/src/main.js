// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. Rounds, money, the bomb objective and the HUD all live here;
// movement, bots, weapons and combat live in their own modules.
//
// ?shot=menu|combat|bomb with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
// ?auto=1 starts a round without pointer lock (headless play-test hook).
import * as THREE from 'three';
import {
  makeState, makeAgent, resetAgentForRound, STEP, ROUND_TIME, BUY_TIME,
  PLANT_TIME, DEFUSE_TIME, BOMB_FUSE, WIN_ROUNDS, MAX_ROUNDS, WEAPONS,
} from './state.js';
import { mulberry32, clamp, V1, V2 } from './util.js';
import { createWorld, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer, createViewmodel } from './player.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { ensureAudio, sfx } from './audio.js';
import { makeBotBrain, buildBotMesh, stepBot, botAim, botBuy, botNames } from './bots.js';
import { fireWeapon, startReload, stepWeapon, currentSpread, buy, giveWeapon, throwGrenade, weaponDef } from './weapons.js';
import { shootPellet, applyDamage, stepGrenades } from './combat.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const auto = params.get('auto') === '1';
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const state = makeState();
state.seed = seed;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x232c38);
scene.fog = new THREE.Fog(0x232c38, 30, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const playerAgent = makeAgent(0, 'atk', true, 0, 16, 0);
playerAgent.name = 'You';
const bots = [];
const namesAtk = botNames('atk');
const namesDef = botNames('def');
for (let i = 0; i < 2; i++) {
  const b = makeAgent(1 + i, 'atk', false, 0, 16, 0);
  b.name = namesAtk[i];
  b.bot = makeBotBrain(seed + 11 + i, 'atk');
  b.mesh = buildBotMesh(scene, 'atk');
  bots.push(b);
}
for (let i = 0; i < 3; i++) {
  const b = makeAgent(3 + i, 'def', false, 0, -16, Math.PI);
  b.name = namesDef[i];
  b.bot = makeBotBrain(seed + 31 + i, 'def');
  b.mesh = buildBotMesh(scene, 'def');
  bots.push(b);
}
state.agents = [playerAgent, ...bots];

const movers = new Map();
for (const a of state.agents) movers.set(a, createPlayer(world, a));
const viewmodel = createViewmodel(camera, 0xc96a2e);
const hud = createHud(onBuy, onPlay);
const input = createInput(renderer.domElement, onLockChange);

// Player loadout: primary + pistol, ammo stashed per weapon when switching.
const loadout = { primary: 'p9', stash: {} };
let playerPlantT = 0;
let playerDefuseT = 0;
let zoomed = false;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let beepT = 0;

function onPlay() {
  ensureAudio();
  if (shot) return;
  if (state.phase === 'matchEnd') { startMatch(); return; }
  if (state.phase === 'menu') { startMatch(); return; }
  input.requestLock();
}

function onBuy(id) {
  if (state.phase !== 'buy') return;
  const msg = buy(playerAgent, id, state);
  if (msg.endsWith('bought.') || msg.endsWith('equipped.')) {
    sfx.buy();
    if (WEAPONS[id] && id !== 'p9') loadout.primary = id;
    syncLoadout();
  } else {
    sfx.denied();
  }
  hud.message(msg, 2);
  hud.setMoney(playerAgent.money);
  hud.setAmmo(playerAgent.mag, playerAgent.reserve, weaponDef(playerAgent).name, playerAgent.he, playerAgent.smoke);
}

function syncLoadout() {
  hud.setAmmo(playerAgent.mag, playerAgent.reserve, weaponDef(playerAgent).name, playerAgent.he, playerAgent.smoke);
}

function switchTo(id) {
  if (playerAgent.weapon === id || playerAgent.reloadT > 0) return;
  const cur = playerAgent.weapon;
  loadout.stash[cur] = { mag: playerAgent.mag, reserve: playerAgent.reserve };
  const saved = loadout.stash[id];
  if (saved) {
    playerAgent.weapon = id;
    playerAgent.mag = saved.mag;
    playerAgent.reserve = saved.reserve;
  } else {
    giveWeapon(playerAgent, id);
  }
  syncLoadout();
}

function onLockChange(locked) {
  if (shot || auto) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (state.phase === 'menu') startMatch();
  } else if (state.phase === 'live' || state.phase === 'buy') {
    hud.showOverlay('paused', 'Paused', 'Vanguard vs Sentinel — first to ' + WIN_ROUNDS + ' rounds takes the yard.', 'Resume');
  }
}

function startMatch() {
  state.score = { atk: 0, def: 0 };
  state.round = 1;
  state.kills = 0;
  state.deaths = 0;
  playerAgent.money = 800;
  loadout.primary = 'p9';
  loadout.stash = {};
  giveWeapon(playerAgent, 'p9');
  startRound();
}

function startRound() {
  state.grenades.length = 0;
  state.smokes.length = 0;
  state.feed.length = 0;
  state.bomb = { state: 'carry', x: 0, y: 0, z: 0, fuse: 0, carrier: playerAgent, planter: null, site: null };
  playerPlantT = 0;
  playerDefuseT = 0;
  // place fighters on their spawns
  const atkSpawns = SPAWNS.atk;
  const defSpawns = SPAWNS.def;
  resetAgentForRound(playerAgent, atkSpawns[0][0], atkSpawns[0][1], 0);
  playerAgent.hasBomb = true;
  playerAgent.he = 0;
  playerAgent.smoke = 0;
  let ai = 0;
  for (const b of bots) {
    if (b.team === 'atk') {
      const s = atkSpawns[1 + ai];
      resetAgentForRound(b, s[0], s[1], 0);
      ai += 1;
    } else {
      const s = defSpawns[b.id - 3];
      resetAgentForRound(b, s[0], s[1], Math.PI);
    }
    b.he = 0; b.smoke = 0;
    botBuy(b, state, random);
    b.mesh.visible = true;
  }
  state.phase = 'buy';
  state.phaseT = BUY_TIME;
  state.atkSite = random() < 0.5 ? 'A' : 'B';
  hud.showBuy(true);
  hud.message('Buy phase — spend your ' + '$' + playerAgent.money + ' (B to toggle menu)', 3);
  hud.setScore(state.score.atk, state.score.def, state.round);
  hud.setMoney(playerAgent.money);
  syncLoadout();
  updateBotMeshes();
}

function goLive() {
  state.phase = 'live';
  state.phaseT = ROUND_TIME;
  hud.showBuy(false);
  hud.message('Round ' + state.round + ' — plant the bomb at A or B', 3);
}

function awardMoney(winner) {
  for (const a of state.agents) {
    const won = a.team === winner;
    a.money += won ? 3250 : 1900;
  }
  playerAgent.money = Math.max(0, playerAgent.money);
}

function endRound(winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd';
  state.phaseT = 4;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner] += 1;
  awardMoney(winner);
  const won = winner === 'atk';
  hud.message((won ? 'Vanguard win — ' : 'Sentinel win — ') + reason, 4);
  hud.setScore(state.score.atk, state.score.def, state.round);
  hud.setMoney(playerAgent.money);
  if (won) sfx.roundWin(); else sfx.roundLose();
}

function endMatch() {
  state.phase = 'matchEnd';
  const atk = state.score.atk, def = state.score.def;
  state.matchWinner = atk === def ? 'draw' : atk > def ? 'atk' : 'def';
  const title = state.matchWinner === 'draw' ? 'Draw' : state.matchWinner === 'atk' ? 'Vanguard take the yard!' : 'Sentinels hold the yard.';
  hud.showOverlay('end', title, 'Final score Vanguard ' + atk + ' — ' + def + ' Sentinel. Kills: ' + state.kills + ', deaths: ' + state.deaths + '.', 'Play again');
  if (document.pointerLockElement) document.exitPointerLock();
}

function nextAfterRound() {
  if (state.score.atk >= WIN_ROUNDS || state.score.def >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
    endMatch();
    return;
  }
  state.round += 1;
  startRound();
}

function plantBomb(agent, siteKey) {
  const s = world.sites[siteKey];
  state.bomb = { state: 'planted', x: s.x, y: 0, z: s.z, fuse: BOMB_FUSE, carrier: null, planter: agent, site: siteKey };
  agent.hasBomb = false;
  agent.money += 300;
  hud.message('Bomb planted at site ' + siteKey + '!', 4);
  sfx.plant();
  state.feed.unshift({ text: agentName(agent) + ' planted the bomb', t: state.time });
}

function defuseBomb(agent) {
  state.bomb = { state: 'defused', x: 0, y: 0, z: 0, fuse: 0, carrier: null, planter: null, site: null };
  agent.money += 300;
  hud.message('Bomb defused!', 4);
  sfx.plant();
  endRound('def', 'Bomb defused');
}

function agentName(a) { return a.isPlayer ? 'You' : a.name; }

function dropBomb(agent) {
  if (!agent.hasBomb) return;
  agent.hasBomb = false;
  state.bomb = { state: 'dropped', x: agent.pos.x, y: 0, z: agent.pos.z, fuse: 0, carrier: null, planter: null, site: null };
  hud.message('Bomb dropped!', 3);
}

// One hitscan shot from `shooter` along `dir` (a Vector3-like). Handles pellets,
// damage, tracers, hitmarkers and sound. `isPlayerShot` gates HUD feedback.
function resolveShot(shooter, dir, spread, isPlayerShot) {
  const w = weaponDef(shooter);
  const ox = shooter.pos.x;
  const oy = shooter.pos.y + shooter.eyeH;
  const oz = shooter.pos.z;
  for (let p = 0; p < w.pellets; p++) {
    const hit = shootPellet(world, state, shooter, dir, spread, random);
    const end = V2;
    if (hit) {
      end.set(hit.point.x, hit.point.y, hit.point.z);
      const dmg = Math.round(w.damage * (hit.head ? w.headMult : 1));
      const killed = applyDamage(state, hit.target, dmg, shooter, hit.head);
      if (killed && shooter.isPlayer) { shooter.money += 300; sfx.kill(); }
      if (isPlayerShot) {
        hud.hitMarker(hit.head, 120);
        sfx.hit(hit.head);
        state.stats.hits += 1;
        if (hit.head) state.stats.headshots += 1;
      } else if (hit.target.isPlayer) {
        hud.damageFlash();
        sfx.hurt();
      }
      if (hit.target === playerAgent && !playerAgent.alive) dropBomb(playerAgent);
      if (hit.target.hasBomb && !hit.target.alive) dropBomb(hit.target);
      effects.spark(hit.point.x, hit.point.y, hit.point.z);
    } else {
      // wall or thin air: tracer runs to wall distance along the shot
      V1.set(dir.x, dir.y, dir.z).multiplyScalar(40);
      end.set(ox + V1.x, oy + V1.y, oz + V1.z);
    }
    effects.tracer(ox, oy - 0.12, oz, end.x, end.y, end.z);
  }
  if (isPlayerShot) state.stats.shots += 1;
  // gunfire is heard: nearby bots investigate the shooter's position
  for (const b of bots) {
    if (!b.alive || b === shooter) continue;
    const d = Math.hypot(b.pos.x - shooter.pos.x, b.pos.z - shooter.pos.z);
    if (d < 28) b.bot.investigate = { x: shooter.pos.x, z: shooter.pos.z, t: state.time };
  }
}

function playerShoot() {
  const w = fireWeapon(playerAgent);
  if (!w) {
    if (playerAgent.mag === 0 && playerAgent.fireT <= 0 && playerAgent.reloadT <= 0) sfx.dry();
    return;
  }
  camera.getWorldDirection(V1);
  resolveShot(playerAgent, V1, currentSpread(playerAgent, movers.get(playerAgent).groundSpeed()), true);
  const mover = movers.get(playerAgent);
  mover.recoil(w.kick + random() * 0.004, (random() * 2 - 1) * 0.003);
  sfx.shot(w.kind);
  viewmodel.position.z = -0.45 + 0.06;
}

function botShoot(bot, target) {
  const w = fireWeapon(bot);
  if (!w) return;
  const dir = botAim(bot, target, random);
  resolveShot(bot, dir, 0, false);
  if (bot.pos.distanceTo(playerAgent.pos) < 42) sfx.distantShot();
}

function updateBotMeshes() {
  for (const b of bots) {
    if (!b.mesh) continue;
    b.mesh.visible = b.alive;
    if (!b.alive) continue;
    b.mesh.position.copy(b.pos);
    b.mesh.rotation.y = b.yaw;
    // simple walk cycle on the legs
    const speed = Math.hypot(b.vel.x, b.vel.z);
    const swing = Math.sin(state.time * 10) * clamp(speed / 5, 0, 1) * 0.5;
    b.mesh.userData.legs[0].rotation.x = swing;
    b.mesh.userData.legs[1].rotation.x = -swing;
    // damage flash
    const flash = b.flashT > 0;
    b.mesh.traverse((o) => {
      if (o.isMesh && o.material.emissive) o.material.emissive.setHex(flash ? 0x992222 : 0x000000);
    });
  }
}

function syncHud() {
  hud.setHealth(playerAgent.hp);
  hud.setAmmo(playerAgent.mag, playerAgent.reserve, weaponDef(playerAgent).name, playerAgent.he, playerAgent.smoke);
  hud.setMoney(playerAgent.money);
  hud.setTimer(state.phaseT, state.phase === 'buy' ? 'BUY' : state.phase === 'live' ? 'ROUND' : '—');
  hud.setScore(state.score.atk, state.score.def, state.round);
  let atkAlive = 0, defAlive = 0;
  for (const a of state.agents) {
    if (!a.alive) continue;
    if (a.team === 'atk') atkAlive += 1; else defAlive += 1;
  }
  hud.setTeams(atkAlive, 3, defAlive, 3);
  hud.setFeed(state.feed);
  hud.setCrosshair(currentSpread(playerAgent, movers.get(playerAgent).groundSpeed()));
  const b = state.bomb;
  hud.setBomb(
    b.state === 'planted' ? 'BOMB PLANTED @ ' + b.site + ' — ' + Math.ceil(b.fuse) + 's'
    : b.state === 'dropped' ? 'BOMB DROPPED — recover it'
    : b.state === 'carry' && playerAgent.hasBomb ? 'YOU CARRY THE BOMB — plant at A or B (hold E)'
    : b.state === 'carry' ? 'A teammate carries the bomb'
    : '—',
  );
}

function step(dt) {
  state.time += dt;
  // phase timers
  if (state.phase === 'buy') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) goLive();
  } else if (state.phase === 'live') {
    state.phaseT -= dt;
    if (state.bomb.state === 'planted') {
      state.bomb.fuse -= dt;
      beepT -= dt;
      if (beepT <= 0) { beepT = state.bomb.fuse < 10 ? 0.5 : 1.0; sfx.beep(); }
      if (state.bomb.fuse <= 0) {
        effects.explosion(state.bomb.x, 0.4, state.bomb.z);
        sfx.explosion();
        endRound('atk', 'Bomb detonated at site ' + state.bomb.site);
      }
    } else if (state.phaseT <= 0) {
      endRound('def', 'Time expired — bomb never planted');
    }
  } else if (state.phase === 'roundEnd') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) nextAfterRound();
  }

  // player movement (frozen only in menu / match end)
  const mover = movers.get(playerAgent);
  const keys = input.state.keys;
  if (state.phase === 'buy' || state.phase === 'live') {
    const look = input.takeLook();
    const sens = zoomed ? 0.0011 : 0.0021;
    mover.look(look.x, look.y, sens);
    const crouch = keys.has('ControlLeft') || keys.has('KeyC');
    mover.step(dt, mover.wishFromKeys(keys), crouch);
    // buy-menu hotkeys
    if (state.phase === 'buy') {
      const buyKeys = ['ar77', 'vk9', 'm590', 'lr50', 'he', 'smoke'];
      for (let i = 0; i < buyKeys.length; i++) {
        if (keys.has('Digit' + (i + 1))) { onBuy(buyKeys[i]); keys.delete('Digit' + (i + 1)); }
      }
    }
    if (keys.has('KeyB') && state.phase === 'buy') {
      const menu = document.getElementById('buy-menu');
      menu.hidden = !menu.hidden;
      keys.delete('KeyB');
    }
    // weapon slots
    if (keys.has('Digit1')) { switchTo(loadout.primary); keys.delete('Digit1'); }
    if (keys.has('Digit2')) { switchTo('p9'); keys.delete('Digit2'); }
    if (keys.has('Digit4') && playerAgent.he > 0 && state.phase === 'live') { throwGrenade(state, playerAgent, 'he', random); keys.delete('Digit4'); }
    if (keys.has('Digit5') && playerAgent.smoke > 0 && state.phase === 'live') { throwGrenade(state, playerAgent, 'smoke', random); keys.delete('Digit5'); }
    if (keys.has('KeyR')) startReload(playerAgent);
    // fire (live rounds only)
    if (state.phase === 'live') {
      const w = weaponDef(playerAgent);
      if (w.auto ? input.state.firing : input.takeFireEdge()) playerShoot();
    } else {
      input.takeFireEdge();
    }
    // zoom (sniper only)
    const wantZoom = input.state.zoomHeld && playerAgent.weapon === 'lr50';
    if (wantZoom !== zoomed) {
      zoomed = wantZoom;
      camera.fov = zoomed ? 30 : 74;
      camera.updateProjectionMatrix();
    }
    // plant / defuse progress while E is held (live rounds only)
    const holdingE = keys.has('KeyE') && state.phase === 'live';
    if (holdingE && playerAgent.alive) {
      if (playerAgent.hasBomb && state.bomb.state === 'carry') {
        const siteKey = nearSite(playerAgent);
        if (siteKey) {
          playerPlantT += dt;
          hud.setPlant(playerPlantT / PLANT_TIME, 'Planting bomb…');
          if (playerPlantT >= PLANT_TIME) { playerPlantT = 0; hud.setPlant(null); plantBomb(playerAgent, siteKey); }
        } else { playerPlantT = 0; hud.setPlant(null); }
      } else if (state.bomb.state === 'planted' && playerAgent.team === 'def') {
        const d = Math.hypot(state.bomb.x - playerAgent.pos.x, state.bomb.z - playerAgent.pos.z);
        if (d < 1.8) {
          playerDefuseT += dt;
          hud.setPlant(playerDefuseT / DEFUSE_TIME, 'Defusing bomb…');
          if (playerDefuseT >= DEFUSE_TIME) { playerDefuseT = 0; hud.setPlant(null); defuseBomb(playerAgent); }
        } else { playerDefuseT = 0; hud.setPlant(null); }
      } else { playerPlantT = 0; playerDefuseT = 0; hud.setPlant(null); }
    } else {
      playerPlantT = 0;
      playerDefuseT = 0;
      hud.setPlant(null);
    }
    // pick up a dropped bomb by walking over it
    if (state.bomb.state === 'dropped' && playerAgent.team === 'atk') {
      const d = Math.hypot(state.bomb.x - playerAgent.pos.x, state.bomb.z - playerAgent.pos.z);
      if (d < 1.0) {
        playerAgent.hasBomb = true;
        state.bomb = { state: 'carry', x: 0, y: 0, z: 0, fuse: 0, carrier: playerAgent, planter: null, site: null };
        hud.message('Bomb recovered', 2);
      }
    }
  }
  stepWeapon(playerAgent, dt);

  // bots: only fight once the round is live; during buy they hold at spawn
  if (state.phase === 'live') {
    for (const b of bots) {
      if (!b.alive) continue;
      stepWeapon(b, dt);
      if (b.flashT > 0) b.flashT -= dt;
      const action = stepBot(b, world, state, movers.get(b), dt);
      if (!action) continue;
      if (action.type === 'fire') botShoot(b, action.target);
      else if (action.type === 'planted') plantBomb(b, action.site);
      else if (action.type === 'defused') defuseBomb(b);
    }
  }

  // grenades + bomb beacons
  stepGrenades(world, state, dt, random);
  // a carrier killed by a grenade drops the bomb where they fell
  if (state.bomb.state === 'carry' && state.bomb.carrier && !state.bomb.carrier.alive) {
    dropBomb(state.bomb.carrier);
  }
  for (const e of state.events) {
    if (e.type === 'explosion') { effects.explosion(e.x, e.y, e.z); sfx.explosion(); }
  }
  state.events.length = 0;

  // round end by elimination (only while live)
  if (state.phase === 'live') {
    let atkAlive = 0, defAlive = 0;
    for (const a of state.agents) {
      if (!a.alive) continue;
      if (a.team === 'atk') atkAlive += 1; else defAlive += 1;
    }
    if (atkAlive === 0) endRound('def', 'Vanguard eliminated');
    else if (defAlive === 0) endRound('atk', 'Sentinels eliminated');
  }

  // camera follows the player (or stays where they fell)
  camera.position.set(playerAgent.pos.x, playerAgent.pos.y + playerAgent.eyeH, playerAgent.pos.z);
  camera.rotation.set(playerAgent.pitch, playerAgent.yaw, 0, 'YXZ');
  // viewmodel kick recovery
  viewmodel.position.z += (-0.45 - viewmodel.position.z) * Math.min(1, dt * 10);
  effects.step(dt, state.smokes, state.bomb);
  updateBotMeshes();
}

function nearSite(a) {
  for (const [key, s] of Object.entries(world.sites)) {
    if (Math.hypot(s.x - a.pos.x, s.z - a.pos.z) < s.r) return key;
  }
  return null;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      step(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (accumulator > STEP * 5) accumulator = 0;
    syncHud();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i++) step(STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  startMatch();
  if (name === 'menu') {
    // buy phase at the attacker spawn, looking up the mid lane
    playerAgent.money = 4000;
    hud.setMoney(4000);
    hud.showBuy(true);
    hud.message('Buy phase — spend your $4,000 (B to toggle menu)', 3);
    playerAgent.pos.set(0, 0, 15.5);
    playerAgent.yaw = 0;
    playerAgent.pitch = 0;
    settle(10);
  } else if (name === 'combat') {
    goLive();
    playerAgent.pos.set(0, 0, 10);
    playerAgent.yaw = 0.27;
    playerAgent.pitch = 0.01;
    giveWeapon(playerAgent, 'ar77');
    loadout.primary = 'ar77';
    // two defenders in the open lane ahead (south of the mid container), one
    // further back — a clear line of fire, no cover between us and them
    const d0 = bots[2];
    d0.pos.set(-1.5, 0, 4.5);
    d0.yaw = Math.PI;
    const d1 = bots[3];
    d1.pos.set(3.5, 0, 2.5);
    d1.yaw = Math.PI;
    const d2 = bots[4];
    d2.pos.set(-6, 0, -8);
    settle(8);
    // fire a burst at the nearest defender so the frame shows a tracer + hitmarker
    camera.position.set(playerAgent.pos.x, playerAgent.pos.y + playerAgent.eyeH, playerAgent.pos.z);
    camera.rotation.set(playerAgent.pitch, playerAgent.yaw, 0, 'YXZ');
    camera.getWorldDirection(V1);
    const aim = { x: d0.pos.x - playerAgent.pos.x, y: 1.1 - playerAgent.eyeH, z: d0.pos.z - playerAgent.pos.z };
    const len = Math.hypot(aim.x, aim.y, aim.z);
    aim.x /= len; aim.y /= len; aim.z /= len;
    playerAgent.mag = 30;
    fireWeapon(playerAgent);
    resolveShot(playerAgent, aim, 0, true);
    settle(4);
    hud.setHealth(playerAgent.hp);
  } else if (name === 'bomb') {
    goLive();
    plantBomb(playerAgent, 'A');
    state.bomb.fuse = 27;
    playerAgent.pos.set(-13.5, 0, -4.5);
    playerAgent.yaw = 0.62;
    playerAgent.pitch = 0.02;
    giveWeapon(playerAgent, 'vk9');
    loadout.primary = 'vk9';
    const d0 = bots[2];
    d0.pos.set(-15, 0, -13);
    d0.yaw = 0.4;
    settle(12);
  }
  syncHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Headless validation hook: live state for an outside checker.
window.__game = {
  get phase() { return state.phase; },
  get round() { return state.round; },
  get score() { return { atk: state.score.atk, def: state.score.def }; },
  get playerHp() { return playerAgent.hp; },
  get playerMoney() { return playerAgent.money; },
  get alive() { return state.agents.filter((a) => a.alive).length; },
  get bombState() { return state.bomb.state; },
  get kills() { return state.kills; },
  get agents() {
    return state.agents.map((a) => ({ name: a.name, team: a.team, hp: a.hp, alive: a.alive, x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1) }));
  },
};

if (shot) {
  runShot(shot);
} else {
  hud.showOverlay('start', 'KESTREL YARD', 'Vanguard vs Sentinel — first to ' + WIN_ROUNDS + ' rounds takes the yard. Plant the bomb at A or B, or eliminate the Sentinels.', 'Click to play');
  if (auto) {
    ensureAudio();
    startMatch();
    hud.hideOverlay();
    started = true;
  }
  requestAnimationFrame(frame);
}
