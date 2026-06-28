/* Dog Park 3D — roads, a distant city edge, cars, and traffic lights.
 *
 * A square ring road sits just outside the park fence. Cars circulate on it as
 * moving spatial audio sources (engine + a couple with generative radios). At
 * the four corners are traffic lights running a fixed, repeating cycle; cars
 * decelerate to the stop line on red/yellow and accelerate on green, and queue
 * behind one another rather than overlapping.
 */
import * as THREE from "./vendor/three.module.js";

function rand(a, b) { return a + Math.random() * (b - a); }
function mod(x, m) { return ((x % m) + m) % m; }

// ---- traffic-light cycle (deterministic, repeats forever) -----------------
const PH = { gE: 8, yE: 2.5, ar1: 1.5, gN: 8, yN: 2.5, ar2: 1.5 };
const CYCLE = PH.gE + PH.yE + PH.ar1 + PH.gN + PH.yN + PH.ar2; // 24s

// Colours for the two approaches (EW / NS) at a given local time. EW and NS are
// never both green; one intersection therefore never shows the same colour on
// both heads (apart from the brief, realistic all-red).
function colorsAt(localT) {
  let t = mod(localT, CYCLE);
  if (t < PH.gE) return { EW: "green", NS: "red" }; t -= PH.gE;
  if (t < PH.yE) return { EW: "yellow", NS: "red" }; t -= PH.yE;
  if (t < PH.ar1) return { EW: "red", NS: "red" }; t -= PH.ar1;
  if (t < PH.gN) return { EW: "red", NS: "green" }; t -= PH.gN;
  if (t < PH.yN) return { EW: "red", NS: "yellow" };
  return { EW: "red", NS: "red" };
}

// ---- meshes ---------------------------------------------------------------
function buildCar(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.2, metalness: 0.4 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.2), bodyMat);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.0), glassMat);
  cabin.position.set(0, 1.05, -0.2); cabin.castShadow = true; g.add(cabin);

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12), tyreMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * 0.95, 0.34, sz * 1.4); g.add(w);
  }
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe066, emissiveIntensity: 0.8 }));
    hl.position.set(sx * 0.6, 0.55, 2.12); g.add(hl);
    const tl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xcc2222, emissiveIntensity: 0.7 }));
    tl.position.set(sx * 0.6, 0.55, -2.12); g.add(tl);
  }
  return g;
}

function buildSignalHead() {
  const g = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.25, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x111417, roughness: 0.7 }));
  g.add(housing);
  const lamp = (y, col) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.04 }));
    m.position.set(0, y, 0.16); g.add(m); return m;
  };
  return { group: g, red: lamp(0.4, 0xff2a2a), yel: lamp(0, 0xffd23a), grn: lamp(-0.4, 0x33dd44) };
}
function setHead(head, color) {
  head.red.material.emissiveIntensity = color === "red" ? 1.5 : 0.04;
  head.yel.material.emissiveIntensity = color === "yellow" ? 1.5 : 0.04;
  head.grn.material.emissiveIntensity = color === "green" ? 1.5 : 0.04;
}

function buildWorldEdge(scene, R, roadW) {
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x35353c, roughness: 0.95 });
  const span = 2 * R + roadW;
  const strip = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), roadMat);
    m.position.set(x, 0.06, z); m.receiveShadow = true; scene.add(m);
  };
  strip(0, R, span, roadW); strip(0, -R, span, roadW);
  strip(R, 0, roadW, span); strip(-R, 0, roadW, span);

  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8c84a, roughness: 0.7, emissive: 0x3a3200 });
  for (let s = -R + 2; s < R; s += 6) {
    for (const e of [[s, R, true], [s, -R, true], [R, s, false], [-R, s, false]]) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(e[2] ? 2 : 0.25, 0.04, e[2] ? 0.25 : 2), lineMat);
      dash.position.set(e[0], 0.13, e[1]); scene.add(dash);
    }
  }

  const D = R + roadW / 2 + 6;
  for (let i = 0; i < 22; i++) {
    const ang = (i / 22) * Math.PI * 2 + rand(-0.05, 0.05);
    const dist = D + rand(2, 34);
    const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    if (Math.abs(x) < R + 4 && Math.abs(z) < R + 4) continue;
    const h = rand(8, 30), w = rand(7, 14), d = rand(7, 14);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(rand(0.55, 0.66), 0.12, rand(0.32, 0.55)), roughness: 0.9,
    });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; scene.add(b);
  }

  // streetlights at edge midpoints (corners get traffic signals instead)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffdf80, emissiveIntensity: 0.6 });
  const L = R + roadW / 2 + 1.5;
  for (const [x, z] of [[0, L], [0, -L], [L, 0], [-L, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 6, 8), poleMat);
    pole.position.set(x, 3, z); pole.castShadow = true; scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), lampMat);
    lamp.position.set(x, 6.1, z); scene.add(lamp);
  }
}

// Traffic signals at the four corners. Index order matches the loop corners
// reached at arc positions s = 0, 2R, 4R, 6R → TL, TR, BR, BL.
function buildSignals(scene, R) {
  const corners = [[-R, R], [R, R], [R, -R], [-R, -R]];
  const offsets = [0, 6, 12, 18]; // staggered by a quarter cycle
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.8 });
  return corners.map(([cx, cz], i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6, 8), poleMat);
    pole.position.set(cx, 3, cz); pole.castShadow = true; scene.add(pole);
    const inX = -Math.sign(cx) * 1.3, inZ = -Math.sign(cz) * 1.3;
    const facing = Math.atan2(-cx, -cz); // look toward park centre, so visible from inside
    const ew = buildSignalHead(); ew.group.position.set(cx + inX, 5.2, cz); ew.group.rotation.y = facing;
    const ns = buildSignalHead(); ns.group.position.set(cx, 5.2, cz + inZ); ns.group.rotation.y = facing;
    scene.add(ew.group); scene.add(ns.group);
    return { x: cx, z: cz, offset: offsets[i], ew, ns };
  });
}

// ---- loop geometry --------------------------------------------------------
function loopPos(s, R) {
  const side = 2 * R, per = 8 * R;
  s = mod(s, per);
  if (s < side) return { x: -R + s, z: R, ang: Math.PI / 2 };
  if (s < 2 * side) { const u = s - side; return { x: R, z: R - u, ang: Math.PI }; }
  if (s < 3 * side) { const u = s - 2 * side; return { x: R - u, z: -R, ang: -Math.PI / 2 }; }
  const u = s - 3 * side; return { x: -R, z: -R + u, ang: 0 };
}

export function createTraffic(scene, audio, opts) {
  const R = opts.roadHalf || 92;
  const roadW = opts.roadWidth || 9;
  buildWorldEdge(scene, R, roadW);
  const intersections = buildSignals(scene, R);

  const ACCEL = 7, DECEL = 16;
  const STOP_OFF = roadW / 2 + 3, STOPZONE = 24, MINGAP = 8, SAFE = 15;

  const colors = [0xc0392b, 0x2e86de, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x8e44ad, 0xe67e22, 0x16a085];
  const cars = [];
  for (let i = 0; i < 6; i++) {
    const inner = i % 2 === 0;
    const mesh = buildCar(colors[i % colors.length]);
    scene.add(mesh);
    cars.push({
      mesh,
      laneR: inner ? R - 2.2 : R + 2.2,
      dir: inner ? 1 : -1,
      s: Math.random() * 8 * R,
      cruise: rand(12, 20),
      speed: rand(8, 16),
      radio: i < 2,
      voice: null,
    });
  }

  // The signal governing a car: its travel axis (EW/NS), the colour at the
  // corner it is approaching, and the distance to that corner's stop line.
  function governing(car, time) {
    const side = 2 * car.laneR, per = 8 * car.laneR;
    const sN = mod(car.s, per);
    const e = Math.floor(sN / side) % 4;          // 0 top,1 right,2 bottom,3 left
    const axis = e % 2 === 0 ? "EW" : "NS";
    const cornerS = car.dir > 0 ? (e + 1) * side : e * side;
    const idx = Math.round(cornerS / side) % 4;   // → intersection index
    const inter = intersections[idx];
    const color = colorsAt(time + inter.offset)[axis];
    const distAlong = car.dir > 0 ? cornerS - sN : sN - cornerS;
    return { axis, color, distToStop: distAlong - STOP_OFF };
  }

  function gapAhead(car) {
    let best = Infinity;
    const per = 8 * car.laneR;
    for (const o of cars) {
      if (o === car || o.laneR !== car.laneR || o.dir !== car.dir) continue;
      const d = mod((o.s - car.s) * car.dir, per);
      if (d > 0 && d < best) best = d;
    }
    return best;
  }

  function update(dt, time) {
    // advance the signals
    for (const it of intersections) {
      const c = colorsAt(time + it.offset);
      setHead(it.ew, c.EW); setHead(it.ns, c.NS);
    }

    for (const c of cars) {
      if (!c.voice && audio.ready) c.voice = audio.makeCarVoice(c.radio);

      let desired = c.cruise;
      // traffic light
      const sig = governing(c, time);
      const committing = sig.color === "yellow" && sig.distToStop < 3;
      if (sig.color !== "green" && !committing && sig.distToStop > -1 && sig.distToStop < STOPZONE) {
        desired = Math.min(desired, sig.distToStop < 1.5 ? 0 : c.cruise * (sig.distToStop / STOPZONE));
      }
      // car-following
      const gap = gapAhead(c);
      if (gap < SAFE) desired = Math.min(desired, gap < MINGAP ? 0 : c.cruise * ((gap - MINGAP) / (SAFE - MINGAP)));

      // integrate speed
      if (c.speed < desired) c.speed = Math.min(desired, c.speed + ACCEL * dt);
      else c.speed = Math.max(desired, c.speed - DECEL * dt);
      if (c.speed < 0.02) c.speed = 0;
      c.s += c.dir * c.speed * dt;

      const p = loopPos(mod(c.s, 8 * c.laneR), c.laneR);
      c.mesh.position.set(p.x, 0.18, p.z);
      c.mesh.rotation.y = c.dir < 0 ? p.ang + Math.PI : p.ang;
      if (c.voice) { c.voice.setPosition(p.x, 0.6, p.z); c.voice.setDrive(c.speed / c.cruise); }
    }
  }

  return { update, cars, intersections, colorsAt, _CYCLE: CYCLE };
}
