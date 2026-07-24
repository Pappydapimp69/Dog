import { createNarrative } from './narrative.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };

const n = createNarrative();

ok(n.count === 22, `expected 22 beats, got ${n.count}`);
ok(n.currentId() === 'cold-open-taillights', `first beat should be cold-open-taillights, got ${n.currentId()}`);
ok(n.index() === 0, 'starts at index 0');

// lookups
ok(!!n.beat('the-locked-door'), 'beat lookup by id');
ok(n.beat('nope') === null, 'unknown beat lookup returns null');
ok(n.actOfBeat('the-under-scent').id === 'act-2', 'the-under-scent is in act-2');

// goTo: unknown id must NOT move the pointer
n.goTo('cold-open-taillights');
const before = n.index();
ok(n.goTo('does-not-exist') === null, 'goTo unknown returns null');
ok(n.index() === before, 'goTo unknown leaves pointer unchanged');

// goTo known
ok(n.goTo('the-locked-door').title === 'The Locked Door', 'goTo returns the beat');
ok(n.currentId() === 'the-locked-door', 'current updated by goTo');

// advance walks story order and stops at the end
n.goTo('cold-open-taillights');
const order = ['cold-open-taillights'];
let b; while ((b = n.advance())) order.push(b.id);
ok(order.length === 22, `advance should visit all 22, visited ${order.length}`);
ok(order[order.length - 1] === 'the-gate-opens', `last beat should be the-gate-opens, got ${order[order.length-1]}`);
ok(n.advance() === null, 'advance past end returns null');
ok(n.isLast(), 'isLast true at end');

// objectives: authored beats have text, cutscene-only beats do not
ok(n.objective('the-locked-door') && /Remember this door/i.test(n.objective('the-locked-door')), 'authored objective present');
ok(n.objective('cold-open-taillights') === null, 'cutscene-only beat has no objective');
ok(n.objective('the-gate-opens') === null, 'unauthored beat objective null');

// cutscene: needed beats return their block; non-cutscene beats return null
ok(n.cutscene('cold-open-taillights') && Array.isArray(n.cutscene('cold-open-taillights').camera), 'cutscene block returned for needed beat');
ok(n.cutscene('the-trail-through-the-rain') === null, 'gameplay beat has no cutscene');
ok(n.cutscene('cinnamon-through-the-bleach').dialogue.length > 0, 'climax cutscene has dialogue');

// save/restore round-trips by beat id
n.goTo('two-at-the-fence');
const snap = n.save();
const m = createNarrative();
ok(m.restore(snap) === true, 'restore accepts a valid snapshot');
ok(m.currentId() === 'two-at-the-fence', 'restore lands on the saved beat');
ok(m.restore({ beat: 'garbage' }) === false, 'restore rejects unknown beat id');

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
