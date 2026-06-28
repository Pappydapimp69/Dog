/* Dog Park 3D — walk around an open park and control a dog.
 * Third-person three.js scene, no runtime CDN (three is vendored).
 */
import * as THREE from "./vendor/three.module.js";
import { ParkAudio } from "./audio.js";
import { createBirds } from "./birds.js";
import { createTraffic } from "./cars.js";
import { createWind } from "./wind.js";
import { createCritters } from "./critters.js";
import { buildProps } from "./props.js";
import { createGame } from "./game.js";

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

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const WORLD = 80; // half-extent of the play field

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
const F = WORLD - 2;
fenceRun(-F, -F, F, -F);
fenceRun(-F, F, F, F);
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
const obstacles = [];
const trees = [];
for (let i = 0; i < 26; i++) {
  let x, z;
  do { x = rand(WORLD - 6); z = rand(WORLD - 6); } while (Math.hypot(x, z) < 8);
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
for (let i = 0; i < 6; i++) makeHydrant(rand(WORLD - 10), rand(WORLD - 10));

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

  return dog;
}
const dog = buildDog();
scene.add(dog);

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

// ---------------------------------------------------------------------------
// Collectibles
// ---------------------------------------------------------------------------
const collectibles = [];
function spawnCollectible(type) {
  let mesh;
  if (type === "frisbee") {
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.08, 20),
      new THREE.MeshStandardMaterial({ color: 0xffce54, roughness: 0.5 })
    );
  } else {
    mesh = new THREE.Group();
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.7, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 0.6 })
    );
    bar.rotation.z = Math.PI / 2; mesh.add(bar);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), bar.material);
      k.position.set(sx * 0.35, 0, sz * 0.15); mesh.add(k);
    }
  }
  placeCollectible(mesh);
  mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(mesh);
  collectibles.push({ mesh, type });
}
function placeCollectible(mesh) {
  let x, z;
  do { x = rand(WORLD - 6); z = rand(WORLD - 6); } while (Math.hypot(x, z) < 4);
  mesh.position.set(x, 0.6, z);
  mesh.userData.baseY = 0.6;
  mesh.userData.phase = Math.random() * Math.PI * 2;
}
for (let i = 0; i < 8; i++) spawnCollectible("bone");
for (let i = 0; i < 5; i++) spawnCollectible("frisbee");

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

// Static park props — benches, tables, bins, lamps, flowers.
buildProps(scene, { world: WORLD, pond: POND });

// Living things — people, other dogs, and pond ducks that attack up close.
const critters = createCritters(scene, audio, {
  world: WORLD,
  pond: POND,
  getDog: () => dogState.pos,
  pushDog: (dx, dz, power) => { dogState.knock.x += dx * power; dogState.knock.z += dz * power; },
});

// The game layer — traits, relationships, disguises, dog catcher, levels.
function setDogPos(x, z) {
  dogState.pos.x = x; dogState.pos.z = z; dogState.pos.y = 0;
  dogState.vy = 0; dogState.knock.set(0, 0, 0);
}
const game = createGame(scene, audio, {
  world: WORLD,
  pond: POND,
  getDog: () => dogState.pos,
  setDogPos,
  people: critters.people,
  dogGroup: dog,
});

let boneCount = 0, frisbeeCount = 0;
const bonesEl = document.getElementById("bones");
const frisbeesEl = document.getElementById("frisbees");

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = Object.create(null);
addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyB" && !e.repeat) { audio.bark(); critters.playerBarked(); game.onBark(); }
  if (e.code === "KeyE" && !e.repeat) game.interact();
  if (e.code === "KeyM" && !e.repeat) updateSoundIcon(audio.toggleMute());
});
addEventListener("keyup", (e) => { keys[e.code] = false; });

// Camera orbit (mouse / right-side touch drag)
let camYaw = Math.PI, camPitch = 0.42;
const camDist = 8;
let dragging = false, lastX = 0, lastY = 0, dragPointer = null;

canvas.addEventListener("pointerdown", (e) => {
  // On touch, the left side is the joystick zone (handled separately).
  dragging = true; dragPointer = e.pointerId; lastX = e.clientX; lastY = e.clientY;
});
addEventListener("pointermove", (e) => {
  if (!dragging || e.pointerId !== dragPointer) return;
  camYaw -= (e.clientX - lastX) * 0.005;
  camPitch += (e.clientY - lastY) * 0.005;
  camPitch = Math.max(0.1, Math.min(1.2, camPitch));
  lastX = e.clientX; lastY = e.clientY;
});
addEventListener("pointerup", (e) => { if (e.pointerId === dragPointer) { dragging = false; dragPointer = null; } });

// Virtual joystick (mobile)
let joyVec = { x: 0, y: 0 };
const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
const touchControls = document.getElementById("touch-controls");
const joystick = document.getElementById("joystick");
const stick = document.getElementById("stick");
const jumpBtn = document.getElementById("jump-btn");
if (isTouch) touchControls.classList.remove("hidden");

let joyId = null, joyCx = 0, joyCy = 0;
joystick.addEventListener("pointerdown", (e) => {
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
jumpBtn.addEventListener("pointerdown", (e) => { jumpQueued = true; e.stopPropagation(); });

const barkBtn = document.getElementById("bark-btn");
barkBtn.addEventListener("pointerdown", (e) => { audio.bark(); critters.playerBarked(); game.onBark(); e.stopPropagation(); });

const actBtn = document.getElementById("act-btn");
if (actBtn) actBtn.addEventListener("pointerdown", (e) => { game.interact(); e.stopPropagation(); });

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
startBtn.addEventListener("click", async () => {
  overlay.classList.add("hidden");
  running = true;
  try { await audio.start(); } catch (err) { console.warn("audio start failed", err); }
  game.begin();
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
  // joystick: up on screen = forward
  ix += joyVec.x; iz += -joyVec.y;
  ix = Math.max(-1, Math.min(1, ix));
  iz = Math.max(-1, Math.min(1, iz));

  const running_ = keys["ShiftLeft"] || keys["ShiftRight"];
  const maxSpeed = running_ ? 16 : 9;

  // forward = from camera toward dog, flattened
  tmpForward.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)).normalize();
  tmpRight.crossVectors(tmpForward, up).normalize();
  tmpMove.set(0, 0, 0)
    .addScaledVector(tmpForward, iz)
    .addScaledVector(tmpRight, ix);

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
  // clamp to field
  const lim = WORLD - 3;
  dogState.pos.x = Math.max(-lim, Math.min(lim, dogState.pos.x));
  dogState.pos.z = Math.max(-lim, Math.min(lim, dogState.pos.z));

  // jump
  if ((keys["Space"] || jumpQueued) && dogState.onGround) {
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

  // --- collectibles ---
  for (const c of collectibles) {
    c.mesh.userData.phase += dt * 2;
    c.mesh.position.y = c.mesh.userData.baseY + Math.sin(c.mesh.userData.phase) * 0.15;
    c.mesh.rotation.y += dt * (c.type === "frisbee" ? 3 : 1.5);
    const dx = c.mesh.position.x - dogState.pos.x;
    const dz = c.mesh.position.z - dogState.pos.z;
    if (dx * dx + dz * dz < 1.7 * 1.7) {
      if (c.type === "frisbee") { frisbeeCount++; frisbeesEl.textContent = frisbeeCount; }
      else { boneCount++; bonesEl.textContent = boneCount; }
      audio.collect(c.type);
      placeCollectible(c.mesh);
    }
  }

  // --- camera follow ---
  const horiz = camDist * Math.cos(camPitch);
  const targetCam = new THREE.Vector3(
    dogState.pos.x + Math.sin(camYaw) * horiz,
    dogState.pos.y + 2.2 + camDist * Math.sin(camPitch),
    dogState.pos.z + Math.cos(camYaw) * horiz
  );
  camera.position.lerp(targetCam, 1 - Math.pow(0.0001, dt));
  camera.lookAt(dogState.pos.x, dogState.pos.y + 1.4, dogState.pos.z);

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
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  if (running) update(dt);
  birds.update(dt, clock.elapsedTime);
  traffic.update(dt, clock.elapsedTime);
  wind.update(dt);
  critters.update(dt, clock.elapsedTime);
  game.update(dt, clock.elapsedTime);
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
window.__birds = birds;
window.__traffic = traffic;
window.__wind = wind;
window.__critters = critters;
window.__game = game;
