/* Dog Park 3D — the fetch/play system.
 *
 * Items the dog can CARRY (one at a time): frisbee, ball, bone, bandana, collar.
 * Frisbees fly slowly on a banking curve and stick where they land; balls arc,
 * bounce and roll. Thrown items lure nearby NPC dogs, who may grab and hold one.
 * A held frisbee is reclaimed by offering a bone-loving dog a bone, or throwing a
 * ball past a ball-loving dog so it chases that instead.
 */
import * as THREE from "./vendor/three.module.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rand = (a, b) => a + Math.random() * (b - a);
const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const REST = { frisbee: 0.18, ball: 0.3, bone: 0.22, bandana: 0.45, collar: 0.45 };
const ITEM_R = { frisbee: 0.46, ball: 0.3 }; // matches each mesh's own radius

export function createFetch(scene, audio, opts) {
  const { getDog, getHeading, npcDogs, world, pathfinder, obstacles } = opts;
  const lim = world - 3;
  const items = [];
  let carry = null;

  // ---- meshes ----
  function makeMesh(kind, tint) {
    if (kind === "frisbee") {
      return new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 22),
        new THREE.MeshStandardMaterial({ color: tint || 0xffcf3d, roughness: 0.5 }));
    }
    if (kind === "ball") {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12),
        new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5 }));
      m.castShadow = true; g.add(m);
      return g;
    }
    if (kind === "bone") {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 0.6 });
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), mat);
      bar.rotation.z = Math.PI / 2; g.add(bar);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), mat);
        k.position.set(sx * 0.28, 0, sz * 0.12); g.add(k);
      }
      return g;
    }
    if (kind === "bandana") {
      return new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.24, 3),
        new THREE.MeshStandardMaterial({ color: 0x2e86de, roughness: 0.6 }));
    }
    // collar
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 8, 18),
      new THREE.MeshStandardMaterial({ color: 0xd63b3b, roughness: 0.5 }));
    m.rotation.x = Math.PI / 2;
    return m;
  }

  const BEACON_COL = { frisbee: 0xffd23a, ball: 0xff7a5a, bone: 0xffffff, bandana: 0x3aa0ff, collar: 0xff5a4a };
  function makeBeacon(kind) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 6),
      new THREE.MeshBasicMaterial({ color: BEACON_COL[kind], transparent: true, opacity: 0.7 }));
    m.rotation.x = Math.PI;
    return m;
  }

  function spawn(kind, x, z, tint) {
    const mesh = makeMesh(kind, tint);
    mesh.position.set(x, REST[kind], z);
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(mesh);
    const beacon = makeBeacon(kind);
    beacon.position.set(x, 2.7, z);
    scene.add(beacon);
    const it = { kind, mesh, beacon, state: "ground", pos: mesh.position.clone(),
      vel: V(0, 0, 0), spin: Math.random() * 6, curve: 0, bounces: 0, thrownBy: null };
    items.push(it);
    return it;
  }

  // scatter the toolkit
  spawn("frisbee", 18, -6); spawn("frisbee", -10, -20);
  spawn("ball", 30, 8, 0xe23b3b); spawn("ball", -6, 24, 0x2e6fe2);
  spawn("bone", 8, 16); spawn("bone", -28, 4); spawn("bone", 36, -14);
  spawn("bandana", -24, 26);
  spawn("collar", 58, -55); // in the new city district (props.js COLLAR_SPOT) — Level 2's disguise piece

  // each NPC dog: a preference + fetch task fields
  for (const d of npcDogs) {
    d.pref = Math.random() < 0.5 ? "bone" : "ball";
    d.task = null; d.holding = null; d.fetchItem = null; d.holdTarget = null;
    d.holdTime = 0; d.wantFlash = 0;
  }

  // ---- carry ----
  function mouth() {
    const d = getDog(), h = getHeading();
    return V(d.x + Math.sin(h) * 1.3, 0.92, d.z + Math.cos(h) * 1.3);
  }
  function carrying() { return carry; }
  function nearestGround(p, range) {
    let best = null, bd = range;
    for (const it of items) { if (it.state !== "ground") continue; const dd = d2(p.x, p.z, it.pos.x, it.pos.z); if (dd < bd) { bd = dd; best = it; } }
    return best;
  }
  function grabItem(it, caught) {
    it.state = "carry"; it.holder = null; it.caught = caught;
    if (it.beacon) { scene.remove(it.beacon); it.beacon = null; }
    carry = it;
    return it;
  }
  function tryGrab() {
    if (carry) return null;
    const d = getDog();
    // a leaping mid-air catch of a low frisbee
    for (const it of items) {
      if (it.state === "fris-air" && it.pos.y < 2.4 && d2(d.x, d.z, it.pos.x, it.pos.z) < 2.2) return grabItem(it, true);
    }
    const it = nearestGround(d, 2.6);
    return it ? grabItem(it, false) : null;
  }
  function dropCarry() {
    if (!carry) return;
    const d = getDog();
    carry.state = "ground"; carry.pos.set(d.x, REST[carry.kind], d.z);
    placeOnGround(carry);
    carry = null;
  }
  function placeOnGround(it) {
    it.pos.x = THREE.MathUtils.clamp(it.pos.x, -lim, lim);
    it.pos.z = THREE.MathUtils.clamp(it.pos.z, -lim, lim);
    it.pos.y = REST[it.kind];
    it.mesh.position.copy(it.pos);
    it.mesh.rotation.set(it.kind === "collar" ? Math.PI / 2 : 0, 0, 0);
  }
  // remove from the dog's mouth without dropping (consumed by a human/dog)
  function takeCarry() { const it = carry; carry = null; return it; }

  // ---- throwing ----
  function throwItem(it, origin, dir, power) {
    if (carry === it) carry = null;
    it.holder = null; it.thrownBy = it.thrownBy || null;
    it.pos.set(origin.x, origin.y, origin.z);
    const n = Math.hypot(dir.x, dir.z) || 1;
    const dx = dir.x / n, dz = dir.z / n;
    if (it.kind === "ball") {
      it.state = "ball-air"; it.vel.set(dx * power, 7.5, dz * power); it.bounces = 0;
      lureBallLovers(it, origin);
    } else {
      // a slow, floaty glide that carries ~3x farther before it sticks
      it.state = "fris-air"; it.vel.set(dx * power * 0.82, 2.7, dz * power * 0.82);
      it.curve = rand(-0.7, 0.7);
    }
    lureFree(it, origin, 52);
  }
  // dog's facing forward, away from the thrower
  function throwFrom(pos, dir, it, power) { throwItem(it, V(pos.x, pos.y || 1.1, pos.z), dir, power); }
  function playerThrow() {
    if (!carry) return null;
    const it = carry, h = getHeading();
    throwItem(it, mouth(), V(Math.sin(h), 0, Math.cos(h)), it.kind === "ball" ? 15 : 13);
    return it;
  }

  // ---- dog attraction ----
  // A contest item (Rex's fetch-off frisbee) is exempt: it's a fair 1-on-1
  // race, and a wandering bystander dog snagging it first would silently
  // stall the round (found in play-testing — the round still self-resolved
  // via its timeout, but that's a consolation, not a fix).
  function lureFree(it, zone, radius) {
    if (it.isContest) return;
    for (const d of npcDogs) {
      if (d.task) continue;
      if (d2(d.pos.x, d.pos.z, zone.x, zone.z) < radius) { d.task = "fetch"; d.fetchItem = it; }
    }
  }
  function lureBallLovers(ball, zone) {
    for (const d of npcDogs) {
      if (d.pref !== "ball") continue;
      if (d2(d.pos.x, d.pos.z, zone.x, zone.z) < 56) {
        if (d.holding) releaseDog(d);
        d.task = "fetch"; d.fetchItem = ball;
      }
    }
  }
  function releaseDog(d) {
    if (!d.holding) return;
    const cur = d.holding;
    cur.state = "ground"; cur.pos.set(d.pos.x, REST[cur.kind], d.pos.z); cur.holder = null;
    placeOnGround(cur);
    d.holding = null;
  }

  function dogHoldingFrisbeeNear(p, range) {
    for (const d of npcDogs) {
      if (d.holding && d.holding.kind === "frisbee" && d2(p.x, p.z, d.pos.x, d.pos.z) < range) return d;
    }
    // tolerate the spelling 'frisbee'
    for (const d of npcDogs) {
      if (d.holding && d.holding.kind === "frisbee" && d2(p.x, p.z, d.pos.x, d.pos.z) < range) return d;
    }
    return null;
  }
  // What it'll take to make a frisbee-thief give it up: a bone for bone-lovers,
  // a chased ball for ball-lovers. Used to drive the thought-bubble over its head.
  function dogWant(d) { return d.pref; }

  // offer the carried item to a frisbee-holding dog.
  // returns: "traded" (it dropped the frisbee for a bone), "wrong" (it wants
  // something else — reveal the want), or null (nothing to offer here).
  function offerItem(d) {
    if (!carry || !d.holding || d.holding.kind !== "frisbee") return null;
    if (carry.kind === "bone" && d.pref === "bone") {
      const fris = d.holding;
      fris.state = "ground"; fris.pos.set(d.pos.x + 0.6, REST.frisbee, d.pos.z); fris.holder = null;
      placeOnGround(fris);
      const bone = takeCarry();
      bone.state = "dog"; bone.holder = d; d.holding = bone;
      d.task = "hold"; d.holdTarget = null; d.holdTime = 0;
      return "traded";
    }
    // wrong item — it sulks and shows what it actually wants
    d.wantFlash = 4.5;
    return "wrong";
  }
  // back-compat alias
  function offerBone(d) { return offerItem(d) === "traded"; }

  // ---- physics ----
  function clampField(it) {
    if (Math.abs(it.pos.x) > lim) { it.pos.x = THREE.MathUtils.clamp(it.pos.x, -lim, lim); it.vel.x *= -0.4; }
    if (Math.abs(it.pos.z) > lim) { it.pos.z = THREE.MathUtils.clamp(it.pos.z, -lim, lim); it.vel.z *= -0.4; }
  }
  // A thrown item used to sail straight through trees/props even after dogs
  // gained obstacle-aware pathfinding — the throw arc and the fetch chase
  // looked inconsistent with each other. Same shape as clampField's own
  // world-edge bounce (push out of penetration, reflect the velocity
  // component along the normal, damp it) so a mid-flight clip reads as a
  // deflection, not a stop-dead snap.
  function obstacleCollide(it) {
    if (!obstacles) return;
    const r = ITEM_R[it.kind]; if (r == null) return; // only items that actually fly with real physics
    for (const o of obstacles) {
      const dx = it.pos.x - o.x, dz = it.pos.z - o.z, dist = Math.hypot(dx, dz);
      const minDist = o.r + r;
      if (dist < minDist) {
        const nx = dist > 1e-4 ? dx / dist : 1, nz = dist > 1e-4 ? dz / dist : 0;
        it.pos.x = o.x + nx * minDist; it.pos.z = o.z + nz * minDist;
        const vn = it.vel.x * nx + it.vel.z * nz;
        if (vn < 0) { it.vel.x -= 1.5 * vn * nx; it.vel.z -= 1.5 * vn * nz; }
        it.vel.x *= 0.6; it.vel.z *= 0.6; // a bounce off a solid object bleeds energy
      }
    }
  }
  function land(it) {
    it.state = "ground"; it.vel.set(0, 0, 0);
    placeOnGround(it);
    lureFree(it, it.pos, 20); // smaller landing-zone radius
  }
  function updateFrisbee(it, dt) {
    it.vel.y -= 3 * dt;
    const hs = Math.hypot(it.vel.x, it.vel.z) || 1;
    const px = -it.vel.z / hs, pz = it.vel.x / hs; // perpendicular → banking
    it.vel.x += px * it.curve * 4 * dt; it.vel.z += pz * it.curve * 4 * dt;
    it.vel.x *= 1 - 0.12 * dt; it.vel.z *= 1 - 0.12 * dt;
    it.pos.addScaledVector(it.vel, dt);
    it.spin += dt * 12;
    obstacleCollide(it);
    it.mesh.position.copy(it.pos);
    it.mesh.rotation.set(0.35, it.spin, 0);
    clampField(it);
    if (it.pos.y <= REST.frisbee) { land(it); it.mesh.rotation.set(0, it.spin, 0); }
  }
  function updateBall(it, dt) {
    it.vel.y -= 14 * dt;
    it.pos.addScaledVector(it.vel, dt);
    obstacleCollide(it);
    if (it.pos.y <= REST.ball) {
      it.pos.y = REST.ball;
      if (it.state === "ball-air" && Math.abs(it.vel.y) > 1.6 && it.bounces < 3) {
        it.vel.y = -it.vel.y * 0.5; it.vel.x *= 0.72; it.vel.z *= 0.72; it.bounces++;
      } else { it.vel.y = 0; it.state = "ball-roll"; }
    }
    if (it.state === "ball-roll") {
      it.vel.x *= 1 - 1.6 * dt; it.vel.z *= 1 - 1.6 * dt;
      if (Math.hypot(it.vel.x, it.vel.z) < 0.4) { land(it); return; }
    }
    it.pos.addScaledVector(V(0, 0, 0), 0);
    it.mesh.position.copy(it.pos);
    it.mesh.rotation.x += dt * 7; it.mesh.rotation.z += dt * 5;
    clampField(it);
  }

  // ---- dog fetch movement ----
  function moveDog(d, tx, tz, dt, sp) {
    const dx = tx - d.pos.x, dz = tz - d.pos.z, dd = Math.hypot(dx, dz) || 1;
    d.pos.x += (dx / dd) * sp * dt; d.pos.z += (dz / dd) * sp * dt;
    d.heading = Math.atan2(dx, dz);
    d.legPhase += dt * sp * 1.4;
    return dd;
  }

  function update(dt) {
    // carried item rides the dog's mouth
    if (carry) {
      const m = mouth();
      carry.pos.copy(m); carry.mesh.position.copy(m);
      carry.mesh.rotation.y += dt * 2;
    }
    // items physics + idle
    for (const it of items) {
      if (it.state === "fris-air") updateFrisbee(it, dt);
      else if (it.state === "ball-air" || it.state === "ball-roll") updateBall(it, dt);
      else if (it.state === "ground" && it.beacon) {
        it.spin += dt; it.beacon.position.y = 2.7 + Math.sin(it.spin) * 0.2; it.beacon.rotation.y += dt * 1.5;
        it.mesh.rotation.y += dt * 0.8;
      }
    }
    // dog-held items ride that dog's mouth
    for (const d of npcDogs) {
      if (d.holding) {
        const h = d.heading || 0;
        d.holding.pos.set(d.pos.x + Math.sin(h) * 0.65, 0.7, d.pos.z + Math.cos(h) * 0.65);
        d.holding.mesh.position.copy(d.holding.pos);
      }
    }
    // dog AI
    for (const d of npcDogs) {
      if (d.task === "fetch" && d.fetchItem) {
        const it = d.fetchItem;
        if (it.state === "carry" || (it.holder && it.holder !== d)) { d.task = null; d.fetchItem = null; continue; }
        const grabbable = it.state === "ground" || it.state === "ball-roll" || (it.state === "fris-air" && it.pos.y < 1.3) || (it.state === "ball-air" && it.pos.y < 1.0);
        if (!d._pather) d._pather = pathfinder.createPather(npcDogs.indexOf(d));
        const steer = d._pather.getSteerTarget(d.pos.x, d.pos.z, it.pos.x, it.pos.z, dt);
        moveDog(d, steer.x, steer.z, dt, d.fetchSpeed !== undefined ? d.fetchSpeed : 14);
        const dd = Math.hypot(it.pos.x - d.pos.x, it.pos.z - d.pos.z); // distance to the ITEM, not the steering waypoint
        if (dd < 1.2 && grabbable) {
          it.state = "dog"; it.holder = d; d.holding = it; d.task = "hold"; d.fetchItem = null; d.holdTarget = null;
          d.holdTime = 0;
          if (d._pather) d._pather.path = null; // the steer target just changed meaning (item -> a new wander spot)
        }
      } else if (d.task === "hold") {
        // a held frisbee eventually bores the thief — it drops it (no soft-lock)
        if (d.holding && d.holding.kind === "frisbee") {
          d.holdTime += dt;
          if (d.holdTime > 20) { releaseDog(d); d.task = null; d.holdTime = 0; continue; }
        }
        if (!d.holdTarget || d2(d.pos.x, d.pos.z, d.holdTarget.x, d.holdTarget.z) < 1.5) {
          d.holdTarget = { x: THREE.MathUtils.clamp(d.pos.x + rand(-14, 14), -lim, lim), z: THREE.MathUtils.clamp(d.pos.z + rand(-14, 14), -lim, lim) };
          if (d._pather) d._pather.path = null; // fresh target -- reuse the same pather, force an immediate replan
        }
        if (!d._pather) d._pather = pathfinder.createPather(npcDogs.indexOf(d));
        const holdSteer = d._pather.getSteerTarget(d.pos.x, d.pos.z, d.holdTarget.x, d.holdTarget.z, dt);
        moveDog(d, holdSteer.x, holdSteer.z, dt, 2.6);
      }
      if (d.wantFlash > 0) d.wantFlash -= dt;
    }
  }

  // Spawns a frisbee on the ground without luring anyone — used to serve a
  // contest round (game.js immediately throws it via throwFrom). A contest
  // round uses a frisbee, not a ball: tryGrab() only lets the player grab a
  // BALL once it's fully stopped ("ground" state) while an NPC dog's own
  // fetch AI can grab it mid-roll ("ball-roll") — a real fairness gap in a
  // head-to-head race. A frisbee has no rolling phase: it's grabbable
  // in-flight (low mid-air catch) or the instant it lands, which both the
  // player (tryGrab) and an NPC dog (fetch AI) can do symmetrically.
  //
  // isContest tags it exempt from lureFree (see there) — a genuinely
  // separate class of frisbee that bystander dogs never chase — and an
  // optional tint gives it a distinct color from the two ordinary park
  // frisbees.
  function spawnFrisbee(x, z, isContest, tint) {
    const it = spawn("frisbee", x, z, tint);
    if (isContest) it.isContest = true;
    return it;
  }

  // Fully removes an item (mesh + beacon + array entry) and clears any
  // dangling reference to it — a contest frisbee is usually still in
  // someone's mouth (the round's winner) when the next round despawns it,
  // not sitting neutrally on the ground.
  function despawnItem(it) {
    if (!it) return;
    scene.remove(it.mesh);
    if (it.beacon) scene.remove(it.beacon);
    if (carry === it) carry = null;
    for (const d of npcDogs) {
      if (d.holding === it) { d.holding = null; if (d.task === "hold") d.task = null; }
      if (d.fetchItem === it) { d.fetchItem = null; d.task = null; }
    }
    const idx = items.indexOf(it);
    if (idx !== -1) items.splice(idx, 1);
  }

  return {
    update, items, carrying, tryGrab, dropCarry, takeCarry, playerThrow, throwFrom,
    nearestGround, dogHoldingFrisbeeNear, offerBone, offerItem, dogWant, mouth, spawnFrisbee, despawnItem,
  };
}
