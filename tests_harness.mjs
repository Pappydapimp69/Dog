/* The harness's own smoke test, and the HUD-ownership rule it uncovered.
 *
 * Run with a static server on 8140:
 *   (python3 -m http.server 8140 &) ; node --test tests_harness.mjs
 *
 * It is skipped, not failed, when nothing is serving — the point is that a
 * check needing a browser should never be the reason a suite is red on a box
 * that cannot run one, but it must also never quietly pass while doing nothing
 * (brain: a test that no-ops is worse than a missing one, since it reports
 * coverage it does not have).
 */

import { test, skip } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const URL_BASE = "http://localhost:8140/";
const serving = await fetch(URL_BASE).then((r) => r.ok).catch(() => false);

const src = readFileSync(new URL("./game.js", import.meta.url), "utf8");

// ── the rule the harness found ─────────────────────────────────────────────
// C1's first-step line was written from startLevel() and from the general
// update loop, while a THIRD writer inside the level-0 branch rewrote the same
// element every single frame. That one won, so the scaffolding shipped dead —
// visible in the source, invisible to every test, and only caught by driving
// the built game and reading the HUD.

test("Level 1's objective line has exactly one writer", () => {
  const lines = src.split("\n")
    .map((l, i) => [l, i + 1])
    .filter(([l]) => /ui\.objText\.textContent\s*=/.test(l));
  // Writers are legitimate per game phase (prologue beats, level 2, the escape
  // sequence). What must not recur is TWO of them owning level 0 in free play.
  const levelZero = lines.filter(([l]) => /Best friends \(70%\+\)/.test(l));
  assert.equal(levelZero.length, 1,
    `level 0's HUD line is written from ${levelZero.length} places — the per-frame one wins`);
});

test("the first-step line is resolved by the writer that actually wins", () => {
  const branch = src.slice(src.indexOf("if (level === 0) {"), src.indexOf("if (level === 2) {"));
  assert.match(branch, /const step = firstStepText\(\)/,
    "the per-frame level-0 writer must consult firstStepText, or scaffolding is overwritten");
  assert.match(branch, /Best friends \(70%\+\)/, "…and fall back to the real goal once it retires");
});

// ── the harness ────────────────────────────────────────────────────────────

if (!serving) {
  skip("harness smoke test (nothing serving on :8140)");
} else {
  /* These are the claims that shipped this session marked "not verified
   * in-engine". Each was argued from source or from a simulation of the same
   * arithmetic; none had been seen to happen in a running build until the
   * harness existed. */

  test("the follow-cam engages and comes around behind, under real input", async () => {
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    try {
      await g.toPlay();
      const before = await g.eval(() => window.__camFollow());
      await g.page.keyboard.down("KeyW");
      try {
        await g.settle(() => window.__camFollow().t > 1.2, { label: "the follow to engage" });
        await g.settle(() => Math.abs(window.__camFollow().behind) < 0.15,
          { label: "the camera to settle behind" });
      } finally { await g.page.keyboard.up("KeyW"); }
      const after = await g.eval(() => window.__camFollow());
      assert.ok(Math.abs(after.behind) < 0.15,
        `camera ended ${after.behind} off behind (started ${before.behind})`);
    } finally { await g.close(); }
  });

  test("every prologue trail stop has an object to work", async () => {
    // Reported four times as "the trail leads to nothing". Asserted in the
    // running game rather than from the source of buildTrailStops.
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    try {
      await g.toTrail();
      const s = await g.eval(() => window.__game._prologueStops());
      const empty = s.stops.filter((t) => t.kind === "sniff");
      assert.equal(empty.length, 0, `${empty.length} of ${s.stops.length} stops have nothing at the end`);
      // and the first one is actually arrivable at its own coordinates
      await g.place(s.stops[0].x, s.stops[0].z);
      await g.settle(() => window.__game._prologueStops().atStop, { label: "arrival at the first stop" });
    } finally { await g.close(); }
  });

  test("the catcher's chase trigger scales with nightfall, live", async () => {
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    try {
      await g.toPlay();
      const r = await g.eval(() => window.__game._catcherRules());
      if (r.trigger == null) return;                       // catcher idle before level 2
      const expected = 0.5 - 0.22 * r.night;
      assert.ok(Math.abs(r.trigger - expected) < 0.01,
        `trigger ${r.trigger} does not match 0.5 - 0.22*${r.night} = ${expected.toFixed(3)}`);
    } finally { await g.close(); }
  });

  test("how you spend the night changes the morning", async () => {
    // Playtested as "energy refills automatically, there's no motivation to
    // find food, and night ends after a set amount of time so it doesn't
    // matter" — three reasons the beat had no stake. Fed and warm must end the
    // night early and start the day strong; hungry and cold must wait out the
    // clock and pay for it. The prologue stays unloseable either way.
    const { open } = await import("./harness.mjs");
    const run = async (patch) => {
      const g = await open({ url: URL_BASE, quiet: true });
      try {
        await g.toTrail();
        const n = (await g.eval(() => window.__game._prologueStops())).stops.length;
        for (let i = 0; i < n; i++) await g.eval(() => window.__game._prologueAdvanceStop());
        const door = await g.eval(() => window.__game._prologueDoor);
        await g.place(door.x, door.z);
        await g.settle(() => !!window.__game._nightState(), { label: "the night beat", timeout: 45000 });
        await g.eval((p) => window.__game._setNight(p), patch);
        await g.settle(() => !!window.__game._dawnOutcome()?.dawn, { label: "dawn", timeout: 45000 });
        return await g.eval(() => window.__game._dawnOutcome());
      } finally { await g.close(); }
    };
    const kind = await run({ fedOnce: true, comfort: 0.95 });
    // Nudge the clock rather than waiting it out: headless rAF runs well under
    // wall-clock and the ratio is not stable (dog#E2, #E22).
    const harsh = await run({ fedOnce: false, comfort: 0.1, t: 39.2 });
    assert.equal(kind.kind, true, "fed and warm should read as a kind night");
    assert.equal(harsh.kind, false, "hungry and cold should not");
    assert.ok(harsh.stamina < kind.stamina - 0.3,
      `stamina barely differed (${harsh.stamina} vs ${kind.stamina}) — the night has no outcome`);
    assert.ok(harsh.suspicion > kind.suspicion,
      "a hungry stray should start the day looking more like a stray");
  });

  test("the city's free-roam verbs are reachable at every prop they belong to", async () => {
    // Playtested as "explore the city area more and have more objects to
    // interact with unstructured… too much hand holding". Nothing points at
    // these, so "is the prompt there when you walk up" IS the feature — and
    // the first cut got it wrong in a way only driving it could show: the
    // context action was ordered by CATEGORY, so a bin standing 1.9u from a
    // lamp post won on every post that had one near it, and the mark verb was
    // silently unreachable across half the street.
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    try {
      await g.toPlay();
      const P = await g.eval(() => window.__game._blockPositions());
      assert.ok(P.posts.length > 20 && P.digs.length >= 8 && P.doors.length >= 3,
        `too little to find out there: ${P.posts.length} posts, ${P.digs.length} mounds, ${P.doors.length} doors`);
      const promptAt = async (x, z) => {
        await g.place(x, z);
        await g.page.waitForTimeout(110);   // one frame for the context pass
        return g.eval(() => { const e = document.getElementById("prompt");
          return e && !e.classList.contains("hidden") ? e.textContent : ""; });
      };
      // Approached from the side a dog can actually stand on: posts and mounds
      // from just off them, doors from the street.
      const miss = [];
      for (let i = 0; i < P.posts.length; i += 7) {
        const p = P.posts[i];
        if (!/mark/i.test(await promptAt(p.x, p.z + 1.2))) miss.push(`post ${i}`);
      }
      for (const d of P.digs) if (!/dig/i.test(await promptAt(d.x, d.z))) miss.push(`mound ${d.x},${d.z}`);
      for (const o of P.doors) if (!/scratch/i.test(await promptAt(o.x, o.z + 1.6))) miss.push(`door ${o.x}`);
      assert.deepEqual(miss, [], `${miss.length} props offer no verb when you stand at them`);
    } finally { await g.close(); }
  });

  test("signing the block makes you read as a local, live", async () => {
    // The free-roam layer's stake in the game's central pressure. Asserted on
    // the suspicion the catcher's rule actually reads, after letting it ease
    // to its target — not on the localness term in isolation, which could be
    // perfectly correct while nothing multiplied it.
    const { open } = await import("./harness.mjs");
    const settled = async (marks) => {
      const g = await open({ url: URL_BASE, quiet: true });
      try {
        await g.toPlay();
        if (marks) await g.eval((n) => { for (let i = 0; i < n; i++) window.__game._markPost(i); }, marks);
        // The arg goes THROUGH waitForFunction — a Node-side closure variable
        // is simply not in scope in the page, and reads as 0 rather than as an
        // error, so this waited for `12 === 0` until it timed out.
        await g.settle((n) => window.__game._block().marks === n, { arg: marks || 0, label: "the marks to land" });
        await g.page.waitForTimeout(6000);   // suspicion eases at ~0.8/s toward target
        return await g.eval(() => window.__game._block());
      } finally { await g.close(); }
    };
    const stranger = await settled(0);
    const local = await settled(12);
    assert.equal(stranger.local, 0);
    assert.equal(local.local, 1, "twelve posts is a fully-signed block");
    assert.ok(local.suspicion < stranger.suspicion - 0.05,
      `suspicion barely moved (${local.suspicion} vs ${stranger.suspicion}) — the marks buy nothing`);
    // …but not so much that wandering replaces Level 2's disguise.
    assert.ok(local.suspicion > 0.25, `a fully-marked stray at ${local.suspicion} skips the level`);
  });

  test("a signed post stays signed across a save round-trip", async () => {
    // Restoring the COUNT without restoring WHICH posts would leave every one
    // of them markable again — the same lamp banked twice, and a city that
    // forgets its own rings. Round-tripped through the real save code rather
    // than through the internal state it was written from.
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    try {
      await g.toPlay();
      const out = await g.eval(() => {
        for (let i = 0; i < 6; i++) window.__game._markPost(i);
        const code = window.__game.exportSaveCode();
        for (let i = 6; i < 10; i++) window.__game._markPost(i);   // drift past the save
        const drifted = window.__game._block().marks;
        window.__game.importSaveCode(code);
        return { drifted, after: window.__game._block(), marked: window.__game._blockPositions().posts.filter((p) => p.marked).length };
      });
      assert.equal(out.drifted, 10, "the setup should have moved past the saved state");
      assert.equal(out.after.marks, 6, "the restored count is the saved one");
      assert.equal(out.marked, 6, "…and the WORLD agrees — six posts still carry a ring");
    } finally { await g.close(); }
  });

  test("the harness drives a real build from boot to a moving dog", async () => {
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    try {
      assert.equal((await g.state()).phase, "idle", "boots to the title");
      await g.newRun();
      assert.notEqual((await g.state()).phase, "idle", "the wizard is cleared");
      await g.toPlay();
      const s = await g.state();
      assert.equal(s.phase, "play");
      assert.equal(s.frozen, false, "movement must be unfrozen, not merely in phase play");
      // The distinction the harness exists to make: input arriving vs the game
      // legitimately ignoring it. Asserting travel, not elapsed time (dog#E2).
      const w = await g.walk("KeyW", 3);
      assert.ok(w.moved >= 3, `dog travelled ${w.moved}u`);
      assert.deepEqual(g.errors.filter((e) => !/404/.test(e)), [], "no page errors");
    } finally {
      await g.close();
    }
  });
}
