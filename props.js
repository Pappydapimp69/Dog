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
// The park gate: the city's open, park-facing corner (toward the park centre).
// Level 0 starts in the city and walks out through this arch into the park.
export const CITY_GATE = { x: CITY.x - CITY.halfW + 2, z: CITY.z + CITY.halfD - 1 };

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

  // ---- skyline: tall buildings with lit-window facades -------------------
  // A canvas facade of windows (some lit) tiled up each building — the single
  // biggest "this is a city, not the park" cue. Buildings ring the far/outer
  // edges (behind the fences), so they form a skyline backdrop without ever
  // blocking the open, park-facing corner the player walks out through.
  const WALL_COLS = [0x3a3f4b, 0x4a3f42, 0x38434a, 0x453f36];
  function windowFacade(tint) {
    const base = "#" + tint.toString(16).padStart(6, "0");
    return canvasTex((cx, w, h) => {
      cx.fillStyle = base; cx.fillRect(0, 0, w, h);
      const cols = 4, rows = 5, mx = w / cols, my = h / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const lit = ((r * 3 + c * 5 + r * c) % 4) === 0;
        cx.fillStyle = lit ? "#ffe39a" : "#12151c";
        cx.fillRect(c * mx + mx * 0.2, r * my + my * 0.16, mx * 0.6, my * 0.56);
      }
    }, 64, 80);
  }
  function building(x, z, w, d, h, faceRy) {
    const tint = WALL_COLS[Math.floor(rnd() * WALL_COLS.length)];
    const tex = windowFacade(tint);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(h / 4)));
    const wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    const plainMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 1 });
    // side order: +x, -x, +y(top), -y, +z, -z — window texture on all four walls
    const mats = [wallMat, wallMat, roofMat, roofMat, wallMat, wallMat];
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    b.position.set(x, h / 2, z); b.rotation.y = faceRy || 0; b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
    obstacles.push({ x, z, r: Math.max(w, d) * 0.5 + 0.3 });
  }
  // A row along the far-x edge (facing the park) and the far-z edge.
  const bx = CITY.x + CITY.halfW - 1;
  for (let i = -2; i <= 2; i++) building(bx, CITY.z + i * 6, 5, 5, 9 + rnd() * 7, 0);
  const bz = CITY.z - CITY.halfD + 1;
  for (let i = -1; i <= 2; i++) building(CITY.x + i * 6, bz, 5, 5, 9 + rnd() * 7, 0);

  // ---- a street: a darker road strip with a dashed centre line running from
  // the city out toward the park gate, so the eye (and the dog) is led along it.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(4.5, CITY.halfD * 2.2),
    new THREE.MeshStandardMaterial({ color: 0x202024, roughness: 1 }));
  road.rotation.x = -Math.PI / 2; road.rotation.z = Math.PI / 4;
  road.position.set(CITY.x - 4, 0.03, CITY.z + 4); road.receiveShadow = true; scene.add(road);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c96a });
  for (let i = -4; i <= 4; i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.2), dashMat);
    dash.rotation.x = -Math.PI / 2; dash.rotation.z = Math.PI / 4;
    dash.position.set(CITY.x - 4 - i * 2.0, 0.05, CITY.z + 4 + i * 2.0); scene.add(dash);
  }

  // ---- the park gate: two stone pillars + a lintel with a PARK sign, at the
  // city's open park-facing corner. Walking through it is "entering the park".
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9 });
  const gateSignTex = canvasTex((cx, w, h) => {
    cx.fillStyle = "#2f5d3a"; cx.fillRect(0, 0, w, h);
    cx.fillStyle = "#fff"; cx.font = "bold 26px sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText("🌳 PARK", w / 2, h / 2);
  }, 192, 48);
  const gx = CITY_GATE.x, gz = CITY_GATE.z, gRy = Math.PI / 4; // face the diagonal walk-out
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.4, 0.7), stoneMat);
    const off = 1.9;
    pillar.position.set(gx + Math.cos(gRy) * s * off, 1.7, gz - Math.sin(gRy) * s * off);
    pillar.castShadow = true; scene.add(pillar);
    obstacles.push({ x: pillar.position.x, z: pillar.position.z, r: 0.5 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.6, 0.7), stoneMat);
  lintel.position.set(gx, 3.4, gz); lintel.rotation.y = gRy; scene.add(lintel);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.66),
    new THREE.MeshStandardMaterial({ map: gateSignTex, roughness: 0.9 }));
  sign.position.set(gx, 3.4, gz); sign.rotation.y = gRy + Math.PI; scene.add(sign);
  const sign2 = sign.clone(); sign2.rotation.y = gRy; scene.add(sign2);

  function flicker(time) {
    for (const f of flickerHeads) {
      const n = Math.sin(time * 7 + f.seed) * Math.sin(time * 2.3 + f.seed * 2);
      f.mat.emissiveIntensity = 0.45 + Math.max(0, n) * 0.35;
    }
  }
  return { obstacles, flicker, gate: { x: CITY_GATE.x, z: CITY_GATE.z } };
}

// ---------------------------------------------------------------------------
// The CITY RING — a band of streets + a building skyline wrapping the whole
// park, so the park sits INSIDE a city. Built in [WORLD, OUTER]; the park core
// is untouched. Level 0 starts out here and walks in through a gate. Frustum
// culling keeps it cheap — you only ever draw the side you're standing on.
export function buildCityRing(scene, opts) {
  const rnd = opts.rng || Math.random;
  const W = opts.world, O = opts.outer;                 // park half-extent, city outer half-extent
  const mid = (W + O) / 2;                              // centre of the ring band
  const obstacles = [];
  const WALL_COLS = [0x3a3f4b, 0x4a3f42, 0x38434a, 0x453f36, 0x2f3742];

  // ---- ring road: four asphalt strips forming a square annulus over the grass
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x26262b, roughness: 1 });
  const band = O - W;
  function roadStrip(cx, cz, w, d) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
    m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.02, cz); m.receiveShadow = true; scene.add(m);
  }
  roadStrip(0, mid, O * 2, band); roadStrip(0, -mid, O * 2, band);
  roadStrip(mid, 0, band, W * 2); roadStrip(-mid, 0, band, W * 2);
  // centre dashes down the middle of each strip
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xcaba5e });
  function dashes(horizontal, fixed) {
    for (let t = -O + 4; t < O - 4; t += 6) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(horizontal ? 1.6 : 0.32, horizontal ? 0.32 : 1.6), dashMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(horizontal ? t : fixed, 0.04, horizontal ? fixed : t);
      scene.add(d);
    }
  }
  dashes(true, mid); dashes(true, -mid); dashes(false, mid); dashes(false, -mid);

  // ---- the enclosing skyline: buildings along the OUTER edge, facing the park
  // The facade texture is CACHED per tint. There are only five tints but the
  // 4x-size ring puts ~100 buildings on screen; minting a fresh 64x80 canvas
  // per building was affordable at the old size and is just waste at this one.
  const facadeCache = new Map();
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 1 });
  function windowFacade(tint) {
    const hit = facadeCache.get(tint);
    if (hit) return hit;
    const base = "#" + tint.toString(16).padStart(6, "0");
    const tex = canvasTex((cx, w, h) => {
      cx.fillStyle = base; cx.fillRect(0, 0, w, h);
      for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
        cx.fillStyle = ((r * 3 + c * 5 + r * c) % 4) === 0 ? "#ffe39a" : "#12151c";
        cx.fillRect(c * (w / 4) + w * 0.05, r * (h / 5) + h * 0.03, w * 0.15, h * 0.11);
      }
    }, 64, 80);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    facadeCache.set(tint, tex);
    return tex;
  }
  // One shared texture can't carry two different repeat counts, so buildings are
  // keyed by (tint, repeatX, repeatY) — still a handful of materials, not ~100.
  const wallMatCache = new Map();
  function wallMaterial(tint, rx, ry) {
    const key = `${tint}|${rx}|${ry}`;
    const hit = wallMatCache.get(key);
    if (hit) return hit;
    const src = windowFacade(tint);
    const tex = src.clone(); tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(rx, ry);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    wallMatCache.set(key, mat);
    return mat;
  }
  function building(x, z, w, d, h) {
    const tint = WALL_COLS[Math.floor(rnd() * WALL_COLS.length)];
    const wall = wallMaterial(tint, Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(h / 4)));
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [wall, wall, roofMat, roofMat, wall, wall]);
    b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; scene.add(b);
    obstacles.push({ x, z, r: Math.max(w, d) * 0.5 + 0.4 });
  }
  const edge = O - 4;
  for (let t = -edge + 6; t <= edge - 6; t += 12) {
    const jitter = () => (rnd() - 0.5) * 3;
    building(t + jitter(), edge, 7, 6, 11 + rnd() * 12);   // north
    building(t + jitter(), -edge, 7, 6, 11 + rnd() * 12);  // south
    building(edge, t + jitter(), 6, 7, 11 + rnd() * 12);   // east
    building(-edge, t + jitter(), 6, 7, 11 + rnd() * 12);  // west
  }

  // ---- streetlamps down the ring road ----
  const flickerHeads = [];
  function lamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 4.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 }));
    pole.position.set(x, 2.2, z); pole.castShadow = true; scene.add(pole);
    const lm = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffdf80, emissiveIntensity: 0.7 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lm);
    head.position.set(x, 4.5, z); scene.add(head);
    flickerHeads.push({ mat: lm, seed: rnd() * 100 });
    obstacles.push({ x, z, r: 0.3 });
  }
  for (let t = -O + 12; t <= O - 12; t += 16) { lamp(t, mid); lamp(t, -mid); lamp(mid, t); lamp(-mid, t); }

  // ---- outer boundary wall ----
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.95 });
  for (const [cx, cz, w, d] of [[0, O, O * 2, 0.6], [0, -O, O * 2, 0.6], [O, 0, 0.6, O * 2], [-O, 0, 0.6, O * 2]]) {
    const wm = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), wallMat);
    wm.position.set(cx, 1.5, cz); wm.castShadow = true; scene.add(wm);
  }

  // ---- the park gate: an arch on the north park boundary; Level 0 walks
  // out of the city and in through here. startSpot is on the ring road.
  const gate = { x: 0, z: W - 1 };
  // Start down the south street, off to the west — NOT dead-centre in front of
  // the gate — so Level 0 is an actual walk through the city to reach the park.
  const start = { x: -mid * 0.62, z: mid };
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9 });
  const signTex = canvasTex((cx, w, h) => {
    cx.fillStyle = "#2f5d3a"; cx.fillRect(0, 0, w, h);
    cx.fillStyle = "#fff"; cx.font = "bold 26px sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText("🌳 PARK", w / 2, h / 2);
  }, 192, 48);
  for (const s of [-1, 1]) {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 0.8), stoneMat);
    pil.position.set(gate.x + s * 2.4, 2, gate.z); pil.castShadow = true; scene.add(pil);
    obstacles.push({ x: gate.x + s * 2.4, z: gate.z, r: 0.5 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.7, 0.8), stoneMat);
  lintel.position.set(gate.x, 4, gate.z); scene.add(lintel);
  for (const ry of [0, Math.PI]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.76), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.9 }));
    sign.position.set(gate.x, 4, gate.z + (ry ? 0.05 : -0.05)); sign.rotation.y = ry; scene.add(sign);
  }

  // A barrier that drops across the gate when the park closes for the night —
  // a visual "CLOSED" cue only (no collision: the dog can still slip through,
  // the danger is the warden, not the bar). world.js toggles its visibility.
  const barrier = new THREE.Group();
  const barMat = new THREE.MeshStandardMaterial({ color: 0xcaa23a, roughness: 0.7, metalness: 0.1 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.34, 0.26), barMat);
  bar.position.set(gate.x, 1.2, gate.z); barrier.add(bar);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 8), barMat);
    post.position.set(gate.x + s * 2.5, 0.7, gate.z); barrier.add(post);
  }
  const closedTex = canvasTex((cx, w, h) => {
    cx.fillStyle = "#b5342a"; cx.fillRect(0, 0, w, h);
    cx.fillStyle = "#fff"; cx.font = "bold 22px sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText("PARK CLOSED", w / 2, h / 2);
  }, 192, 48);
  for (const ry of [0, Math.PI]) {
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.76), new THREE.MeshStandardMaterial({ map: closedTex, roughness: 0.9 }));
    cs.position.set(gate.x, 1.75, gate.z + (ry ? 0.04 : -0.04)); cs.rotation.y = ry; barrier.add(cs);
  }
  barrier.visible = false; scene.add(barrier);

  // ---- street clutter the stray can work: trash cans (knock over for food)
  // and a food cart (beg with a trick). game.js owns the interactions; here we
  // just build + place the meshes and hand back their positions/groups.
  const cans = [];
  const canBodyMat = new THREE.MeshStandardMaterial({ color: 0x4a5460, roughness: 0.8, metalness: 0.2 });
  const canLidMat = new THREE.MeshStandardMaterial({ color: 0x363b43, roughness: 0.85 });
  function buildCan(x, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 1.1, 12), canBodyMat);
    body.position.y = 0.55; body.castShadow = true; g.add(body);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.14, 12), canLidMat);
    lid.position.y = 1.16; g.add(lid);
    for (const yy of [0.42, 0.74]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 6, 14), canBodyMat);
      rib.rotation.x = Math.PI / 2; rib.position.y = yy; g.add(rib);
    }
    g.position.set(x, 0, z); scene.add(g);
    cans.push({ x, z, group: g });
  }
  // Placed as FRACTIONS of the ring's centre-line, not absolute coordinates —
  // these were literals tuned to the old (mid=93) ring and would have been left
  // stranded out on the grass when the city grew. `mid` keeps them on the road.
  [[-0.32, 0.97], [0.24, 0.97], [-0.97, -0.19], [-0.97, 0.34],
   [0.97, -0.26], [0.97, 0.28], [-0.28, -0.97], [0.32, -0.97]]
    .forEach(([fx, fz]) => buildCan(fx * mid, fz * mid));

  // A hot-dog cart with a striped awning + a vendor, on the south street near
  // where Level 0 walks in — beg here (perform a trick) for a bite.
  const cartGroup = new THREE.Group();
  const cartBox = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x9c4a3c, roughness: 0.8 }));
  cartBox.position.y = 0.95; cartBox.castShadow = true; cartGroup.add(cartBox);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 1.3), new THREE.MeshStandardMaterial({ color: 0xcbb89a, roughness: 0.8 }));
  counter.position.y = 1.56; cartGroup.add(counter);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    w.rotation.z = Math.PI / 2; w.position.set(sx * 0.9, 0.42, 0.66); cartGroup.add(w);
  }
  const awnTex = canvasTex((cx, w, h) => { for (let i = 0; i < 6; i++) { cx.fillStyle = i % 2 ? "#ececec" : "#d64535"; cx.fillRect(i * w / 6, 0, w / 6, h); } }, 96, 32);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 1.4), new THREE.MeshStandardMaterial({ map: awnTex, roughness: 0.9 }));
  awning.position.set(0, 2.5, 0.1); awning.rotation.x = -0.12; cartGroup.add(awning);
  for (const sx of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.95, 6), new THREE.MeshStandardMaterial({ color: 0x8a8a8a }));
    pole.position.set(sx * 1.15, 1.6, 0.66); cartGroup.add(pole);
  }
  const vendor = new THREE.Group();
  const vTorso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.32), new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.85 }));
  vTorso.position.y = 1.5; vendor.add(vTorso);
  const vHead = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe0ac69, roughness: 0.8 }));
  vHead.position.y = 2.1; vendor.add(vHead);
  const vHat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  vHat.position.y = 2.32; vendor.add(vHat);
  vendor.position.set(0, 0, -0.85); cartGroup.add(vendor);
  // On the south street near where Level 0 walks in — ring-relative for the same
  // reason the cans are, and kept just inside the start spot so it stays on the
  // player's actual route to the gate rather than behind them.
  const CART = { x: -mid * 0.35, z: mid * 0.95 };
  cartGroup.position.set(CART.x, 0, CART.z); scene.add(cartGroup);
  const cart = { x: CART.x, z: CART.z, group: cartGroup, vendor };

  function flicker(time) {
    for (const f of flickerHeads) {
      const n = Math.sin(time * 7 + f.seed) * Math.sin(time * 2.3 + f.seed * 2);
      f.mat.emissiveIntensity = 0.45 + Math.max(0, n) * 0.35;
    }
  }
  return { obstacles, flicker, startSpot: start, gate, barrier, cans, cart };
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
