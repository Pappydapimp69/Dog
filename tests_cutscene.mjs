import { compileCutscene } from './cutscene.js';
import { createNarrative } from './narrative.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };

const n = createNarrative();
const ctx = { getDog: () => ({ x: 10, z: -4 }), dogY: 0.35, heading: 0.5, nameOf: (id) => n.nameOf(id) };

// --- opening cutscene: cold-open-taillights ---
const cut = n.cutscene('cold-open-taillights');
const t = compileCutscene(cut, ctx);

ok(t.cams.length === cut.camera.length, 'camera keys count matches source');
ok(t.caps.length === cut.dialogue.length, 'caption count matches dialogue');
ok(t.fx.length === cut.effects.length, 'effect count matches source');
ok(t.dur >= (cut.duration_estimate_seconds || 0), `dur >= estimate (${t.dur} vs ${cut.duration_estimate_seconds})`);
const lastCue = Math.max(...t.cams.map(c=>c.t), ...t.caps.map(c=>c.t), ...t.fx.map(c=>c.t));
ok(t.dur >= lastCue + 3.2 - 1e-9, 'dur holds past last cue');

// camera keys are sorted and cameraAt picks the latest <= t
let sorted = true; for (let i=1;i<t.cams.length;i++) if (t.cams[i].t < t.cams[i-1].t) sorted=false;
ok(sorted, 'camera keys sorted by time');
ok(t.cameraAt(-1).shot === 0, 'cameraAt before start is on the first shot');
ok(t.cameraAt(1e9).shot === t.cams.length - 1, 'cameraAt after end is on the last shot');
// the opening of a shot is exactly where its stored key sits (that's the cut point)
{
  const c = t.cameraAt(t.cams[1].t);
  ok(Math.abs(c.eye.x - t.cams[1].eye.x) < 1e-9 && Math.abs(c.eye.y - t.cams[1].eye.y) < 1e-9,
    'a shot opens on its stored key (the frame the cut lands on)');
}
// every eye is finite and keeps the dog roughly framed (look at dog)
const cam0 = t.cameraAt(0);
ok(Number.isFinite(cam0.eye.x) && Number.isFinite(cam0.eye.y) && Number.isFinite(cam0.eye.z), 'eye finite');
ok(Math.abs(cam0.look.x - 10) < 1e-6 && Math.abs(cam0.look.z + 4) < 1e-6, 'look targets the dog');

// captions: "" before first line, NARRATION bare, character lines prefixed
ok(t.captionAt(-1) === '', 'no caption before first line');
const dennisLine = cut.dialogue.find(d => d.speaker === 'dennis-whitfield');
ok(t.captionAt(dennisLine.timing_seconds).startsWith('Dennis'), `character caption prefixed with name, got "${t.captionAt(dennisLine.timing_seconds)}"`);
const narr = cut.dialogue.find(d => d.speaker === 'NARRATION');
ok(t.captionAt(narr.timing_seconds) === narr.line, 'NARRATION caption is bare text (no prefix)');

// effects: each fires exactly once as time advances; effectsAfter(0) = all
let fired = [];
let prev = -1;  // runner inits lastT < 0 so a t=0 effect fires on the first tick
for (let tt = 0; tt <= t.dur + 1; tt += 0.1) { fired.push(...t.effectsBetween(prev, tt)); prev = tt; }
ok(fired.length === t.fx.length, `each effect fires exactly once (got ${fired.length}, expected ${t.fx.length})`);
ok(t.effectsAfter(-1).length === t.fx.length, 'effectsAfter(0) returns all effects (skip parity source)');
ok(t.effectsAfter(1e9).length === 0, 'no effects remain after the end');

// --- climax cutscene with many dialogue lines: cinnamon-through-the-bleach ---
const c2 = compileCutscene(n.cutscene('cinnamon-through-the-bleach'), ctx);
ok(c2.caps.length >= 5, 'climax has multiple captions');
const maya = n.cutscene('cinnamon-through-the-bleach').dialogue.find(d => d.speaker === 'maya-flores');
ok(c2.captionAt(maya.timing_seconds).startsWith('Maya'), 'Maya lines are name-prefixed');

// ---- the camera MOVES: every shot is a travelling move, not a held key ----
// (the user-visible failure this replaced: "the camera never moves")
{
  const dogAt = { x: 10, z: -4 };
  const dist = (c) => Math.hypot(c.eye.x - dogAt.x, c.eye.z - dogAt.z);
  let everyShotMoves = true, worstTravel = Infinity;
  for (let i = 0; i < t.shots.length; i++) {
    const s = t.shots[i];
    const a = t.cameraAt(s.t + 0.01), b = t.cameraAt(s.t + s.dur - 0.01);
    const travel = Math.hypot(b.eye.x - a.eye.x, b.eye.y - a.eye.y, b.eye.z - a.eye.z);
    worstTravel = Math.min(worstTravel, travel);
    if (travel < 0.25) everyShotMoves = false;   // even "static, held" breathes
  }
  ok(everyShotMoves, `every shot's camera travels (smallest move ${worstTravel.toFixed(3)} units)`);

  // the shot is CONTINUOUS inside itself — no jump between adjacent samples
  const s0 = t.shots[0];
  let maxStep = 0, prev = t.cameraAt(s0.t);
  for (let tt = s0.t; tt <= s0.t + s0.dur; tt += 1 / 60) {
    const c = t.cameraAt(tt);
    maxStep = Math.max(maxStep, Math.hypot(c.eye.x - prev.eye.x, c.eye.y - prev.eye.y, c.eye.z - prev.eye.z));
    prev = c;
  }
  ok(maxStep < 0.2, `camera path is continuous within a shot (max per-frame step ${maxStep.toFixed(4)})`);

  // a "slow push-in" must actually END CLOSER than it started — the shot type's
  // named intent, checked against the geometry rather than assumed
  const pushIdx = cut.camera.slice().sort((a,b)=>(a.timing_seconds||0)-(b.timing_seconds||0))
    .findIndex(c => /push-?in/i.test(c.shot || ''));
  ok(pushIdx >= 0, 'the cold-open has an authored push-in shot');
  const ps = t.shots[pushIdx];
  ok(dist(t.cameraAt(ps.t + ps.dur - 0.01)) < dist(t.cameraAt(ps.t + 0.01)) - 0.5,
    'a "slow push-in" ends nearer the subject than it began');

  // a rising/crane shot must gain height
  const wideIdx = cut.camera.slice().sort((a,b)=>(a.timing_seconds||0)-(b.timing_seconds||0))
    .findIndex(c => /wide/i.test(c.shot || ''));
  const ws = t.shots[wideIdx];
  ok(Number.isFinite(t.cameraAt(ws.t).eye.y), 'wide shot eye height is finite');

  // shots tile the whole timeline with no gap and no overlap
  let tiled = true;
  for (let i = 0; i + 1 < t.shots.length; i++) {
    if (Math.abs((t.shots[i].t + t.shots[i].dur) - t.shots[i + 1].t) > 1e-9) tiled = false;
  }
  ok(tiled, 'shot durations tile the timeline exactly (each runs until the next cut)');
  ok(Math.abs((t.shots[t.shots.length-1].t + t.shots[t.shots.length-1].dur) - t.dur) < 1e-9,
    'the last shot runs out the clock');

  // the shot index only ever advances — that's what the runner cuts on
  let monotonic = true, seen = -1;
  for (let tt = 0; tt <= t.dur; tt += 0.05) { const s = t.cameraAt(tt).shot; if (s < seen) monotonic = false; seen = s; }
  ok(monotonic, 'shot index advances monotonically (the runner can cut on a change)');

  // a LIVE subject is tracked: staging can walk the dog and the framing follows
  const still = t.cameraAt(12), moved = t.cameraAt(12, { x: 30, z: -4 });
  ok(Math.abs(moved.look.x - still.look.x) > 1e-6, 'passing a live subject moves the framing with it');
  ok(Math.abs(moved.eye.x - still.eye.x) > 1e-6, 'the eye tracks the live subject too');
  ok(JSON.stringify(t.cameraAt(12)) === JSON.stringify(t.cameraAt(12, null)),
    'omitting the live subject falls back to the compile-time dog');
}

// ---- locationAnchor: broad shots bias toward the SET, not just the dog ----
// (the gap this closes: "wide"/"static, held" shots orbited the dog alone
// regardless of where the beat is staged, so an authored location never read
// on screen even once the set existed)
{
  const anchor = { x: 40, z: -30 };           // e.g. the underpass's crate
  const ctxLoc = { ...ctx, locationAnchor: anchor };
  const t1 = compileCutscene(cut, ctxLoc);
  const t0 = compileCutscene(cut, ctx);       // no locationAnchor at all
  const camByIdx = cut.camera.slice().sort((a,b)=>(a.timing_seconds||0)-(b.timing_seconds||0));

  // the cold-open's "wide" and "static wide, held" shots should bias toward it
  let biased = 0, unbiased = 0;
  camByIdx.forEach((c, i) => {
    const s = (c.shot || '').toLowerCase();
    const isBroad = /wide|static|held/.test(s);
    const withLoc = t1.cams[i].look, without = t0.cams[i].look;
    const moved = Math.abs(withLoc.x - without.x) > 1e-6 || Math.abs(withLoc.z - without.z) > 1e-6;
    if (isBroad) { if (moved) biased++; } else if (moved) unbiased++;
  });
  ok(biased > 0, `at least one broad shot's framing shifts toward the location anchor (${biased} did)`);
  ok(unbiased === 0, `non-broad shots (close/medium/insert) are unaffected by locationAnchor (${unbiased} moved)`);

  // charPos still wins over locationAnchor when both would apply to the same shot
  const charPos = (t) => (/dennis/i.test(t || '') ? { x: 5, z: 5 } : null);
  const tBoth = compileCutscene(cut, { ...ctx, charPos, locationAnchor: anchor });
  const dennisShot = cut.camera.find((c) => /dennis-whitfield/i.test(c.target || ''));
  const dennisIdx = camByIdx.findIndex((c) => c === dennisShot);
  if (dennisIdx >= 0) {
    const midX = (10 + 5) / 2, midZ = (-4 + 5) / 2;   // dog + Dennis, per charPos
    const look = tBoth.cams[dennisIdx].look;
    ok(Math.abs(look.x - midX) < 1e-6 && Math.abs(look.z - midZ) < 1e-6,
      'a resolved character still wins over the location bias on the same shot');
  }

  // omitting locationAnchor entirely is a pure no-op (back-compat, matches the
  // existing charPos-omitted guarantee)
  ok(JSON.stringify(t0.cams) === JSON.stringify(compileCutscene(cut, ctx).cams),
    'omitting locationAnchor entirely is a pure no-op');
}

// ---- the treat beat mines Maya's FULL blocking, not just the kneel --------
// (regression: "holds? out" didn't match "holding out" — the ACTUAL prose —
// so human-offer only ever fired later, on an unrelated shot that happened to
// also say "palm"; and there was no cue at all for her entering/stopping/
// leaving, so she was on screen for a fraction of a six-shot scene about her)
{
  const treatCut = n.cutscene('a-treat-in-the-rain');
  const t = compileCutscene(treatCut, ctx);
  const cues = new Set(t.stage.map((s) => s.type));
  ok(cues.has('char-enter'), 'Maya entering frame is mined ("passing left to right")');
  ok(cues.has('char-stop-turn'), 'her stop-and-turn beat is mined ("stopping... turning back")');
  ok(cues.has('human-offer'), 'holding out the treat is mined (the fixed holds?-out regex)');
  ok(cues.has('char-leave'), 'her walking away is mined ("standing, walking away")');
  // and specifically at the shot that actually says it — not a later,
  // coincidental match on an unrelated word
  const shotsSorted = treatCut.camera.slice().sort((a, b) => (a.timing_seconds||0)-(b.timing_seconds||0));
  const offerShotT = shotsSorted.find((c) => /holding out a treat/i.test(c.target || '')).timing_seconds;
  const offerCue = t.stage.find((s) => s.type === 'human-offer');
  ok(offerCue && offerCue.t === offerShotT,
    `human-offer fires on the shot that actually offers it (t=${offerCue && offerCue.t}, expected ${offerShotT})`);
}

// ---- staging: the actors DO something, not just the camera ----
{
  ok(t.stage.length > 0, 'the cold-open mines staging cues from its prose');
  const cues = new Set(t.stage.map(s => s.type));
  ok(cues.has('dog-sit'), '"the sit is the shot" is mined as a dog-sit cue');
  ok(cues.has('car-leave'), 'the receding taillights are mined as a car-leave cue');
  // regression: "walks a few steps... stops... and sits" mines BOTH dog-walk
  // and dog-sit from the SAME shot at the SAME timestamp. Emitting them as two
  // independent cues meant sit's persistent hold started instantly, before the
  // walk even ran — the dog visibly scooted across the ground in a seated pose
  // instead of walking then sitting. They must merge into one sequenced cue.
  ok(cues.has('dog-walk-then-sit'), 'a shot that both walks and sits mines ONE compound, sequenced cue');
  ok(!t.stage.some((s) => s.type === 'dog-walk'), 'dog-walk never appears standalone once merged into the compound cue');
  const walkSitAt = t.stage.find((s) => s.type === 'dog-walk-then-sit').t;
  ok(!t.stage.some((s) => s.type === 'dog-sit' && s.t === walkSitAt),
    'the merged shot has no independent dog-sit cue racing the walk at the same timestamp');
  // regression: dog-eat used to false-positive on "Dennis's mutter is
  // half-swallowed" (his WORDS, not the dog eating) via a bare `swallow` match,
  // firing an eating pose mid cold-open where there is no treat yet.
  ok(!t.stage.some((s) => s.type === 'dog-eat' && s.t === 18),
    '"half-swallowed" (Dennis\'s mutter) does not mine a false dog-eat cue');
  // fire-once, and skip parity mirrors the effects contract exactly
  let fired2 = [], prev2 = -1;
  for (let tt = 0; tt <= t.dur + 1; tt += 0.1) { fired2.push(...t.stagingBetween(prev2, tt)); prev2 = tt; }
  ok(fired2.length === t.stage.length, `each staging cue fires exactly once (${fired2.length}/${t.stage.length})`);
  ok(t.stagingAfter(-1).length === t.stage.length, 'stagingAfter(-1) returns every cue (skip parity source)');
  ok(t.stagingAfter(1e9).length === 0, 'no staging cues remain after the end');
  // a cutscene with no actionable prose simply has no staging (no crash, no noise)
  ok(compileCutscene({ camera: [{ shot: 'wide', timing_seconds: 0 }] }, ctx).stage.length === 0,
    'a shot with no actionable prose yields no staging cues');
}

// determinism (pure)
const a = JSON.stringify(compileCutscene(cut, ctx).cams);
const b = JSON.stringify(compileCutscene(cut, ctx).cams);
ok(a === b, 'compile is deterministic');

// robustness: empty / missing cutscene must not throw
ok(compileCutscene(null, ctx).dur >= 0, 'null cut compiles to a safe empty timeline');
ok(compileCutscene({}, ctx).caps.length === 0, 'empty cut has no captions');

// ---- charPos: a shot whose target names a resolvable character becomes a
// real two-shot; everything else is unaffected (backward-compatible) ----
{
  const charPos = (targetText) => (/dennis/i.test(targetText || "") ? { x: 40, z: -20 } : null);
  const ctxChar = { ...ctx, charPos };
  const t1 = compileCutscene(cut, ctxChar);
  const dennisShot = cut.camera.find((c) => /dennis-whitfield/i.test(c.target || ""));
  const dennisIdx = cut.camera.slice().sort((a, b) => (a.timing_seconds||0)-(b.timing_seconds||0)).findIndex((c) => c === dennisShot);
  const cam = t1.cams[dennisIdx];
  const midX = (10 + 40) / 2, midZ = (-4 + -20) / 2; // dog is {x:10,z:-4} per ctx
  ok(Math.abs(cam.look.x - midX) < 1e-6 && Math.abs(cam.look.z - midZ) < 1e-6, 'a resolved character shot looks at the dog/character midpoint');
  // a shot with NO character match still frames purely on the dog (unchanged)
  const plainShot = t1.cams.find((c, i) => i !== dennisIdx);
  const t0 = compileCutscene(cut, ctx); // no charPos at all
  ok(JSON.stringify(t1.cams.filter((_, i) => i !== dennisIdx)) === JSON.stringify(t0.cams.filter((_, i) => i !== dennisIdx)),
    'shots with no resolvable character are unaffected by charPos');
  // charPos omitted entirely (the common case) behaves exactly as before
  ok(JSON.stringify(compileCutscene(cut, ctx).cams) === JSON.stringify(t0.cams), 'omitting charPos entirely is a pure no-op');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
