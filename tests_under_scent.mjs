// "The Under-Scent" (Act 2) — the beat's compiled cutscene.
//
// The camera/caption/effect timing lives here rather than in a browser test on
// purpose: headless Chromium advances rAF far slower than wall-clock, so a
// 65-second authored scene needs many real minutes to play through and a
// browser run can only ever sample its first few seconds. The compiled
// timeline is pure data, so assert it directly and leave the browser to prove
// the things only a browser can — that the beat triggers in free play, stages
// its actors, and leaves the world correct on both watch and skip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileCutscene } from "./cutscene.js";
import { createNarrative } from "./narrative.js";
import { NARRATIVE } from "./narrative-data.js";

const narrative = createNarrative(NARRATIVE);
const BEAT = "the-under-scent";

// A stand-in stage: dog at the origin, the bakery off to one side, and a live
// Maya whose position CHANGES between calls — the point of E80 is that the
// resolver is re-invoked, so a test that hands back a constant can't detect a
// cached one.
function ctx(mayaRef) {
  return {
    getDog: () => ({ x: 0, z: 0 }),
    dogY: 0.35,
    heading: 0,
    nameOf: (id) => narrative.nameOf(id),
    locationAnchor: { x: 12, z: -6 },
    charPos: (targetText) => {
      const s = (targetText || "").toLowerCase();
      if (/maya|her |she /.test(s)) return { x: mayaRef.x, z: mayaRef.z };
      return null;
    },
  };
}

test("the beat is authored, needs a cutscene, and is anchored at the bakery", () => {
  const beat = narrative.beat(BEAT);
  assert.ok(beat, "beat exists in narrative-data");
  assert.equal(narrative.locationIdOfBeat(BEAT), "marigold-bakery");
  const cut = narrative.cutscene(BEAT);
  assert.ok(cut, "beat carries a cutscene");
  assert.equal(cut.camera.length, 6, "six authored shots");
});

test("compiles to a timeline that actually runs its full authored length", () => {
  const maya = { x: 12, z: -6 };
  const tl = compileCutscene(narrative.cutscene(BEAT), ctx(maya));
  // The last authored cue is at 60s; the compiler holds past the final cue so
  // the closing line can be read rather than cut on its own timestamp.
  assert.ok(tl.dur >= 63, `timeline runs the authored beat, got ${tl.dur}`);
  assert.equal(tl.cams.length, 6, "one camera per authored shot");
  // Every shot must have a real interval — a zero-length shot is a shot that
  // never plays (dog#E73: a beat needs a start, an end and a duration).
  for (const c of tl.cams) assert.ok(c.dur > 0.1, `shot at ${c.t}s has a real duration`);
});

test("the six shots each get the screen at their authored time", () => {
  const maya = { x: 12, z: -6 };
  const tl = compileCutscene(narrative.cutscene(BEAT), ctx(maya));
  // Sample the middle of each authored shot window and assert the camera has
  // actually cut to that shot — not merely that it moved at some point.
  const starts = narrative.cutscene(BEAT).camera.map((c) => c.timing_seconds);
  starts.forEach((t, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : tl.dur;
    const mid = t + (end - t) / 2;
    assert.equal(tl.cameraAt(mid, { x: 0, z: 0 }).shot, i, `shot ${i} owns t=${mid}s`);
  });
  // and they are all distinct positions, not one framing repeated six times
  const eyes = starts.map((t, i) => {
    const c = tl.cameraAt(t + 0.5, { x: 0, z: 0 });
    return `${c.eye.x.toFixed(1)},${c.eye.z.toFixed(1)}`;
  });
  assert.ok(new Set(eyes).size > 1, "shots frame from more than one place");
});

test("the name reveal and the under-scent land as captions, in that order", () => {
  const maya = { x: 12, z: -6 };
  const tl = compileCutscene(narrative.cutscene(BEAT), ctx(maya));
  const under = tl.captionAt(50);
  const name = tl.captionAt(62);
  assert.match(String(under), /wintergreen|pipe smoke|wool/i, "the discovery is spoken");
  assert.match(String(name), /biscuit/i, "the dog's name is spoken");
});

test("the scent override, the bloom and the comfort restore all fire", () => {
  const maya = { x: 12, z: -6 };
  const tl = compileCutscene(narrative.cutscene(BEAT), ctx(maya));
  const fired = [];
  let prev = -1;
  for (let t = 0; t <= tl.dur; t += 0.25) {
    for (const fx of tl.effectsBetween(prev, t)) fired.push(fx);
    prev = t;
  }
  const joined = fired.join(" ").toLowerCase();
  assert.match(joined, /scent-override/, "Scent View overrides him");
  assert.match(joined, /memory-flash-bloom/, "the memory flash blooms");
  assert.match(joined, /comfort-restore/, "memory refills the meter");
  // and each fires exactly once across a full watch — a re-fired authoritative
  // cue is the cutscene-resume double-dispatch bug (sandbox-cutscene-resume#E1)
  const overrides = fired.filter((f) => /scent-override/.test(f));
  assert.equal(overrides.length, 1, "scent-override dispatches once, not per-frame");
});

test("Maya is resolved live, so a beat that stages her later still frames her", () => {
  // E80: the subject resolver must be re-invoked, never captured at compile
  // time. Move her AFTER compiling and the framing must follow.
  const maya = { x: 12, z: -6 };
  const tl = compileCutscene(narrative.cutscene(BEAT), ctx(maya));
  const before = tl.cameraAt(24, { x: 0, z: 0 });
  maya.x = 90; maya.z = 90;
  const after = tl.cameraAt(24, { x: 0, z: 0 });
  assert.notDeepEqual(
    { x: before.look.x, z: before.look.z },
    { x: after.look.x, z: after.look.z },
    "moving Maya moves the shot that frames her"
  );
});
