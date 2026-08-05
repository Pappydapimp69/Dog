// Milestone-1 gate. A social sim is pure state, so unlike a 3D build (brain
// T11: automated 3D verification tops out at logic, not looks) every claim here
// is provable in a terminal. These are the claims.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Town } from "./sim/town.js";
import { Rng, Streams } from "./sim/rng.js";
import { MemoryStream, PIVOTAL, resetMemoryIds } from "./sim/memory.js";
import { SocialGraph, STICKY } from "./sim/graph.js";
import { makeRumor, retell, resetRumorIds } from "./sim/rumor.js";
import { fingerprint, canonicalJSON } from "./sim/fingerprint.js";

const CAST = JSON.parse(readFileSync(new URL("./town/cast.json", import.meta.url), "utf8"));
const freshTown = (seed = 1234) => {
  resetMemoryIds(); resetRumorIds();
  return new Town(CAST, { seed });
};
const runWeek = (seed = 1234) => {
  const t = freshTown(seed);
  t.plant({ speaker: "you", listener: "pell", about: "greer", valence: -0.7 });
  t.run(7 * 12);
  return t;
};

// ---------------------------------------------------------------- determinism

test("same seed, same script, same fingerprint", () => {
  assert.equal(fingerprint(runWeek(1234).serialize()), fingerprint(runWeek(1234).serialize()));
});

test("a different seed produces a different town", () => {
  assert.notEqual(fingerprint(runWeek(1234).serialize()), fingerprint(runWeek(99).serialize()));
});

test("rng restores from raw state words, not a replay count", () => {
  const a = Rng.forStream(7, "pair:x>y");
  for (let i = 0; i < 50; i++) a.next();
  const b = Rng.restore(a.save());
  assert.deepEqual([a.next(), a.next()], [b.next(), b.next()]);
});

test("streams are independent — adding an agent cannot shift another's rolls", () => {
  // brain the-game-the-answering-deep#E3: one shared stream couples every
  // probabilistic outcome to every other consumer, so an unrelated content
  // change flips tests that had nothing to do with it.
  const s1 = new Streams(1234);
  const before = [s1.roll("pair:a>b"), s1.roll("pair:a>b")];
  const s2 = new Streams(1234);
  s2.roll("pair:z>q"); s2.roll("pair:newcomer>a");   // an unrelated newcomer acts first
  assert.deepEqual([s2.roll("pair:a>b"), s2.roll("pair:a>b")], before);
});

test("canonical serialisation is key-order independent", () => {
  assert.equal(canonicalJSON({ b: 1, a: { d: 2, c: 3 } }), canonicalJSON({ a: { c: 3, d: 2 }, b: 1 }));
});

// -------------------------------------------------------------------- rumours

test("a rumour cannot reach anyone with no path to it", () => {
  // The anti-broadcast rule. An isolated agent who never shares a location
  // hears nothing, however loud the week was.
  const cast = [...CAST, {
    id: "hermit", name: "The hermit", traits: { gossip: 0.9, trust: 0.5, boldness: 0.5 },
    knows: [], schedule: Array(12).fill("wood"),
  }];
  resetMemoryIds(); resetRumorIds();
  const t = new Town(cast, { seed: 1234 });
  t.plant({ speaker: "you", listener: "pell", about: "greer", valence: -0.7 });
  t.run(7 * 12);
  assert.equal(t.agent("hermit").carrying.length, 0, "the hermit never shares a place with anyone");
});

test("retelling degrades fidelity and eventually mutates the claim", () => {
  resetRumorIds();
  let t = makeRumor({ claim: { about: "greer", kind: "witnessed", valence: -0.7 }, origin: "you", at: 0 });
  for (let i = 0; i < 4; i++) t = retell(t, `p${i}`, i, 0.0);   // roll 0 => always mutates once eligible
  assert.ok(t.hops === 4);
  assert.ok(t.mutated, "past the distortion threshold the claim itself changes");
  assert.equal(t.claim.kind, "secondhand", "a witnessing becomes a hearsay");
  assert.ok(t.claim.valence < -0.7, "and it sharpens away from the truth");
});

test("the chain of custody records every carrier, including the first", () => {
  const t = runWeek();
  const carried = [...t.agents.values()].flatMap((a) => a.carrying);
  const first = carried.find((r) => r.hops === 0);
  assert.deepEqual(first.chain, ["you", "pell"], "planting is a hop, not authorship");
});

// -------------------------------------------------------------------- memory

test("recall resets recency, so what gets brought up stays available", () => {
  const m = new MemoryStream();
  const old = m.add({ kind: "heard", subject: "greer", text: "x", importance: 0.3, at: 0 });
  m.add({ kind: "heard", subject: "other", text: "y", importance: 0.3, at: 90 });
  assert.ok(m.recency(old, 100) < 0.7, "untouched, it fades");
  m.retrieve(100, { subject: "greer", k: 1 });
  assert.equal(m.recency(old, 100), 1, "recalled, it is fresh again");
});

test("pivotal events never decay", () => {
  const m = new MemoryStream();
  const grudge = m.add({ kind: "betrayed", subject: "greer", text: "x", importance: 0.5, at: 0 });
  assert.ok(PIVOTAL.has("betrayed"));
  assert.equal(m.recency(grudge, 10000), 1, "a betrayal is exactly as sharp a year later");
});

test("reflection abstracts without deleting", () => {
  const m = new MemoryStream();
  for (let i = 0; i < 20; i++) m.add({ kind: "heard", subject: "greer", text: "x", importance: 0.9, at: i });
  const before = m.entries.length;
  const r = m.reflect(20);
  assert.ok(r, "enough accumulated importance to consolidate");
  assert.equal(r.subject, "greer");
  assert.equal(m.entries.length, before + 1, "the summary is ADDED; nothing is destroyed");
});

// --------------------------------------------------------------------- graph

test("opinion propagates by graph distance, not to the whole town", () => {
  const g = new SocialGraph();
  g.touch("a", "b"); g.touch("b", "c");        // a—b—c, and d is unconnected
  g.shift("a", "target", -0.8);
  assert.ok(g.opinionOf("a", "target") < 0, "the source moves");
  assert.equal(g.opinionOf("d", "target"), 0, "an unconnected stranger hears nothing");
});

test("strong feelings are sticky; mild ones drift back", () => {
  const g = new SocialGraph();
  g.edge("a", "b").opinion = 0.2;
  g.edge("c", "d").opinion = STICKY + 0.1;
  for (let i = 0; i < 5; i++) g.decayDay();
  assert.ok(g.opinionOf("a", "b") < 0.2, "a mild liking fades");
  assert.equal(g.opinionOf("c", "d"), STICKY + 0.1, "a strong one does not");
});

// ------------------------------------------------------------------ the week

test("one true sentence measurably turns the town against its subject", () => {
  const t = runWeek();
  const greer = t.standing().find((s) => s.id === "greer");
  assert.ok(greer.standing < -1, `greer ended at ${greer.standing}, expected clearly negative`);
});

test("who you tell changes what the town believes — the game is in that choice", () => {
  // The claim milestone 1 exists to prove. Before news had a shelf life the
  // rumour saturated the whole town on every seed and from every starting
  // person, so the opening move was decorative. Averaged over seeds, a
  // well-connected gossip must move the town measurably further than a
  // forge-bound loner.
  const avg = (listener) => {
    let reach = 0, standing = 0;
    const seeds = [1234, 7, 99, 4242, 31337, 8, 555, 21, 77, 300];
    for (const seed of seeds) {
      resetMemoryIds(); resetRumorIds();
      const t = new Town(CAST, { seed });
      t.plant({ speaker: "you", listener, about: "greer", valence: -0.7 });
      t.run(7 * 12);
      reach += [...t.agents.values()].filter((a) => a.carrying.length).length;
      standing += t.standing().find((s) => s.id === "greer").standing;
    }
    return { reach: reach / seeds.length, standing: standing / seeds.length };
  };
  const loud = avg("pell");      // the carter: gossip 0.9, on the road all day
  const quiet = avg("tobias");   // the smith: gossip 0.25, at the forge all day
  assert.ok(loud.reach > quiet.reach + 2,
    `carter should reach far more of the town (${loud.reach} vs ${quiet.reach})`);
  assert.ok(loud.standing < quiet.standing - 0.5,
    `and do far more damage (${loud.standing.toFixed(2)} vs ${quiet.standing.toFixed(2)})`);
  assert.ok(quiet.reach < CAST.length,
    "and a badly-chosen confidant must let the story die short of the whole town");
});

test("the sim has no ambient nondeterminism in its authoritative path", async () => {
  // brain: ban ambient Math.random()/Date.now() in the sim — one discipline
  // gives exact save/load, replay and lockstep co-op at once.
  const { readdirSync } = await import("node:fs");
  const dir = new URL("./sim/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/Math\.random|Date\.now|performance\.now/.test(code), `${f} reaches for ambient randomness/time`);
  }
});
