// Effects: tracers, muzzle flashes, impact sparks, explosion and smoke
// visuals. Everything is pooled — a fixed set of meshes reused forever, so
// firing never allocates.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_SPARKS = 40;

export function createEffects(scene) {
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 });
  for (let i = 0; i < MAX_TRACERS; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat);
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, t: 0 });
  }
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.06, 6, 5);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  for (let i = 0; i < MAX_SPARKS; i++) {
    const m = new THREE.Mesh(sparkGeo, sparkMat);
    m.visible = false;
    scene.add(m);
    sparks.push({ mesh: m, t: 0, vx: 0, vy: 0, vz: 0 });
  }
  // explosion flash: one expanding sphere, reused
  const boom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff9a3d, transparent: true, opacity: 0 }),
  );
  boom.visible = false;
  scene.add(boom);
  const boomState = { t: 0 };
  // smoke puffs: one shared material, a fixed set of billboards
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.55, depthWrite: false });
  const smokeGeo = new THREE.SphereGeometry(1, 10, 8);
  const puffs = [];
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(smokeGeo, smokeMat);
    m.visible = false;
    scene.add(m);
    puffs.push(m);
  }
  // bomb light: blinking red sphere shown while the bomb is planted
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
  );
  bombLight.visible = false;
  scene.add(bombLight);

  let tracerI = 0;
  let sparkI = 0;

  return {
    tracer(x1, y1, z1, x2, y2, z2) {
      const t = tracers[tracerI];
      tracerI = (tracerI + 1) % MAX_TRACERS;
      const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
      const len = Math.hypot(dx, dy, dz) || 1;
      t.mesh.visible = true;
      t.mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
      t.mesh.lookAt(x2, y2, z2);
      t.mesh.scale.set(1, 1, len);
      t.t = 0.07;
    },
    spark(x, y, z) {
      for (let n = 0; n < 4; n++) {
        const s = sparks[sparkI];
        sparkI = (sparkI + 1) % MAX_SPARKS;
        s.mesh.visible = true;
        s.mesh.position.set(x, y, z);
        s.vx = (Math.random() - 0.5) * 6;
        s.vy = Math.random() * 4;
        s.vz = (Math.random() - 0.5) * 6;
        s.t = 0.35;
      }
    },
    explosion(x, y, z) {
      boom.visible = true;
      boom.position.set(x, y + 0.4, z);
      boom.scale.setScalar(0.5);
      boomState.t = 0.45;
      this.spark(x, y + 0.3, z);
    },
    step(dt, smokes, bomb) {
      for (const t of tracers) {
        if (t.t > 0) { t.t -= dt; if (t.t <= 0) t.mesh.visible = false; }
      }
      for (const s of sparks) {
        if (s.t > 0) {
          s.t -= dt;
          s.mesh.position.x += s.vx * dt;
          s.mesh.position.y += s.vy * dt;
          s.mesh.position.z += s.vz * dt;
          s.vy -= 12 * dt;
          if (s.t <= 0) s.mesh.visible = false;
        }
      }
      if (boomState.t > 0) {
        boomState.t -= dt;
        const k = 1 - boomState.t / 0.45;
        boom.scale.setScalar(0.5 + k * 6);
        boom.material.opacity = 0.85 * (1 - k);
        if (boomState.t <= 0) boom.visible = false;
      }
      // smoke puffs track the simulation's smoke clouds
      let pi = 0;
      for (const s of smokes) {
        for (let n = 0; n < 3 && pi < puffs.length; n++, pi++) {
          const m = puffs[pi];
          m.visible = true;
          const a = (n / 3) * Math.PI * 2 + s.t;
          m.position.set(s.x + Math.cos(a) * 1.4, s.y + (n - 1) * 0.5, s.z + Math.sin(a) * 1.4);
          m.scale.setScalar(1.4 + Math.sin(s.t * 2 + n) * 0.3);
          m.material.opacity = Math.min(0.55, s.t * 0.1);
        }
      }
      for (; pi < puffs.length; pi++) puffs[pi].visible = false;
      // bomb beacon
      if (bomb.state === 'planted') {
        bombLight.visible = true;
        bombLight.position.set(bomb.x, 0.5 + Math.sin(performance.now() * 0.01) * 0.1, bomb.z);
        bombLight.material.color.setHex(Math.sin(performance.now() * 0.012) > 0 ? 0xff3b30 : 0x7a0d08);
      } else if (bomb.state === 'dropped') {
        bombLight.visible = true;
        bombLight.position.set(bomb.x, 0.35, bomb.z);
        bombLight.material.color.setHex(0xf0a830);
      } else {
        bombLight.visible = false;
      }
    },
  };
}
