/* Dog Park 3D — living things: pedestrians, other dogs, and pond ducks.
 *
 * People stroll, other dogs trot around and bark, and ducks paddle on the pond
 * — but get too close and the ducks turn aggressive: they charge across the
 * water, quack furiously, and peck the dog (a shove + a yelp).
 */
import * as THREE from "./vendor/three.module.js";

// All critter randomness draws from RND so a seeded park reproduces the same
// crowd. createCritters sets it from opts.rng (LESSON: one leaked Math.random
// in the placement path breaks reproducibility — so everything goes through RND).
let RND = Math.random;
function rand(a, b) { return a + RND() * (b - a); }
function pick(a) { return a[Math.floor(RND() * a.length)]; }

// ---- meshes ---------------------------------------------------------------
function buildPerson() {
  const g = new THREE.Group();
  const skin = pick([0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac]);
  const shirt = new THREE.Color().setHSL(RND(), 0.5, 0.5).getHex();
  const pants = new THREE.Color().setHSL(RND(), 0.3, 0.3).getHex();
  const sM = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
  const pM = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.85 });
  const skM = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.32), sM);
  torso.position.y = 1.5; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skM);
  head.position.y = 2.1; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
    new THREE.MeshStandardMaterial({ color: pick([0x2a1a0a, 0x4a2f17, 0x111111, 0x6b4a2a, 0x999999]), roughness: 0.9 }));
  hair.position.y = 2.15; g.add(hair);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.16), sM);
    arm.position.set(sx * 0.37, 1.5, 0); g.add(arm);
  }
  const legs = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.16, 1.05, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.22), pM);
    leg.position.y = -0.5; leg.castShadow = true; pivot.add(leg);
    g.add(pivot); legs.push(pivot);
  }
  return { group: g, legs, torso, head };
}

function buildNpcDog(color, scale) {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7).getHex(), roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 1.0), fur);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.4), fur);
  head.position.set(0, 0.75, 0.6); head.castShadow = true; g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.22), dark);
  snout.position.set(0, 0.68, 0.84); g.add(snout);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.06), dark);
    ear.position.set(sx * 0.16, 0.96, 0.55); g.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.45, 6), fur);
  tail.position.set(0, 0.7, -0.6); tail.rotation.x = -0.8; g.add(tail);
  const legs = [];
  for (const [lx, lz] of [[-0.18, 0.35], [0.18, 0.35], [-0.18, -0.35], [0.18, -0.35]]) {
    const pivot = new THREE.Group(); pivot.position.set(lx, 0.5, lz);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), dark);
    leg.position.y = -0.25; leg.castShadow = true; pivot.add(leg);
    g.add(pivot); legs.push(pivot);
  }
  g.scale.setScalar(scale);
  return { group: g, legs, tail };
}

function buildDuck() {
  const g = new THREE.Group();
  const isMallard = RND() < 0.6;
  const bodyCol = isMallard ? 0x6b5535 : 0xf2f2ee;
  const headCol = isMallard ? 0x1d6b3a : 0xf2f2ee;
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({ color: headCol, roughness: 0.6, metalness: isMallard ? 0.3 : 0 });
  const billMat = new THREE.MeshStandardMaterial({ color: 0xf5a623, roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), bodyMat);
  body.scale.set(1, 0.7, 1.4); body.position.y = 0.16; body.castShadow = true; g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 8), bodyMat);
  tail.rotation.x = -Math.PI / 2.2; tail.position.set(0, 0.22, -0.42); g.add(tail);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.32, 8), headMat);
  neck.position.set(0, 0.38, 0.32); g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), headMat);
  head.position.set(0, 0.56, 0.38); head.castShadow = true; g.add(head);
  const bill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.22), billMat);
  bill.position.set(0, 0.54, 0.56); g.add(bill);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    eye.position.set(sx * 0.09, 0.6, 0.48); g.add(eye);
  }
  const wings = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.3, 0.2, 0);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.5), bodyMat);
    wing.position.set(sx * 0.14, 0, 0); pivot.add(wing); g.add(pivot); wings.push(pivot);
  }
  return { group: g, wings };
}

// ---- system ---------------------------------------------------------------
export function createCritters(scene, audio, opts) {
  RND = opts.rng || Math.random; // seed the whole crowd's layout + look
  const WORLD = opts.world;
  const roam = WORLD - 6;
  const getDog = opts.getDog;
  const pushDog = opts.pushDog;
  const pond = opts.pond; // {x, z, r}
  const pathfinder = opts.pathfinder; // obstacle-aware steering, shared grid (brain: local/sandbox-dog-pathfinding)

  const people = [];
  const dogs = [];
  const ducks = [];

  const newTarget = (near, spread) => new THREE.Vector3(
    THREE.MathUtils.clamp((near ? near.x : 0) + rand(-spread, spread), -roam, roam), 0,
    THREE.MathUtils.clamp((near ? near.z : 0) + rand(-spread, spread), -roam, roam)
  );
  const inPond = (x, z) => Math.hypot(x - pond.x, z - pond.z) < pond.r + 2;

  // People (a livelier crowd — cheap now that neighbour queries are gridded)
  for (let i = 0; i < 30; i++) {
    const { group, legs, torso, head } = buildPerson();
    const pos = newTarget(null, roam);
    group.position.copy(pos); scene.add(group);
    people.push({ group, legs, torso, head, pos, target: newTarget(pos, 30), speed: rand(1.6, 3.2),
      legPhase: RND() * 6, voice: null, chatty: RND() < 0.6, talkTimer: rand(4, 16), bondT: 0 });
  }

  // Other dogs
  const dogColors = [0x3a3a3a, 0xd9c8a0, 0x6b4a2a, 0xe8e8e8, 0x2a2a2a, 0xc8782f];
  for (let i = 0; i < 8; i++) {
    const { group, legs, tail } = buildNpcDog(pick(dogColors), rand(0.85, 1.2));
    const pos = newTarget(null, roam);
    group.position.copy(pos); scene.add(group);
    dogs.push({ group, legs, tail, pos, target: newTarget(pos, 35), speed: rand(3.5, 6),
      legPhase: RND() * 6, voice: null, barkTimer: rand(4, 14) });
  }

  // Ducks on the pond
  for (let i = 0; i < 6; i++) {
    const { group, wings } = buildDuck();
    const a = RND() * Math.PI * 2, r = RND() * (pond.r - 2);
    const pos = new THREE.Vector3(pond.x + Math.cos(a) * r, 0.28, pond.z + Math.sin(a) * r);
    group.position.copy(pos); scene.add(group);
    ducks.push({ group, wings, pos, heading: RND() * 6, state: "calm",
      target: new THREE.Vector3().copy(pos), exit: new THREE.Vector3(), flap: 0, bob: RND() * 6,
      voice: null, quackTimer: rand(3, 9), peckCD: 0, guardTimer: 0, awayTimer: 0, startle: 0, sated: 0 });
  }

  // Ducks defend a "pursuit ring" around the pond. They chase within it, guard
  // its boundary if you flee past it, then return. Barking fills a scare meter
  // that, once full, sends the whole flock flying off the map for a while.
  const DUCK = { pursuit: 20, peck: 1.9, chase: 5.2, paddle: 1.3, guardTime: 3.5,
    fleeSpeed: 26, hearing: 26, fill: 0.4, drain: 0.1, awaySecs: 60 };
  let scare = 0;

  const stepXZ = (e, tx, tz, sp, dt) => {
    const dx = tx - e.pos.x, dz = tz - e.pos.z, d = Math.hypot(dx, dz) || 1;
    e.pos.x += (dx / d) * sp * dt; e.pos.z += (dz / d) * sp * dt;
    e.heading = Math.atan2(dx, dz);
  };
  const move3D = (e, t, sp, dt) => {
    const dx = t.x - e.pos.x, dy = t.y - e.pos.y, dz = t.z - e.pos.z, d = Math.hypot(dx, dy, dz) || 1;
    e.pos.x += (dx / d) * sp * dt; e.pos.y += (dy / d) * sp * dt; e.pos.z += (dz / d) * sp * dt;
    e.heading = Math.atan2(dx, dz);
  };
  const pondPoint = () => {
    const a = RND() * Math.PI * 2, r = RND() * (pond.r - 2);
    return new THREE.Vector3(pond.x + Math.cos(a) * r, 0.28, pond.z + Math.sin(a) * r);
  };

  function triggerFlee() {
    for (const dk of ducks) {
      if (dk.state === "away") continue;
      dk.state = "flee";
      const a = RND() * Math.PI * 2;
      dk.exit.set(pond.x + Math.cos(a) * 220, 42, pond.z + Math.sin(a) * 220);
    }
  }

  // Called whenever the player barks. Closer barks fill the meter more.
  function playerBarked() {
    if (ducks.every((d) => d.state === "away" || d.state === "flee")) return;
    const dog = getDog();
    const dist = Math.hypot(dog.x - pond.x, dog.z - pond.z);
    if (dist > DUCK.hearing) return; // too far for the ducks to hear
    scare = Math.min(1, scare + DUCK.fill * (1 - dist / DUCK.hearing));
    for (const dk of ducks) {
      if (dk.state === "away" || dk.state === "flee") continue;
      dk.startle = 0.5;
      if (dk.voice && RND() < 0.5) dk.voice.quack(false);
    }
    if (scare >= 1) { triggerFlee(); scare = 0; }
  }

  function wander(e, dt, animSpeed) {
    const dx = e.target.x - e.pos.x, dz = e.target.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) {
      // A homed NPC (e.g. a shelter volunteer) re-centers around its home spot
      // instead of drifting across the whole map, so it stays findable there.
      do { e.target = e.home ? newTarget(e.home, 9) : newTarget(e.pos, 30); } while (inPond(e.target.x, e.target.z));
    } else {
      e.pos.x += (dx / d) * e.speed * dt;
      e.pos.z += (dz / d) * e.speed * dt;
      e.heading = Math.atan2(dx, dz);
      e.legPhase += dt * animSpeed;
    }
    e.group.position.set(e.pos.x, 0, e.pos.z);
    e.group.rotation.y = e.heading;
    const sw = Math.sin(e.legPhase) * 0.5;
    e.legs[0].rotation.x = sw; e.legs[1].rotation.x = -sw;
    if (e.legs[2]) { e.legs[2].rotation.x = -sw; e.legs[3].rotation.x = sw; }
  }

  // ---- boids flocking for idle NPC dogs (from the sandbox "Critter Garden") ----
  // A shared scare point everyone flees — set by the catcher chasing or a bark.
  const dogScare = { x: 0, z: 0, r: 0, t: 0 };
  function setDogScare(x, z, r) { dogScare.x = x; dogScare.z = z; dogScare.r = r; dogScare.t = 0.5; }
  const DOG_NEIGH = 15, DOG_SEP = 6;
  // Uniform spatial-hash grid (cell = query radius). Keeps neighbour queries
  // O(n) so the park can hold a big crowd. MEMORY LESSON: scan the 3x3 block of
  // cells, not just the home cell, or cross-boundary neighbours are missed.
  function buildGrid(snap, cell) {
    const g = new Map();
    for (let i = 0; i < snap.length; i++) {
      const k = Math.floor(snap[i].x / cell) + "," + Math.floor(snap[i].z / cell);
      let b = g.get(k); if (!b) { b = []; g.set(k, b); } b.push(i);
    }
    return { g, cell };
  }
  function eachNeighbor(grid, x, z, cb) {
    const cx = Math.floor(x / grid.cell), cz = Math.floor(z / grid.cell);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const b = grid.g.get((cx + ox) + "," + (cz + oz)); if (!b) continue;
      for (let k = 0; k < b.length; k++) cb(b[k]);
    }
  }
  function flockDogs(list, dt) {
    if (!list.length) return;
    // MEMORY LESSON (snapshot-then-integrate): read every neighbour from a copy
    // taken before anyone moves, so the step is order-independent & symmetric.
    const snap = list.map((d) => ({ x: d.pos.x, z: d.pos.z, vx: d.vx, vz: d.vz }));
    const grid = buildGrid(snap, DOG_NEIGH);
    for (let i = 0; i < list.length; i++) {
      const d = list[i], s0 = snap[i];
      let sepx = 0, sepz = 0, alx = 0, alz = 0, cox = 0, coz = 0, n = 0;
      eachNeighbor(grid, s0.x, s0.z, (j) => {
        if (j === i) return;
        const o = snap[j], dx = s0.x - o.x, dz = s0.z - o.z, dd = Math.hypot(dx, dz);
        if (dd < DOG_NEIGH && dd > 0) {
          alx += o.vx; alz += o.vz; cox += o.x; coz += o.z; n++;
          if (dd < DOG_SEP) { sepx += dx / dd; sepz += dz / dd; }
        }
      });
      let ax = 0, az = 0;
      if (n > 0) { ax += (alx / n) * 0.6 + ((cox / n) - s0.x) * 0.02 + sepx * 2.4; az += (alz / n) * 0.6 + ((coz / n) - s0.z) * 0.02 + sepz * 2.4; }
      // gentle wander toward a roaming target, with ARRIVAL (memory lesson):
      // ramp the seek down inside a radius so momentum doesn't overshoot/orbit it.
      // The SEEK direction is obstacle-aware (steers toward the next
      // pathfinding waypoint, not straight at the target); arrival is still
      // judged against the real target so a new roam destination gets
      // picked at the right moment.
      const td = Math.hypot(d.target.x - d.pos.x, d.target.z - d.pos.z);
      if (td < 2) { do { d.target = newTarget(d.pos, 30); } while (inPond(d.target.x, d.target.z)); }
      else {
        if (!d._pather) d._pather = pathfinder.createPather(i);
        const steer = d._pather.getSteerTarget(d.pos.x, d.pos.z, d.target.x, d.target.z, dt);
        const tdx = steer.x - d.pos.x, tdz = steer.z - d.pos.z, sd = Math.hypot(tdx, tdz) || 1;
        const arrive = Math.min(1, td / 8);
        ax += (tdx / sd) * 0.5 * arrive; az += (tdz / sd) * 0.5 * arrive;
      }
      // flee the shared scare source
      let fleeing = false;
      if (dogScare.t > 0) {
        const dx = d.pos.x - dogScare.x, dz = d.pos.z - dogScare.z, dd = Math.hypot(dx, dz);
        if (dd < dogScare.r) {
          const ux = dd > 0.01 ? dx / dd : Math.cos(d.legPhase), uz = dd > 0.01 ? dz / dd : Math.sin(d.legPhase);
          ax += ux * 6; az += uz * 6; fleeing = true; // even a dog atop the threat bolts somewhere
        }
      }
      d.vx += ax * dt; d.vz += az * dt;
      const sp = Math.hypot(d.vx, d.vz), max = fleeing ? d.speed * 2.4 : d.speed;
      if (sp > max) { d.vx = d.vx / sp * max; d.vz = d.vz / sp * max; }
      let nx = d.pos.x + d.vx * dt, nz = d.pos.z + d.vz * dt;
      if (inPond(nx, nz)) { d.vx *= -0.5; d.vz *= -0.5; nx = d.pos.x; nz = d.pos.z; }
      d.pos.x = THREE.MathUtils.clamp(nx, -roam, roam);
      d.pos.z = THREE.MathUtils.clamp(nz, -roam, roam);
      if (sp > 0.05) d.heading = Math.atan2(d.vx, d.vz);
      d.legPhase += dt * (1.4 + sp * 0.4) * (fleeing ? 2.0 : 1.4);
      d.group.position.set(d.pos.x, 0, d.pos.z);
      d.group.rotation.y = d.heading;
      const sw = Math.sin(d.legPhase) * 0.5;
      d.legs[0].rotation.x = sw; d.legs[1].rotation.x = -sw;
      d.legs[2].rotation.x = -sw; d.legs[3].rotation.x = sw;
    }
  }

  // ---- emergent crowds --------------------------------------------------
  // Gathering points are no longer fixed. A crowd is *born* where a gather-
  // seeking person plants one, grows as neighbours drift in, and is held in
  // check purely by decay: appeal climbs with members (with diminishing
  // returns), but bleeds away faster the more crowded it gets AND the older it
  // is — so a popular spot saturates, burns itself out, and the crowd reforms
  // elsewhere. A dissolve-cooldown at the dead spot stops it snapping back, so
  // the park's clusters migrate instead of freezing onto one point forever.
  // (The age term guarantees termination — a crowd can't live indefinitely, the
  // same max-dwell safety the person FSM uses.)
  const CROWD = {
    max: 3,          // hard cap on live crowds (bounds the visual pool)
    joinR: 8,        // a person within this of a crowd counts as a member
    seekR: 40,       // a gather-seeker joins a crowd within this, else founds one
    formR: 7,        // seeded crowds / cooldowns must be at least this far apart
    tick: 0.5,       // crowd bookkeeping runs on this cadence, not every frame
    appealStart: 2.0,
    appealMax: 4.0,
    joinGain: 0.6,   // appeal gained per member per second...
    joinCap: 3,      // ...but only the first few members help (diminishing return)
    decayBase: 0.2,  // constant bleed
    crowdDecay: 0.22,// extra bleed per member (linear — overtakes gain when full)
    ageDecay: 0.03,  // extra bleed per second of age (forces eventual death)
    coolTime: 16,    // a dissolved spot stays "salted" this long
  };
  const crowds = [];             // { pos:{x,z}, appeal, age }
  const crowdCooldowns = [];     // { x, z, t }
  let crowdT = 0;
  const near2 = (ax, az, bx, bz, r) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz) < r * r;

  function updateCrowds(dt) {
    // 1. members + appeal integration, oldest-first death
    for (let i = crowds.length - 1; i >= 0; i--) {
      const c = crowds[i];
      let members = 0;
      for (const p of people) if (near2(p.pos.x, p.pos.z, c.pos.x, c.pos.z, CROWD.joinR)) members++;
      const gain = CROWD.joinGain * Math.min(members, CROWD.joinCap);
      const decay = CROWD.decayBase + CROWD.crowdDecay * members + CROWD.ageDecay * c.age;
      c.appeal = Math.min(CROWD.appealMax, c.appeal + (gain - decay) * dt);
      c.age += dt;
      if (c.appeal <= 0) {
        crowdCooldowns.push({ x: c.pos.x, z: c.pos.z, t: CROWD.coolTime });
        crowds.splice(i, 1);
      }
    }
    // 2. cooldown timers
    for (let i = crowdCooldowns.length - 1; i >= 0; i--) {
      crowdCooldowns[i].t -= dt;
      if (crowdCooldowns[i].t <= 0) crowdCooldowns.splice(i, 1);
    }
  }

  // A gather-seeking person either joins an existing crowd (weighted by appeal,
  // so the popular spots pull harder but never exclusively) or, if there's no
  // live crowd, seeds a fresh one at their own position — a nucleus that only
  // survives if others actually come. Returns a jittered target point.
  function crowdTarget(p) {
    // Join a crowd within reach, weighted by appeal (the popular one pulls
    // harder, never exclusively). "Within reach" keeps distant gatherings
    // independent, so several crowds coexist across the park.
    let total = 0;
    for (const c of crowds) if (near2(p.pos.x, p.pos.z, c.pos.x, c.pos.z, CROWD.seekR)) total += c.appeal;
    if (total > 0) {
      let r = RND() * total;
      for (const c of crowds) {
        if (!near2(p.pos.x, p.pos.z, c.pos.x, c.pos.z, CROWD.seekR)) continue;
        r -= c.appeal; if (r <= 0) return { x: c.pos.x + rand(-3, 3), z: c.pos.z + rand(-3, 3) };
      }
    }
    // nothing to join nearby — try to found one here (respecting cap + salted spots)
    if (crowds.length < CROWD.max) {
      const blocked = crowdCooldowns.some((cd) => near2(p.pos.x, p.pos.z, cd.x, cd.z, CROWD.formR)) ||
        crowds.some((c) => near2(p.pos.x, p.pos.z, c.pos.x, c.pos.z, CROWD.formR)) ||
        inPond(p.pos.x, p.pos.z);
      if (!blocked) { crowds.push({ pos: { x: p.pos.x, z: p.pos.z }, appeal: CROWD.appealStart, age: 0 }); }
    }
    return { x: p.pos.x + rand(-2, 2), z: p.pos.z + rand(-2, 2) };
  }

  // A soft ground ring makes each live crowd legible to the player (the old
  // fixed spots were invisible). Pooled: one ring per possible crowd, shown/
  // sized/faded from the crowd's appeal so it grows as a gathering catches on.
  const crowdRings = [];
  for (let i = 0; i < CROWD.max; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.4, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false;
    scene.add(ring); crowdRings.push(ring);
  }
  function renderCrowds() {
    for (let i = 0; i < crowdRings.length; i++) {
      const ring = crowdRings[i], c = crowds[i];
      if (!c) { ring.visible = false; continue; }
      const f = Math.min(1, c.appeal / CROWD.appealMax);
      ring.visible = true;
      ring.position.set(c.pos.x, 0.03, c.pos.z);
      ring.scale.setScalar(0.6 + f * 0.9);          // bigger as it fills
      ring.material.opacity = 0.12 + f * 0.33;        // brighter as it fills
    }
  }
  function walkToward(e, tx, tz, dt, sp, animSpeed) {
    const dx = tx - e.pos.x, dz = tz - e.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.4) {
      e.pos.x += (dx / d) * sp * dt; e.pos.z += (dz / d) * sp * dt;
      e.heading = Math.atan2(dx, dz); e.legPhase += dt * animSpeed;
    }
    e.group.position.set(e.pos.x, 0, e.pos.z); e.group.rotation.y = e.heading;
    const sw = Math.sin(e.legPhase) * 0.5;
    e.legs[0].rotation.x = sw; e.legs[1].rotation.x = -sw;
  }
  // A small scheduled FSM: stroll -> rest -> gather. Every state has a
  // guaranteed max-dwell exit (MEMORY LESSON) so no one can get stuck.
  function nextPersonState(p) {
    const r = RND();
    if (p.aiState === "stroll") { p.aiState = r < 0.5 ? "rest" : "gather"; }
    else if (p.aiState === "rest") { p.aiState = r < 0.7 ? "stroll" : "gather"; }
    else { p.aiState = "stroll"; }
    p.aiT = 0;
    if (p.aiState === "stroll") { do { p.target = newTarget(p.pos, 30); } while (inPond(p.target.x, p.target.z)); p.aiMax = rand(5, 10); }
    else if (p.aiState === "gather") { p.target = crowdTarget(p); p.aiMax = rand(12, 22); } // longer: they walk there AND linger
    else { p.aiMax = rand(3, 7); } // rest
  }
  // Once a gatherer reaches the spot, keep them milling within the crowd (a
  // point inside joinR) instead of walking off — this is what lets a crowd
  // actually accumulate members rather than have people ping it and leave.
  function mingleTarget(p) {
    let best = null, bd = CROWD.joinR * 1.5;
    for (const c of crowds) { const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z); if (d < bd) { bd = d; best = c; } }
    if (!best) return null; // the gathering fizzled while walking over — move on
    return { x: best.pos.x + rand(-CROWD.joinR * 0.55, CROWD.joinR * 0.55), z: best.pos.z + rand(-CROWD.joinR * 0.55, CROWD.joinR * 0.55) };
  }
  function stepPersonAI(p, dt) {
    if (p.aiState === undefined) { p.aiState = "stroll"; p.aiT = 0; p.aiMax = rand(4, 9); if (!p.target) p.target = newTarget(p.pos, 30); }
    p.aiT += dt;
    let exit = false;
    if (p.aiState === "rest") {
      p.legs[0].rotation.x *= 0.85; p.legs[1].rotation.x *= 0.85; // settle to a stand
      p.group.position.set(p.pos.x, 0, p.pos.z); p.group.rotation.y = p.heading;
    } else {
      if (!p._pather) p._pather = pathfinder.createPather(people.indexOf(p));
      const steer = p._pather.getSteerTarget(p.pos.x, p.pos.z, p.target.x, p.target.z, dt);
      walkToward(p, steer.x, steer.z, dt, p.speed, p.speed * 2.4);
      if (Math.hypot(p.target.x - p.pos.x, p.target.z - p.pos.z) < 1.2) {
        // At a gathering, linger and mingle until the dwell timer runs out;
        // anywhere else, "arrived" means pick the next thing to do.
        if (p.aiState === "gather" && p.aiT < p.aiMax) {
          const m = mingleTarget(p);
          if (m) p.target = m; else exit = true;
        } else exit = true;
      }
    }
    if (p.aiT > p.aiMax) exit = true; // guaranteed exit — a bad guard can't trap them
    if (exit) nextPersonState(p);
  }

  // Mrs. Bell's body language mirrors her bond with the dog — reads like a dog's
  // own signals (stiff -> relaxed sway -> play-bow invite -> held gaze) so the
  // adoption feels like mutual recognition, not a transaction. Always resets to
  // neutral when not near the dog / not yet bonding, so no pose gets stuck.
  function animateBondBodyLanguage(p, dt) {
    if (!p.torso) return;
    const rapport = p.rapport || 0;
    if (rapport < 0.3) {
      p.torso.rotation.x = 0; p.torso.rotation.z = 0;
      if (p.head) { p.head.rotation.x = 0; p.head.rotation.z = 0; }
      return;
    }
    p.bondT += dt;
    const t = p.bondT;
    if (rapport < 0.6) { // relaxed: a slow, gentle sway
      p.torso.rotation.x = 0;
      p.torso.rotation.z = Math.sin(t * 1.1) * 0.025;
      if (p.head) { p.head.rotation.x = 0; p.head.rotation.z = Math.sin(t * 0.9 + 1) * 0.03; }
    } else if (rapport < 0.8) { // play-bow invite: a brief periodic crouch, like a dog's own play-bow
      const cyc = t % 5, bow = cyc < 0.7 ? Math.sin((cyc / 0.7) * Math.PI) : 0;
      p.torso.rotation.x = bow * 0.45;
      p.torso.rotation.z = Math.sin(t * 1.1) * 0.02;
      if (p.head) { p.head.rotation.x = bow * 0.2; p.head.rotation.z = 0; }
    } else { // sustained gaze: head held toward the dog, body settled
      p.torso.rotation.x = 0.06; p.torso.rotation.z = 0;
      if (p.head) { p.head.rotation.x = 0.18; p.head.rotation.z = Math.sin(t * 0.6) * 0.04; }
    }
  }

  function update(dt, time) {
    const dog = getDog();

    // Crowd bookkeeping on its own coarse cadence; rings refreshed every frame.
    crowdT += dt;
    if (crowdT >= CROWD.tick) { updateCrowds(crowdT); crowdT = 0; }
    renderCrowds();

    for (const p of people) {
      // Stop and turn to face the dog when it's close, so the player can
      // actually walk up and greet instead of chasing a moving target.
      const near = Math.hypot(dog.x - p.pos.x, dog.z - p.pos.z) < 6;
      if (near) {
        p.heading = Math.atan2(dog.x - p.pos.x, dog.z - p.pos.z);
        p.group.position.set(p.pos.x, 0, p.pos.z);
        p.group.rotation.y = p.heading;
        p.legs[0].rotation.x = 0; p.legs[1].rotation.x = 0;
        if (p.role === "adopter") animateBondBodyLanguage(p, dt);
      } else {
        stepPersonAI(p, dt);
        p.bondT = 0;
        if (p.torso) { p.torso.rotation.x = 0; p.torso.rotation.z = 0; }
        if (p.head) { p.head.rotation.x = 0; p.head.rotation.z = 0; }
      }
      if (p.chatty) {
        if (!p.voice && audio.ready) p.voice = audio.makePersonVoice();
        if (p.voice) {
          p.voice.setPosition(p.pos.x, 1.8, p.pos.z);
          p.talkTimer -= dt;
          if (p.talkTimer <= 0) { p.voice.chatter(); p.talkTimer = rand(7, 20); }
        }
      }
    }

    const idleDogs = [];
    for (const d of dogs) {
      if (d.vx === undefined) { d.vx = 0; d.vz = 0; }
      if (d.task) {
        // movement controlled by the fetch system; just render from pos + animate
        d.group.position.set(d.pos.x, 0, d.pos.z);
        d.group.rotation.y = d.heading;
        const sw = Math.sin(d.legPhase) * 0.5;
        d.legs[0].rotation.x = sw; d.legs[1].rotation.x = -sw;
        d.legs[2].rotation.x = -sw; d.legs[3].rotation.x = sw;
      } else {
        idleDogs.push(d); // idle dogs move together as a loose flock (below)
      }
      d.tail.rotation.y = Math.sin(time * 8 + d.legPhase) * 0.4;
      d.barkTimer -= dt; // NPC dogs bark via spatial one-shots (audio.barkAt)
      if (d.barkTimer <= 0) {
        if (audio.ready) audio.barkAt(d.pos.x, 0.7, d.pos.z);
        d.barkTimer = rand(5, 15);
      }
    }
    flockDogs(idleDogs, dt);
    if (dogScare.t > 0) dogScare.t -= dt;

    scare = Math.max(0, scare - DUCK.drain * dt);
    for (const dk of ducks) {
      if (!dk.voice && audio.ready) dk.voice = audio.makeDuckVoice();
      if (dk.startle > 0) dk.startle -= dt;
      if (dk.sated > 0) dk.sated -= dt; // fed ducks stay peaceful for a while
      const hostile = dk.sated <= 0;
      const dogPond = Math.hypot(dog.x - pond.x, dog.z - pond.z);
      const ddx = dog.x - dk.pos.x, ddz = dog.z - dk.pos.z, distDog = Math.hypot(ddx, ddz);

      switch (dk.state) {
        case "flee":
          move3D(dk, dk.exit, DUCK.fleeSpeed, dt); dk.flap += dt * 22;
          if (dk.pos.distanceTo(dk.exit) < 6) { dk.state = "away"; dk.awayTimer = DUCK.awaySecs; dk.group.visible = false; }
          break;
        case "away":
          dk.awayTimer -= dt;
          if (dk.awayTimer <= 0) { dk.group.visible = true; dk.target.copy(pondPoint()); dk.state = "comeback"; }
          break;
        case "comeback":
          move3D(dk, dk.target, DUCK.fleeSpeed * 0.8, dt); dk.flap += dt * 18;
          if (Math.hypot(dk.pos.x - dk.target.x, dk.pos.z - dk.target.z) < 1 && dk.pos.y < 1) dk.state = "calm";
          break;
        case "chase":
          if (!hostile) { dk.target.copy(pondPoint()); dk.state = "return"; break; }
          if (dogPond <= DUCK.pursuit) {
            // dog is inside the territory → run it down
            stepXZ(dk, dog.x, dog.z, DUCK.chase, dt); dk.pos.y = 0.3; dk.flap += dt * 18;
            const px = dk.pos.x - pond.x, pz = dk.pos.z - pond.z, pd = Math.hypot(px, pz);
            if (pd > DUCK.pursuit) { dk.pos.x = pond.x + (px / pd) * DUCK.pursuit; dk.pos.z = pond.z + (pz / pd) * DUCK.pursuit; }
            dk.peckCD -= dt;
            if (distDog < DUCK.peck && dk.peckCD <= 0) {
              dk.peckCD = 1.1; if (dk.voice) dk.voice.quack(true); audio.yelp();
              if (pushDog && distDog > 0.0001) pushDog(ddx / distDog, ddz / distDog, 7);
            }
            dk.quackTimer -= dt; if (dk.quackTimer <= 0) { if (dk.voice) dk.voice.quack(true); dk.quackTimer = rand(0.5, 1.1); }
          } else {
            // dog fled past the boundary → chase to the boundary, then guard it
            const inv = 1 / (dogPond || 1);
            const bx = pond.x + (dog.x - pond.x) * inv * DUCK.pursuit;
            const bz = pond.z + (dog.z - pond.z) * inv * DUCK.pursuit;
            stepXZ(dk, bx, bz, DUCK.chase, dt); dk.pos.y = 0.3; dk.flap += dt * 16;
            if (Math.hypot(dk.pos.x - bx, dk.pos.z - bz) < 1.5) { dk.state = "guard"; dk.guardTimer = DUCK.guardTime; }
            dk.quackTimer -= dt; if (dk.quackTimer <= 0) { if (dk.voice) dk.voice.quack(true); dk.quackTimer = rand(0.6, 1.2); }
          }
          break;
        case "guard":
          if (hostile && dogPond <= DUCK.pursuit) { dk.state = "chase"; break; }
          dk.pos.y = 0.3; dk.guardTimer -= dt;
          dk.quackTimer -= dt; if (dk.quackTimer <= 0) { if (dk.voice) dk.voice.quack(true); dk.quackTimer = rand(0.5, 1.0); }
          if (dk.guardTimer <= 0) { dk.target.copy(pondPoint()); dk.state = "return"; }
          break;
        case "return":
          if (hostile && dogPond <= DUCK.pursuit) { dk.state = "chase"; break; }
          stepXZ(dk, dk.target.x, dk.target.z, DUCK.paddle * 1.8, dt);
          dk.pos.y = 0.28 + Math.sin(time * 1.5 + dk.bob) * 0.04;
          if (Math.hypot(dk.pos.x - dk.target.x, dk.pos.z - dk.target.z) < 0.6) dk.state = "calm";
          break;
        default: // calm
          if (hostile && dogPond <= DUCK.pursuit) { dk.state = "chase"; break; }
          if (Math.hypot(dk.target.x - dk.pos.x, dk.target.z - dk.pos.z) < 0.6) dk.target.copy(pondPoint());
          else stepXZ(dk, dk.target.x, dk.target.z, DUCK.paddle, dt);
          dk.pos.y = 0.26 + Math.sin(time * 1.5 + dk.bob) * 0.04;
          dk.quackTimer -= dt; if (dk.quackTimer <= 0) { if (dk.voice) dk.voice.quack(false); dk.quackTimer = rand(4, 10); }
      }

      dk.group.position.copy(dk.pos);
      dk.group.rotation.y = dk.heading;
      const flying = dk.state === "chase" || dk.state === "flee" || dk.state === "comeback";
      const wa = flying ? Math.abs(Math.sin(dk.flap)) * 0.9 + 0.1
        : dk.startle > 0 ? 0.5 + Math.sin(time * 40) * 0.4 : 0.05;
      dk.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * wa));
      if (dk.voice) dk.voice.setPosition(dk.pos.x, dk.pos.y + 0.4, dk.pos.z);
    }
  }

  // Toss food to the ducks → they calm down and stay peaceful for a while.
  function feedDucks() {
    let fed = 0;
    for (const dk of ducks) {
      if (dk.state === "away" || dk.state === "flee") continue;
      dk.sated = 30;
      if (dk.state === "chase" || dk.state === "guard") { dk.target.copy(pondPoint()); dk.state = "return"; }
      if (dk.voice && RND() < 0.6) dk.voice.quack(false);
      fed++;
    }
    return fed > 0;
  }
  // Rex spawns later — only once Level 3 begins, not present before then.
  // Mirrors the per-dog fields fetch.js's own init loop sets (that loop only
  // ran once, before Rex existed, so he needs them set explicitly here).
  function spawnRex(x, z) {
    const { group, legs, tail } = buildNpcDog(0xd4922a, 1.15);
    const pos = new THREE.Vector3(x, 0, z);
    group.position.copy(pos); scene.add(group);
    // task starts as "loiter" (anything truthy) so the dog-render loop below
    // poses him from pos/heading directly instead of handing him to the idle
    // flock — he'd otherwise wander off and be unfindable for the challenge.
    // legPhase 0 keeps his stance neutral (not frozen mid-stride).
    const rex = { group, legs, tail, pos, target: null, speed: 14,
      legPhase: 0, voice: null, barkTimer: rand(4, 14),
      pref: Math.random() < 0.5 ? "bone" : "ball", task: "loiter", holding: null,
      fetchItem: null, holdTarget: null, holdTime: 0, wantFlash: 0, isRex: true };
    dogs.push(rex);
    return rex;
  }

  // A well-fed pair of NPC dogs earns the park a pup — the self-regulating
  // half of the hungry-dog mechanic (idea: energy-food-reproduce). Spawned
  // as a normal wandering dog, just smaller; the population cap that gates
  // calling this at all lives in game.js alongside the starve-to-death half.
  function spawnPup(x, z) {
    const { group, legs, tail } = buildNpcDog(pick(dogColors), rand(0.55, 0.75));
    const pos = newTarget(new THREE.Vector3(x, 0, z), 4);
    group.position.copy(pos); scene.add(group);
    const pup = { group, legs, tail, pos, target: newTarget(pos, 35), speed: rand(3.8, 6.4),
      legPhase: RND() * 6, voice: null, barkTimer: rand(4, 14), hunger: 0.1 };
    dogs.push(pup);
    return pup;
  }

  return { update, people, dogs, ducks, crowds, playerBarked, feedDucks, setDogScare, get scare() { return scare; }, _flee: triggerFlee, spawnRex, spawnPup };
}
