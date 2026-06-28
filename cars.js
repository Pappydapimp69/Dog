/* Dog Park 3D — roads, a distant city edge, and cars.
 *
 * A square ring road sits just outside the park fence. Cars circulate on it;
 * each is a moving spatial audio source (engine), and a couple are playing a
 * generative car radio. Because the source rides the car, you hear it pass.
 */
import * as THREE from "./vendor/three.module.js";

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rand(a, b) { return a + Math.random() * (b - a); }

// Position + heading on a square loop of half-size R, parametised by arc s.
// Heading is the angle θ where forward = (sinθ, 0, cosθ).
function loopPos(s, R) {
  const side = 2 * R, per = 8 * R;
  s = ((s % per) + per) % per;
  if (s < side) return { x: -R + s, z: R, ang: Math.PI / 2 };          // top, +x
  if (s < 2 * side) { const u = s - side; return { x: R, z: R - u, ang: Math.PI }; } // right, -z
  if (s < 3 * side) { const u = s - 2 * side; return { x: R - u, z: -R, ang: -Math.PI / 2 }; } // bottom, -x
  const u = s - 3 * side; return { x: -R, z: -R + u, ang: 0 };          // left, +z
}

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
  // head/tail lights (front = +z)
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

function buildWorldEdge(scene, R, roadW) {
  // Ring road: four overlapping strips forming a square loop.
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x35353c, roughness: 0.95 });
  const span = 2 * R + roadW;
  const strip = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), roadMat);
    m.position.set(x, 0.06, z); m.receiveShadow = true; scene.add(m);
  };
  strip(0, R, span, roadW); strip(0, -R, span, roadW);
  strip(R, 0, roadW, span); strip(-R, 0, roadW, span);

  // Dashed centre line (small emissive boxes) along each edge.
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8c84a, roughness: 0.7, emissive: 0x3a3200 });
  for (let s = -R + 2; s < R; s += 6) {
    for (const e of [[s, R, true], [s, -R, true], [R, s, false], [-R, s, false]]) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(e[2] ? 2 : 0.25, 0.04, e[2] ? 0.25 : 2), lineMat);
      dash.position.set(e[0], 0.13, e[1]); scene.add(dash);
    }
  }

  // A loose ring of simple buildings beyond the road, for a city silhouette.
  const D = R + roadW / 2 + 6;
  for (let i = 0; i < 22; i++) {
    const ang = (i / 22) * Math.PI * 2 + rand(-0.05, 0.05);
    const dist = D + rand(2, 34);
    const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    if (Math.abs(x) < R + 4 && Math.abs(z) < R + 4) continue;
    const h = rand(8, 30), w = rand(7, 14), d = rand(7, 14);
    const hue = rand(0.55, 0.66);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.12, rand(0.32, 0.55)), roughness: 0.9,
    });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; scene.add(b);
  }

  // Streetlights at the four corners + edge midpoints.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffdf80, emissiveIntensity: 0.6 });
  const L = R + roadW / 2 + 1.5;
  for (const [x, z] of [[L, L], [-L, L], [L, -L], [-L, -L], [0, L], [0, -L], [L, 0], [-L, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 6, 8), poleMat);
    pole.position.set(x, 3, z); pole.castShadow = true; scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), lampMat);
    lamp.position.set(x, 6.1, z); scene.add(lamp);
  }
}

export function createTraffic(scene, audio, opts) {
  const R = opts.roadHalf || 92;
  const roadW = opts.roadWidth || 9;
  buildWorldEdge(scene, R, roadW);

  const colors = [0xc0392b, 0x2e86de, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x8e44ad, 0xe67e22, 0x16a085];
  const cars = [];
  const NUM = 6;
  for (let i = 0; i < NUM; i++) {
    const inner = i % 2 === 0;
    const mesh = buildCar(colors[i % colors.length]);
    scene.add(mesh);
    cars.push({
      mesh,
      laneR: inner ? R - 2.2 : R + 2.2,
      dir: inner ? 1 : -1,
      s: Math.random() * 8 * R,
      speed: rand(13, 22),
      radio: i < 2,           // first two cars are blasting tunes
      voice: null,
    });
  }

  function update(dt) {
    for (const c of cars) {
      if (!c.voice && audio.ready) c.voice = audio.makeCarVoice(c.radio);
      c.s += c.dir * c.speed * dt;
      const p = loopPos(c.s, c.laneR);
      c.mesh.position.set(p.x, 0.18, p.z);
      c.mesh.rotation.y = c.dir < 0 ? p.ang + Math.PI : p.ang;
      if (c.voice) c.voice.setPosition(p.x, 0.6, p.z);
    }
  }

  return { update, cars };
}
