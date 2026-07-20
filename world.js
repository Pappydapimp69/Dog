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
scene.fog = new THREE.Fog(0x8fd3ff, 80, 200);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

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
const DAY = { sky: new THREE.Color(0x8fd3ff), hemi: 1.1, sun: 2.4, sunCol: new THREE.Color(0xfff3d6) };
const NIGHT = { sky: new THREE.Color(0x1a2740), hemi: 0.42, sun: 0.6, sunCol: new THREE.Color(0x7488c0) };
const _skyCol = new THREE.Color();
const env = { nightT: 0 };
window.__env = env; // test/debug hook
function updateDayNight(time) {
  const phase = (Math.sin((time / 200) * Math.PI * 2 - Math.PI / 2) + 1) / 2; // 0(day)→1(night)→0
  const n = env.nightT = phase * 0.85; // never pitch black
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
const fenceMat = new THREE.MeshStandardMaterial({ color: 0xb98a4f, roughness: 0.9 });
function fenceRun(x1, z1, x2, z2) {
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
const WORLD_OUTER = 106; // the city ring wraps the park out to here
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
let coatKey = localStorage.getItem("dogpark-coat") || "classic";
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
    let saved = localStorage.getItem("dogpark-name");
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
const game = createGame(scene, audio, {
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
});

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
addEventListener("keydown", (e) => {
  startGame();
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
  if (e.code === "KeyM" && !e.repeat) updateSoundIcon(audio.toggleMute());
  if ((e.code === "KeyP" || e.code === "Escape") && !e.repeat) setPaused(!paused);
  // Simon-Says trick input during the trick showcase (no-op unless the game
  // is actually waiting on trickInput — see game.js's stage guard).
  if (!e.repeat) {
    if (e.code === "Digit1") { playTrickAnim("sit"); game.trickInput("sit"); }
    else if (e.code === "Digit2") { playTrickAnim("spin"); game.trickInput("spin"); }
    else if (e.code === "Digit3") { playTrickAnim("speak"); game.trickInput("speak"); }
  }
});
addEventListener("keyup", (e) => { keys[e.code] = false; });

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
let pauseFocusIdx = 0; // 0 = Resume, 1 = Restart
const pauseButtons = [resumeBtn, restartBtn];
function applyPauseFocus() { pauseButtons.forEach((b, i) => b.classList.toggle("pad-focus", i === pauseFocusIdx)); }
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
      '<span class="badge b">B</span> bark · <span class="badge">☰</span> pause';
  }
  return '⌨ <b>WASD</b> move · <b>Mouse</b> look · <b>E</b> act · <b>B</b> bark · <b>Space</b> jump · <b>P</b> pause';
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
const TRICK_DUR = { sit: 0.5, spin: 0.7, speak: 0.45 };
let trickAnim = null; // { kind, t, dur }
function playTrickAnim(kind) {
  if (!game._trickInputActive) return;
  trickAnim = { kind, t: 0, dur: TRICK_DUR[kind] || 0.5 };
  if (kind === "speak") audio.bark();
}
if (trickSitBtn) trickSitBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); playTrickAnim("sit"); game.trickInput("sit"); });
if (trickSpinBtn) trickSpinBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); playTrickAnim("spin"); game.trickInput("spin"); });
if (trickSpeakBtn) trickSpeakBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); playTrickAnim("speak"); game.trickInput("speak"); });

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
const startBtn = document.getElementById("start-btn");
const loadingEl = document.getElementById("loading");
let running = false;
loadingEl.classList.add("done");
// Start the game. Idempotent, and triggered by ANY interaction (the Enter
// button, the joystick, or any control) so the player can never end up stuck in
// a started-but-not-playing limbo. Audio is best-effort and never gates this.
let gameStarted = false;
function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  overlay.classList.add("hidden");
  running = true;
  try { game.begin(); } catch (e) { console.warn("game begin failed", e); }
  audio.start().catch((err) => console.warn("audio start failed", err));
}
startBtn.addEventListener("click", startGame);
startBtn.addEventListener("pointerup", startGame);

// ---------------------------------------------------------------------------
// Gamepad (global) — works in menus and in play. Standard mapping:
//   left stick = move, right stick = look, A = jump/confirm, B = bark,
//   X = action (E), Y = bark, Start = pause, and any button dismisses overlays.
// ---------------------------------------------------------------------------
let padSprint = false;
const prevBtn = [];
function overlayButton() {
  // the primary button of whatever overlay is currently up (top-most wins)
  if (!document.getElementById("story-overlay").classList.contains("hidden")) return document.getElementById("story-btn");
  if (!document.getElementById("settings-overlay").classList.contains("hidden")) return document.getElementById("settings-done");
  if (!pauseOverlay.classList.contains("hidden")) return document.getElementById("resume-btn");
  if (!overlay.classList.contains("hidden")) return startBtn;
  return null;
}
function pollGamepad(dt) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) { padMove.x = 0; padMove.y = 0; return; }
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
  padSprint = down(6) || down(7) || down(10); // triggers or L3 = sprint (read in update())

  const ov = overlayButton();
  const startOpen = ov === startBtn; // the title screen is the active overlay
  if (ov) {
    const pauseOpen = !pauseOverlay.classList.contains("hidden");
    if (startOpen) {
      // Title screen: D-pad / left-stick left-right cycles the coat colour
      // (live preview on the dog); A or Start enters the park. Nav is
      // edge-debounced so holding a direction doesn't race the palette. Crucially
      // this REPLACES the old "any button starts the game" behaviour here, so a
      // stick nudge navigates instead of skipping the whole title screen.
      const stickX = dz(ax[0] || 0);
      const navL = edge(14) || (stickX <= -0.55 && !prevBtn._padNav);
      const navR = edge(15) || (stickX >= 0.55 && !prevBtn._padNav);
      if (navL) cycleCoat(-1);
      else if (navR) cycleCoat(1);
      prevBtn._padNav = Math.abs(stickX) >= 0.55;
      if (edge(2) || edge(3)) rerollName();   // X / Y → new name (no pad text entry)
      if (edge(0) || edge(9)) startGame();     // A / Start → enter the park
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
      // settings / story overlays: A / Start / X confirm-dismiss
      if (edge(0) || edge(9) || edge(2)) {
        if (!settingsOverlay.classList.contains("hidden")) settingsOverlay.classList.add("hidden");
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
      if (edge(2)) game.interact();                    // X → action (E)
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
  game.tickHold(!!(keys["KeyE"] || actHeld), dt);
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
    if (pk && !trickAnim) {
      game._consumeTrickAnim();
      trickAnim = { kind: pk, t: 0, dur: TRICK_DUR[pk] || 0.5 };
      if (pk === "speak") audio.bark();
    }
  }
  if (trickAnim) {
    const p = Math.min(1, trickAnim.t / trickAnim.dur);
    if (trickAnim.kind === "sit") {
      const env = Math.sin(p * Math.PI); // 0 -> 1 -> 0 over the whole beat
      dog.position.y -= 0.22 * env;
      dog.rotation.x = -0.12 * env; // nose tips up
      legs[2].rotation.x = 1.15 * env; // back legs tuck under
      legs[3].rotation.x = 1.15 * env;
      legs[0].rotation.x = -0.15 * env; // front legs plant forward slightly
      legs[1].rotation.x = -0.15 * env;
    } else if (trickAnim.kind === "spin") {
      dog.rotation.y = dogState.heading + p * Math.PI * 2; // one full turn, lands back on heading
      legs[0].rotation.x = Math.sin(p * Math.PI * 8) * 0.5;
      legs[1].rotation.x = -Math.sin(p * Math.PI * 8) * 0.5;
      legs[2].rotation.x = -Math.sin(p * Math.PI * 8) * 0.5;
      legs[3].rotation.x = Math.sin(p * Math.PI * 8) * 0.5;
    } else if (trickAnim.kind === "speak") {
      const decay = 1 - p;
      dog.userData.head.rotation.x = Math.sin(p * Math.PI * 6) * 0.2 * decay;
      dog.userData.tail.rotation.y = Math.sin(clock.elapsedTime * 18) * 0.6; // extra-excited wag
    }
    trickAnim.t += dt;
    if (trickAnim.t >= trickAnim.dur) trickAnim = null;
  }

  // --- camera follow (with obstacle pull-in so it never clips through trees) ---
  const cutsceneCam = game._cutsceneCam;
  if (cutsceneCam) {
    // Cinematic cutscene: a scripted shot (eye + look), eased so cuts between
    // shots glide rather than snap. Player orbit input is ignored here.
    const e = cutsceneCam.eye, l = cutsceneCam.look;
    camera.position.lerp(new THREE.Vector3(e.x, e.y, e.z), 1 - Math.pow(0.0016, dt));
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
      const camTargetPos = new THREE.Vector3(
        dogState.pos.x + ux * back,
        2.4 + (1 - dolly) * 0.6,
        dogState.pos.z + uz * back
      );
      camera.position.lerp(camTargetPos, 1 - Math.pow(0.002, dt));
      camera.lookAt(dogState.pos.x, dogState.pos.y + 1.2, dogState.pos.z);
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
      dogState.pos.y + 2.2 + effDist * Math.sin(camPitch) * scale,
      dogState.pos.z + Math.cos(camYaw) * horiz
    );
    camera.position.lerp(targetCam, 1 - Math.pow(0.0001, dt));
    camera.lookAt(dogState.pos.x, dogState.pos.y + 1.4, dogState.pos.z);
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
function safe(fn) { try { fn(); } catch (e) { if (!safe._warned) { console.warn("subsystem error", e); safe._warned = true; } } }
function animate() {
  requestAnimationFrame(animate);
  const dt = paused ? 0 : Math.min(0.05, clock.getDelta());
  safe(() => pollGamepad(dt));
  safe(() => updateDayNight(clock.elapsedTime));
  safe(() => updateFireflies(dt));
  safe(() => city.flicker(clock.elapsedTime));
  safe(() => cityRing.flicker(clock.elapsedTime));
  if (!paused) {
    safe(() => updateWeather(dt));
    safe(() => updateClouds(dt));
    safe(() => updateLightning(dt)); // after updateDayNight/weather so the flash boost sticks this frame
    if (running) safe(() => update(dt));
    safe(() => birds.update(dt, clock.elapsedTime));
    safe(() => traffic.update(dt, clock.elapsedTime));
    safe(() => wind.update(dt));
    safe(() => critters.update(dt, clock.elapsedTime));
    safe(() => game.update(dt, clock.elapsedTime));
  }
  if (audio.ready) {
    camera.getWorldDirection(_camFwd);
    audio.updateListener(
      camera.position.x, camera.position.y, camera.position.z,
      _camFwd.x, _camFwd.y, _camFwd.z
    );
  }
  renderer.render(scene, camera);
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
window.__camera = camera;
window.__camScale = () => smoothedCamScale; // test hook: the camera's obstacle pull-in smoothing state
window.__zoom = { get: () => camZoom, set: setZoom, min: ZOOM_MIN, max: ZOOM_MAX }; // test hook: camera zoom (wheel/pinch)
