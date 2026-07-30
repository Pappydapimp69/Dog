/* Dog Park 3D — walk around an open park and control a dog.
 * Third-person three.js scene, no runtime CDN (three is vendored).
 */
import * as THREE from "./vendor/three.module.js";
import { ParkAudio } from "./audio.js?v=__BUILD__";
import { createBirds } from "./birds.js?v=__BUILD__";
import { createTraffic } from "./cars.js?v=__BUILD__";
import { createWind } from "./wind.js?v=__BUILD__";
import { createCritters } from "./critters.js?v=__BUILD__";
import { buildProps, buildCityDistrict, buildCityRing, buildAdoptionFair, CITY, CITY_GATE, FAIR } from "./props.js?v=__BUILD__";
import { createGame } from "./game.js?v=__BUILD__";
import { createPathfinder } from "./pathfind.js?v=__BUILD__";
import { createScent } from "./scent.js?v=__BUILD__";
import { createNarrative } from "./narrative.js?v=__BUILD__";
import { createKeepsake } from "./keepsake.js?v=__BUILD__";

const audio = new ParkAudio();
window.__audio = audio; // test hook

// ---------------------------------------------------------------------------
// Core setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
// Fog/clip far must clear the ring's far side (corner-to-corner is ~2*O*sqrt2
// = 452 units at O=160) or the skyline vanishes into fog and then gets
// clipped outright — brain opticon#E2: a blank render at certain camera
// distances is usually fog `far`, not the scene graph.
scene.fog = new THREE.Fog(0x8fd3ff, 110, 420);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 700);

// Lights
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4f8a3a, 1.1);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff3d6, 2.4);
sun.position.set(34, 58, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
const S = 70;
sun.shadow.camera.left = -S;
sun.shadow.camera.right = S;
sun.shadow.camera.top = S;
sun.shadow.camera.bottom = -S;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

// ---- day/night cycle: a slow tint across sky, fog, and lights ----
// Daylight lasts twice as long as night: the cycle spends 2/3 of its time in
// day and 1/3 in night, with short dawn/dusk ramps between. The park opens at
// dawn and closes at dusk (env.closed) — the dog catcher owns the closed park.
const DAY = { sky: new THREE.Color(0x8fd3ff), hemi: 1.1, sun: 2.4, sunCol: new THREE.Color(0xfff3d6) };
const NIGHT = { sky: new THREE.Color(0x1a2740), hemi: 0.42, sun: 0.6, sunCol: new THREE.Color(0x7488c0) };
const _skyCol = new THREE.Color();
// env exposes the world clock to the game/critters layers (via window.__env):
//   nightT  0(day)→~0.85(deep night), drives lighting
//   dayPhase 0..1 position through one full day
//   closed  true from dusk through night to dawn (park shut, catcher patrols)
const env = { nightT: 0, dayPhase: 0, closed: false };
window.__env = env; // test/debug hook + read by game.js (catcher) and critters
const CYCLE = 240;                 // one full day, in seconds
const DAY_FRAC = 2 / 3;            // day is 2× night
const RAMP = 0.05;                 // dawn/dusk transition width (fraction of cycle)
// Smooth 0(day)→1(night) over the warped cycle: flat day, dusk ramp up, flat
// night, dawn ramp down. u is the normalised position through the day.
function nightLevel(u) {
  if (u < RAMP) return 1 - u / RAMP;                       // dawn: night → day
  if (u < DAY_FRAC) return 0;                              // full day
  if (u < DAY_FRAC + RAMP) return (u - DAY_FRAC) / RAMP;   // dusk: day → night
  return 1;                                                // full night
}
window.__dayNight = { nightLevel, CYCLE, DAY_FRAC, RAMP }; // test hook (pure clock math)
function updateDayNight(time) {
  const u = env.dayPhase = (time % CYCLE) / CYCLE;
  env.closed = u >= DAY_FRAC;      // shut from dusk (2/3 through the day) onward
  if (env._forceClosed != null) env.closed = env._forceClosed; // test override
  // Act 1 is "one long night and one dawn" — the cold open is an abandonment in
  // a night rainstorm under sodium light. The STORM was already forced for the
  // prologue but the clock was not, so the scene could open at noon under a
  // blue sky: rain falling out of clear daylight, and the underpass's whole
  // point (the only dry place, lit orange) invisible. Force night to match the
  // weather that was already being forced beside it.
  const scripted = game && game.phase === "prologue";
  let n = env.nightT = (scripted ? 1 : nightLevel(u)) * 0.85; // never pitch black
  if (scripted) env.closed = true;
  _skyCol.copy(DAY.sky).lerp(NIGHT.sky, n);
  scene.background.copy(_skyCol);
  scene.fog.color.copy(_skyCol);
  hemi.intensity = DAY.hemi + (NIGHT.hemi - DAY.hemi) * n;
  sun.intensity = DAY.sun + (NIGHT.sun - DAY.sun) * n;
  sun.color.copy(DAY.sunCol).lerp(NIGHT.sunCol, n);
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const WORLD = 80; // half-extent of the play field

// ---- fireflies: fade in at night and drift near the ground ----
const fireflies = [];
{
  const fgeo = new THREE.SphereGeometry(0.06, 5, 4);
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(fgeo, new THREE.MeshBasicMaterial({ color: 0xd9ff88, transparent: true, opacity: 0 }));
    m.position.set(rand(70), 1.2, rand(70));
    scene.add(m); fireflies.push({ m, ph: Math.random() * 6, sp: 0.3 + Math.random() * 0.5 });
  }
}
function updateFireflies(dt) {
  const glow = settings.reduceMotion ? 0 : env.nightT;
  for (const f of fireflies) {
    f.ph += dt * f.sp;
    f.m.position.x += Math.sin(f.ph) * dt * 0.6;
    f.m.position.z += Math.cos(f.ph * 0.7) * dt * 0.6;
    f.m.position.y = 1.1 + Math.sin(f.ph * 1.3) * 0.5;
    f.m.material.opacity = glow * (0.35 + Math.abs(Math.sin(f.ph * 2)) * 0.6);
  }
}

// ---- weather: occasional rain that also rinses the dog clean ----
const RAIN_N = 650;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) { rainPos[i * 3] = rand(28); rainPos[i * 3 + 1] = Math.random() * 34; rainPos[i * 3 + 2] = rand(28); }
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rainPts = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xcfe0f0, size: 0.22, transparent: true, opacity: 0 }));
rainPts.frustumCulled = false; scene.add(rainPts);
env.rainT = 0;
let rainTimer = 25 + Math.random() * 35, rainTarget = 0;
function updateWeather(dt) {
  // Level 0 is a rainy night in the city — force a steady storm during the
  // prologue; elsewhere the weather drifts in and out on its own timer.
  const storm = game && game.phase === "prologue";
  if (storm) {
    rainTarget = 0.9;
  } else {
    rainTimer -= dt;
    if (rainTimer <= 0) { rainTarget = rainTarget > 0.1 ? 0 : (0.5 + Math.random() * 0.5); rainTimer = 30 + Math.random() * 50; }
  }
  env.rainT += (rainTarget - env.rainT) * Math.min(1, dt * (storm ? 1.2 : 0.4));
  const r = env.rainT;
  rainPts.material.opacity = settings.reduceMotion ? 0 : r * 0.8;
  if (r > 0.01 && !settings.reduceMotion) {
    const d = dogState.pos;
    for (let i = 0; i < RAIN_N; i++) {
      rainPos[i * 3 + 1] -= (24 + 12 * r) * dt;
      if (rainPos[i * 3 + 1] < 0) { rainPos[i * 3 + 1] = 34; rainPos[i * 3] = d.x + rand(28); rainPos[i * 3 + 2] = d.z + rand(28); }
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
}

// ---- clouds: low-poly puffs drifting across the sky, greying with the rain ----
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.9 });
const clouds = [];
{
  const puff = new THREE.SphereGeometry(1, 8, 6); // shared geometry across every puff
  for (let i = 0; i < 20; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 4);
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(puff, cloudMat);
      const s = 4 + Math.random() * 6;
      m.scale.set(s, s * 0.5, s * 0.8);
      m.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 10);
      g.add(m);
    }
    g.position.set(rand(130), 44 + Math.random() * 20, rand(130));
    scene.add(g);
    clouds.push({ g, sp: 1.1 + Math.random() * 1.7 });
  }
}
const STORM_SKY = new THREE.Color(0x39404a); // dark overcast blue-grey
function updateClouds(dt) {
  const r = env.rainT;
  // Storm mood: overcast the sky + fog and dim the lights as the rain builds,
  // so a rainy Level 0 actually looks dark and heavy (and the flashes read).
  // Runs after updateDayNight, so it layers on top of the time-of-day base.
  if (r > 0.02) {
    scene.background.lerp(STORM_SKY, r * 0.72);
    scene.fog.color.lerp(STORM_SKY, r * 0.72);
    hemi.intensity *= (1 - r * 0.42);
    sun.intensity *= (1 - r * 0.5);
  }
  const gg = 1 - r * 0.62; // grey the clouds out as the storm rolls in
  cloudMat.color.setRGB(gg, gg, Math.min(1, gg * 1.03));
  cloudMat.opacity = 0.82 + r * 0.14;
  const drift = settings.reduceMotion ? 0 : dt;
  for (const c of clouds) { c.g.position.x += c.sp * drift; if (c.g.position.x > 145) c.g.position.x = -145; }
}

// ---- lightning: during heavy rain, an occasional sky flash + a delayed thunder ----
const WHITE_FLASH = new THREE.Color(0xf2f2ff);
let lightningCD = 6 + Math.random() * 10, flashT = 0, thunderCD = 0;
const boltMat = new THREE.MeshBasicMaterial({ color: 0xfdf6c8, transparent: true, opacity: 0 });
const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.02, 44, 4), boltMat);
bolt.visible = false; bolt.frustumCulled = false; scene.add(bolt);
function updateLightning(dt) {
  if (settings.reduceMotion) { if (flashT > 0) { flashT = 0; bolt.visible = false; } return; }
  if (env.rainT > 0.45) {
    lightningCD -= dt;
    if (lightningCD <= 0) {
      lightningCD = 4 + Math.random() * 12;
      flashT = 0.2;
      const d = dogState.pos;
      bolt.position.set(d.x + rand(70), 22, d.z + rand(70)); bolt.rotation.z = rand(0.4);
      bolt.visible = true;
      thunderCD = 0.3 + Math.random() * 1.4; // thunder follows the flash by a beat
    }
  }
  if (flashT > 0) {
    flashT -= dt;
    const k = Math.max(0, flashT / 0.2);
    hemi.intensity += k * 2.4;                    // whole-sky flash (updateDayNight reset it this frame)
    scene.background.lerp(WHITE_FLASH, k * 0.7);
    boltMat.opacity = k;
    if (flashT <= 0) bolt.visible = false;
  }
  if (thunderCD > 0) { thunderCD -= dt; if (thunderCD <= 0 && audio.thunder) audio.thunder(); }
}

// Ground
const groundMat = new THREE.MeshStandardMaterial({ color: 0x6cbf52, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(340, 340), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Subtle darker grass patches for depth / motion reference
const patchMat = new THREE.MeshStandardMaterial({ color: 0x5fae47, roughness: 1 });
for (let i = 0; i < 60; i++) {
  const r = 2 + Math.random() * 5;
  const patch = new THREE.Mesh(new THREE.CircleGeometry(r, 12), patchMat);
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(rand(WORLD - 4), 0.01, rand(WORLD - 4));
  patch.receiveShadow = true;
  scene.add(patch);
}

// Pond
const pond = new THREE.Mesh(
  new THREE.CircleGeometry(11, 40),
  new THREE.MeshStandardMaterial({ color: 0x3aa0d6, roughness: 0.3, metalness: 0.1 })
);
pond.rotation.x = -Math.PI / 2;
pond.position.set(-34, 0.02, -28);
pond.receiveShadow = true;
scene.add(pond);

// Perimeter fence
// Runs are recorded as we build them so collision can be added once `obstacles`
// exists (it's declared below these calls) — the fence was pure scenery until
// now: you could walk straight through the park boundary anywhere.
const fenceRuns = [];
const fenceMat = new THREE.MeshStandardMaterial({ color: 0xb98a4f, roughness: 0.9 });
function fenceRun(x1, z1, x2, z2) {
  fenceRuns.push([x1, z1, x2, z2]);
  const len = Math.hypot(x2 - x1, z2 - z1);
  const posts = Math.floor(len / 4);
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.6, 0.4), fenceMat);
    post.position.set(x1 + (x2 - x1) * t, 1.3, z1 + (z2 - z1) * t);
    post.castShadow = true;
    scene.add(post);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 0.2), fenceMat);
  rail.position.set((x1 + x2) / 2, 1.7, (z1 + z2) / 2);
  rail.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  rail.castShadow = true;
  scene.add(rail);
}
// The city ring wraps the park out to here. Sized so the CITY is four times
// the area it was (band area (2*O)^2-(2*W)^2: 106 -> 19,344 units^2, 160 ->
// 76,800, a 3.97x), which is also what stops Level 0 spawning within sight
// of the park gate — the walk in is now ~85 units, not ~50.
const WORLD_OUTER = 160;
const F = WORLD - 2;
fenceRun(-F, -F, F, -F);
// north edge is split to leave a gate opening at x≈0 (the park entrance arch)
fenceRun(-F, F, -3, F);
fenceRun(3, F, F, F);
fenceRun(-F, -F, -F, F);
fenceRun(F, -F, F, F);

// Trees
function makeTree(x, z) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.7, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 })
  );
  trunk.position.y = 2;
  trunk.castShadow = true;
  tree.add(trunk);
  const foliageMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.28, 0.5, 0.32 + Math.random() * 0.1),
    roughness: 1,
  });
  for (let i = 0; i < 3; i++) {
    const blob = new THREE.Mesh(new THREE.SphereGeometry(2.2 - i * 0.3, 10, 8), foliageMat);
    blob.position.set((Math.random() - 0.5) * 1.4, 4.4 + i * 1.4, (Math.random() - 0.5) * 1.4);
    blob.castShadow = true;
    tree.add(blob);
  }
  tree.position.set(x, 0, z);
  scene.add(tree);
  trees.push({ x, z, topY: 6.2 }); // perch point on the crown
  return { x, z, r: 1.4 }; // collision footprint
}
// Keep generic scatter (trees, hydrants) out of the City District / Adoption
// Fair footprints — those districts build their own fixed layout and a tree
// landing inside one (verified: happens on some seeds) would silently
// overlap the stage/fence/dumpsters.
function inDistrict(x, z, d) { return Math.abs(x - d.x) < d.halfW + 2 && Math.abs(z - d.z) < d.halfD + 2; }
function clearOfDistricts(x, z) { return !inDistrict(x, z, CITY) && !inDistrict(x, z, FAIR); }

const obstacles = [];
// Give the perimeter fence real collision: a chain of overlapping circles down
// each run. Spacing < 2*r so there is no gap to squeeze through between them.
for (const [x1, z1, x2, z2] of fenceRuns) {
  const len = Math.hypot(x2 - x1, z2 - z1), r = 0.9, step = 1.4;
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    obstacles.push({ x: x1 + (x2 - x1) * t, z: z1 + (z2 - z1) * t, r });
  }
}
const trees = [];
for (let i = 0; i < 26; i++) {
  let x, z;
  do { x = rand(WORLD - 6); z = rand(WORLD - 6); } while (Math.hypot(x, z) < 8 || !clearOfDistricts(x, z));
  obstacles.push(makeTree(x, z));
}

// Fire hydrants (decor + obstacle)
function makeHydrant(x, z) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd63b3b, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.3, 12), mat);
  body.position.y = 0.65; body.castShadow = true; g.add(body);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), mat);
  cap.position.y = 1.35; cap.castShadow = true; g.add(cap);
  const armG = new THREE.BoxGeometry(1.3, 0.25, 0.25);
  const arm = new THREE.Mesh(armG, mat); arm.position.y = 0.9; arm.castShadow = true; g.add(arm);
  g.position.set(x, 0, z);
  scene.add(g);
  obstacles.push({ x, z, r: 0.8 });
}
for (let i = 0; i < 6; i++) {
  let x, z;
  do { x = rand(WORLD - 10); z = rand(WORLD - 10); } while (!clearOfDistricts(x, z));
  makeHydrant(x, z);
}

// Doghouse (home base)
(function doghouse() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(4, 3, 4),
    new THREE.MeshStandardMaterial({ color: 0xc46b3d, roughness: 0.9 })
  );
  base.position.y = 1.5; base.castShadow = true; base.receiveShadow = true; g.add(base);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.4, 2, 4),
    new THREE.MeshStandardMaterial({ color: 0x8c4a28, roughness: 0.9 })
  );
  roof.position.y = 4; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
  const door = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshStandardMaterial({ color: 0x2a1a12 })
  );
  door.position.set(0, 1.2, 2.01); g.add(door);
  g.position.set(14, 0, 14);
  scene.add(g);
  obstacles.push({ x: 14, z: 14, r: 3 });
})();

// ---------------------------------------------------------------------------
// The dog (third-person avatar)
// ---------------------------------------------------------------------------
function buildDog() {
  const dog = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0xc8782f, roughness: 0.8 });
  const furDark = new THREE.MeshStandardMaterial({ color: 0xa85f1f, roughness: 0.8 });
  const black = new THREE.MeshStandardMaterial({ color: 0x2a1a12 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff });

  // body — long axis along +z (nose toward +z)
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.8), fur);
  body.position.y = 1.0; body.castShadow = true; dog.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), fur);
  chest.position.set(0, 1.0, 0.9); chest.scale.set(1, 0.95, 0.8); chest.castShadow = true; dog.add(chest);

  // head group
  const head = new THREE.Group();
  head.position.set(0, 1.45, 1.15);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.72, 0.72), fur);
  skull.castShadow = true; head.add(skull);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.5), furDark);
  snout.position.set(0, -0.08, 0.5); snout.castShadow = true; head.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), black);
  nose.position.set(0, -0.05, 0.78); head.add(nose);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.12), furDark);
    ear.position.set(sx * 0.34, 0.42, -0.05); ear.castShadow = true; head.add(ear);
    const eyeW = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), white);
    eyeW.position.set(sx * 0.22, 0.08, 0.36); head.add(eyeW);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), black);
    eye.position.set(sx * 0.22, 0.08, 0.45); head.add(eye);
  }
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.22), new THREE.MeshStandardMaterial({ color: 0xe8607a }));
  tongue.position.set(0, -0.24, 0.62); head.add(tongue);
  dog.add(head);
  dog.userData.head = head;

  // tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 1.3, -0.9);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 0.9, 8), fur);
  tail.position.set(0, 0.35, -0.15); tail.rotation.x = -0.7; tail.castShadow = true;
  tailPivot.add(tail);
  dog.add(tailPivot);
  dog.userData.tail = tailPivot;

  // legs (pivot at hip for swing)
  const legs = [];
  const legGeo = new THREE.BoxGeometry(0.24, 0.9, 0.24);
  const positions = [
    [-0.34, 0.7], [0.34, 0.7],   // front
    [-0.34, -0.6], [0.34, -0.6], // back
  ];
  for (const [lx, lz] of positions) {
    const pivot = new THREE.Group();
    pivot.position.set(lx, 0.95, lz);
    const leg = new THREE.Mesh(legGeo, furDark);
    leg.position.y = -0.45; leg.castShadow = true;
    pivot.add(leg);
    dog.add(pivot);
    legs.push(pivot);
  }
  dog.userData.legs = legs;
  dog.userData.coatMats = { fur, furDark }; // exposed so the coat can be re-tinted

  return dog;
}
const dog = buildDog();
// buildDog()'s raw geometry is built at roughly HUMAN height (~1.8 units, nose
// to ground) with no scale correction — critters.js's buildNpcDog() builds at
// HALF that raw geometry (0.5x0.45x1.0 body vs the player's 1.0x0.9x1.8) then
// applies its own ~1.0 scale on top, so every OTHER dog in the park already
// reads as a normal, correctly-proportioned dog next to human NPCs. The
// player's own dog never got the equivalent correction — it was rendering at
// full human height, looming over park benches. This factor matches the
// player dog to the same finished size the game already uses for everyone
// else's dog (new head-top height ~1.0 unit, in line with buildNpcDog's own
// 0.85-1.2 scale range for an adult dog).
// The city is authored at 1 unit = 1 metre (4.4m streetlamps, a 4.3m sedan,
// 1.16m bins, ~2.2-unit people), so the dog has to be metric too or it reads
// as a Great Dane against a correct-scale street. At 0.55 the dog stood 1.1
// units to a human's 2.2 — a 0.50 ratio; a real medium dog is 0.65m to a
// 1.75m person, 0.37. 0.41 lands on that ratio (~0.82m at the head).
// Every dependent camera/attachment offset is already expressed as
// `* DOG_VISUAL_SCALE` (dog#E69), so this constant propagates on its own.
const DOG_VISUAL_SCALE = 0.41;
dog.scale.setScalar(DOG_VISUAL_SCALE);
scene.add(dog);

// ---- coat customization: pick your pup's colour (persisted). Research on
// cozy/pet sims is consistent that letting players choose how their animal
// looks drives attachment — so the stray is yours from the title screen on.
// Purely cosmetic: re-tints the two fur materials (the nose/eyes/collar keep
// their own colours), saved under its own key so it survives reloads.
const COATS = [
  { key: "classic",  name: "Classic",   base: 0xc8782f, dark: 0xa85f1f },
  { key: "midnight", name: "Midnight",  base: 0x3b332e, dark: 0x241d19 },
  { key: "golden",   name: "Golden",    base: 0xe0a94a, dark: 0xbf8a34 },
  { key: "cream",    name: "Cream",     base: 0xe7d5ac, dark: 0xc9b487 },
  { key: "ash",      name: "Ash",       base: 0x9a9a9a, dark: 0x767676 },
  { key: "cocoa",    name: "Cocoa",     base: 0x6b4326, dark: 0x492e19 },
];
let coatKey = "classic";
try { coatKey = localStorage.getItem("dogpark-coat") || "classic"; } catch (e) {}
function applyCoat(key) {
  const c = COATS.find((x) => x.key === key) || COATS[0];
  coatKey = c.key;
  dog.userData.coatMats.fur.color.setHex(c.base);
  dog.userData.coatMats.furDark.color.setHex(c.dark);
  try { localStorage.setItem("dogpark-coat", c.key); } catch (e) {}
}
applyCoat(coatKey); // restore the saved coat on load

// Highlight the currently-chosen swatch, and cycle the coat by a step — used by
// both the pointer handlers and gamepad title-screen navigation (D-pad/stick).
const coatSwatchRow = document.getElementById("coat-swatches");
function markCoatSwatches() {
  if (coatSwatchRow) coatSwatchRow.querySelectorAll("button").forEach((btn) => btn.classList.toggle("on", btn.dataset.key === coatKey));
}
function cycleCoat(dir) {
  const i = COATS.findIndex((c) => c.key === coatKey);
  const n = ((i < 0 ? 0 : i) + dir + COATS.length) % COATS.length;
  applyCoat(COATS[n].key); markCoatSwatches();
}

// Build the title-screen swatch row from the palette (single source of truth).
// Picking one re-tints the dog live and marks the choice; it's in effect the
// moment the player enters the park.
{
  const row = coatSwatchRow;
  if (row) {
    const hex = (n) => "#" + n.toString(16).padStart(6, "0");
    COATS.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "coat-sw"; btn.dataset.key = c.key;
      btn.title = c.name; btn.setAttribute("aria-label", c.name);
      btn.style.background = hex(c.base);
      btn.addEventListener("pointerdown", (e) => { e.stopPropagation(); applyCoat(c.key); markCoatSwatches(); });
      row.appendChild(btn);
    });
    markCoatSwatches();
  }
}

// ---- name your pup: persisted, and woven into the story beats (opening
// cutscene, the adoption moment) so the name you pick actually pays off.
// First visit gets a friendly random default the player can change. Typing in
// the field must not leak into the game's key/pointer handlers.
const NAMES = ["Biscuit", "Scout", "Luna", "Pepper", "Mochi", "Rusty", "Clementine", "Waffles", "Bandit", "Juniper"];
const nameInputEl = document.getElementById("dog-name");
const saveName = (v) => { try { localStorage.setItem("dogpark-name", (v || "").trim().slice(0, 16)); } catch (e) {} };
// Gamepad has no practical text entry, so give pad users a way to change the
// name too: re-roll a fresh one from the list (never the same twice in a row).
function rerollName() {
  if (!nameInputEl) return;
  const cur = nameInputEl.value; let n;
  do { n = NAMES[Math.floor(Math.random() * NAMES.length)]; } while (NAMES.length > 1 && n === cur);
  nameInputEl.value = n; saveName(n);
}
{
  const nameInput = nameInputEl;
  if (nameInput) {
    let saved = null;
    try { saved = localStorage.getItem("dogpark-name"); } catch (e) {}
    if (saved == null) { saved = NAMES[Math.floor(Math.random() * NAMES.length)]; saveName(saved); }
    nameInput.value = saved;
    nameInput.addEventListener("input", () => saveName(nameInput.value));
    // keep field interaction out of the world (no game-start, no orbit, no WASD)
    nameInput.addEventListener("pointerdown", (e) => e.stopPropagation());
    nameInput.addEventListener("keydown", (e) => e.stopPropagation());
  }
}

const dogState = {
  pos: new THREE.Vector3(0, 0, 0),
  vy: 0,
  onGround: true,
  heading: 0,      // facing angle
  speed: 0,        // current planar speed (for animation)
  walkPhase: 0,
  knock: new THREE.Vector3(0, 0, 0), // knockback impulse (x,z) e.g. from a duck peck
};

const POND = { x: -34, z: -28, r: 11 };
let lastStepIndex = 0;

// Birds — visual + their own spatial voices.
const birds = createBirds(scene, audio, { trees, world: WORLD });

// Roads + cars (real moving sources, some with generative radios).
const traffic = createTraffic(scene, audio, { roadHalf: 92, roadWidth: 9 });

// Wind — rare sweeping gusts that make trees rustle and brush past the dog.
const wind = createWind(scene, audio, {
  trees,
  world: WORLD,
  getDog: () => dogState.pos,
});

// ---- seeded park: the same seed lays out the same park; share via #seed=N.
// LESSON (recorded): every layout roll must go through this one rng — a leaked
// Math.random() in a placement path would silently break reproducibility.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function parseSeed() { const m = (location.hash || "").match(/seed=(\d+)/); return m ? (parseInt(m[1], 10) >>> 0) : 1234; }
const PARK_SEED = parseSeed();
const rng = mulberry32(PARK_SEED);
window.__seed = PARK_SEED;

// Static park props — benches, tables, bins, lamps, flowers.
buildProps(scene, { world: WORLD, pond: POND, rng });

// City district — Level 2's back-alley zone (dumpsters, fences, graffiti,
// a fire escape, flickering lamps); its returned obstacles join collision,
// and its flicker animation is driven from the main loop below.
const city = buildCityDistrict(scene, { rng });
obstacles.push(...city.obstacles);
// The city ring wrapping the whole park (streets + skyline + park gate).
const cityRing = buildCityRing(scene, { rng, world: WORLD, outer: WORLD_OUTER });
obstacles.push(...cityRing.obstacles);

// Adoption Fair — Level 3's zone (stage, banner, bunting, hay bales, and the
// two shelter volunteers' home spots), on the opposite side of the park from
// the City District.
const fair = buildAdoptionFair(scene, { rng });
obstacles.push(...fair.obstacles);

// Obstacle-aware pathfinding, built ONCE against the real (now fully
// populated) obstacle list and shared by every subsystem that steers an
// entity toward a target — the dog catcher, Rex, and wandering NPCs all
// reuse the same grid instead of each rebuilding it (brain: verified in
// local/sandbox-dog-pathfinding; ~15ms one-time build, not per-frame).
const pathfinder = createPathfinder(obstacles, WORLD);

// Living things — people, other dogs, and pond ducks that attack up close.
const critters = createCritters(scene, audio, {
  world: WORLD,
  outer: WORLD_OUTER,   // the city ring — populated with wary city folk
  pond: POND,
  rng,
  getClosed: () => env.closed, // casual crowd heads home at dusk…
  getRain: () => env.rainT,    // …and when it rains
  getDog: () => dogState.pos,
  pushDog: (dx, dz, power) => { dogState.knock.x += dx * power; dogState.knock.z += dz * power; },
  pathfinder,
});

// The game layer — traits, relationships, disguises, dog catcher, levels.
function setDogPos(x, z) {
  dogState.pos.x = x; dogState.pos.z = z; dogState.pos.y = 0;
  dogState.vy = 0; dogState.knock.set(0, 0, 0);
}
function setDogHeading(h) { dogState.heading = h; }
// Story controller over the authored narrative (acts/beats/cutscenes). Passed
// into the game so the opening-act rebuild can drive objectives + cutscenes
// from beats; dormant until then (existing level flow is unchanged).
const narrative = createNarrative();
// Scent-tracking — created BEFORE the game so it can be injected as an opt:
// game.begin() runs during setup (below), before the window.__scent hook exists,
// and the opening act needs scent at prologue start. Owns the trail field, the
// Scent View veil, and the follow/strength queries the story drives. Hold F to
// see scent. shelterAt is a coarse cover hook (0..1); real awning/alley/under-car
// cover lands with the alley pass, so the world is exposed everywhere for now.
const scent = createScent(scene, audio, {
  THREE,
  getDog: () => dogState.pos,
  getRain: () => env.rainT,
  shelterAt: () => 0,
});
// The keepsake — Errol's tennis ball. One persistent object the dog carries in
// his mouth from Act 2 into the ending. Built before the game (like scent) and
// fetches the field lazily so its aura lands even though window.__scent is set
// later. Injected so game.js drives acquire/setDown/rollTo at story beats.
const keepsake = createKeepsake(scene, audio, {
  THREE,
  getDog: () => dogState.pos,
  getHeading: () => dogState.heading,
  getScent: () => scent,
});
const game = createGame(scene, audio, {
  narrative,
  scent,
  keepsake,
  world: WORLD,
  pond: POND,
  getDog: () => dogState.pos,
  getHeading: () => dogState.heading,
  getDevice: () => activeDevice,
  setDogPos,
  setDogHeading,
  people: critters.people,
  dogs: critters.dogs,
  dogGroup: dog,
  feedDucks: critters.feedDucks,
  setDogScare: critters.setDogScare,
  spawnRex: critters.spawnRex,
  spawnPup: critters.spawnPup,
  crowds: critters.crowds,
  obstacles,
  pathfinder,
  fair,
  cityGate: cityRing.gate,        // Level 0 walks in through the ring's park arch
  cityStart: cityRing.startSpot,  // …starting out on the ring road
  cityCans: cityRing.cans,        // knock-over-for-food trash cans
  cityCart: cityRing.cart,        // beg-with-a-trick food cart
});

// (scent-tracking is created above, before the game, so it can be injected.)

// ---------------------------------------------------------------------------
// Draw-call budget: the world is ~1,350 primitive meshes, and every
// shadow-caster is drawn a SECOND time into the sun's shadow map — so the
// shadow pass was the cheapest big win. Small parts (ears, snouts, legs,
// collars, pickets, window panes…) each cast a shadow so tiny it's invisible
// under the body/prop shadow they sit on. Drop casting on anything below a
// size threshold: the perceived shadows are unchanged, but the shadow pass
// stops redrawing hundreds of trivial meshes. Materials are left untouched
// (many are mutated at runtime — flicker, fades — so sharing them is unsafe).
function pruneShadowCasters(root, minRadius) {
  let kept = 0, dropped = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.castShadow || !o.geometry) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const bs = o.geometry.boundingSphere;
    const s = o.scale ? Math.max(o.scale.x, o.scale.y, o.scale.z) : 1;
    if (bs && bs.radius * s < minRadius) { o.castShadow = false; dropped++; } else kept++;
  });
  return { kept, dropped };
}
// 0.5 keeps torsos, bodies, trees, buildings, the ground; drops the small
// attachments. Runs once over the built world; the few dynamic spawns (Rex, a
// bred pup) are negligible and can stay as-is.
const _shadowPrune = pruneShadowCasters(scene, 0.5);

// Debug/measurement hooks — watch the real draw-call count drop.
window.__renderer = renderer;
window.__renderInfo = () => ({ ...renderer.info.render });
window.__shadowPrune = _shadowPrune;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = Object.create(null);
// Keys that must NOT boot the game out of the title/continue screen. A bare
// keydown used to start it unconditionally, so reaching for a browser control
// — Ctrl (any chord), Fn, F11 fullscreen, or R/Ctrl+R to reload — launched a
// run instead. Modifier and function keys are never a "start" intent, and any
// chord held with Ctrl/Meta/Alt belongs to the browser, not the game.
function isStartIntent(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;   // browser chords
  if (/^(Control|Meta|Alt|Shift|Fn|F\d{1,2}|Tab|CapsLock|NumLock|ScrollLock|Escape|Pause|PrintScreen|ContextMenu|Insert|Home|End|PageUp|PageDown|Dead|Unidentified)/.test(e.key || "")) return false;
  if (/^(F\d{1,2}|Fn|FnLock|ControlLeft|ControlRight|MetaLeft|MetaRight|AltLeft|AltRight|ShiftLeft|ShiftRight|CapsLock|NumLock|ScrollLock|Tab|Escape|Pause|PrintScreen|ContextMenu|Insert|Home|End|PageUp|PageDown|BrowserRefresh)$/.test(e.code || "")) return false;
  if (e.code === "KeyR") return false;                    // reload muscle memory
  return true;
}
addEventListener("keydown", (e) => {
  startGame(e);        // self-guards: platform keystrokes never start a run
  keys[e.code] = true;
  // A read screen (briefing card) or a cutscene is confirmed/advanced ONLY by
  // the player — E / Space / Enter — never a timer. Handle it first so E
  // dismisses the card instead of firing a game action behind it.
  if (!e.repeat && (e.code === "KeyE" || e.code === "Space" || e.code === "Enter")) {
    if (game._cutsceneActive) { e.preventDefault(); game.advanceCinematic(); return; }
    const storyBtn = document.getElementById("story-btn");
    if (storyBtn && !document.getElementById("story-overlay").classList.contains("hidden")) {
      e.preventDefault(); storyBtn.click(); return;
    }
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyB" && !e.repeat && game.tryBark()) { audio.bark(); critters.playerBarked(); }
  if (e.code === "KeyE" && !e.repeat) game.interact();
  // G — set down / pick back up the keepsake (Errol's ball). A dedicated key,
  // deliberately kept OFF the overloaded E/interact prompt (brain dog#E52,
  // draft#E9: reusing a control that already has a world binding double-fires).
  // A no-op until the ball is actually acquired at the midpoint.
  if (e.code === "KeyG" && !e.repeat && game.keepsakeToggleCarry) game.keepsakeToggleCarry();
  if (e.code === "KeyM" && !e.repeat) updateSoundIcon(audio.toggleMute());
  if ((e.code === "KeyP" || e.code === "Escape") && !e.repeat) setPaused(!paused);
  // Hold T to open the free-roam trick wheel (released in keyup, below).
  if (e.code === "KeyT" && !e.repeat) openWheel();
  // Digit keys: while the trick wheel is open they perform that specific trick;
  // otherwise they're the Simon-Says showcase inputs (no-op unless the game is
  // actually waiting on trickInput — see game.js's stage guard).
  if (!e.repeat) {
    const digitKind = e.code === "Digit1" ? "sit" : e.code === "Digit2" ? "spin" : e.code === "Digit3" ? "speak" : null;
    if (digitKind) {
      if (wheelOpen) { if ((game.knownTricks || []).includes(digitKind)) doPerform(digitKind); }
      else { playTrickAnim(digitKind); game.trickInput(digitKind); }
    }
  }
});
addEventListener("keyup", (e) => {
  keys[e.code] = false;
  if (e.code === "KeyT") closeWheel(true); // release performs the highlighted trick
});

// ---- pause ----
let paused = false;
const pauseOverlay = document.getElementById("pause-overlay");
const pauseToggle = document.getElementById("pause-toggle");
const resumeBtn = document.getElementById("resume-btn");
const restartBtn = document.getElementById("restart-btn");
// Gamepad-navigable pause menu: which of the two buttons is highlighted.
// (There's no native focus system here — buttons only ever bound pointerdown
// — so a gamepad had no way to reach anything but the hardcoded primary
// button. This makes both items actually reachable.)
const wipeBtn = document.getElementById("wipe-btn");
let pauseFocusIdx = 0; // 0 = Resume, 1 = Restart, 2 = Delete save data
const pauseButtons = [resumeBtn, restartBtn, wipeBtn].filter(Boolean);
function applyPauseFocus() { pauseButtons.forEach((b, i) => b.classList.toggle("pad-focus", i === pauseFocusIdx)); }

// Delete every trace of this browser's save data and reload into a clean first
// run. Destructive and unrecoverable, so it takes a second, explicit confirm.
// Wipes by PREFIX rather than a hardcoded key list: the save keys are spread
// across slots, the active-slot pointer, the legacy pre-slot key, coat, name
// and settings, and a list would silently rot the next time one is added
// (brain dog#E64 — the bug there was exactly a stray localStorage key nobody
// remembered to include).
if (wipeBtn) wipeBtn.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  if (!confirm("Delete ALL save data?\n\nEvery save slot, your pup's name and coat, and all settings will be erased. This cannot be undone.")) return;
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("dogpark-")) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch (err) { /* storage can throw outright in embedded contexts */ }
  location.reload();
});
function setPaused(v) {
  paused = v;
  pauseOverlay.classList.toggle("hidden", !paused);
  pauseToggle.textContent = paused ? "▶" : "⏸";
  for (const k in keys) keys[k] = false; // drop held keys so nothing sticks
  if (paused) { pauseFocusIdx = 0; applyPauseFocus(); }
}
pauseToggle.addEventListener("pointerdown", (e) => { e.stopPropagation(); setPaused(!paused); });
resumeBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); setPaused(false); });
// Restart wipes the save and reloads into a fresh Level 1 — but keeps the
// SAME park seed (unlike the win screen's "escape to a new town" reload,
// which also reseeds). Confirm first, since it discards all progress. Named
// so gamepad confirm can call it directly (the button only listens for
// pointerdown, not the synthetic .click() a gamepad confirm would otherwise
// need to fake).
function doRestart() {
  if (!confirm("Restart from the beginning? This erases your saved progress (bond levels, tricks, achievements).")) return;
  game.clearSave();
  location.reload();
}
restartBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); doRestart(); });
// Auto-pause on focus loss. A gamepad's Start/Guide button often pops a
// SYSTEM-level overlay (Steam Input, Xbox Game Bar, etc.) that steals window
// focus before our own poll ever sees the press — the browser throttles/stops
// rAF while unfocused (looks exactly like "paused"), but setPaused() never
// ran, so our menu never showed and returning to the tab looked frozen with
// no way out. Catching both signals (blur = OS focus loss without hiding the
// document; visibilitychange = the document is actually hidden) covers it.
addEventListener("blur", () => { if (gameStarted && !paused) setPaused(true); });
document.addEventListener("visibilitychange", () => { if (gameStarted && document.hidden && !paused) setPaused(true); });

// ---- settings (persisted) ----
const settings = { minimap: true, reduceMotion: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem("dogpark-settings") || "{}")); } catch (e) {}
window.__settings = settings;
const settingsOverlay = document.getElementById("settings-overlay");
const setMinimap = document.getElementById("set-minimap");
const setReduce = document.getElementById("set-reduce");
function applySettings() {
  setMinimap.checked = settings.minimap;
  setReduce.checked = settings.reduceMotion;
  const mm = document.getElementById("minimap");
  if (mm) mm.classList.toggle("hidden", !(settings.minimap && running));
}
function saveSettings() { try { localStorage.setItem("dogpark-settings", JSON.stringify(settings)); } catch (e) {} applySettings(); }
document.getElementById("settings-toggle").addEventListener("pointerdown", (e) => { e.stopPropagation(); settingsOverlay.classList.remove("hidden"); applySettings(); });
document.getElementById("settings-done").addEventListener("pointerdown", (e) => { e.stopPropagation(); settingsOverlay.classList.add("hidden"); });
setMinimap.addEventListener("change", () => { settings.minimap = setMinimap.checked; saveSettings(); });
setReduce.addEventListener("change", () => { settings.reduceMotion = setReduce.checked; saveSettings(); });

// ---- achievements panel: the full checklist behind the HUD's bare "X/N"
// trophy chip. Rebuilt fresh every time it's opened (achievements only
// change rarely — an unlock — so there's no need to keep it live while closed).
const achOverlay = document.getElementById("ach-overlay");
const achList = document.getElementById("ach-list");
const achCount = document.getElementById("ach-count");
function renderAchievements() {
  const list = game.achievements;
  const n = list.filter((a) => a.unlocked).length;
  achCount.textContent = `${n}/${list.length}`;
  achList.innerHTML = list.map((a) => {
    const emoji = (a.name.match(/\p{Emoji}/u) || ["🏆"])[0];
    const label = a.unlocked ? a.name.replace(/\s*\p{Emoji}\s*$/u, "") : "???";
    const hint = a.unlocked ? a.hint : a.hint.replace(/^[A-Z]/, (c) => c.toLowerCase());
    return `<div class="ach-item ${a.unlocked ? "unlocked" : "locked"}">
      <span class="ach-emoji">${a.unlocked ? emoji : "🔒"}</span>
      <span class="ach-body"><span class="ach-name">${label}</span><span class="ach-hint">${a.unlocked ? "" : "Locked — "}${hint}</span></span>
      <span class="ach-check">✅</span>
    </div>`;
  }).join("");
}
document.getElementById("ach-toggle").addEventListener("pointerdown", (e) => { e.stopPropagation(); renderAchievements(); achOverlay.classList.remove("hidden"); });
document.getElementById("ach-done").addEventListener("pointerdown", (e) => { e.stopPropagation(); achOverlay.classList.add("hidden"); });

// initial sync (avoid touching `running` — it's declared later, TDZ)
setMinimap.checked = settings.minimap;
setReduce.checked = settings.reduceMotion;
if (!settings.minimap) document.getElementById("minimap").classList.add("hidden");

// ---- shareable park seed ----
const seedVal = document.getElementById("seed-val");
if (seedVal) seedVal.textContent = PARK_SEED;
const copySeedBtn = document.getElementById("copy-seed");
if (copySeedBtn) copySeedBtn.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  const url = location.origin + location.pathname + "#seed=" + PARK_SEED;
  try { navigator.clipboard && navigator.clipboard.writeText(url); } catch (err) {}
  const b = e.currentTarget, t = b.textContent; b.textContent = "Copied!"; setTimeout(() => { b.textContent = t; }, 1200);
});
const newParkBtn = document.getElementById("new-park");
if (newParkBtn) newParkBtn.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  location.hash = "seed=" + Math.floor(rng() * 1e6); location.reload();
});

// ---- full save codes: carry level/bond/bark/disguise/achievements anywhere ----
const copySaveBtn = document.getElementById("copy-save");
if (copySaveBtn) copySaveBtn.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  const code = game.exportSaveCode();
  const b = e.currentTarget, t = b.textContent;
  if (!code) { b.textContent = "Nothing to save yet"; setTimeout(() => { b.textContent = t; }, 1500); return; }
  try { navigator.clipboard && navigator.clipboard.writeText(code); } catch (err) {}
  b.textContent = "Copied!"; setTimeout(() => { b.textContent = t; }, 1200);
});
const loadSaveBtn = document.getElementById("load-save");
const loadSaveInput = document.getElementById("load-save-input");
if (loadSaveBtn && loadSaveInput) loadSaveBtn.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  const b = e.currentTarget, t = b.textContent;
  const result = game.importSaveCode(loadSaveInput.value);
  b.textContent = result.ok ? "Loaded!" : "Invalid code";
  setTimeout(() => { b.textContent = t; }, 1600);
  if (result.ok) loadSaveInput.value = "";
});
// clicks inside the input/button shouldn't fall through to canvas controls
if (loadSaveInput) loadSaveInput.addEventListener("pointerdown", (e) => e.stopPropagation());

// Tap anywhere on the cinematic letterbox skips the cutscene (movement is
// frozen while it plays, so there's nothing useful behind it to hit).
const cinemaEl = document.getElementById("cinema");
if (cinemaEl) cinemaEl.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (game.advanceCinematic) game.advanceCinematic(); });

// Camera orbit (mouse / right-side touch drag)
let camYaw = Math.PI, camPitch = 0.42;
const camDist = 8;
// Zoom: a multiplier on camDist. >1 pulls the camera back (see more park),
// <1 pushes in. Driven by mouse wheel (desktop) and two-finger pinch (touch)
// so both input surfaces can zoom — a fixed distance left mobile players with
// no way to pull back at all (dog#E27 input-surface parity).
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.4;
let camZoom = 1;
function setZoom(z) { camZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }
let wasFetchFrozen = false; // tracks the frisbee-cam freeze edge for the unfreeze handback
// Obstacle pull-in "scale" (1 = full distance, pulled toward 0.35 when
// something's between the dog and the camera) — smoothed with ASYMMETRIC
// damping: an instant snap on pull-in (an obstruction must never show even
// one frame of clipping) but an eased release once it clears. A merely-fast
// lerp on both directions still visibly flickers when the dog hovers right
// at an obstacle's edge, since the per-frame raycast toggles blocked/clear
// on tiny position noise — sandboxed and confirmed: smoothing cut frame-to-
// frame jitter ~90% in that exact hover-at-boundary case with zero clipping
// regressions (brain: local/sandbox-camera-occlusion).
let smoothedCamScale = 1;
let dragging = false, lastX = 0, lastY = 0, dragPointer = null;
// Active pointers that landed on the canvas (not the joystick — that stops
// propagation before this fires). One → orbit drag; two → pinch-zoom.
const camPointers = new Map();
let pinchDist = 0; // last two-finger separation while pinching (0 = not pinching)

canvas.addEventListener("pointerdown", (e) => {
  startGame();
  // On touch, the left side is the joystick zone (handled separately).
  camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (camPointers.size === 2) {
    // Second finger down → switch from orbit to pinch; seed the separation.
    dragging = false; dragPointer = null;
    const p = [...camPointers.values()];
    pinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  } else {
    dragging = true; dragPointer = e.pointerId; lastX = e.clientX; lastY = e.clientY;
  }
});
addEventListener("pointermove", (e) => {
  if (camPointers.has(e.pointerId)) camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (camPointers.size >= 2) {
    // Two-finger pinch = zoom (orbit is suspended). Fingers apart → zoom in;
    // fingers together → zoom out. Ratio-based so it tracks the gesture 1:1.
    const p = [...camPointers.values()];
    const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    if (pinchDist > 0 && d > 0) setZoom(camZoom * (pinchDist / d));
    pinchDist = d;
    return;
  }
  if (!dragging || e.pointerId !== dragPointer) return;
  camYaw -= (e.clientX - lastX) * 0.005;
  camPitch += (e.clientY - lastY) * 0.005;
  camPitch = Math.max(0.1, Math.min(1.2, camPitch));
  lastX = e.clientX; lastY = e.clientY;
});
function endCamPointer(e) {
  if (!camPointers.has(e.pointerId)) return;
  camPointers.delete(e.pointerId);
  pinchDist = 0;
  if (e.pointerId === dragPointer) { dragging = false; dragPointer = null; }
  // If one finger remains after a pinch, hand orbit back to it cleanly so the
  // camera doesn't jump on the leftover pointer's next move.
  if (camPointers.size === 1) {
    const [id, p] = [...camPointers.entries()][0];
    dragging = true; dragPointer = id; lastX = p.x; lastY = p.y;
  }
}
addEventListener("pointerup", endCamPointer);
addEventListener("pointercancel", endCamPointer);

// Desktop parity: mouse wheel zooms (down = out, up = in).
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  setZoom(camZoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

// Virtual joystick (mobile)
let joyVec = { x: 0, y: 0 };
const padMove = { x: 0, y: 0 }; // gamepad left-stick, fed into the move vector
const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
const touchControls = document.getElementById("touch-controls");
const joystick = document.getElementById("joystick");
const stick = document.getElementById("stick");
const jumpBtn = document.getElementById("jump-btn");

// ---- device-adaptive UI: show controls in the language of the ACTIVE device.
// Touch buttons appear only while touch is active; a control legend renders in
// the active device's own vocabulary (keycaps for keyboard, A/B/X badges for a
// gamepad); touch is self-labeling so it needs no legend. Switches live. ----
const legendEl = document.getElementById("legend");
let activeDevice = isTouch ? "touch" : "key";
function legendHTML(dev, trickActive) {
  // During the Simon-Says trick showcase, A/B/X and Digit1/2/3 briefly mean
  // something different (sit/spin/speak) — say so, or a player has no way
  // to discover the reused inputs do double duty.
  if (trickActive) {
    if (dev === "pad") {
      return '🎮 trick showcase — <span class="badge a">A</span> sit · <span class="badge b">B</span> spin · <span class="badge x">X</span> speak';
    }
    return '⌨ trick showcase — <b>1</b> sit · <b>2</b> spin · <b>3</b> speak';
  }
  if (dev === "pad") {
    return '🎮 <b>L</b>-stick move · <b>R</b>-stick look · ' +
      '<span class="badge a">A</span> jump · <span class="badge x">X</span> act · ' +
      '<span class="badge b">B</span> bark · <span class="badge">LT</span> tricks · <span class="badge">☰</span> pause';
  }
  return '⌨ <b>WASD</b> move · <b>Mouse</b> look · <b>E</b> act · <b>B</b> bark · <b>T</b> tricks · <b>Space</b> jump · <b>P</b> pause';
}
let lastLegendTrickState = false;
function applyDeviceUI() {
  if (touchControls) touchControls.classList.toggle("hidden", activeDevice !== "touch");
  if (!legendEl) return;
  if (activeDevice === "touch") { legendEl.classList.add("hidden"); }
  else { legendEl.innerHTML = legendHTML(activeDevice, lastLegendTrickState); legendEl.classList.remove("hidden"); }
}
function setDevice(dev) { if (dev === activeDevice) return; activeDevice = dev; applyDeviceUI(); }
applyDeviceUI();
addEventListener("keydown", () => setDevice("key"));
addEventListener("pointerdown", (e) => setDevice(e.pointerType === "touch" ? "touch" : "key"));

let joyId = null, joyCx = 0, joyCy = 0;
joystick.addEventListener("pointerdown", (e) => {
  startGame();
  joyId = e.pointerId;
  const r = joystick.getBoundingClientRect();
  joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2;
  joystick.setPointerCapture(e.pointerId);
  e.stopPropagation();
});
joystick.addEventListener("pointermove", (e) => {
  if (e.pointerId !== joyId) return;
  let dx = e.clientX - joyCx, dy = e.clientY - joyCy;
  const max = 46, len = Math.hypot(dx, dy);
  if (len > max) { dx = dx / len * max; dy = dy / len * max; }
  stick.style.transform = `translate(${dx}px, ${dy}px)`;
  joyVec.x = dx / max; joyVec.y = dy / max;
});
function endJoy(e) {
  if (e.pointerId !== joyId) return;
  joyId = null; joyVec.x = 0; joyVec.y = 0; stick.style.transform = "translate(0,0)";
}
joystick.addEventListener("pointerup", endJoy);
joystick.addEventListener("pointercancel", endJoy);

let jumpQueued = false;
jumpBtn.addEventListener("pointerdown", (e) => { startGame(); jumpQueued = true; e.stopPropagation(); });

const barkBtn = document.getElementById("bark-btn");
barkBtn.addEventListener("pointerdown", (e) => { startGame(); if (game.tryBark()) { audio.bark(); critters.playerBarked(); } e.stopPropagation(); });

const actBtn = document.getElementById("act-btn");
// Authoritative hold state for mobile — same E-hold gesture that advances a
// rules cutscene, fed to game.tickHold() every frame alongside the keyboard.
let actHeld = false;
if (actBtn) {
  actBtn.addEventListener("pointerdown", (e) => { startGame(); actHeld = true; game.interact(); e.stopPropagation(); });
  actBtn.addEventListener("pointerup", (e) => { actHeld = false; e.stopPropagation(); });
  actBtn.addEventListener("pointerleave", () => { actHeld = false; });
  actBtn.addEventListener("pointercancel", () => { actHeld = false; });
}

// Simon-Says trick showcase buttons — visible only while game._trickInputActive.
const trickControlsEl = document.getElementById("trick-controls");
const trickSitBtn = document.getElementById("trick-sit-btn");
const trickSpinBtn = document.getElementById("trick-spin-btn");
const trickSpeakBtn = document.getElementById("trick-speak-btn");
// The dog's actual performance of a trick — every SIT/SPIN/SPEAK press plays
// this immediately regardless of whether it turns out to be the CORRECT next
// trick in the sequence (correctness is resolved separately by game.js); the
// player pressed a button expecting their dog to visibly do something, and
// silence there reads as broken no matter how the round ultimately scores.
const TRICK_DUR = { sit: 0.5, spin: 0.7, speak: 0.45, look: 1.6, eat: 2.2 };
let trickAnim = null; // { kind, t, dur } — one-shot poses only (spin/speak/look/eat)
let _lastCutShot = null; // which cutscene shot the camera is on (a change = a hard cut)
// SIT is a persistent character STATE, not a timed animation: once entered it
// holds the pose every frame until something explicitly cancels it (a real
// trick, real movement, a jump) — not a duration that reverts itself. This is
// what lets a scripted cutscene hold on a sit for as long as its shots need
// ("do not cut early — the sit is the shot") instead of popping back to idle
// after TRICK_DUR.sit's 0.5s.
let dogSitting = false;
function enterSit() { dogSitting = true; trickAnim = null; }
function exitSit() { dogSitting = false; }
// Only a genuine ALTERNATE trick stands the dog up first — cosmetic staging
// poses (look/eat) are meant to compose with a held sit (e.g. dipping the head
// to take a treat while still seated), not cancel it.
const STANDING_TRICKS = new Set(["spin", "speak"]);
function applyTrickPose(kind) {
  if (kind === "sit") { enterSit(); return; }
  if (dogSitting && STANDING_TRICKS.has(kind)) exitSit();
  trickAnim = { kind, t: 0, dur: TRICK_DUR[kind] || 0.5 };
  if (kind === "speak") audio.bark();
}
function playTrickAnim(kind) {
  if (!game._trickInputActive) return;
  applyTrickPose(kind);
}
if (trickSitBtn) trickSitBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); playTrickAnim("sit"); game.trickInput("sit"); });
if (trickSpinBtn) trickSpinBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); playTrickAnim("spin"); game.trickInput("spin"); });
if (trickSpeakBtn) trickSpeakBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); playTrickAnim("speak"); game.trickInput("speak"); });

// ---- Free-roam trick wheel -------------------------------------------------
// Hold a trigger (LT on a pad, T on a keyboard) or tap the 🐾 touch button to
// open a radial menu of the tricks you've learned; aim with the stick/mouse to
// highlight one, then release (or tap a slice) to perform it near a friend.
// This is the player's proactive, pick-exactly-which-trick path — separate from
// approaching an NPC (context "Show off") and from the Simon-Says contest.
const trickWheelEl = document.getElementById("trick-wheel");
const trickWheelRing = document.getElementById("trick-wheel-ring");
const trickWheelHintEl = document.getElementById("trick-wheel-hint");
const trickBtn = document.getElementById("trick-btn");
const TW_META = { sit: { emoji: "🪑", name: "Sit" }, spin: { emoji: "🌀", name: "Spin" }, speak: { emoji: "💬", name: "Speak" } };
let wheelOpen = false, wheelTricks = [], wheelSel = 0;

function canOpenWheel() {
  return running && !paused && game.phase === "play" && !game._contest &&
    !game._cutsceneActive && !game._trickInputActive;
}
function highlightWheel() {
  if (!trickWheelRing) return;
  [...trickWheelRing.children].forEach((c, i) => c.classList.toggle("sel", i === wheelSel));
}
function renderWheelRing() {
  if (!trickWheelRing) return;
  trickWheelRing.innerHTML = "";
  const n = wheelTricks.length || 1;
  wheelTricks.forEach((kind, i) => {
    const m = TW_META[kind] || { emoji: "🐾", name: kind };
    const ang = (-90 + i * (360 / n)) * Math.PI / 180; // slice 0 at top, clockwise
    const R = 78;
    const b = document.createElement("button");
    b.className = "tw-slice" + (i === wheelSel ? " sel" : "");
    b.style.left = `calc(50% + ${(Math.cos(ang) * R).toFixed(1)}px)`;
    b.style.top = `calc(50% + ${(Math.sin(ang) * R).toFixed(1)}px)`;
    b.innerHTML = `<span class="tw-emoji">${m.emoji}</span><span class="tw-name">${m.name}</span>`;
    b.addEventListener("pointerdown", (e) => { e.stopPropagation(); doPerform(kind); });
    trickWheelRing.appendChild(b);
  });
}
function openWheel() {
  if (wheelOpen || !canOpenWheel()) return;
  wheelTricks = (game.knownTricks || []).slice(0, 3);
  wheelSel = 0;
  wheelOpen = true;
  if (trickWheelHintEl) trickWheelHintEl.textContent =
    wheelTricks.length ? "Aim & release" : "No tricks yet — learn one in the park!";
  renderWheelRing();
  trickWheelEl.classList.remove("hidden");
}
// Perform the given trick (or just dismiss, if kind is null) and close.
function doPerform(kind) {
  if (!wheelOpen) return;
  wheelOpen = false;
  trickWheelEl.classList.add("hidden");
  wheelTricks = [];
  if (kind) game.performTrick(kind);
}
function closeWheel(perform) { doPerform(perform ? wheelTricks[wheelSel] : null); }
// Aim: pick the slice nearest the pointing direction (screen up = -y).
function aimWheel(vx, vy, mag) {
  if (!wheelOpen || wheelTricks.length < 2 || mag < 0.45) return;
  const n = wheelTricks.length;
  const a = Math.atan2(vx, -vy); // 0 = up, clockwise positive
  let best = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const sa = i * (2 * Math.PI / n);
    const d = Math.abs(((a - sa + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best !== wheelSel) { wheelSel = best; highlightWheel(); }
}
// Tap the scrim (not a slice) to dismiss without performing.
if (trickWheelEl) trickWheelEl.addEventListener("pointerdown", () => doPerform(null));
// Mouse aim while the wheel is open (keyboard players point with the mouse).
addEventListener("mousemove", (e) => {
  if (!wheelOpen) return;
  const cx = innerWidth / 2, cy = innerHeight / 2, dx = e.clientX - cx, dy = e.clientY - cy;
  aimWheel(dx, dy, Math.hypot(dx, dy) / 80);
});
// Touch: the 🐾 button opens the wheel (slices/scrim handle the rest).
if (trickBtn) trickBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); startGame(); if (wheelOpen) doPerform(null); else openWheel(); });

// Sound toggle
const soundToggle = document.getElementById("sound-toggle");
function updateSoundIcon(muted) {
  soundToggle.textContent = muted ? "🔇" : "🔊";
  soundToggle.classList.toggle("muted", muted);
}
updateSoundIcon(audio.muted);
soundToggle.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  updateSoundIcon(audio.toggleMute());
});

// ---------------------------------------------------------------------------
// Game start
// ---------------------------------------------------------------------------
const overlay = document.getElementById("overlay");
const overlayCard = overlay.querySelector(".card"); // scrollable title card — see gamepad scroll in pollGamepad
// ---- save-slot picker: three cards on the title card, from the game's store.
// Selecting a slot sets the active slot BEFORE startGame() (so begin() loads
// it); an empty slot starts fresh. Delete wipes a slot. The start button then
// enters whichever slot is active — so a plain click (and every existing test
// that just clicks Enter) keeps working with the default slot.
const slotCardsEl = document.getElementById("slot-cards");
const escSlot = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function fmtPlaytime(sec) {
  sec = Math.max(0, sec | 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${sec}s`;
}

// ---- boot flow: three screens, one at a time (was a single cramped card with
// no working controller nav for slots — left/right always meant "cycle coat",
// nothing let a gamepad player choose a save slot at all). Step 0 picks a
// slot (Continue an existing one -> straight into the park; or start a new
// one -> continues to step 1). Steps 1 (coat) and 2 (name) only happen for a
// new game. #start-btn is ONE stable "confirm" control across every step, so
// there's always exactly one thing to press (click, Enter, or gamepad A). ----
const startBtn = document.getElementById("start-btn"); // declared here, not below —
// renderSlots()/applySlotFocus() (called during this block's own setup, before
// startGame()'s section) read startBtn.textContent, so it must exist first.
let wizStep = 0;          // 0 slots, 1 coat, 2 name
let slotFocusIdx = 0;     // which slot card is gamepad/keyboard-focused at step 0
const stepEls = {
  slots: document.getElementById("step-slots"),
  coat: document.getElementById("step-coat"),
  name: document.getElementById("step-name"),
};
const padHintEl = document.getElementById("pad-hint");
const PAD_HINTS = {
  0: "🎮 ◀ ▶ choose a slot · A confirm",
  1: "🎮 ◀ ▶ coat · A next",
  2: "🎮 Y new name · A enter",
};
function setWizStep(n) {
  wizStep = n;
  stepEls.slots.classList.toggle("hidden", n !== 0);
  stepEls.coat.classList.toggle("hidden", n !== 1);
  stepEls.name.classList.toggle("hidden", n !== 2);
  startBtn.textContent = n === 0 ? (slotIsEmpty(slotFocusIdx) ? "Start New Game" : "Continue")
    : n === 1 ? "Next" : "Enter the Park";
  if (padHintEl) padHintEl.textContent = PAD_HINTS[n]; // set even while hidden, so it's ready the instant a pad connects
  if (n === 0) applySlotFocus();
}
function slotIsEmpty(idx) {
  const cards = game.listSlots ? game.listSlots() : [];
  return !cards[idx] || cards[idx].empty;
}
function applySlotFocus() {
  if (!slotCardsEl) return;
  slotCardsEl.querySelectorAll(".slot-card").forEach((el, i) => el.classList.toggle("pad-focus", i === slotFocusIdx));
  if (wizStep === 0) startBtn.textContent = slotIsEmpty(slotFocusIdx) ? "Start New Game" : "Continue";
}
// Commit to a slot: an existing one goes straight into the park; an empty one
// starts fresh and continues to the coat step (brain dbh#E4: New Game must use
// the real reset path, not just reopen character creation — newGameInSlot()
// does that; see game.js).
function confirmSlot(idx) {
  const cards = game.listSlots ? game.listSlots() : [];
  const c = cards[idx]; if (!c) return;
  if (c.empty) {
    game.newGameInSlot(c.slot);
    renderSlots();
    setWizStep(1);
  } else {
    const card = game.useSlot(c.slot);
    if (card && !card.empty) {
      if (nameInputEl) nameInputEl.value = card.name === "Unnamed pup" ? "" : card.name;
      if (card.coat) { applyCoat(card.coat); markCoatSwatches(); }
    }
    startGame();
  }
}
function renderSlots() {
  if (!slotCardsEl || !game.listSlots) return;
  const active = game.activeSlot;
  slotCardsEl.innerHTML = "";
  game.listSlots().forEach((c, i) => {
    const el = document.createElement("div");
    el.className = "slot-card" + (c.empty ? " empty" : "") + (c.slot === active ? " on" : "");
    el.dataset.slot = c.slot;
    if (c.empty) {
      el.innerHTML = `<div class="slot-name">Slot ${c.slot + 1}</div><div class="slot-meta">Empty — new game</div>`;
    } else {
      el.innerHTML = `<div class="slot-name">${escSlot(c.name)}</div>`
        + `<div class="slot-meta">${escSlot(c.act)} · ⏱${fmtPlaytime(c.playtime)}</div>`
        + `<button class="slot-del" type="button" title="Delete this save" aria-label="Delete save">✕</button>`;
    }
    el.addEventListener("pointerdown", (e) => {
      if (e.target && e.target.classList.contains("slot-del")) return;
      e.stopPropagation();
      slotFocusIdx = i;
      confirmSlot(i);
    });
    const del = el.querySelector(".slot-del");
    if (del) del.addEventListener("pointerdown", (e) => { e.stopPropagation(); game.deleteSlot(c.slot); renderSlots(); });
    slotCardsEl.appendChild(el);
  });
  applySlotFocus();
}
setWizStep(0); // sets the initial start-btn label from the actual slot state
renderSlots();

const loadingEl = document.getElementById("loading");
let running = false;
loadingEl.classList.add("done");
// Start the game. Idempotent, and triggered by ANY interaction (the Enter
// button, the joystick, or any control) so the player can never end up stuck in
// a started-but-not-playing limbo. Audio is best-effort and never gates this.
let gameStarted = false;
// `ev` is optional: pass the originating event and startGame self-rejects any
// keystroke the PLATFORM owns. The guard lives here rather than at the call
// site because there are seven call sites and only the keyboard one ever had
// it — a second keyboard entry point added later would silently reopen the
// hole. A sandbox on this exact bug class measured why that matters: with the
// guard per-surface, independently-written versions have non-overlapping blind
// spots and an app's exposure is the UNION across surfaces, so fixing one
// surface buys nothing until every surface is fixed. One predicate, one place.
function startGame(ev) {
  if (ev && ev.type === "keydown" && !isStartIntent(ev)) return;
  if (gameStarted) return;
  gameStarted = true;
  overlay.classList.add("hidden");
  running = true;
  try { game.begin(); } catch (e) { console.warn("game begin failed", e); }
  audio.start().catch((err) => console.warn("audio start failed", err));
}
// #start-btn is the one "confirm" control for whichever step is active. Only
// "click" is bound (not also pointerup, unlike the old always-idempotent
// startGame() binding) — confirmStep() advances one step per call, so a
// double-fire from binding both events would skip a step on a single press.
function confirmStep() {
  if (wizStep === 0) confirmSlot(slotFocusIdx);
  else if (wizStep === 1) setWizStep(2);
  else startGame();
}
startBtn.addEventListener("click", confirmStep);

// ---------------------------------------------------------------------------
// Gamepad (global) — works in menus and in play. Standard mapping:
//   left stick = move, right stick = look, A = jump/confirm, B = bark,
//   X = action (E), Y = bark, Start = pause, and any button dismisses overlays.
// ---------------------------------------------------------------------------
let padSprint = false;
let padActHeld = false; // gamepad X currently held — feeds game.tickHold() alongside keyboard/touch
const prevBtn = [];
function overlayButton() {
  // the primary button of whatever overlay is currently up (top-most wins)
  if (!document.getElementById("story-overlay").classList.contains("hidden")) return document.getElementById("story-btn");
  if (!document.getElementById("settings-overlay").classList.contains("hidden")) return document.getElementById("settings-done");
  if (!document.getElementById("ach-overlay").classList.contains("hidden")) return document.getElementById("ach-done");
  if (!pauseOverlay.classList.contains("hidden")) return document.getElementById("resume-btn");
  if (!overlay.classList.contains("hidden")) return startBtn;
  return null;
}
function pollGamepad(dt) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) { padMove.x = 0; padMove.y = 0; padActHeld = false; return; }
  const dz = (v) => (Math.abs(v) > 0.2 ? v : 0);
  const ax = gp.axes;
  // any real stick/button activity makes the gamepad the active device
  if (gp.buttons.some((b) => b && b.pressed) || [ax[0], ax[1], ax[2], ax[3]].some((v) => Math.abs(v || 0) > 0.3)) setDevice("pad");
  // left stick → movement
  padMove.x = dz(ax[0] || 0);
  padMove.y = dz(ax[1] || 0);
  // right stick → camera look (scaled by dt so it's framerate-independent)
  if (dt > 0) {
    camYaw -= dz(ax[2] || 0) * 2.6 * dt;
    camPitch += dz(ax[3] || 0) * 2.0 * dt;
    camPitch = Math.max(0.1, Math.min(1.2, camPitch));
  }
  const B = gp.buttons;
  const down = (i) => !!(B[i] && B[i].pressed);
  const edge = (i) => down(i) && !prevBtn[i];
  padSprint = down(7) || down(10); // RT / L3 = sprint (LT is the trick wheel now)
  // X held — the gamepad's ACT button — mirrors keyboard E / the touch ACT
  // button for game.tickHold()'s press-and-hold contest-rules cutscene (the
  // fetch-off/trick-showcase briefing). Read unconditionally like the rest of
  // this function's raw button state; tickHold no-ops outside that cutscene.
  padActHeld = down(2);

  // Left trigger opens the free-roam trick wheel: hold to open, aim with the
  // left stick, release (or press X) to perform the highlighted trick. While
  // it's open the left stick aims the wheel instead of moving the dog.
  const ltHeld = down(6);
  if (ltHeld && !wheelOpen) openWheel();
  if (wheelOpen) {
    if (!ltHeld) { closeWheel(true); }
    else {
      const sx = ax[0] || 0, sy = ax[1] || 0;
      aimWheel(sx, sy, Math.hypot(sx, sy));
      padMove.x = 0; padMove.y = 0;      // stick aims the wheel, doesn't move the dog
      if (edge(2)) { closeWheel(true); } // X performs immediately
    }
  }

  const ov = overlayButton();
  const startOpen = ov === startBtn; // the title screen is the active overlay
  if (ov) {
    const pauseOpen = !pauseOverlay.classList.contains("hidden");
    if (startOpen) {
      // Boot flow is one step at a time now (slots -> coat -> name), so D-pad
      // left/right means something DIFFERENT per step instead of always
      // cycling coat — that flat mapping was exactly why a gamepad had no way
      // to choose a save slot before. Nav is edge-debounced so holding a
      // direction doesn't race. A/Start always means "confirm this step"
      // (same action #start-btn's click does), replacing the old "any button
      // starts the game" behaviour so a stick nudge navigates instead of
      // skipping the screen.
      const stickX = dz(ax[0] || 0);
      const navL = edge(14) || (stickX <= -0.55 && !prevBtn._padNav);
      const navR = edge(15) || (stickX >= 0.55 && !prevBtn._padNav);
      if (wizStep === 0) {
        const slotCount = (game.listSlots ? game.listSlots() : []).length || 1;
        if (navL) { slotFocusIdx = (slotFocusIdx - 1 + slotCount) % slotCount; applySlotFocus(); }
        else if (navR) { slotFocusIdx = (slotFocusIdx + 1) % slotCount; applySlotFocus(); }
      } else if (wizStep === 1) {
        if (navL) cycleCoat(-1);
        else if (navR) cycleCoat(1);
      }
      prevBtn._padNav = Math.abs(stickX) >= 0.55;
      // The title card can overflow taller than the viewport — mouse wheel and
      // touch drag already scroll it, but a gamepad had no way to. D-pad
      // up/down or the left stick's vertical axis scrolls it continuously
      // (not edge-triggered — held input keeps scrolling), scaled by dt like
      // the right-stick camera look.
      if (overlayCard && dt > 0) {
        const stickY = dz(ax[1] || 0);
        let scrollV = stickY; // left stick up/down
        if (down(12)) scrollV = -1; else if (down(13)) scrollV = 1; // D-pad up/down override
        if (scrollV) overlayCard.scrollTop += scrollV * 620 * dt;
      }
      if (wizStep === 2 && (edge(2) || edge(3))) rerollName(); // X / Y → new name (name step only)
      if (edge(0) || edge(9)) confirmStep();   // A / Start → confirm the active step
      const hint = document.getElementById("pad-hint"); // reveal controls once a pad is live
      if (hint) hint.classList.remove("hidden");
    } else if (pauseOpen) {
      // Pause menu: D-pad/left-stick up-down toggles Resume/Restart.
      const stickY = dz(ax[1] || 0);
      if (edge(12) || edge(13) || (stickY !== 0 && Math.abs(stickY) > 0.6 && !prevBtn._padStick)) {
        pauseFocusIdx = pauseFocusIdx === 0 ? 1 : 0;
        applyPauseFocus();
      }
      prevBtn._padStick = Math.abs(stickY) > 0.6;
      if (edge(0) || edge(9) || edge(2)) {
        if (edge(9)) setPaused(false); // Start is always a quick-resume
        else if (pauseFocusIdx === 1) doRestart();
        else setPaused(false);
      }
    } else {
      // settings / achievements / story overlays: A / Start / X confirm-dismiss
      if (edge(0) || edge(9) || edge(2)) {
        if (!settingsOverlay.classList.contains("hidden")) settingsOverlay.classList.add("hidden");
        else if (!achOverlay.classList.contains("hidden")) achOverlay.classList.add("hidden");
        else ov.click();
      }
    }
  } else if (game._cutsceneActive) {
    // A cutscene advances ONLY on the player's confirm — A (or X / Start) steps
    // to the next shot; no timer. Other buttons do nothing here.
    if (edge(0) || edge(2) || edge(9)) game.advanceCinematic();
  } else {
    // During the Simon-Says trick QTE, A/B/X ARE sit/spin/speak (below) — their
    // normal meanings must not also fire, or e.g. B would input "spin" AND make
    // the dog bark (interact self-guards and jump is frozen out, but bark did
    // not — brain dog#E27: a new minigame action colliding with an existing
    // binding on the gamepad surface only, since the keyboard uses 1/2/3). One
    // override seam for the QTE window (brain dog#E20). Pause stays live.
    if (!game._trickInputActive) {
      if (edge(0)) jumpQueued = true;                 // A → jump
      if (edge(2) && !wheelOpen) game.interact();      // X → action (E); wheel eats X while open
      if (edge(1) || edge(3)) { if (game.tryBark()) { audio.bark(); critters.playerBarked(); } } // B/Y → bark
    }
    if (edge(9) || edge(8)) setPaused(!paused);       // Start/Select → pause
  }
  // Simon-Says trick input (A/B/X → sit/spin/speak) — mirrors the keyboard
  // Digit1/2/3 and touch trick buttons above: fire unconditionally, since
  // playTrickAnim()/trickInput() both self-guard on _trickInputActive and
  // are no-ops otherwise (same context-gated pattern as the rest of input).
  if (edge(0)) { playTrickAnim("sit"); game.trickInput("sit"); }
  if (edge(1)) { playTrickAnim("spin"); game.trickInput("spin"); }
  if (edge(2)) { playTrickAnim("speak"); game.trickInput("speak"); }
  // A fresh button press boots the game out of any NON-title overlay (e.g. a
  // story card). The title screen is handled above (A/Start only), so a stick
  // nudge there navigates the coat picker instead of starting the game.
  for (let i = 0; i < B.length; i++) { if (!startOpen && edge(i)) startGame(); prevBtn[i] = down(i); }
}
addEventListener("gamepadconnected", () => {
  // On a fresh page load the Gamepad API stays hidden from navigator.getGamepads()
  // until the page receives a user gesture (a Chromium/Brave anti-fingerprinting
  // gate) — but the gamepadconnected event DOES fire on the first button/stick
  // input, and once it has, getGamepads() starts returning the pad. So just wake
  // polling here (mark the pad active); do NOT auto-start, or the very first
  // stick nudge would skip the title screen. From the next frame pollGamepad can
  // read the pad and drive title-screen navigation (coat picking + A to enter).
  setDevice("pad");
});

// ---------------------------------------------------------------------------
// Update loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const GRAVITY = 22;
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpMove = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

function update(dt) {
  // The trick wheel can't outlive the state it opened in (pause, a cutscene, a
  // contest starting) — dismiss it without performing if the moment has passed.
  if (wheelOpen && !canOpenWheel()) doPerform(null);
  // --- input vector (camera-relative) ---
  let ix = 0, iz = 0;
  if (keys["KeyW"] || keys["ArrowUp"]) iz += 1;
  if (keys["KeyS"] || keys["ArrowDown"]) iz -= 1;
  if (keys["KeyD"] || keys["ArrowRight"]) ix += 1;
  if (keys["KeyA"] || keys["ArrowLeft"]) ix -= 1;
  // joystick + gamepad left stick: up on screen = forward
  ix += joyVec.x + padMove.x; iz += -joyVec.y - padMove.y;
  ix = Math.max(-1, Math.min(1, ix));
  iz = Math.max(-1, Math.min(1, iz));

  const wantSprint = keys["ShiftLeft"] || keys["ShiftRight"] || padSprint;
  const pl = game.player || {};
  const canSprint = wantSprint && (pl.stamina === undefined || pl.stamina > 0.05);
  const running_ = canSprint;
  const boost = pl.speedMul || 1; // treat "zoomies"
  const maxSpeed = (canSprint ? 16 : 9) * boost;

  // The Rex fetch-off's frisbee-cam: both dogs frozen (no input applied)
  // while the camera tracks the thrown frisbee, for a fixed window with no
  // skip — world.js just obeys game.js's authoritative freeze flag.
  const fetchFrozen = !!(game._fetchFrozen);
  // Movement is ALSO frozen through any rules cutscene and the whole trick
  // showcase (watch + input) — the player can only perform tricks there, not
  // walk away. _movementFrozen already includes the fetch-cam window above.
  const movementFrozen = !!(game._movementFrozen);
  const judgeCamActive = !!(game._judgeCamActive);
  game.tickHold(!!(keys["KeyE"] || actHeld || padActHeld), dt);
  const trickInputActive = !!game._trickInputActive;
  if (trickInputActive !== lastLegendTrickState) { lastLegendTrickState = trickInputActive; applyDeviceUI(); }
  if (trickControlsEl) trickControlsEl.classList.toggle("hidden", !trickInputActive);
  // Trick-controls REPLACES the normal touch controls while active (movement
  // is frozen and ACT/JUMP are no-ops during trick-input anyway) — without
  // this they visually stack: the joystick sits directly under SIT and the
  // ACT button directly under SPEAK on a phone-width viewport (found via a
  // real touch-viewport screenshot + bounding-box overlap check).
  if (touchControls) touchControls.classList.toggle("hidden", activeDevice !== "touch" || trickInputActive);

  // forward = from camera toward dog, flattened
  tmpForward.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)).normalize();
  tmpRight.crossVectors(tmpForward, up).normalize();
  tmpMove.set(0, 0, 0)
    .addScaledVector(tmpForward, iz)
    .addScaledVector(tmpRight, ix);

  if (movementFrozen) {
    dogState.speed = 0;
  } else {
    const mag = Math.min(1, tmpMove.length());
    if (mag > 0.01) {
      tmpMove.normalize();
      dogState.heading = Math.atan2(tmpMove.x, tmpMove.z);
      dogState.speed = maxSpeed * mag;
      if (dogSitting) exitSit(); // real movement input cancels a held sit
    } else {
      dogState.speed = 0;
    }

    // move with simple obstacle avoidance
    const step = dogState.speed * dt;
    if (step > 0) {
      const nx = dogState.pos.x + tmpMove.x * step;
      const nz = dogState.pos.z + tmpMove.z * step;
      if (!blocked(nx, dogState.pos.z)) dogState.pos.x = nx;
      if (!blocked(dogState.pos.x, nz)) dogState.pos.z = nz;
    }
    // knockback (e.g. a duck peck) — an impulse that decays quickly
    if (dogState.knock.lengthSq() > 0.0001) {
      dogState.pos.x += dogState.knock.x * dt;
      dogState.pos.z += dogState.knock.z * dt;
      dogState.knock.multiplyScalar(Math.pow(0.02, dt));
    }
    // clamp to the whole world (park core PLUS the surrounding city ring)
    const lim = WORLD_OUTER - 3;
    dogState.pos.x = Math.max(-lim, Math.min(lim, dogState.pos.x));
    dogState.pos.z = Math.max(-lim, Math.min(lim, dogState.pos.z));
  }

  // stamina: sprinting drains it, everything else recovers it (gates sprint above)
  if (pl.stamina !== undefined) {
    const moving = dogState.speed > 0.6;
    if (canSprint && moving) pl.stamina = Math.max(0, pl.stamina - dt * 0.34);
    else pl.stamina = Math.min(1, pl.stamina + dt * (moving ? 0.14 : 0.28));
  }

  // jump
  if (!movementFrozen && (keys["Space"] || jumpQueued) && dogState.onGround) {
    dogState.vy = 9.5; dogState.onGround = false;
    if (dogSitting) exitSit(); // can't jump from a seated hold
    audio.jump();
  }
  jumpQueued = false;
  dogState.vy -= GRAVITY * dt;
  dogState.pos.y += dogState.vy * dt;
  if (dogState.pos.y <= 0) {
    const impact = -dogState.vy; // downward speed at touchdown
    dogState.pos.y = 0; dogState.vy = 0;
    if (!dogState.onGround && impact > 2) audio.land(Math.min(1.4, impact / 9));
    dogState.onGround = true;
  }

  // apply to dog object
  dog.position.copy(dogState.pos);
  // smooth heading turn
  dog.rotation.y = lerpAngle(dog.rotation.y, dogState.heading, 1 - Math.pow(0.001, dt));

  // --- footsteps & pond ambience ---
  dogState.walkPhase += dogState.speed * dt * 1.2;
  const dpx = dogState.pos.x - POND.x, dpz = dogState.pos.z - POND.z;
  const pondDist = Math.hypot(dpx, dpz);
  const stepIndex = Math.floor(dogState.walkPhase / Math.PI);
  if (dogState.onGround && dogState.speed > 0.6 && stepIndex !== lastStepIndex) {
    audio.footstep(running_ ? 1.0 : 0.7, pondDist < POND.r);
  }
  lastStepIndex = stepIndex;
  // (pond ambience is now a positional source — distance handles its level)

  // --- animation ---
  const swing = Math.sin(dogState.walkPhase) * Math.min(0.9, dogState.speed / 9);
  const legs = dog.userData.legs;
  legs[0].rotation.x = swing;
  legs[1].rotation.x = -swing;
  legs[2].rotation.x = -swing;
  legs[3].rotation.x = swing;
  // tail wags faster when moving
  dog.userData.tail.rotation.y = Math.sin(clock.elapsedTime * (dogState.speed > 0.5 ? 14 : 5)) * 0.5;
  // head bob
  dog.userData.head.rotation.x = Math.sin(dogState.walkPhase * 2) * 0.04 * (dogState.speed > 0.5 ? 1 : 0);

  // --- trick performance: the dog actually DOES the Simon-Says trick that
  // was pressed, not just a state-machine transition + a toast — every pose
  // here overrides the (otherwise-idle, since movement is frozen) values set
  // just above, for one short procedural beat, then hands back cleanly. ---
  // Free-roam trick performance: the game signals a learned/performed trick
  // (SIT/SPIN/SPEAK) outside the showcase; play the same procedural pose here.
  if (!game._trickInputActive) {
    const pk = game._pendingTrickAnim;
    // sit always drains (it doesn't occupy trickAnim, so it can't be blocked
    // by one) — everything else keeps the original "only if idle" guard.
    if (pk && (pk === "sit" || !trickAnim)) {
      game._consumeTrickAnim();
      applyTrickPose(pk);
    }
  }
  // Persistent SIT hold — every frame while dogSitting, overriding the base
  // idle/walk pose above, until enterSit()/exitSit() change it. Uses the same
  // pose numbers the old one-shot "sit" trickAnim used, just held at full
  // extent instead of eased in and back out over 0.5s.
  if (dogSitting) {
    dog.position.y -= 0.22;
    dog.rotation.x = -0.12;              // nose tips up
    legs[2].rotation.x = 1.15; legs[3].rotation.x = 1.15;   // back legs tucked under
    legs[0].rotation.x = -0.15; legs[1].rotation.x = -0.15; // front legs planted forward
    dog.userData.tail.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.25; // settled, not the moving-tail wag
  }
  if (trickAnim) {
    const p = Math.min(1, trickAnim.t / trickAnim.dur);
    if (trickAnim.kind === "spin") {
      dog.rotation.y = dogState.heading + p * Math.PI * 2; // one full turn, lands back on heading
      legs[0].rotation.x = Math.sin(p * Math.PI * 8) * 0.5;
      legs[1].rotation.x = -Math.sin(p * Math.PI * 8) * 0.5;
      legs[2].rotation.x = -Math.sin(p * Math.PI * 8) * 0.5;
      legs[3].rotation.x = Math.sin(p * Math.PI * 8) * 0.5;
    } else if (trickAnim.kind === "speak") {
      const decay = 1 - p;
      dog.userData.head.rotation.x = Math.sin(p * Math.PI * 6) * 0.2 * decay;
      dog.userData.tail.rotation.y = Math.sin(clock.elapsedTime * 18) * 0.6; // extra-excited wag
    } else if (trickAnim.kind === "eat") {
      // Head down to the offered palm, then chewing: the muzzle works while the
      // tail picks up. This is the beat where a stray decides to trust someone.
      const down = Math.sin(Math.min(1, p * 1.6) * Math.PI);
      dog.userData.head.rotation.x = 0.55 * down;                  // nose to the hand
      dog.position.y -= 0.06 * down;
      if (p > 0.35) {                                              // chewing
        const chew = Math.sin((p - 0.35) * Math.PI * 22);
        dog.userData.head.rotation.x += chew * 0.07;
        dog.userData.tail.rotation.y = Math.sin(clock.elapsedTime * 14) * 0.75;
      }
    } else if (trickAnim.kind === "look") {
      // Not a trick — a cutscene staging pose ("watching the taillights
      // shrink"): the head lifts and holds, then settles. Slow and still, which
      // is the point; the ears/tail go quiet with it.
      const env = Math.sin(Math.min(1, p * 1.35) * Math.PI);
      dog.userData.head.rotation.x = -0.30 * env;   // nose up, watching it go
      dog.userData.head.rotation.y = 0.12 * env;
      dog.userData.tail.rotation.y *= 1 - 0.85 * env; // the wag stops
    }
    trickAnim.t += dt;
    if (trickAnim.t >= trickAnim.dur) trickAnim = null;
  }

  // --- camera follow (with obstacle pull-in so it never clips through trees) ---
  const cutsceneCam = game._cutsceneCam;
  if (!cutsceneCam) _lastCutShot = null; // so the next cutscene's opening shot snaps in
  if (cutsceneCam) {
    // Cinematic cutscene: the shot is a MOVE, not a fixed key — cutscene.js
    // hands back a live point on the current shot's eased path every frame, so
    // the camera is always travelling. Player orbit input is ignored here.
    //
    // A change of shot index is a CUT: snap to the new framing rather than
    // easing, or the camera flies across the world between setups and every
    // hard cut in the direction reads as one long mushy drift. Within a shot,
    // a light lerp keeps the move from feeling rigidly on-rails.
    const e = cutsceneCam.eye, l = cutsceneCam.look;
    const shot = cutsceneCam.shot;
    if (shot !== _lastCutShot) { camera.position.set(e.x, e.y, e.z); _lastCutShot = shot; }
    else camera.position.lerp(new THREE.Vector3(e.x, e.y, e.z), 1 - Math.pow(0.0016, dt));
    camera.lookAt(l.x, l.y, l.z);
    wasFetchFrozen = false;
  } else if (fetchFrozen) {
    // Cinematic: track the frisbee from a fixed vantage instead of the dog.
    const tgt = game._fetchTargetPos;
    if (tgt) {
      const camTargetPos = new THREE.Vector3(tgt.x, tgt.y + 3, tgt.z + 6);
      camera.position.lerp(camTargetPos, 1 - Math.pow(0.0005, dt));
      camera.lookAt(tgt.x, tgt.y + 0.3, tgt.z);
    }
    wasFetchFrozen = true;
  } else if (judgeCamActive) {
    // Cinematic judge-POV: a fixed vantage on the far side of the player from
    // the judge (so the judge sits between camera and player, "watching" the
    // performance), with a slow dolly-in over the round for a cinematic feel.
    // The camera doesn't orbit with player input here — it's a locked shot.
    wasFetchFrozen = false;
    const jp = game._judgePos;
    if (jp) {
      const dx = jp.x - dogState.pos.x, dz = jp.z - dogState.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len; // unit vector from player toward the judge
      const t = game._judgeCamT || 0;
      const dolly = Math.min(1, t / 6); // slow push-in over ~6s, then holds
      const back = 8 - dolly * 2.5;
      // Eye height was tuned to watch the dog's old ~1.8-unit (human-height)
      // model at a flattering angle; scaled down so it still frames the
      // correctly-sized dog instead of looking down over its head.
      const camTargetPos = new THREE.Vector3(
        dogState.pos.x + ux * back,
        (2.4 + (1 - dolly) * 0.6) * DOG_VISUAL_SCALE,
        dogState.pos.z + uz * back
      );
      camera.position.lerp(camTargetPos, 1 - Math.pow(0.002, dt));
      camera.lookAt(dogState.pos.x, dogState.pos.y + 1.2 * DOG_VISUAL_SCALE, dogState.pos.z);
    }
  } else {
    if (wasFetchFrozen) {
      // Just unfroze this frame — hand the camera back pre-aimed straight
      // down the dog→frisbee line, and turn the dog to match immediately
      // (not waiting on player input), so the race starts fair for both.
      const tgt = game._fetchTargetPos;
      if (tgt) {
        camYaw = Math.atan2(dogState.pos.x - tgt.x, dogState.pos.z - tgt.z);
        dogState.heading = Math.atan2(tgt.x - dogState.pos.x, tgt.z - dogState.pos.z);
      }
      wasFetchFrozen = false;
    }
    const effDist = camDist * camZoom;
    const fullHoriz = effDist * Math.cos(camPitch);
    const camX = dogState.pos.x + Math.sin(camYaw) * fullHoriz;
    const camZ = dogState.pos.z + Math.cos(camYaw) * fullHoriz;
    let rawScale = 1;
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      if (blocked(dogState.pos.x + (camX - dogState.pos.x) * t, dogState.pos.z + (camZ - dogState.pos.z) * t)) {
        rawScale = Math.max(0.35, (i - 1) / 6); break;
      }
    }
    // Instant on pull-in (a hard safety floor — never a transient clip),
    // eased on release (see smoothedCamScale's declaration for why).
    if (rawScale < smoothedCamScale) smoothedCamScale = rawScale;
    else smoothedCamScale += (rawScale - smoothedCamScale) * (1 - Math.pow(0.05, dt));
    const scale = smoothedCamScale;
    const horiz = fullHoriz * scale;
    const targetCam = new THREE.Vector3(
      dogState.pos.x + Math.sin(camYaw) * horiz,
      // +2.2/+1.4 were tuned for the dog's old ~1.8-unit (human-height) model;
      // scaled by DOG_VISUAL_SCALE so the camera sits at the same relative
      // height/angle above the correctly-sized dog instead of aiming into the
      // air above its now-much-shorter head.
      dogState.pos.y + 2.2 * DOG_VISUAL_SCALE + effDist * Math.sin(camPitch) * scale,
      dogState.pos.z + Math.cos(camYaw) * horiz
    );
    camera.position.lerp(targetCam, 1 - Math.pow(0.0001, dt));
    camera.lookAt(dogState.pos.x, dogState.pos.y + 1.4 * DOG_VISUAL_SCALE, dogState.pos.z);
  }

  // keep sun shadow centered on the dog
  sun.position.set(dogState.pos.x + 34, 58, dogState.pos.z + 20);
  sun.target.position.copy(dogState.pos);
}

function blocked(x, z) {
  for (const o of obstacles) {
    const dx = x - o.x, dz = z - o.z;
    if (dx * dx + dz * dz < (o.r + 0.6) * (o.r + 0.6)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rand(half) { return (Math.random() * 2 - 1) * half; }
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// place camera initially
camera.position.set(0, 6, -10);
camera.lookAt(0, 1, 0);

const _camFwd = new THREE.Vector3();
// Each subsystem is isolated so a fault in one can never freeze the rest.
// The one-time warning is tracked PER LABEL, not one global flag — a single
// global flag meant subsystem A throwing once (logged, as designed) would
// permanently silence every future error from any OTHER subsystem B for the
// rest of the session, even an unrelated regression starting minutes later.
// Now each labeled call site still only warns once (no per-frame log spam),
// but distinct subsystems never silence each other.
const _warnedSubsystems = new Set();
function safe(fn, label) {
  try { fn(); } catch (e) {
    const key = label || "unlabeled";
    if (!_warnedSubsystems.has(key)) { console.warn(`subsystem error [${key}]`, e); _warnedSubsystems.add(key); }
  }
}
function animate() {
  requestAnimationFrame(animate);
  const dt = paused ? 0 : Math.min(0.05, clock.getDelta());
  safe(() => pollGamepad(dt), "gamepad");
  safe(() => updateDayNight(clock.elapsedTime), "dayNight");
  safe(() => updateFireflies(dt), "fireflies");
  safe(() => city.flicker(clock.elapsedTime), "cityFlicker");
  safe(() => cityRing.flicker(clock.elapsedTime), "cityRingFlicker");
  if (cityRing.barrier) cityRing.barrier.visible = env.closed; // gate bar drops when the park shuts
  if (!paused) {
    safe(() => updateWeather(dt), "weather");
    safe(() => updateClouds(dt), "clouds");
    safe(() => updateLightning(dt), "lightning"); // after updateDayNight/weather so the flash boost sticks this frame
    if (running) safe(() => update(dt), "playerUpdate");
    safe(() => birds.update(dt, clock.elapsedTime), "birds");
    safe(() => traffic.update(dt, clock.elapsedTime), "traffic");
    safe(() => wind.update(dt), "wind");
    safe(() => critters.update(dt, clock.elapsedTime), "critters");
    safe(() => game.update(dt, clock.elapsedTime), "game");
    safe(() => keepsake.update(dt), "keepsake"); // after game (which drives acquire/setDown), before scent so its aura lands this frame
    safe(() => scent.update(dt, clock.elapsedTime), "scent"); // after game: reads fresh dog pos + rain
  }
  // Scent View: hold F while in play. Placed outside !paused so pausing (which
  // clears held keys, world.js keyup/pause) always drops the veil.
  safe(() => scent.setView(!paused && running && !!keys["KeyF"]), "scentView");
  safe(() => {
    if (audio.ready) {
      camera.getWorldDirection(_camFwd);
      audio.updateListener(
        camera.position.x, camera.position.y, camera.position.z,
        _camFwd.x, _camFwd.y, _camFwd.z
      );
    }
    renderer.render(scene, camera);
  }, "render");
}
animate();

// expose a tiny hook for automated testing
window.__dog = dogState;
window.__dogGroup = dog; // the THREE.Group — lets tests inspect actual pose/mesh transforms, not just physics state
window.__birds = birds;
window.__traffic = traffic;
window.__wind = wind;
window.__critters = critters;
window.__obstacles = obstacles;
window.__game = game;
window.__scent = scent; // test hook: scent field + Scent View
window.__narrative = narrative; // test hook: story controller (acts/beats)
window.__keepsake = keepsake; // test hook: the persistent tennis ball
window.__camera = camera;
window.__camScale = () => smoothedCamScale; // test hook: the camera's obstacle pull-in smoothing state
window.__zoom = { get: () => camZoom, set: setZoom, min: ZOOM_MIN, max: ZOOM_MAX }; // test hook: camera zoom (wheel/pinch)
window.__dogSitting = () => dogSitting; // test hook: the persistent sit character state
