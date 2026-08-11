/* The free-roam layer's rules — the payout tables, the milestones, and the
 * localness curve the suspicion target reads.
 *
 * These are here rather than in a browser because the arguments this file
 * settles are arithmetic ones: does the tail of the mark counter reward
 * grinding, can a dig table roll off the end, is "local" ever worth more than
 * a collar. Whether any of it is REACHABLE in the running game is a different
 * question and belongs to the harness (tests_harness.mjs) — this session's
 * standing lesson is that those two must not be conflated.
 *
 *   node --test tests_block.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as B from "./block.js";

// ---- the payout tables ----------------------------------------------------

for (const [name, table, fn] of [["dig", B.DIG_TABLE, B.digYield], ["door", B.DOOR_TABLE, B.doorAnswer]]) {
  test(`the ${name} table's weights sum to 1`, () => {
    const sum = table.reduce((a, r) => a + r.w, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
  });

  test(`every ${name} roll in [0,1) lands on a row, and the boundaries don't fall through`, () => {
    // A weighted pick written as a running sum has exactly two ways to be
    // wrong, and both are silent: a roll of 0 taking the wrong row, and a roll
    // just under 1 falling off the end and returning undefined. Walk the cut
    // points rather than sampling randomly, so a re-weighting can't pass here
    // by luck.
    let acc = 0;
    for (const row of table) {
      const lo = acc, hi = acc + row.w;
      assert.equal(fn(lo).kind, row.kind, `roll ${lo} should be ${row.kind}`);
      assert.equal(fn(hi - 1e-9).kind, row.kind, `roll just under ${hi} should still be ${row.kind}`);
      acc = hi;
    }
    assert.ok(fn(0.9999999), "a roll at the very top must still return a row");
    assert.ok(fn(1), "…and so must an out-of-range one, rather than undefined");
    assert.ok(fn(-1), "…in both directions");
  });

  test(`every ${name} outcome has copy`, () => {
    for (const row of table) assert.ok(row.text && row.text.length > 10, `${row.kind} has no line`);
  });
}

test("digging pays out something useful more often than not", () => {
  // The verb has to be worth the walk. If most holes are empty the mounds
  // become scenery you learn to ignore, which is the failure mode the whole
  // free-roam pass exists to fix.
  const good = B.DIG_TABLE.filter((r) => r.kind === "bone" || r.kind === "ball" || r.kind === "food")
    .reduce((a, r) => a + r.w, 0);
  assert.ok(good >= 0.55, `only ${(good * 100).toFixed(0)}% of digs pay`);
});

test("scratching at a door is a real gamble, not a free action", () => {
  const bad = B.DOOR_TABLE.filter((r) => r.kind === "shooed").reduce((a, r) => a + r.w, 0);
  const good = B.DOOR_TABLE.filter((r) => r.kind === "food" || r.kind === "kind").reduce((a, r) => a + r.w, 0);
  assert.ok(bad >= 0.15, "no downside means no decision");
  assert.ok(good > bad, "…but the odds still have to be worth knocking");
});

// ---- marking --------------------------------------------------------------

test("the news pool has no repeats", () => {
  assert.equal(new Set(B.MARK_LINES).size, B.MARK_LINES.length);
});

test("there is more news than there are milestones to chase", () => {
  // The mark verb's reward is the reading, not the counter. If the pool ran
  // dry before the last tier, the back half of the block would be a number
  // going up — exactly the checklist the design note asked me to remove.
  assert.ok(B.MARK_LINES.length > B.MARK_TIERS[B.MARK_TIERS.length - 1].n,
    `${B.MARK_LINES.length} lines for ${B.MARK_TIERS[B.MARK_TIERS.length - 1].n} posts`);
});

test("localness saturates, so the tail isn't worth grinding", () => {
  assert.equal(B.localness(0), 0);
  assert.ok(B.localness(1) > 0, "the first post has to count for something");
  // Half the benefit by the fifth post — the curve is the anti-grind claim,
  // so it gets asserted rather than described in a comment.
  assert.ok(B.localness(5) >= 0.5 * B.localness(B.LOCAL_FULL), "front-loaded");
  assert.equal(B.localness(B.LOCAL_FULL), 1);
  assert.equal(B.localness(9999), 1, "it must never exceed 1 — it scales a suspicion term");
  assert.equal(B.localness(-4), 0, "…or go negative on junk input");
  let prev = -1;
  for (let n = 0; n <= 30; n++) { const v = B.localness(n); assert.ok(v >= prev, "monotone"); prev = v; }
});

test("being a local is worth less than a collar", () => {
  // Level 2 asks for a disguise. If wandering could replace that outright the
  // level would have a second, unsignposted solution — the point is to give
  // free roam a stake in the main pressure, not an exit from it.
  const src = readFileSync(new URL("./game.js", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => /let target = 0\.64/.test(l));
  assert.ok(line, "the suspicion target line moved — re-point this check");
  const collar = +line.match(/player\.collar \* ([\d.]+)/)[1];
  const local = +line.match(/player\._local \* ([\d.]+)/)[1];
  assert.ok(local < collar, `local ${local} vs collar ${collar}`);
  // …and the whole set still can't drive the target negative before clamping
  // is doing the work, which would make the clamp the real rule.
  const subs = [...line.matchAll(/- player\.\w+ \* ([\d.]+)/g)].map((m) => +m[1]);
  assert.ok(subs.reduce((a, b) => a + b, 0) <= 1.2, "every modifier at once should not swamp the base");
});

test("a milestone fires once, on the crossing", () => {
  for (const t of B.MARK_TIERS) {
    assert.equal(B.markTierReached(t.n - 1, t.n)?.ach, t.ach);
    assert.equal(B.markTierReached(t.n, t.n + 1)?.ach ?? null, B.MARK_TIERS.find((x) => x.n === t.n + 1)?.ach ?? null);
  }
  assert.equal(B.markTierReached(0, 0), null);
  assert.equal(B.markTierReached(99, 100), null, "past the last tier it goes quiet");
});

test("shuffled keeps every line exactly once", () => {
  let s = 12345;
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out = B.shuffled(B.MARK_LINES, rng);
  assert.equal(out.length, B.MARK_LINES.length);
  assert.deepEqual([...out].sort(), [...B.MARK_LINES].sort());
});

// ---- reach ----------------------------------------------------------------

test("the city's verbs answer from a body-length away", () => {
  // dog#E93: a 2.4-unit radius on an unlit prop is not findable at night, and
  // that read as the mechanic being broken through two correct fixes. These
  // are things you are meant to bump into.
  for (const [name, r] of [["post", B.REACH_POST], ["dig", B.REACH_DIG], ["door", B.REACH_DOOR]]) {
    assert.ok(r >= 3, `${name} reach is ${r} — under the radius that already failed a playtest twice`);
  }
});

// ---- wiring ---------------------------------------------------------------

test("nothing in the game points at the free-roam layer", () => {
  // The design note was "too much hand holding". The whole claim of this layer
  // is that it is found, not taught — so no objective line, coach hint or
  // level intro is allowed to name any of it. The achievements panel is the
  // one exception, and it is opt-in.
  const src = readFileSync(new URL("./game.js", import.meta.url), "utf8");
  const teachy = src.split("\n").map((l, i) => [l, i + 1]).filter(([l]) =>
    /(objText\.textContent|ui\.coach\.textContent|intro:)/.test(l) && /\b(mark|dig|scratch)\w*\b/i.test(l));
  assert.deepEqual(teachy.map(([, n]) => n), [],
    "an objective or coach line names a free-roam verb — it is supposed to be discovered");
});

test("the trick coach cannot stay up forever", () => {
  const src = readFileSync(new URL("./game.js", import.meta.url), "utf8");
  assert.match(src, /coachBudget > 0/, "the trick hint must be budgeted, not open-ended");
  assert.match(src, /coachBudget -=/, "…and the budget must actually be spent");
  assert.match(src, /coachBudget: Math\.max/, "…and persist, or a reload refills the nag");
});
