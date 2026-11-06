// The story chain (story.js): order, guarded advance, save round-trip, and
// the three small pure rules the late beats run on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STORY, createStory, stillAir, restTarget, surrenderGain, SURRENDER_SECONDS } from "./story.js";
import { NARRATIVE } from "./narrative-data.js";

test("the chain is exactly the authored beats after the under-scent, in order", () => {
  const authored = NARRATIVE.acts.flatMap((a) => a.beats.map((b) => b.id));
  const from = authored.indexOf("making-a-name");
  assert.deepEqual(STORY, authored.slice(from), "the chain must follow narrative-data.js, beat for beat");
});

test("advance only finishes the CURRENT beat", () => {
  const entered = [];
  const s = createStory({ onEnter: (id) => entered.push(id) });
  assert.equal(s.advance("making-a-name"), false, "nothing to advance before start");
  s.start();
  assert.equal(s.advance("the-empty-house"), false, "a stale/out-of-order callback must not skip ahead");
  assert.equal(s.current(), "making-a-name");
  assert.equal(s.advance("making-a-name"), true);
  assert.equal(s.current(), "the-old-scent-runs-deep");
  assert.deepEqual(entered, ["making-a-name", "the-old-scent-runs-deep"]);
});

test("walking the whole chain ends it, and nothing advances past the end", () => {
  const s = createStory();
  s.start();
  for (const id of STORY) assert.equal(s.advance(id), true, `could not finish ${id}`);
  assert.equal(s.done(), true);
  assert.equal(s.current(), null);
  assert.equal(s.advance("the-gate-opens"), false);
});

test("a saved index restores AND re-enters that beat (so its world is rebuilt)", () => {
  const a = createStory(); a.start(); a.advance("making-a-name"); a.advance("the-old-scent-runs-deep");
  const saved = a.serialize();
  const re = [];
  const b = createStory({ onEnter: (id, i, o) => re.push([id, !!(o && o.restored)]) });
  b.restore(saved);
  assert.equal(b.current(), "the-empty-house");
  assert.deepEqual(re, [["the-empty-house", true]]);
  // CONTROL: garbage restores to "not started", never to a beat
  const c = createStory(); c.restore("nope");
  assert.equal(c.started(), false);
});

test("still air brackets dawn and dusk, and resting always lands inside one", () => {
  assert.equal(stillAir(0.0), "dawn");
  assert.equal(stillAir(0.97), "dawn");
  assert.equal(stillAir(0.68), "dusk");
  assert.equal(stillAir(0.3), null, "midday is for the living");
  assert.equal(stillAir(0.85), null, "deep night is for the catcher");
  // Dead air (brain flood#E126: judge by the longest gap): without a rest the
  // worst wait is the late morning; with one, every start lands in a window.
  let worst = 0;
  for (let i = 0; i < 1000; i++) {
    const u = i / 1000;
    const r = restTarget(u);
    assert.ok(stillAir(u + r), `resting from ${u} landed outside a window`);
    worst = Math.max(worst, r);
  }
  assert.ok(worst * 240 > 100 && worst * 240 < 140, `worst unrested wait ${(worst * 240).toFixed(0)}s`);
});

test("the surrender falls from full to nothing over its span, monotonically", () => {
  assert.equal(surrenderGain(0), 1);
  assert.equal(surrenderGain(SURRENDER_SECONDS), 0);
  let prev = 1;
  for (let t = 0; t <= SURRENDER_SECONDS; t += 0.25) { const g = surrenderGain(t); assert.ok(g <= prev + 1e-12); prev = g; }
  assert.ok(surrenderGain(2) > 0.85, "the first seconds must still feel like running");
});
