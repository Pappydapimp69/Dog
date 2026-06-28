/* Dog Park 3D — birds.
 *
 * Three species (sparrow / robin / dove), at least one of each and five in
 * total. They hop along the ground, fly, and perch on tree tops. Each bird
 * carries its own spatial audio voice, so its call comes from its position.
 */
import * as THREE from "./vendor/three.module.js";

const SPECIES = {
  sparrow: { body: 0x8a6a45, belly: 0xcdb89a, beak: 0x3a2a1a, scale: 0.85, perches: false, callMin: 2.5, callMax: 6 },
  robin:   { body: 0x6b5641, belly: 0xc0612f, beak: 0xe0a000, scale: 1.0,  perches: true,  callMin: 4.0, callMax: 9 },
  dove:    { body: 0x9a9aa2, belly: 0xc4c4cc, beak: 0x444444, scale: 1.15, perches: false, callMin: 7.0, callMax: 13 },
};

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function buildBirdMesh(spec) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: spec.body, roughness: 0.85 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: spec.belly, roughness: 0.85 });
  const beakMat = new THREE.MeshStandardMaterial({ color: spec.beak, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), bodyMat);
  body.scale.set(1, 0.85, 1.3); body.castShadow = true; g.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), bellyMat);
  belly.scale.set(0.9, 0.7, 1.0); belly.position.set(0, -0.08, 0.16); g.add(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), bodyMat);
  head.position.set(0, 0.22, 0.34); head.castShadow = true; g.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 8), beakMat);
  beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.2, 0.58); g.add(beak);

  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), eyeMat);
    eye.position.set(sx * 0.11, 0.26, 0.46); g.add(eye);
  }

  // tail
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.34), bodyMat);
  tail.position.set(0, 0.02, -0.42); tail.castShadow = true; g.add(tail);

  // wings (pivot at the shoulder so they can flap)
  const wings = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.22, 0.08, 0);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.5), bodyMat);
    wing.position.set(sx * 0.2, 0, 0); wing.castShadow = true;
    pivot.add(wing); g.add(pivot); wings.push(pivot);
  }

  // legs
  const legMat = new THREE.MeshStandardMaterial({ color: spec.beak, roughness: 0.7 });
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6), legMat);
    leg.position.set(sx * 0.1, -0.36, 0); g.add(leg);
  }

  g.scale.setScalar(spec.scale);
  return { group: g, wings };
}

export function createBirds(scene, audio, opts) {
  const trees = opts.trees || [];
  const WORLD = opts.world || 78;
  const roam = WORLD - 8;
  const birds = [];

  // ≥1 of each species, 5 total.
  const roster = ["sparrow", "sparrow", "robin", "robin", "dove"];

  for (const species of roster) {
    const spec = SPECIES[species];
    const { group, wings } = buildBirdMesh(spec);
    const start = new THREE.Vector3(rand(-roam, roam), 0, rand(-roam, roam));
    group.position.copy(start);
    scene.add(group);

    birds.push({
      species, spec, group, wings,
      pitch: rand(0.9, 1.12),
      voice: null,
      pos: group.position,
      mode: "idle",                       // idle | hop | fly
      timer: rand(0.6, 2.5),              // until next decision
      callTimer: rand(spec.callMin, spec.callMax),
      from: start.clone(),
      to: start.clone(),
      t: 0, dur: 0,                       // motion progress
      baseY: 0,
      flap: Math.random() * Math.PI * 2,
      heading: Math.random() * Math.PI * 2,
    });
  }

  function groundPoint(near) {
    // a nearby ground spot (short hop) or a wider wander
    const a = Math.random() * Math.PI * 2;
    const r = rand(1.5, 6);
    return new THREE.Vector3(
      THREE.MathUtils.clamp(near.x + Math.cos(a) * r, -roam, roam),
      0,
      THREE.MathUtils.clamp(near.z + Math.sin(a) * r, -roam, roam)
    );
  }

  function treePerch() {
    if (!trees.length) return null;
    const tr = pick(trees);
    return new THREE.Vector3(tr.x, tr.topY, tr.z);
  }

  function decide(b) {
    if (b.spec.perches && Math.random() < 0.6 && trees.length) {
      // fly to a tree top (or down to the ground occasionally)
      const target = Math.random() < 0.8 ? treePerch() : groundPoint(b.pos);
      if (target) { startFly(b, target); return; }
    }
    if (Math.random() < 0.78) {
      // a little ground hop
      startHop(b, groundPoint(b.pos));
    } else {
      // short flight to a new spot
      startFly(b, groundPoint(b.pos));
    }
  }

  function face(b, target) {
    b.heading = Math.atan2(target.x - b.pos.x, target.z - b.pos.z);
  }

  function startHop(b, target) {
    b.mode = "hop"; b.from.copy(b.pos); b.to.copy(target);
    b.baseY = b.pos.y; b.t = 0;
    b.dur = 0.32 + b.from.distanceTo(b.to) * 0.04;
    face(b, target);
  }

  function startFly(b, target) {
    b.mode = "fly"; b.from.copy(b.pos); b.to.copy(target);
    b.t = 0;
    b.dur = 0.5 + b.from.distanceTo(b.to) * 0.06;
    face(b, target);
  }

  function update(dt, time) {
    for (const b of birds) {
      // lazily attach the spatial voice once audio is live
      if (!b.voice && audio.ready) b.voice = audio.makeBirdVoice(b.species, b.pitch);

      // ---- behaviour ----
      if (b.mode === "idle") {
        b.timer -= dt;
        b.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * 0.1));
        if (b.timer <= 0) { decide(b); }
      } else if (b.mode === "hop") {
        b.t += dt;
        const k = Math.min(1, b.t / b.dur);
        b.pos.lerpVectors(b.from, b.to, k);
        b.pos.y = b.baseY + Math.sin(k * Math.PI) * 0.5; // arc
        b.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * (0.2 + Math.sin(k * Math.PI) * 0.5)));
        if (k >= 1) { b.pos.y = b.to.y; b.mode = "idle"; b.timer = rand(0.8, 3.0); }
      } else if (b.mode === "fly") {
        b.t += dt;
        const k = Math.min(1, b.t / b.dur);
        b.pos.lerpVectors(b.from, b.to, k);
        // rise into an arc between endpoints, clearing the ground
        b.pos.y = THREE.MathUtils.lerp(b.from.y, b.to.y, k) + Math.sin(k * Math.PI) * 2.2;
        b.flap += dt * 26;
        const fa = Math.sin(b.flap) * 0.9;
        b.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * fa));
        if (k >= 1) { b.pos.copy(b.to); b.mode = "idle"; b.timer = rand(1.5, 4.5); }
      }

      b.group.position.x = b.pos.x;
      b.group.position.z = b.pos.z;
      b.group.position.y = b.mode === "idle"
        ? b.pos.y + Math.sin(time * 3 + b.flap) * 0.03
        : b.pos.y;
      b.group.rotation.y = b.heading;

      // ---- voice ----
      if (b.voice) {
        b.voice.setPosition(b.pos.x, b.pos.y + 0.3, b.pos.z);
        b.callTimer -= dt;
        if (b.callTimer <= 0) {
          b.voice.call();
          // perched/idle birds sing a bit more freely
          const base = b.mode === "idle" ? b.spec.callMin : b.spec.callMin * 1.6;
          b.callTimer = rand(base, b.spec.callMax);
        }
      }
    }
  }

  return { update, birds };
}
