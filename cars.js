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

// ---- ring-road cross-section ----------------------------------------------
// The road is a two-lane, bidirectional street centred on the loop half-extent
// R. Each direction rides in its own lane, LANE_OFF to either side of R, with a
// double-yellow line between them and white edge (fog) lines outside each lane.
const LANE_OFF = 3.5;   // a lane's centre sits this far off the loop half-extent R
const ROAD_HALF_W = 7;  // half-width of the drivable asphalt (both lanes + a sliver of shoulder)

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

// The drivable ring road: one dark asphalt band, two lanes wide, laid over the
// props.js city-ring band, plus the lane markings that make the two directions
// read as separate lanes. props.js already draws the enclosing skyline and the
// wider asphalt/shoulder band, so we deliberately do NOT add our own building
// ring here any more (it only doubled and z-fought the props buildings). The
// road box sits proud of the props band (top ≈ 0.12 vs the band's 0.02), so it
// also hides the props centre dash and lets these markings be authoritative.
function buildWorldEdge(scene, R, roadW) {
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x33333a, roughness: 0.95 });
  const span = 2 * R + 2 * ROAD_HALF_W;   // over-length so the four strips meet at the corners
  const strip = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), roadMat);
    m.position.set(x, 0.06, z); m.receiveShadow = true; scene.add(m);
  };
  strip(0, R, span, 2 * ROAD_HALF_W); strip(0, -R, span, 2 * ROAD_HALF_W);
  strip(R, 0, 2 * ROAD_HALF_W, span); strip(-R, 0, 2 * ROAD_HALF_W, span);

  // ---- lane markings: continuous lines following the square loop, painted
  // just above the road surface (y ≈ 0.14, under the cars at y ≈ 0.18). Each
  // side of the square is one flat strip; over-length so the corners meet.
  const Y = 0.14;
  function loopLine(rad, mat, lineW) {
    const L = 2 * rad + lineW;
    for (const [x, z, w, d] of [[0, rad, L, lineW], [0, -rad, L, lineW], [rad, 0, lineW, L], [-rad, 0, lineW, L]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, Y, z); scene.add(m);
    }
  }
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xe6c84a });
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xdfe3e6 });
  // double-yellow centre line dividing the two opposing lanes …
  loopLine(R - 0.4, yellowMat, 0.28); loopLine(R + 0.4, yellowMat, 0.28);
  // … and a white fog line on the outside edge of each lane.
  loopLine(R - LANE_OFF - 2.5, whiteMat, 0.22); loopLine(R + LANE_OFF + 2.5, whiteMat, 0.22);

  // streetlights at edge midpoints (corners get traffic signals instead)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffdf80, emissiveIntensity: 0.6 });
  const L = R + ROAD_HALF_W + 1.5;
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
  // Twelve cars, six per lane, so both directions stay populated. Even indices
  // ride the inner lane (dir +1), odd the outer lane (dir -1); the two lanes are
  // 2*LANE_OFF apart so oncoming traffic never shares asphalt. Spread each car
  // evenly round its own lane (with a little jitter) so nothing starts bunched.
  const N = 12;
  for (let i = 0; i < N; i++) {
    const inner = i % 2 === 0;
    const mesh = buildCar(colors[i % colors.length]);
    scene.add(mesh);
    const laneR = inner ? R - LANE_OFF : R + LANE_OFF;
    cars.push({
      mesh,
      laneR,
      dir: inner ? 1 : -1,
      s: (i / N) * 8 * laneR + rand(-6, 6),
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
