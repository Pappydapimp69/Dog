/* Dog Park 3D — living things: pedestrians, other dogs, and pond ducks.
 *
 * People stroll, other dogs trot around and bark, and ducks paddle on the pond
 * — but get too close and the ducks turn aggressive: they charge across the
 * water, quack furiously, and peck the dog (a shove + a yelp).
 */
import * as THREE from "./vendor/three.module.js";

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

// ---- meshes ---------------------------------------------------------------
function buildPerson() {
  const g = new THREE.Group();
  const skin = pick([0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac]);
  const shirt = new THREE.Color().setHSL(Math.random(), 0.5, 0.5).getHex();
  const pants = new THREE.Color().setHSL(Math.random(), 0.3, 0.3).getHex();
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
  return { group: g, legs };
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
  const isMallard = Math.random() < 0.6;
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
  const WORLD = opts.world;
  const roam = WORLD - 6;
  const getDog = opts.getDog;
  const pushDog = opts.pushDog;
  const pond = opts.pond; // {x, z, r}

  const people = [];
  const dogs = [];
  const ducks = [];

  const newTarget = (near, spread) => new THREE.Vector3(
    THREE.MathUtils.clamp((near ? near.x : 0) + rand(-spread, spread), -roam, roam), 0,
    THREE.MathUtils.clamp((near ? near.z : 0) + rand(-spread, spread), -roam, roam)
  );
  const inPond = (x, z) => Math.hypot(x - pond.x, z - pond.z) < pond.r + 2;

  // People
  for (let i = 0; i < 8; i++) {
    const { group, legs } = buildPerson();
    const pos = newTarget(null, roam);
    group.position.copy(pos); scene.add(group);
    people.push({ group, legs, pos, target: newTarget(pos, 30), speed: rand(1.6, 3.2),
      legPhase: Math.random() * 6, voice: null, chatty: Math.random() < 0.6, talkTimer: rand(4, 16) });
  }

  // Other dogs
  const dogColors = [0x3a3a3a, 0xd9c8a0, 0x6b4a2a, 0xe8e8e8, 0x2a2a2a, 0xc8782f];
  for (let i = 0; i < 4; i++) {
    const { group, legs, tail } = buildNpcDog(pick(dogColors), rand(0.85, 1.2));
    const pos = newTarget(null, roam);
    group.position.copy(pos); scene.add(group);
    dogs.push({ group, legs, tail, pos, target: newTarget(pos, 35), speed: rand(3.5, 6),
      legPhase: Math.random() * 6, voice: null, barkTimer: rand(4, 14) });
  }

  // Ducks on the pond
  for (let i = 0; i < 6; i++) {
    const { group, wings } = buildDuck();
    const a = Math.random() * Math.PI * 2, r = Math.random() * (pond.r - 2);
    const pos = new THREE.Vector3(pond.x + Math.cos(a) * r, 0.28, pond.z + Math.sin(a) * r);
    group.position.copy(pos); scene.add(group);
    ducks.push({ group, wings, pos, heading: Math.random() * 6, state: "calm",
      target: new THREE.Vector3().copy(pos), exit: new THREE.Vector3(), flap: 0, bob: Math.random() * 6,
      voice: null, quackTimer: rand(3, 9), peckCD: 0, guardTimer: 0, awayTimer: 0, startle: 0 });
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
    const a = Math.random() * Math.PI * 2, r = Math.random() * (pond.r - 2);
    return new THREE.Vector3(pond.x + Math.cos(a) * r, 0.28, pond.z + Math.sin(a) * r);
  };

  function triggerFlee() {
    for (const dk of ducks) {
      if (dk.state === "away") continue;
      dk.state = "flee";
      const a = Math.random() * Math.PI * 2;
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
      if (dk.voice && Math.random() < 0.5) dk.voice.quack(false);
    }
    if (scare >= 1) { triggerFlee(); scare = 0; }
  }

  function wander(e, dt, animSpeed) {
    const dx = e.target.x - e.pos.x, dz = e.target.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) {
      do { e.target = newTarget(e.pos, 30); } while (inPond(e.target.x, e.target.z));
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

  function update(dt, time) {
    const dog = getDog();

    for (const p of people) {
      // Stop and turn to face the dog when it's close, so the player can
      // actually walk up and greet instead of chasing a moving target.
      const near = Math.hypot(dog.x - p.pos.x, dog.z - p.pos.z) < 6;
      if (near) {
        p.heading = Math.atan2(dog.x - p.pos.x, dog.z - p.pos.z);
        p.group.position.set(p.pos.x, 0, p.pos.z);
        p.group.rotation.y = p.heading;
        p.legs[0].rotation.x = 0; p.legs[1].rotation.x = 0;
      } else {
        wander(p, dt, p.speed * 2.4);
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

    for (const d of dogs) {
      wander(d, dt, d.speed * 1.6);
      d.tail.rotation.y = Math.sin(time * 8 + d.legPhase) * 0.4;
      d.barkTimer -= dt; // NPC dogs bark via spatial one-shots (audio.barkAt)
      if (d.barkTimer <= 0) {
        if (audio.ready) audio.barkAt(d.pos.x, 0.7, d.pos.z);
        d.barkTimer = rand(5, 15);
      }
    }

    scare = Math.max(0, scare - DUCK.drain * dt);
    for (const dk of ducks) {
      if (!dk.voice && audio.ready) dk.voice = audio.makeDuckVoice();
      if (dk.startle > 0) dk.startle -= dt;
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
          if (dogPond <= DUCK.pursuit) { dk.state = "chase"; break; }
          dk.pos.y = 0.3; dk.guardTimer -= dt;
          dk.quackTimer -= dt; if (dk.quackTimer <= 0) { if (dk.voice) dk.voice.quack(true); dk.quackTimer = rand(0.5, 1.0); }
          if (dk.guardTimer <= 0) { dk.target.copy(pondPoint()); dk.state = "return"; }
          break;
        case "return":
          if (dogPond <= DUCK.pursuit) { dk.state = "chase"; break; }
          stepXZ(dk, dk.target.x, dk.target.z, DUCK.paddle * 1.8, dt);
          dk.pos.y = 0.28 + Math.sin(time * 1.5 + dk.bob) * 0.04;
          if (Math.hypot(dk.pos.x - dk.target.x, dk.pos.z - dk.target.z) < 0.6) dk.state = "calm";
          break;
        default: // calm
          if (dogPond <= DUCK.pursuit) { dk.state = "chase"; break; }
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

  return { update, people, dogs, ducks, playerBarked, get scare() { return scare; }, _flee: triggerFlee };
}
