import { createMemoryFlashes } from './memory.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };

// A scent stub whose strength we can dial per source.
function stubScent(strength = {}) {
  return {
    SCENT: { ERROL: 'errol', MAYA: 'maya', PARK: 'park', DOG: 'dog' },
    _s: strength,
    strengthOf(id) { return this._s[id] || 0; },
  };
}
// A narrative stub: every beat has a cutscene.
const narrative = { cutscene: (id) => ({ id, needed: true }) };

function harness(over = {}) {
  const played = [];
  let curtain = 0;
  const scent = over.scent || stubScent();
  const rec = {
    played, get curtain() { return curtain; },
    playCutscene(cut, done) { played.push(cut.id); if (over.autoDone !== false) done(); },
  };
  const m = createMemoryFlashes({
    getScent: () => scent,
    narrative,
    playCutscene: (c, d) => rec.playCutscene(c, d),
    grantCurtainCall: () => { curtain++; },
    isBusy: over.isBusy || (() => false),
    ...over.opts,
  });
  return { m, rec, scent, getCurtain: () => curtain };
}

// ---- explicit trigger fires once, plays the beat cutscene ----
{
  const { m, rec } = harness();
  ok(m.count() === 0 && m.total() === 2, 'starts with 0 of 2 seen');
  ok(m.trigger('under-scent') === true, 'trigger fires the flash');
  ok(rec.played.includes('the-under-scent'), 'plays the beat cutscene');
  ok(m.hasSeen('under-scent'), 'marked seen');
  ok(m.trigger('under-scent') === false, 'one-shot: cannot re-fire');
  ok(rec.played.length === 1, 'cutscene played exactly once');
  ok(m.trigger('nope') === false, 'unknown flash id is a safe no-op');
}

// ---- collecting ALL flashes unlocks curtain call exactly once ----
{
  const { m, getCurtain } = harness();
  ok(!m.curtainCallUnlocked() && getCurtain() === 0, 'curtain locked at first');
  m.trigger('under-scent');
  ok(!m.curtainCallUnlocked(), 'still locked after one of two');
  m.trigger('the-chair');
  ok(m.curtainCallUnlocked() && getCurtain() === 1, 'unlocked once all flashes seen');
  ok(m.allSeen(), 'allSeen true');
}

// ---- scent-driven trigger needs to clear the threshold AND the dwell time ----
{
  const scent = stubScent({ errol: 0.4 }); // above the 0.32 under-scent threshold
  const { m, rec } = harness({ scent });
  m.update(0.3);
  ok(rec.played.length === 0, 'no fire before dwell time (0.6s) elapses');
  m.update(0.4); // total 0.7s over threshold
  ok(rec.played.includes('the-under-scent'), 'fires once dwell threshold passed');
}

// ---- leaving the source before dwell completes resets the timer ----
{
  const scent = stubScent({ errol: 0.4 });
  const { m, rec } = harness({ scent });
  m.update(0.4);            // building dwell
  scent._s.errol = 0.1;     // walked out of the hot zone
  m.update(0.4);            // should reset, not fire
  ok(rec.played.length === 0, 'dwell resets when leaving the source');
  scent._s.errol = 0.4;     // back in
  m.update(0.7);
  ok(rec.played.length === 1, 'fires after a fresh full dwell');
}

// ---- weak scent never arms ----
{
  const scent = stubScent({ errol: 0.2 }); // below threshold
  const { m, rec } = harness({ scent });
  for (let i = 0; i < 30; i++) m.update(0.1);
  ok(rec.played.length === 0, 'a sub-threshold source never fires');
}

// ---- a flash does not arm while its own cutscene is still playing ----
{
  const { m, rec } = harness({ autoDone: false, scent: stubScent({ errol: 0.9 }) });
  m.trigger('under-scent');            // starts, done() never called (autoDone false)
  m.update(1.0);                        // the-chair source is hot too, but we're "firing"
  ok(rec.played.length === 1, 'no second flash arms while one is mid-play');
}

// ---- save / restore round-trip, incl. the curtain unlock ----
{
  const { m } = harness();
  m.trigger('under-scent');
  const s = m.serialize();
  ok(s && s.seen.includes('under-scent') && s.curtain === 0, 'serialize captures partial progress');
  const { m: m2, getCurtain } = harness();
  m2.restore(s);
  ok(m2.hasSeen('under-scent') && !m2.curtainCallUnlocked(), 'restore rebuilds partial progress');
  // a save that saw everything restores AND (re)grants the curtain call
  m2.trigger('the-chair');
  const full = m2.serialize();
  ok(full.curtain === 1, 'full progress serializes the curtain unlock');
  const { m: m3, getCurtain: c3 } = harness();
  m3.restore(full);
  ok(m3.curtainCallUnlocked() && c3() === 1, 'restore re-grants curtain call');
  // legacy save: saw all flashes but curtain flag missing -> maybeUnlock grants it
  const { m: m4, getCurtain: c4 } = harness();
  m4.restore({ seen: ['under-scent', 'the-chair'], curtain: 0 });
  ok(m4.curtainCallUnlocked() && c4() === 1, 'legacy all-seen save still unlocks curtain');
  // restore(null) clears
  const { m: m5 } = harness();
  m5.trigger('under-scent'); m5.restore(null);
  ok(m5.count() === 0, 'restore(null) clears progress');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
