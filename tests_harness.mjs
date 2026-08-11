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
