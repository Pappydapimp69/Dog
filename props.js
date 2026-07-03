/* Dog Park 3D — static park props: benches, picnic tables, bins, lamps,
 * and flower patches. Purely decorative "stuff all around". */
import * as THREE from "./vendor/three.module.js";

export function buildProps(scene, opts) {
  const WORLD = opts.world;
  const pond = opts.pond;
  const lim = WORLD - 8;
  // seeded layout: draw every placement from the injected stream (see lesson)
  const rnd = opts.rng || Math.random;
  const rand = (a, b) => a + rnd() * (b - a);

  const wood = new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.9 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x6f4a28, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x444a50, roughness: 0.6, metalness: 0.4 });

  // Place helper: random spot inside the park, clear of the centre and the pond.
  function spot() {
    for (let tries = 0; tries < 20; tries++) {
      const x = rand(-lim, lim), z = rand(-lim, lim);
      if (Math.hypot(x, z) < 8) continue;                          // dog spawn
      if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 4) continue; // pond
      return { x, z };
    }
    return { x: rand(-lim, lim), z: rand(-lim, lim) };
  }
  function place(group, { x, z }) {
    group.position.set(x, 0, z);
    group.rotation.y = rand(0, Math.PI * 2);
    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(group);
  }

  function bench() {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), wood); seat.position.y = 0.55; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.1), wood); back.position.set(0, 0.85, -0.25); g.add(back);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.5), woodDark);
      leg.position.set(sx * 0.9, 0.27, 0); g.add(leg);
    }
    return g;
  }

  function table() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 1.0), wood); top.position.y = 0.9; g.add(top);
    for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.4), wood); b.position.set(0, 0.5, sz * 0.8); g.add(b);
      const lg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), woodDark); lg.position.set(0, 0.45, sz * 0.8); g.add(lg);
    }
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), woodDark); c1.position.set(-0.8, 0.45, 0); g.add(c1);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), woodDark); c2.position.set(0.8, 0.45, 0); g.add(c2);
    return g;
  }

  function bin() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.9, 12), metal); body.position.y = 0.45; g.add(body);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0x2c8a4a, roughness: 0.7 }));
    lid.position.y = 0.95; g.add(lid);
    return g;
  }

  function lamp() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.5, 8), metal); pole.position.y = 2.25; g.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffe28a, emissiveIntensity: 0.55 }));
    head.position.y = 4.6; g.add(head);
    return g;
  }

  function flowers() {
    const g = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.CircleGeometry(rand(0.8, 1.4), 14), new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = 0.02; g.add(bed);
    const cols = [0xff5d8f, 0xffd23a, 0xff8a3d, 0xb86bff, 0xffffff];
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.8 }));
      f.position.set(rand(-0.7, 0.7), 0.18, rand(-0.7, 0.7)); g.add(f);
    }
    return g;
  }

  const make = (fn, n) => { for (let i = 0; i < n; i++) place(fn(), spot()); };
  make(bench, 7);
  make(table, 4);
  make(bin, 5);
  make(lamp, 6);
  make(flowers, 12);
}
