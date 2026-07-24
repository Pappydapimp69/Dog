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
ok(t.cameraAt(-1) === t.cams[0], 'cameraAt before start returns first key');
ok(t.cameraAt(1e9) === t.cams[t.cams.length-1], 'cameraAt after end returns last key');
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

// determinism (pure)
const a = JSON.stringify(compileCutscene(cut, ctx).cams);
const b = JSON.stringify(compileCutscene(cut, ctx).cams);
ok(a === b, 'compile is deterministic');

// robustness: empty / missing cutscene must not throw
ok(compileCutscene(null, ctx).dur >= 0, 'null cut compiles to a safe empty timeline');
ok(compileCutscene({}, ctx).caps.length === 0, 'empty cut has no captions');

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
