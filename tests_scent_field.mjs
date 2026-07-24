import { ScentField, SCENT } from './scent.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ FAIL:', m); } };
const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// (b) exponential decay: ratio between consecutive ticks == (1-rho), constant.
{
  const f = new ScentField({ tick: 1, floor: 0, rhoExposed: 0.2, rhoRainBonus: 0 });
  f.deposit('x', 0, 0, 0, 0, true);          // exposed => rho 0.2
  const taus = [f.nodes[0].tau];
  for (let i = 0; i < 5; i++) { f.update(1); taus.push(f.nodes[0].tau); }
  let constant = true;
  for (let i = 1; i < taus.length - 1; i++) {
    const r1 = taus[i] / taus[i - 1], r2 = taus[i + 1] / taus[i];
    if (!approx(r1, r2)) constant = false;
  }
  ok(constant, 'decay ratio not constant (not exponential)');
  ok(approx(taus[1] / taus[0], 0.8), `first ratio ${(taus[1]/taus[0]).toFixed(4)} != 0.8 (=1-rho)`);
  console.log(`(b) exponential decay: ratio held at ${(taus[1]/taus[0]).toFixed(4)} = 1-rho ✓`);
}

// (a)+(e) shelter divergence / anchor survival: same age, sheltered outlives exposed.
{
  const f = new ScentField({ tick: 1, floor: 0.15, rhoExposed: 0.16, rhoRainBonus: 0.55,
                             rhoSheltered: 0.03, mergeRadius: 0.1 });
  f.deposit('open', 0, 0, 0.0, 1.0, true);   // exposed + full rain => rho ~0.71
  f.deposit('cover', 5, 0, 1.0, 1.0, true);  // sheltered => rho ~0.03
  let openDied = -1, coverAlive = true;
  for (let t = 1; t <= 20; t++) {
    f.update(1);
    if (openDied < 0 && f.count('open') === 0) openDied = t;
    if (f.count('cover') === 0) coverAlive = false;
  }
  ok(openDied > 0 && openDied <= 5, `exposed node should die fast, died at tick ${openDied}`);
  ok(coverAlive, 'sheltered anchor should survive 20 ticks');
  console.log(`(a/e) exposed died @tick ${openDied}, sheltered still legible @20 ✓`);
}

// (c) reinforcement steady state ~ reinforce/rho for a stationary repeated depositor.
{
  const R = 0.6, rho = 0.2;
  const f = new ScentField({ tick: 1, floor: 0, reinforce: R, rhoExposed: rho,
                             rhoRainBonus: 0, depositTau: R, mergeRadius: 2 });
  f.deposit('s', 0, 0, 0, 0, true);
  for (let t = 0; t < 200; t++) { f.update(1); f.deposit('s', 0, 0, 0, 0, true); }
  const ss = f.nodes[0].tau, predicted = R / rho; // = 3.0
  ok(approx(ss, predicted, 1e-3), `steady state ${ss.toFixed(4)} != predicted ${predicted}`);
  console.log(`(c) reinforce steady state ${ss.toFixed(4)} = reinforce/rho (${predicted}) ✓`);
}

// (f) bearing points toward the strongest nearby node.
{
  const f = new ScentField({ tick: 1, floor: 0 });
  f.deposit('m', 10, 0, 1, 0, true);   // strong-ish east
  f.deposit('m', 0, -8, 1, 0, true);   // north(-z)
  f.nodes.find(n => n.x === 10).tau = 5;   // make the east node clearly strongest
  const b = f.bearing(0, 0, 50, 'm');
  ok(b && approx(b.x, 1, 1e-3) && approx(b.z, 0, 1e-3), `bearing should point +x, got ${b && b.x.toFixed(2)},${b && b.z.toFixed(2)}`);
  console.log(`(f) bearing toward strongest: (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) ✓`);
}

// (g) per-source cap prunes weakest and reports dropped count (never silent).
{
  const f = new ScentField({ tick: 1, floor: 0, maxNodesPerSource: 10, depositStep: 0.01, mergeRadius: 0 });
  for (let i = 0; i < 25; i++) f.deposit('d', i * 3, 0, 0, 0, true);
  ok(f.count('d') === 10, `cap should hold count at 10, got ${f.count('d')}`);
  ok(f.dropped === 15, `should report 15 dropped, got ${f.dropped}`);
  console.log(`(g) cap held at ${f.count('d')}, dropped=${f.dropped} (reported) ✓`);
}

// (d) determinism: identical script => identical serialized field.
{
  const run = () => {
    const f = new ScentField({ tick: 0.25 });
    for (let i = 0; i < 40; i++) { f.deposit('m', i * 0.5, Math.sin(i) * 2, (i % 3) / 3, 0.4, true); f.update(0.1); }
    return JSON.stringify(f.serialize());
  };
  const a = run(), b = run();
  ok(a === b, 'two identical runs diverged (nondeterministic)');
  console.log(`(d) determinism: identical field across runs ✓`);
}

// (h) save/restore round-trips.
{
  const f = new ScentField();
  for (let i = 0; i < 30; i++) { f.deposit('m', i, i % 5, 0.5, 0.2, true); f.update(0.3); }
  const snap = f.serialize();
  const g = new ScentField(); g.restore(snap);
  ok(JSON.stringify(g.serialize()) === JSON.stringify(snap), 'restore did not round-trip');
  console.log(`(h) save/restore round-trips (${f.count()} nodes) ✓`);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
