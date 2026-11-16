// Player movement: acceleration, friction, crouch, and AABB collision.
// One fixed-step call per tick; the same routine drives bots through their
// steering input, so movement rules are identical for everyone.
import * as THREE from 'three';
import { clamp } from './util.js';
import { collideCircle } from './world.js';

const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.6;
const ACCEL = 55;
const FRICTION = 12;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.08;

export function createPlayer(world, agent) {
  const a = agent;
  return {
    agent: a,
    groundSpeed() {
      return Math.hypot(a.vel.x, a.vel.z);
    },
    // wish: {x, z} unit wish direction in world space; crouch: bool
    step(dt, wish, crouch) {
      a.crouch = crouch;
      const targetEye = crouch ? EYE_CROUCH : EYE_STAND;
      a.eyeH += (targetEye - a.eyeH) * Math.min(1, dt * 14);
      const maxSpeed = crouch ? CROUCH_SPEED : WALK_SPEED;
      const wx = wish.x * maxSpeed;
      const wz = wish.z * maxSpeed;
      // accelerate toward the wish velocity, friction when no input
      a.vel.x += (wx - a.vel.x) * Math.min(1, (wish.x || wish.z ? ACCEL : FRICTION) * dt / maxSpeed * 8);
      a.vel.z += (wz - a.vel.z) * Math.min(1, (wish.x || wish.z ? ACCEL : FRICTION) * dt / maxSpeed * 8);
      a.pos.x += a.vel.x * dt;
      a.pos.z += a.vel.z * dt;
      collideCircle(world, a.pos, a.radius);
    },
    look(dx, dy, sens) {
      a.yaw -= dx * sens;
      a.pitch = clamp(a.pitch - dy * sens, -1.53, 1.53);
    },
    recoil(pitchKick, yawKick) {
      a.pitch = clamp(a.pitch + pitchKick, -1.53, 1.53);
      a.yaw += yawKick;
    },
    // world-space wish direction from forward/strafe keys and current yaw
    wishFromKeys(keys) {
      let f = 0, s = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
      const sin = Math.sin(a.yaw), cos = Math.cos(a.yaw);
      // forward is -z rotated by yaw
      let x = -sin * f + cos * s;
      let z = -cos * f - sin * s;
      const len = Math.hypot(x, z);
      if (len > 0) { x /= len; z /= len; }
      return { x, z };
    },
  };
}

// Build the low-poly viewmodel gun attached to the camera.
export function createViewmodel(camera, color) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.4);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), accent);
  grip.position.set(0, -0.12, 0.12);
  grip.rotation.x = 0.3;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.1), dark);
  mag.position.set(0, -0.12, -0.05);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
  sight.position.set(0, 0.09, -0.1);
  g.add(body, barrel, grip, mag, sight);
  g.position.set(0.28, -0.24, -0.45);
  camera.add(g);
  return g;
}
