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
