import { renownScore, recognitionVoices, recognitionReady, recognitionState, FRIEND_LINE, ACQUAINTANCE_LINE } from './reputation.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };

const P = (cname, rapport, role = 'parkgoer') => ({ cname, rapport, role });

// ---- renownScore counts friends and warms acquaintances fractionally ----
{
  const people = [P('A', 0.9), P('B', 0.72), P('C', 0.55), P('D', 0.4), P('E', 0.1)];
  const r = renownScore(people);
  ok(r.friends === 2, `two friends over ${FRIEND_LINE} (got ${r.friends})`);
  // C at 0.55 is halfway from 0.4->0.7 => 0.5 warmth-weight * 0.5 = 0.25; D at 0.4 => 0
  ok(Math.abs(r.warmth - (1 + 1 + 0.25 + 0 + 0)) < 1e-6, `warmth aggregates acquaintances (got ${r.warmth})`);
  ok(renownScore([]).friends === 0 && renownScore(null).friends === 0, 'empty/null is safe');
}

// ---- recognitionVoices: strongest first, capped, named only ----
{
  const people = [P('A', 0.9), P('B', 0.5), P('C', 0.75), { rapport: 0.95 }, P('D', 0.2)];
  const v = recognitionVoices(people, 6);
  ok(v.length === 3, `only named acquaintance+ people are voices (got ${v.length})`);
  ok(v[0].name === 'A' && v[1].name === 'C' && v[2].name === 'B', 'sorted by rapport desc');
  ok(!v.some((x) => x.name === 'D'), 'below the acquaintance line is excluded');
  ok(recognitionVoices(people, 2).length === 2, 'cap limits the voice count');
  ok(recognitionVoices(people, 0).length === 0, 'cap 0 yields no voices');
}

// ---- the montage scales with reputation ----
{
  const few = [P('A', 0.8), P('B', 0.75)];
  const many = [P('A', 0.8), P('B', 0.75), P('C', 0.72), P('D', 0.71), P('E', 0.9)];
  ok(recognitionVoices(many).length > recognitionVoices(few).length, 'more friends => more voices');
}

// ---- recognitionReady gate ----
{
  ok(recognitionReady([P('A', 0.9), P('B', 0.72)]) === true, 'two friends => ready');
  ok(recognitionReady([P('A', 0.9), P('B', 0.6)]) === false, 'one friend => not ready');
  ok(recognitionReady([P('A', 0.9), P('B', 0.72), P('C', 0.9)], 3) === true, 'custom threshold met');
  ok(recognitionReady([P('A', 0.9), P('B', 0.72)], 3) === false, 'custom threshold unmet');
}

// ---- READ-ONLY guarantee (brain dog#E50): people are never mutated ----
{
  const people = [P('A', 0.9), P('B', 0.5), P('C', 0.72)];
  const before = people.map((p) => p.rapport);
  renownScore(people); recognitionVoices(people); recognitionReady(people); recognitionState(people);
  ok(people.every((p, i) => p.rapport === before[i]), 'aggregation never writes rapport');
}

// ---- recognitionState snapshot ----
{
  const people = [P('A', 0.9), P('B', 0.72), P('C', 0.5)];
  const s = recognitionState(people);
  ok(s.friends === 2 && s.ready === true, 'snapshot: friends + ready');
  ok(s.voiceCount === 3 && s.voices.length === 3, 'snapshot: voice list included');
  ok(Number.isFinite(s.warmth), 'snapshot: warmth present');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
