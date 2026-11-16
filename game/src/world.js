// Kestrel Yard: an original container-yard map. Attackers spawn south, defenders
// north; bomb site A is the west depot, site B the east warehouse. All collision is
// axis-aligned boxes; bots navigate a hand-placed waypoint graph over the lanes.
import * as THREE from 'three';
import { clamp } from './util.js';

// {x, z, w, d, h, c} — centre, footprint, height, colour. Axis-aligned on purpose.
const BOXES = [
  // Perimeter walls (h 4, thick 1)
  { x: 0, z: -18.5, w: 50, d: 1, h: 4, c: 0x5a5f66, kind: 'wall' },
  { x: 0, z: 18.5, w: 50, d: 1, h: 4, c: 0x5a5f66, kind: 'wall' },
  { x: -24.5, z: 0, w: 1, d: 38, h: 4, c: 0x5a5f66, kind: 'wall' },
  { x: 24.5, z: 0, w: 1, d: 38, h: 4, c: 0x5a5f66, kind: 'wall' },
  // Mid containers — the central crossroads
  { x: 0, z: 0, w: 6.2, d: 2.6, h: 2.6, c: 0xb3542e, kind: 'box' },
  { x: -7, z: 3.5, w: 2.6, d: 6.2, h: 2.6, c: 0x2e6b8a, kind: 'box' },
  { x: 7, z: -3.5, w: 2.6, d: 6.2, h: 2.6, c: 0x8a7a2e, kind: 'box' },
  { x: -3, z: -8, w: 6.2, d: 2.6, h: 2.6, c: 0x3f7a4a, kind: 'box' },
  { x: 4, z: 8.5, w: 6.2, d: 2.6, h: 2.6, c: 0x7a3f5e, kind: 'box' },
  // Stacked container pair (climbable sightline blocker, h 5.2)
  { x: -13, z: -1, w: 6.2, d: 2.6, h: 5.2, c: 0xb3542e, kind: 'box' },
  { x: 13, z: 1, w: 6.2, d: 2.6, h: 5.2, c: 0x2e6b8a, kind: 'box' },
  // Site A depot (west): low walls + crates form a pocket
  { x: -19, z: -12, w: 8, d: 1, h: 2.2, c: 0x6b5a44, kind: 'wall' },
  { x: -22.5, z: -8, w: 1, d: 8, h: 2.2, c: 0x6b5a44, kind: 'wall' },
  { x: -18, z: -9, w: 2.4, d: 2.4, h: 2.4, c: 0x9a7b4f, kind: 'crate' },
  { x: -15.5, z: -12.5, w: 1.2, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  { x: -20.5, z: -5.5, w: 1.2, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  // Site B warehouse (east)
  { x: 19, z: -12, w: 8, d: 1, h: 2.2, c: 0x6b5a44, kind: 'wall' },
  { x: 22.5, z: -8, w: 1, d: 8, h: 2.2, c: 0x6b5a44, kind: 'wall' },
  { x: 18, z: -9, w: 2.4, d: 2.4, h: 2.4, c: 0x9a7b4f, kind: 'crate' },
  { x: 15.5, z: -12.5, w: 1.2, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  { x: 20.5, z: -5.5, w: 1.2, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  // Spawn cover + lane crates
  { x: -6, z: 14, w: 2.4, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  { x: 6, z: 14, w: 2.4, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  { x: -6, z: -14, w: 2.4, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  { x: 6, z: -14, w: 2.4, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  { x: -11, z: 9, w: 1.2, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  { x: 11, z: -9, w: 1.2, d: 1.2, h: 1.2, c: 0x9a7b4f, kind: 'crate' },
  { x: -16, z: 6, w: 2.6, d: 2.6, h: 2.6, c: 0x3f7a4a, kind: 'box' },
  { x: 16, z: -6, w: 2.6, d: 2.6, h: 2.6, c: 0x8a7a2e, kind: 'box' },
];

// Waypoint graph: nodes the bots walk between. Edges are symmetric.
const WP = [
  [-20, 15], [-8, 15], [0, 15], [8, 15], [20, 15],          // 0-4 attacker spawn lane
  [-20, 8], [-8, 8], [0, 8], [8, 8], [20, 8],               // 5-9 south lane
  [-20, 0], [-8, -1], [0, -4], [8, -1], [20, 0],            // 10-14 mid lane
  [-20, -8], [-14, -8], [-8, -8], [0, -12], [8, -8], [14, -8], [20, -8], // 15-21 site lane
  [-20, -15], [-8, -15], [0, -15], [8, -15], [20, -15],     // 22-26 defender spawn lane
  [-14, 4], [14, 4], [-14, -13], [14, -13],                 // 27-30 flanks / site pockets
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [1, 6], [2, 7], [3, 8], [4, 9],
  [5, 6], [6, 7], [7, 8], [8, 9], [5, 10], [6, 11], [7, 12], [8, 13], [9, 14],
  [10, 11], [11, 12], [12, 13], [13, 14], [10, 15], [11, 18], [13, 20], [14, 21],
  [15, 16], [16, 17], [17, 18], [18, 19], [19, 20], [20, 21],
  [15, 22], [17, 23], [19, 24], [20, 25], [21, 26],
  [22, 23], [23, 24], [24, 25], [25, 26],
  [5, 27], [27, 10], [9, 28], [28, 14], [16, 29], [20, 30], [29, 22], [30, 26],
];

export const SITES = {
  A: { x: -19, z: -9, r: 3.2 },
  B: { x: 19, z: -9, r: 3.2 },
};
export const SPAWNS = {
  atk: [[-4, 15.5], [0, 16], [4, 15.5]],
  def: [[-4, -15.5], [0, -16], [4, -15.5]],
};

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3d42';
  g.fillRect(0, 0, 512, 512);
  // asphalt speckle
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#33363b' : '#41454b';
    g.fillRect((Math.random() * 512) | 0, (Math.random() * 512) | 0, 2, 2);
  }
  // painted lane lines
  g.strokeStyle = '#c9a227';
  g.lineWidth = 4;
  g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(256, 20); g.lineTo(256, 492); g.stroke();
  g.beginPath(); g.moveTo(20, 256); g.lineTo(492, 256); g.stroke();
  g.setLineDash([]);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#14161a';
  g.font = 'bold 72px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.set(2.2, 2.2, 1);
  return s;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const solids = [];
  const colliders = [];

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 38),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  solids.push(ground);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const b of BOXES) {
    const mat = new THREE.MeshStandardMaterial({ color: b.c, roughness: 0.85, metalness: 0.08 });
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(b.w, b.h, b.d);
    m.position.set(b.x, b.h / 2, b.z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    solids.push(m);
    colliders.push({
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h,
    });
  }

  // Site markers: painted rings + floating A / B
  const ringGeo = new THREE.RingGeometry(2.6, 3.2, 40);
  for (const [key, s] of Object.entries(SITES)) {
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xf0a830 : 0x37b6a9, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    group.add(ring);
    const label = labelSprite(key, key === 'A' ? '#f0a830' : '#37b6a9');
    label.position.set(s.x, 3.4, s.z);
    group.add(label);
  }

  // Lighting: warm dusk sun + cool sky fill, one shadow-casting light.
  const sun = new THREE.DirectionalLight(0xffe0b3, 3.0);
  sun.position.set(18, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 80;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa3c7, 0x2e2620, 1.25));
  const lamp = new THREE.PointLight(0xffc46b, 30, 22, 1.8);
  lamp.position.set(0, 6, -9);
  scene.add(lamp);

  // Waypoint adjacency
  const adj = WP.map(() => []);
  for (const [a, b] of EDGES) { adj[a].push(b); adj[b].push(a); }

  return {
    group, solids, colliders, waypoints: WP, adj, sites: SITES, spawns: SPAWNS,
    bounds: { minX: -24, maxX: 24, minZ: -18, maxZ: 18 },
  };
}

// Push a circle (feet at pos, radius r) out of every box it overlaps.
export function collideCircle(world, pos, r) {
  const b = world.bounds;
  pos.x = clamp(pos.x, b.minX + r, b.maxX - r);
  pos.z = clamp(pos.z, b.minZ + r, b.maxZ - r);
  for (const c of world.colliders) {
    if (pos.y >= c.h) continue;
    const nx = clamp(pos.x, c.minX, c.maxX);
    const nz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * r;
      pos.z = nz + (dz / d) * r;
    } else {
      // centre inside the box: push out along the smallest penetration axis
      const pl = pos.x - c.minX + r;
      const pr = c.maxX - pos.x + r;
      const pt = pos.z - c.minZ + r;
      const pb = c.maxZ - pos.z + r;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = c.minX - r;
      else if (m === pr) pos.x = c.maxX + r;
      else if (m === pt) pos.z = c.minZ - r;
      else pos.z = c.maxZ + r;
    }
  }
}

// Segment vs AABB slab test. Returns true when the segment is blocked.
export function segmentBlocked(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const c of world.colliders) {
    let t0 = 0, t1 = 1;
    // x slab
    if (Math.abs(dx) < 1e-9) { if (ax < c.minX || ax > c.maxX) continue; }
    else {
      let ta = (c.minX - ax) / dx, tb = (c.maxX - ax) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (az < c.minZ || az > c.maxZ) continue; }
    else {
      let ta = (c.minZ - az) / dz, tb = (c.maxZ - az) / dz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // y slab: box spans 0..h
    if (Math.abs(dy) < 1e-9) { if (ay < 0 || ay > c.h) continue; }
    else {
      let ta = (0 - ay) / dy, tb = (c.h - ay) / dy;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    return true; // every slab overlapped: the segment hits this box
  }
  return false;
}

// Smoke clouds also block sight.
export function losClear(world, smokes, ax, ay, az, bx, by, bz) {
  if (segmentBlocked(world, ax, ay, az, bx, by, bz)) return false;
  for (const s of smokes) {
    if (s.t <= 0) continue;
    // segment vs sphere (smoke puff)
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const px = s.x - ax, py = s.y - ay, pz = s.z - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    const t = clamp((px * dx + py * dy + pz * dz) / (len2 || 1), 0, 1);
    const cx = ax + dx * t - s.x, cy = ay + dy * t - s.y, cz = az + dz * t - s.z;
    if (cx * cx + cy * cy + cz * cz < s.r * s.r) return false;
  }
  return true;
}

export function nearestWaypoint(world, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < world.waypoints.length; i++) {
    const w = world.waypoints[i];
    const d = (w[0] - x) ** 2 + (w[1] - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// BFS path over the waypoint graph; returns node indices from start to goal.
export function findPath(world, from, to) {
  if (from === to) return [to];
  const prev = new Int16Array(world.waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    for (const m of world.adj[n]) {
      if (prev[m] !== -1) continue;
      prev[m] = n;
      if (m === to) {
        const path = [to];
        let cur = to;
        while (cur !== from) { cur = prev[cur]; path.push(cur); }
        path.reverse();
        return path;
      }
      queue.push(m);
    }
  }
  return [to];
}
