import { createKeepsake } from './keepsake.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---- stubs: a minimal THREE + a recording scent field ----
function stubThree() {
  const V3 = () => { const o = { x: 0, y: 0, z: 0 }; o.set = (x, y, z) => { o.x = x; o.y = y; o.z = z; return o; }; o.copy = (v) => o.set(v.x, v.y, v.z); return o; };
  const node = () => {
    const o = { visible: true, children: [], position: V3(), rotation: V3() };
    o.add = (c) => { o.children.push(c); return o; };
    o.traverse = (fn) => { fn(o); o.children.forEach(fn); };
    return o;
  };
  const M = { color: 0 };
  return {
    Group: function () { return node(); },
    Mesh: function () { return node(); },
    SphereGeometry: function () { return {}; },
    TorusGeometry: function () { return {}; },
    MeshStandardMaterial: function () { return M; },
  };
}
function stubScent() {
  const emits = [];
  return {
    SCENT: { PARK: 'park', MAYA: 'maya', ERROL: 'errol', DOG: 'dog' },
    emit: (id, x, z, o) => emits.push({ id, x, z, o: o || {} }),
    cleared: [],
    clearSource(id) { this.cleared.push(id); },
    _emits: emits,
  };
}

function harness() {
  const scene = { children: [], add(o) { this.children.push(o); }, remove(o) { this.children = this.children.filter(c => c !== o); } };
  const dog = { x: 0, z: 0, y: 0 };
  let heading = 0;
  const scent = stubScent();
  const k = createKeepsake(scene, { collect: () => {} }, {
    THREE: stubThree(), getDog: () => dog, getHeading: () => heading, getScent: () => scent,
  });
  return { k, scene, dog, setHeading: (h) => { heading = h; }, scent };
}

// ---- lifecycle ----
{
  const { k, scene } = harness();
  ok(!k.has(), 'starts without the ball');
  ok(k.serialize() === null, 'no save state before acquire');
  ok(k.acquire() === true, 'acquire succeeds the first time');
  ok(k.has() && k.isCarried(), 'after acquire: has it, carried in mouth');
  ok(k.acquire() === false, 'acquire is idempotent (no re-pickup)');
  ok(scene.children.length === 1, 'exactly one mesh group added to the scene');
}

// ---- carried ball rides ahead of the dog and moves with it ----
{
  const { k, dog, setHeading } = harness();
  k.acquire();
  setHeading(0); dog.x = 5; dog.z = 5;
  k.update(0.016);
  let p = k.position();
  ok(near(p.x, 5) && p.z > 5, 'carried ball sits ahead of the dog along heading 0 (+z)');
  setHeading(Math.PI / 2); dog.x = 5; dog.z = 5;
  k.update(0.016);
  p = k.position();
  ok(p.x > 5 && near(p.z, 5, 1e-3), 'heading +x moves the muzzle to +x');
  ok(p.y > 0.4, 'carried ball rides at mouth height, not on the ground');
}

// ---- set down / pick up gating by reach ----
{
  const { k, dog } = harness();
  k.acquire();
  dog.x = 10; dog.z = -3;
  ok(k.setDown() === true, 'set down succeeds while carried');
  ok(!k.isCarried(), 'no longer carried after set down');
  const p = k.position();
  ok(near(p.x, 10) && near(p.z, -3), 'ball rests where the dog was standing');
  dog.x = 40; dog.z = 40;
  ok(k.pickUp() === false, 'cannot pick up from far away');
  ok(!k.isCarried(), 'still on the ground after a failed reach');
  dog.x = 10.5; dog.z = -3.5;
  ok(k.pickUp() === true, 'picks up when close enough');
  ok(k.isCarried(), 'carried again');
  ok(k.setDown() && k.setDown() === false, 'cannot set down twice');
}

// ---- scent aura: carried lays a following thread; set-down pools immediately ----
{
  const { k, dog, scent } = harness();
  k.acquire();
  scent._emits.length = 0;
  // ~1.2s carried should trigger ~2 aura steps (AURA_STEP 0.55)
  for (let i = 0; i < 20; i++) k.update(0.06);
  ok(scent._emits.length >= 2, `carried ball deposits aura over time (got ${scent._emits.length})`);
  ok(scent._emits.every(e => e.id === 'park'), 'aura uses the PARK (green) lane');
  ok(scent._emits.every(e => e.o.shelter === 1), 'aura is sheltered so it persists (re-smellable)');
  ok(scent._emits.every(e => e.o.force === true), 'aura deposits are forced so a still ball is still smellable');
  const before = scent._emits.length;
  k.setDown();
  ok(scent._emits.length === before + 1, 'set down deposits one strong pool immediately');
  ok(scent._emits[before].o.force === true, 'the set-down pool is a forced deposit');
}

// ---- rollTo animates to the target then fires the callback once ----
{
  const { k, dog } = harness();
  k.acquire();
  dog.x = 0; dog.z = 0;
  let arrived = 0;
  ok(k.rollTo(3, 0, () => { arrived++; }) === true, 'rollTo starts');
  ok(k.isRolling() && !k.isCarried(), 'rolling, not carried');
  let guard = 0;
  while (k.isRolling() && guard++ < 1000) k.update(0.05);
  ok(arrived === 1, 'onArrive fires exactly once');
  ok(!k.isRolling(), 'no longer rolling after arrival');
  const p = k.position();
  ok(near(p.x, 3, 1e-3) && near(p.z, 0, 1e-3), 'settles at the target');
}

// ---- save / restore round-trip ----
{
  const { k, dog } = harness();
  k.acquire(); dog.x = 7; dog.z = 8; k.setDown();
  const s = k.serialize();
  ok(s && s.has === 1 && s.carried === 0, 'serialize captures set-down state');
  const { k: k2 } = harness();
  k2.restore(s);
  ok(k2.has() && !k2.isCarried(), 'restore rebuilds a set-down ball');
  const p = k2.position();
  ok(near(p.x, 7) && near(p.z, 8), 'restore places it at the saved spot');
  // restoring a carried ball
  const { k: k3, dog: d3 } = harness();
  k3.acquire();
  const s3 = k3.serialize();
  ok(s3.carried === 1, 'carried state serializes');
  const { k: k4 } = harness();
  k4.restore(s3);
  ok(k4.has() && k4.isCarried(), 'restore rebuilds a carried ball');
  // restoring null / empty clears
  k4.restore(null);
  ok(!k4.has(), 'restore(null) clears the ball');
}

// ---- remove clears the source and the flag ----
{
  const { k, scene, scent } = harness();
  k.acquire();
  k.remove();
  ok(!k.has(), 'removed');
  ok(scene.children.length === 0, 'mesh gone from the scene');
  ok(scent.cleared.includes('park'), 'PARK scent source cleared on remove');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
