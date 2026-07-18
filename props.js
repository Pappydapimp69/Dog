/* Dog Park 3D — static park props: benches, picnic tables, bins, lamps,
 * and flower patches. Purely decorative "stuff all around". */
import * as THREE from "./vendor/three.module.js";

export function buildProps(scene, opts) {
  const WORLD = opts.world;
  const pond = opts.pond;
  const lim = WORLD - 8;
  // seeded layout: draw every placement from the injected stream (see lesson)
  const rnd = opts.rng || Math.random;
  const rand = (a, b) => a + rnd() * (b - a);

  const wood = new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.9 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x6f4a28, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x444a50, roughness: 0.6, metalness: 0.4 });

  // Place helper: random spot inside the park, clear of the centre and the pond.
  function spot() {
    for (let tries = 0; tries < 20; tries++) {
      const x = rand(-lim, lim), z = rand(-lim, lim);
      if (Math.hypot(x, z) < 8) continue;                          // dog spawn
      if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 4) continue; // pond
      return { x, z };
    }
    return { x: rand(-lim, lim), z: rand(-lim, lim) };
  }
  function place(group, { x, z }) {
    group.position.set(x, 0, z);
    group.rotation.y = rand(0, Math.PI * 2);
    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(group);
  }

  function bench() {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), wood); seat.position.y = 0.55; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.1), wood); back.position.set(0, 0.85, -0.25); g.add(back);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.5), woodDark);
      leg.position.set(sx * 0.9, 0.27, 0); g.add(leg);
    }
    return g;
  }

  function table() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 1.0), wood); top.position.y = 0.9; g.add(top);
    for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.4), wood); b.position.set(0, 0.5, sz * 0.8); g.add(b);
      const lg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), woodDark); lg.position.set(0, 0.45, sz * 0.8); g.add(lg);
    }
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), woodDark); c1.position.set(-0.8, 0.45, 0); g.add(c1);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), woodDark); c2.position.set(0.8, 0.45, 0); g.add(c2);
    return g;
  }

  function bin() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.9, 12), metal); body.position.y = 0.45; g.add(body);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0x2c8a4a, roughness: 0.7 }));
    lid.position.y = 0.95; g.add(lid);
    return g;
  }

  function lamp() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.5, 8), metal); pole.position.y = 2.25; g.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffe28a, emissiveIntensity: 0.55 }));
    head.position.y = 4.6; g.add(head);
    return g;
  }

  function flowers() {
    const g = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.CircleGeometry(rand(0.8, 1.4), 14), new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = 0.02; g.add(bed);
    const cols = [0xff5d8f, 0xffd23a, 0xff8a3d, 0xb86bff, 0xffffff];
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.8 }));
      f.position.set(rand(-0.7, 0.7), 0.18, rand(-0.7, 0.7)); g.add(f);
    }
    return g;
  }

  const make = (fn, n) => { for (let i = 0; i < n; i++) place(fn(), spot()); };
  make(bench, 7);
  make(table, 4);
  make(bin, 5);
  make(lamp, 6);
  make(flowers, 12);
}

// ---------------------------------------------------------------------------
// City district — a themed "back alley" zone for Level 2 (Lay Low): a dark
// asphalt patch tucked in one corner of the park with dumpsters, crates,
// chain-link, graffiti, and a fire escape under flickering lamps. Level 2's
// collar spawns here (see COLLAR_SPOT), so disguising yourself means actually
// venturing into the city, not just the benches.
//
// Deliberately left open on two sides (fenced only along the far/outer
// edges) so it's always trivially walk-in-able — no ringed perimeter, no
// maze, no reachability risk (brain: procgen connectivity lessons).
export const CITY = { x: 58, z: -55, halfW: 16, halfD: 15 };
export const COLLAR_SPOT = { x: CITY.x, z: CITY.z };

function canvasTex(draw, w = 128, h = 128) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  draw(cv.getContext("2d"), w, h);
  return new THREE.CanvasTexture(cv);
}

export function buildCityDistrict(scene, opts) {
  const rnd = opts.rng || Math.random;
  const rand = (a, b) => a + rnd() * (b - a);
  const obstacles = [];
  const flickerHeads = [];

  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.halfW * 2, CITY.halfD * 2),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 1 })
  );
  asphalt.rotation.x = -Math.PI / 2; asphalt.position.set(CITY.x, 0.02, CITY.z);
  asphalt.receiveShadow = true; scene.add(asphalt);

  const dumpsterBody = new THREE.MeshStandardMaterial({ color: 0x3a4a34, roughness: 0.85 });
  const dumpsterLid = new THREE.MeshStandardMaterial({ color: 0x2e3a29, roughness: 0.9 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5a35, roughness: 0.95 });
  const brickMat = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.55, metalness: 0.5 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });

  const fenceTex = canvasTex((cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    cx.strokeStyle = "rgba(180,185,190,0.85)"; cx.lineWidth = 2;
    for (let x = -h; x < w + h; x += 14) {
      cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x + h, h); cx.stroke();
      cx.beginPath(); cx.moveTo(x, h); cx.lineTo(x + h, 0); cx.stroke();
    }
  });
  fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping; fenceTex.repeat.set(3, 1);
  const fenceMat = new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, side: THREE.DoubleSide, opacity: 0.9 });

  const graffitiTex = canvasTex((cx, w, h) => {
    cx.fillStyle = "#4a4a4e"; cx.fillRect(0, 0, w, h);
    const cols = ["#ff5d8f", "#ffd23a", "#3ad6ff", "#b86bff"];
    for (let i = 0; i < 6; i++) {
      cx.fillStyle = cols[i % cols.length]; cx.globalAlpha = 0.7;
      cx.beginPath();
      cx.ellipse(Math.random() * w, Math.random() * h, 14 + Math.random() * 20, 8 + Math.random() * 14, Math.random() * Math.PI, 0, Math.PI * 2);
      cx.fill();
    }
    cx.globalAlpha = 1; cx.strokeStyle = "#111"; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(10, h * 0.6); cx.quadraticCurveTo(w * 0.5, h * 0.3, w - 10, h * 0.65); cx.stroke();
  });
  const graffitiMat = new THREE.MeshStandardMaterial({ map: graffitiTex, roughness: 0.95 });

  // Poisson-disk-ish scatter (min-distance rejection) for the movable props —
  // brain lesson: naive independent placement clumps measurably; reject any
  // candidate too close to an already-placed prop OR the collar.
  // Seed with every FIXED prop position too (brain lesson: the rejection set
  // must include everything already placed, not just a subset, or the
  // scatter can still stack a random prop on top of a fixed one).
  const placed = [
    { x: COLLAR_SPOT.x, z: COLLAR_SPOT.z },
    { x: CITY.x - CITY.halfW + 1.5, z: CITY.z - 2 }, // the fire escape
  ];
  function scatterSpot(minDist, tries = 40) {
    for (let t = 0; t < tries; t++) {
      const x = CITY.x + rand(-CITY.halfW + 2, CITY.halfW - 2);
      const z = CITY.z + rand(-CITY.halfD + 2, CITY.halfD - 2);
      if (Math.hypot(x - COLLAR_SPOT.x, z - COLLAR_SPOT.z) < 5) continue; // keep the collar clear
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < minDist)) continue;
      placed.push({ x, z }); return { x, z };
    }
    return null;
  }

  function dumpster(x, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.0), dumpsterBody);
    body.position.y = 0.55; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 1.1), dumpsterLid);
    lid.position.y = 1.14; lid.rotation.z = rand(-0.05, 0.05); g.add(lid);
    g.position.set(x, 0, z); g.rotation.y = rand(0, Math.PI * 2); scene.add(g);
    obstacles.push({ x, z, r: 1.0 });
  }
  function crate(x, z) {
    const g = new THREE.Group();
    const n = 1 + Math.floor(rand(0, 2));
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), crateMat);
      c.position.y = 0.3 + i * 0.62; c.rotation.y = rand(0, Math.PI * 2); c.castShadow = true; g.add(c);
    }
    g.position.set(x, 0, z); scene.add(g);
    obstacles.push({ x, z, r: 0.5 });
  }
  function streetlamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 4.2, 8), poleMat);
    pole.position.set(x, 2.1, z); pole.castShadow = true; scene.add(pole);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffdf80, emissiveIntensity: 0.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), lampMat);
    head.position.set(x, 4.3, z); scene.add(head);
    flickerHeads.push({ mat: lampMat, seed: rand(0, 100) });
  }
  function graffitiPanel(x, z, ry) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.2), graffitiMat);
    p.position.set(x, 1.1, z); p.rotation.y = ry; scene.add(p);
  }
  function fireEscape(x, z, ry) {
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.15, 6, 2.2), brickMat);
    back.position.set(0, 3, 0); g.add(back);
    for (const y of [2, 4]) {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 2.0), railMat);
      plat.position.set(0.7, y, 0); plat.castShadow = true; g.add(plat);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 2.0), railMat);
      rail.position.set(1.3, y + 0.35, 0); g.add(rail);
    }
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2, 0.5), railMat);
    ladder.rotation.z = 0.15; ladder.position.set(0.9, 1, -0.8); g.add(ladder);
    g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    obstacles.push({ x, z, r: 1.2 });
  }
  function fenceSegment(x, z, ry) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.4), fenceMat);
    f.position.set(x, 1.2, z); f.rotation.y = ry; scene.add(f);
  }

  // Fence only along the far/outer edges — the park-facing sides stay open.
  for (let i = -1; i <= 1; i++) {
    fenceSegment(CITY.x + i * 6, CITY.z - CITY.halfD, 0);
    fenceSegment(CITY.x + CITY.halfW, CITY.z + i * 5, Math.PI / 2);
  }
  graffitiPanel(CITY.x - CITY.halfW + 0.1, CITY.z + 3, Math.PI / 2);
  graffitiPanel(CITY.x - 4, CITY.z - CITY.halfD + 0.1, 0);
  fireEscape(CITY.x - CITY.halfW + 1.5, CITY.z - 2, Math.PI / 2);

  for (let i = 0; i < 6; i++) { const s = scatterSpot(2.2); if (s) dumpster(s.x, s.z); }
  for (let i = 0; i < 5; i++) { const s = scatterSpot(1.4); if (s) crate(s.x, s.z); }
  for (let i = 0; i < 3; i++) { const s = scatterSpot(6); if (s) streetlamp(s.x, s.z); }

  function flicker(time) {
    for (const f of flickerHeads) {
      const n = Math.sin(time * 7 + f.seed) * Math.sin(time * 2.3 + f.seed * 2);
      f.mat.emissiveIntensity = 0.45 + Math.max(0, n) * 0.35;
    }
  }
  return { obstacles, flicker };
}

// ---------------------------------------------------------------------------
// The Adoption Fair — Level 3's dedicated zone (opposite corner of the park
// from the City District): a stage, a banner, bunting, hay bales, and the two
// shelter volunteers' home turf. Fenced only on the far/outer edges, same as
// the City District — always trivially walk-in-able (brain: procgen
// connectivity/reachability lessons).
export const FAIR = { x: -58, z: 55, halfW: 15, halfD: 14 };

export function buildAdoptionFair(scene, opts) {
  const rnd = opts.rng || Math.random;
  const rand = (a, b) => a + rnd() * (b - a);
  const obstacles = [];

  const dirt = new THREE.Mesh(
    new THREE.PlaneGeometry(FAIR.halfW * 2, FAIR.halfD * 2),
    new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 1 })
  );
  dirt.rotation.x = -Math.PI / 2; dirt.position.set(FAIR.x, 0.02, FAIR.z);
  dirt.receiveShadow = true; scene.add(dirt);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.9 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.85 });
  const hayMat = new THREE.MeshStandardMaterial({ color: 0xd9b84a, roughness: 1 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9 });

  // Stage: a raised platform at the back of the fairground.
  const stageX = FAIR.x, stageZ = FAIR.z - FAIR.halfD + 3;
  const stage = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 3.2), woodMat);
  stage.position.set(stageX, 0.3, stageZ); stage.castShadow = true; stage.receiveShadow = true;
  scene.add(stage);
  obstacles.push({ x: stageX, z: stageZ, r: 3 });

  // Banner: two poles either side of the stage with an "ADOPT ME" canvas texture.
  const bannerTex = canvasTex((cx, w, h) => {
    cx.fillStyle = "#ff6bd0"; cx.fillRect(0, 0, w, h);
    cx.fillStyle = "#fff"; cx.font = "bold 30px sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText("ADOPT ME 🐾", w / 2, h / 2);
  }, 256, 64);
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.9 });
  const poleXs = [stageX - 4, stageX + 4];
  for (const px of poleXs) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6, 8), poleMat);
    pole.position.set(px, 1.8, stageZ - 1.8); pole.castShadow = true; scene.add(pole);
    obstacles.push({ x: px, z: stageZ - 1.8, r: 0.25 });
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.4), bannerMat);
  banner.position.set(stageX, 3.1, stageZ - 1.8); scene.add(banner);

  // Bunting: a repeating triangle-flag texture along the front edge (same
  // canvas-texture technique as the City District's chain-link/graffiti).
  const buntingTex = canvasTex((cx, w, h) => {
    cx.clearRect(0, 0, w, h);
    const cols = ["#ff6bd0", "#ffd23a", "#3ad6ff", "#7ee081"];
    const n = 5, tw = w / n;
    for (let i = 0; i < n; i++) {
      cx.fillStyle = cols[i % cols.length];
      cx.beginPath(); cx.moveTo(i * tw, 0); cx.lineTo((i + 1) * tw, 0); cx.lineTo((i + 0.5) * tw, h); cx.closePath(); cx.fill();
    }
  });
  buntingTex.wrapS = THREE.RepeatWrapping; buntingTex.repeat.set(4, 1);
  const buntingMat = new THREE.MeshBasicMaterial({ map: buntingTex, transparent: true, side: THREE.DoubleSide });
  const bunting = new THREE.Mesh(new THREE.PlaneGeometry(FAIR.halfW * 2 - 2, 1.1), buntingMat);
  bunting.position.set(FAIR.x, 2.6, FAIR.z + FAIR.halfD - 0.1);
  scene.add(bunting);

  // Two decorative pens (open rail squares — visual only, no obstacle, so
  // they never block a path).
  function pen(cx, cz) {
    const size = 3.4, y = 0.5;
    for (const [ox, oz, len, ry] of [
      [-size / 2, 0, size, Math.PI / 2], [size / 2, 0, size, Math.PI / 2],
      [0, -size / 2, size, 0], [0, size / 2, size, 0],
    ]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), railMat);
      rail.position.set(cx + ox, y, cz + oz); rail.rotation.y = ry; scene.add(rail);
    }
  }
  pen(FAIR.x - 8, FAIR.z + 5);
  pen(FAIR.x + 8, FAIR.z + 5);

  // Two fixed home spots for the shelter volunteers, near the stage.
  const volunteerSpots = [
    { x: stageX - 4, z: stageZ + 3 },
    { x: stageX + 4, z: stageZ + 3 },
  ];

  // Poisson-disk-ish scatter for hay bales (min-distance rejection) — seeded
  // with every FIXED prop position AND its radius (brain lesson: the
  // rejection set must include everything already placed, e.g. E17 found in
  // the City District — and a uniform minDist isn't enough once radii vary:
  // a candidate must clear minDist PLUS the seed's own footprint, or a small
  // scattered prop can still land inside a much bigger fixed one like the stage).
  const placed = [
    { x: stageX, z: stageZ, r: 3 },
    { x: poleXs[0], z: stageZ - 1.8, r: 0.25 }, { x: poleXs[1], z: stageZ - 1.8, r: 0.25 },
    ...volunteerSpots.map((s) => ({ x: s.x, z: s.z, r: 1 })),
  ];
  function inFetchLane(x, z) {
    return Math.abs(x - stageX) < 4 && z > stageZ + 4 && z < FAIR.z + FAIR.halfD - 1;
  }
  function scatterSpot(minDist, tries = 40) {
    for (let t = 0; t < tries; t++) {
      const x = FAIR.x + rand(-FAIR.halfW + 2, FAIR.halfW - 2);
      const z = FAIR.z + rand(-FAIR.halfD + 2, FAIR.halfD - 2);
      if (inFetchLane(x, z)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < minDist + (p.r || 0))) continue;
      placed.push({ x, z }); return { x, z };
    }
    return null;
  }
  function hayBale(x, z) {
    const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 12), hayMat);
    bale.rotation.z = Math.PI / 2; bale.position.set(x, 0.55, z); bale.castShadow = true; bale.receiveShadow = true;
    scene.add(bale);
    obstacles.push({ x, z, r: 0.6 });
  }
  for (let i = 0; i < 6; i++) { const s = scatterSpot(2.0); if (s) hayBale(s.x, s.z); }

  return { obstacles, volunteerSpots, stage: { x: stageX, z: stageZ } };
}
