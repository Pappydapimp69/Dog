// Milestone-1 gate. A social sim is pure state, so unlike a 3D build (brain
// T11: automated 3D verification tops out at logic, not looks) every claim here
// is provable in a terminal. These are the claims.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Town } from "./sim/town.js?v=__BUILD__";
import { Rng, Streams } from "./sim/rng.js?v=__BUILD__";
import { MemoryStream, PIVOTAL, resetMemoryIds } from "./sim/memory.js?v=__BUILD__";
import { SocialGraph, STICKY, GOSSIP_BAND } from "./sim/graph.js?v=__BUILD__";
import { makeRumor, retell, resetRumorIds } from "./sim/rumor.js?v=__BUILD__";
import { fingerprint, canonicalJSON } from "./sim/fingerprint.js?v=__BUILD__";

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

test("distortion is a function of WHO tells it and how long they sat on it", () => {
  // Regression on a dead mechanic. Charging distortion per hop alone needed 3
  // hops to reach the 0.5 threshold, but a week's chains top out at 2 — so
  // mutation was unreachable code that the suite happily called covered.
  // brain (dog#E91): a quantity bounded by the structure of the thing cannot be
  // freed by tuning its coefficient. It has to depend on more than hops.
  const base = { claim: { about: "greer", kind: "witnessed", valence: -0.7 }, origin: "you", at: 0 };
  const chatty = { traits: { gossip: 0.9 } }, careful = { traits: { gossip: 0.25 } };

  resetRumorIds();
  const quick = retell(makeRumor({ ...base }), "a", 0, 1);      // told on immediately, careful
  const stale = retell(makeRumor({ ...base }), "a", 10, 1);     // sat on it ten hours
  assert.ok(stale.distortion > quick.distortion, "holding a story degrades it");

  resetRumorIds();
  const loud = retell(makeRumor({ ...base }), "a", 0, 1, chatty);
  const soft = retell(makeRumor({ ...base }), "a", 0, 1, careful);
  assert.ok(loud.distortion > soft.distortion, "a chatty mouth sharpens a story");

  // and the point of all that: two hops is now enough to reach the threshold
  resetRumorIds();
  const twoHops = retell(retell(makeRumor({ ...base }), "a", 3, 1, chatty), "b", 8, 0, chatty);
  assert.ok(twoHops.mutated, "mutation must be reachable within a real week's chain length");
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
  g.setDirect("a", "b", 0.2);
  g.setDirect("c", "d", STICKY + 0.1);
  for (let i = 0; i < 5; i++) g.decayDay();
  assert.ok(g.opinionOf("a", "b") < 0.2, "a mild liking fades");
  assert.equal(g.opinionOf("c", "d"), STICKY + 0.1, "a strong one does not");
});

test("hearsay is banded strictly below the threshold for making a scene", () => {
  // brain (dog#E50): when a diffusion system writes to a score that also GATES
  // behaviour, band its contribution strictly inside the gate. Ambient gossip
  // that could cross the `confront` threshold on its own would mean being told
  // a story about a man is the same as being wronged by him.
  const g = new SocialGraph();
  for (let i = 0; i < 50; i++) g.shift("a", "b", -0.2, 0);           // relentless bad-mouthing
  assert.ok(Math.abs(g.opinionOf("a", "b")) <= GOSSIP_BAND + 1e-9,
    `hearsay reached ${g.opinionOf("a", "b")}, past the ${GOSSIP_BAND} band`);
  assert.ok(GOSSIP_BAND < 0.3, "and the band must sit strictly inside the confront gate");

  g.shift("a", "b", -0.5, 0, "firsthand");                           // something that HAPPENED
  assert.ok(g.opinionOf("a", "b") < -0.3, "firsthand experience is what crosses it");
});

test("a feud burns down instead of locking", () => {
  // brain (dog#E41): a lifecycle needs a decay term, not a balanced one. The
  // first cut of `confront` deepened the very grievance that triggered it, so a
  // pair that shared a room re-enacted the identical scene every hour forever.
  const g = new SocialGraph();
  g.shift("a", "b", -0.5, 0, "firsthand");
  const before = g.opinionOf("a", "b");
  g.discharge("a", "b", 0.3);
  assert.ok(g.opinionOf("a", "b") > before, "having your say spends some of it");
  g.discharge("a", "b", 5);
  assert.equal(g.opinionOf("a", "b"), 0, "and discharge stops at neutral, never overshoots");
});

// ------------------------------------------------------------------ the week

// A single week is one draw from a distribution, so week-level claims are
// averaged over a fixed seed set. Asserting them on seed 1234 alone measures
// that seed, not the design.
const SEEDS = [1234, 7, 99, 4242, 31337, 8, 555, 21, 77, 300, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const overSeeds = (listener) => {
  const runs = SEEDS.map((seed) => {
    resetMemoryIds(); resetRumorIds();
    const t = new Town(CAST, { seed });
    t.plant({ speaker: "you", listener, about: "greer", valence: -0.7 });
    t.run(7 * 12);
    return t;
  });
  const mean = (f) => runs.reduce((s, t) => s + f(t), 0) / runs.length;
  const count = (type) => runs.reduce((s, t) => s + t.log.filter((l) => l.type === type).length, 0);
  return {
    runs,
    reach: mean((t) => [...t.agents.values()].filter((a) => a.carrying.length).length),
    standing: mean((t) => t.standing().find((s) => s.id === "greer").standing),
    mutations: runs.reduce((s, t) => s + t.log.filter((l) => l.mutated).length, 0),
    faces: count("to-their-face"),
    rows: count("confront"),
  };
};

test("one true sentence measurably turns the town against its subject", () => {
  const { standing } = overSeeds("pell");
  assert.ok(standing < -0.15, `greer averaged ${standing.toFixed(3)}, expected clearly negative`);
});

test("who you tell changes what the town believes — the game is in that choice", () => {
  // The claim milestone 1 exists to prove. Before news had a shelf life the
  // rumour saturated the whole town on every seed and from every starting
  // person, so the opening move was decorative.
  const loud = overSeeds("pell");      // the carter: gossip 0.9, on the road all day
  const quiet = overSeeds("tobias");   // the smith: gossip 0.25, at the forge all day
  assert.ok(loud.reach > quiet.reach + 2,
    `carter should reach far more of the town (${loud.reach} vs ${quiet.reach})`);
  assert.ok(loud.standing < quiet.standing - 0.1,
    `and do far more damage (${loud.standing.toFixed(2)} vs ${quiet.standing.toFixed(2)})`);
  assert.ok(quiet.reach < CAST.length,
    "and a badly-chosen confidant must let the story die short of the whole town");
});

test("reach is not the only axis — the recluse is the loudest choice", () => {
  // The result that makes the choice more than a slider. Hollis barely leaves
  // the house, so the story dies with two or three people — but her day
  // intersects the reeve's, so she says it to his face and the week turns into
  // a feud. Lowest spread, most damage. If these ever collapse into one axis,
  // "who do you tell" is just "pick the biggest number" again.
  const wide = overSeeds("pell");
  const close = overSeeds("hollis");
  assert.ok(close.reach < wide.reach - 1, `recluse must spread less (${close.reach} vs ${wide.reach})`);
  assert.ok(close.faces > wide.faces, `but reach the subject more often (${close.faces} vs ${wide.faces})`);
  assert.ok(close.standing <= wide.standing + 0.05,
    `and still do comparable damage (${close.standing.toFixed(2)} vs ${wide.standing.toFixed(2)})`);
});

test("mutation actually happens in a real week", () => {
  // This is the test that was missing when mutation was silently unreachable.
  // The mechanic was implemented, documented, exercised by a unit test with a
  // hand-built 4-hop chain — and never once fired in an actual simulated week.
  const { mutations, runs } = overSeeds("pell");
  assert.ok(mutations > 0, "a story must be able to arrive somewhere false");
  assert.ok(mutations < runs.length * 8, "but not so freely that nothing survives intact");
});

test("the antagonist is made, not assigned", () => {
  // Every public row must be traceable to something firsthand — a story told to
  // someone's face, or an earlier row. Nobody is born the villain, and hearsay
  // alone is never enough to start a scene (that is what GOSSIP_BAND buys).
  for (const t of overSeeds("hollis").runs) {
    const firsthand = new Set();
    for (const l of t.log) {
      if (l.type === "to-their-face" || l.type === "confront") {
        if (l.type === "confront") {
          const grounded = firsthand.has(`${l.from}|${l.to}`) || firsthand.has(`${l.to}|${l.from}`);
          assert.ok(grounded, `row ${l.from}→${l.to} at hour ${l.at} has no firsthand cause`);
        }
        firsthand.add(`${l.to}|${l.from}`);
      }
    }
  }
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
