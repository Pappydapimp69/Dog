/* The story chain, played end to end in the running game: Act 2 "Making a
 * Name" through Act 3 "The Gate Opens", plus the save round-trip and the fence
 * jump Act 3 depends on.
 *
 * Movement between places uses g.place() — headless frame pacing is not wall
 * clock (dog#E2), and the walking itself is covered by the fence-jump test
 * and the reachability test below. Every ACTION goes through the same entry
 * the action key uses (storyAction -> storyInteract), and every transition
 * through story.advance (brain dog#E24: no hand-copied state).
 *
 *   (python3 -m http.server 8140 &) ; node --test tests_story_chain.mjs
 */
import { test, skip } from "node:test";
import assert from "node:assert/strict";

const URL_BASE = "http://localhost:8140/";
const serving = await fetch(URL_BASE).then((r) => r.ok).catch(() => false);

if (!serving) {
  skip("story chain (nothing serving on :8140)");
} else {
  const helpers = (g) => {
    const wait = (ms) => g.page.waitForTimeout(ms);
    return {
      wait,
      st: () => g.eval(() => window.__game._story()),
      P: () => g.eval(() => window.__game._storyPlaces()),
      act: () => g.eval(() => window.__game._storyAct()),
      action: () => g.eval(() => window.__game._storyAction()),
      at: async (p) => { await g.place(p.x, p.z); await wait(450); },
      dayTo: (u) => g.eval((t) => { window.__env.timeOffset += ((t - window.__env.dayPhase + 1) % 1) * 240; }, u),
      skip: async () => {
        for (let i = 0; i < 60; i++) {
          if (!(await g.eval(() => !!window.__game._movementFrozen))) return;
          await g.page.keyboard.press("e"); await wait(140);
        }
      },
      until: (fn, label, timeout = 40000) => g.settle(fn, { label, timeout }),
    };
  };

  test("the whole story plays from Making a Name to The Gate Opens", async () => {
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    const errs = [];
    g.page.on("pageerror", (e) => errs.push(String(e.message || e)));
    const h = helpers(g);
    try {
      await g.toPlay();
      await g.eval(() => window.__game._storyStart());
      assert.equal((await h.st()).id, "making-a-name");

      // making-a-name: three audiences are not a name; four are.
      for (let i = 0; i < 3; i++) await g.eval((k) => window.__game._storyTrickFor(k), i);
      await h.wait(400);
      assert.equal((await h.st()).id, "making-a-name", "three regulars must not finish the beat");
      await g.eval(() => window.__game._storyTrickFor(3));
      await h.until(() => window.__game._story().id === "the-old-scent-runs-deep", "the old scent");
      assert.ok((await h.st()).wom > 0.9, "word of mouth should be full after making a name");

      // old scent: in full daylight the thread does not hold, even at the house
      let P = await h.P();
      await h.dayTo(0.35); await h.wait(500);
      await h.at(P.corner); await h.at(P.stoop); await h.wait(800);
      assert.equal((await h.st()).id, "the-old-scent-runs-deep", "the under-scent must be unreadable at midday");
      assert.equal((await h.action()).verb, "Rest", "midday must offer a rest until the air goes still");
      await h.act(); await h.wait(500);
      await h.at(P.corner); await h.wait(700); await h.at(P.stoop); await h.wait(900);
      await h.until(() => window.__game._story().id === "the-empty-house", "the empty house");

      // empty house: never at night; by day Dennis bolts you and the van comes
      await h.dayTo(0.3); await h.wait(500); await h.wait(500);
      assert.equal((await h.st()).beat.stage, "approach", "the house beat must not fire the moment the reveal ends");
      await h.at(P.bakery); await h.wait(600);                 // leave…
      await h.dayTo(0.85); await h.wait(500); await h.at(P.stoop); await h.wait(800);
      assert.equal((await h.st()).beat.stage, "approach", "…and it must wait for daylight");
      await h.dayTo(0.3); await h.wait(500); await h.at(P.stoop); await h.wait(900);
      assert.equal((await h.st()).beat.stage, "bolted");
      for (let i = 0; i < 20 && (await h.st()).id === "the-empty-house"; i++) {
        const d = await g.eval(() => ({ x: window.__dog.pos.x, z: window.__dog.pos.z }));
        await g.place(d.x + 40, d.z); await h.wait(900);
      }
      const after = await h.st();
      assert.equal(after.id, "the-chair-on-the-curb");
      assert.equal(after.openCase, true, "losing the van opens Vega's case on him");

      // chair: after dark, climb in -> the memory flash, the ball, the bow
      await h.act(); await h.wait(700);                       // rest until dark
      P = await h.P();
      await h.at(P.curb); await h.wait(700);
      assert.equal((await h.action()).verb, "Climb");
      await h.act(); await h.wait(500); await h.skip(); await h.wait(700);
      await h.until(() => window.__game._story().id === "the-washing-rain", "the washing rain");
      assert.equal(await g.eval(() => window.__keepsake.has()), true, "the chair gives him Errol's ball");

      await h.at(P.fenceOut); await h.wait(900);
      await h.until(() => window.__game._story().id === "two-at-the-fence", "two at the fence");
      await h.at(P.fenceOut); await h.wait(1200); await h.skip(); await h.wait(500);
      P = await h.P();
      await h.at(P.post); await h.act();
      await h.until(() => window.__game._story().id === "the-storm", "the storm");

      // storm: every shelter refuses, and only then does the wind turn him to the run
      P = await h.P();
      for (const s of P.shelters.slice(0, 3)) { await h.at(s); await h.act(); }
      assert.equal((await h.st()).beat.wind, false, "the run must not call until every door is shut");
      await h.at(P.shelters[3]); await h.act(); await h.wait(500);
      assert.equal((await h.st()).beat.wind, true);
      await h.at(P.fenceOut); await h.wait(800);
      await h.until(() => window.__game._story().id === "over-the-fence", "over the fence");
      await h.at(P.bench); await h.wait(1200); await h.skip();
      await h.until(() => window.__game._story().id === "caught", "caught");

      // caught: the designed surrender takes his legs away
      await h.wait(4000);
      const sm = await g.eval(() => window.__game.player.speedMul);
      assert.ok(sm < 0.95, `the surrender should already be draining speed (speedMul ${sm})`);
      await h.until(() => window.__game._story().id !== "caught" || !!window.__game._movementFrozen, "the capture", 60000);
      await h.skip();
      await h.until(() => window.__game._story().id === "the-gray-kennel", "the kennel");
      assert.equal(await g.eval(() => document.body.classList.contains("scent-silence")), true, "the kennel is scent-silent");

      for (let i = 0; i < 12 && (await h.st()).id === "the-gray-kennel"; i++) { await h.act(); await h.wait(1600); }
      assert.equal((await h.st()).id, "word-travels");
      for (let i = 0; i < 14 && (await h.st()).id === "word-travels"; i++) { await g.page.keyboard.press("e"); await h.wait(250); }

      // cinnamon: the recognition is NOT the ending any more
      await h.until(() => window.__game._story().id === "cinnamon-through-the-bleach", "cinnamon");
      for (let i = 0; i < 80 && (await h.st()).id === "cinnamon-through-the-bleach"; i++) {
        const cap = await g.eval(() => document.getElementById("cinema-cap")?.textContent || "");
        assert.doesNotMatch(cap, /DOG PARK 3D/, "the title card belongs to The Gate Opens, not the kennel");
        await g.eval((k) => window.__game.trickInput(k), /Sit\?/.test(cap) ? "sit" : "spin");
        await g.page.keyboard.press("e"); await h.wait(350);
      }
      let s = await h.st();
      assert.equal(s.id, "papers-and-a-leash");
      assert.equal(s.phase, "play", "the game must not be won in the kennel");
      for (let i = 0; i < 14 && (await h.st()).id === "papers-and-a-leash"; i++) { await g.page.keyboard.press("e"); await h.wait(250); }
      s = await h.st();
      assert.equal(s.id, "the-gate-opens");
      assert.equal(s.adopted, true, "the papers retire the suspicion system");

      // the gate: ball under his name, then — on his own — to her feet
      await h.wait(800); await h.skip(); await h.wait(600);
      P = await h.P();
      await h.at(P.bench); assert.equal((await h.action()).verb, "Set down"); await h.act(); await h.wait(300);
      assert.equal((await h.action()).verb, "Pick up"); await h.act(); await h.wait(300);
      await h.at({ x: P.gate.x + 1.5, z: P.gate.z + 2.5 });
      assert.equal((await h.action()).verb, "Drop"); await h.act();
      await h.until(() => window.__game._story().done, "the end", 15000);
      s = await h.st();
      assert.equal(s.phase, "won");
      assert.deepEqual(errs, [], "no page errors across the whole story");
    } finally { await g.close(); }
  });

  test("a save code taken mid-story brings the story back to the same beat", async () => {
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    try {
      await g.toPlay();
      await g.eval(() => window.__game._storyStart());
      await g.eval(() => window.__game._storyJump(6));            // the storm
      const code = await g.eval(() => window.__game.exportSaveCode());
      await g.eval(() => window.__game._storyJump(1));
      assert.equal((await g.eval(() => window.__game._story())).id, "the-old-scent-runs-deep");
      const r = await g.eval((c) => window.__game.importSaveCode(c), code);
      assert.equal(r.ok, true);
      const s = await g.eval(() => window.__game._story());
      assert.equal(s.id, "the-storm", "importing must restore the saved beat");
      assert.ok(s.beat && s.beat.comfort === 1, "…and rebuild it (its own state, not a bare index)");
    } finally { await g.close(); }
  });

  test("every place a beat sends you to is on open ground", async () => {
    // Measured before this test existed: Errol's stoop sat 4.4u inside his
    // house's collision (the beat's 4u trigger could never fire on foot), and
    // Maya's door, the Peralta corner and the pound were inside geometry too.
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    try {
      await g.toPlay();
      await g.eval(() => window.__game._storyStart());
      await g.eval(() => window.__game._storyJump(6));
      const P = await g.eval(() => window.__game._storyPlaces());
      const pts = { stoop: P.stoop, curb: P.curb, corner: P.corner, bakery: P.bakery, bench: P.bench,
        fenceOut: P.fenceOut, pound: P.pound, ...Object.fromEntries(P.shelters.map((s, i) => ["shelter" + i, s])) };
      const bad = await g.eval((pts) => Object.entries(pts).filter(([, p]) => {
        let c = Infinity;
        for (const o of window.__obstacles) c = Math.min(c, Math.hypot(p.x - o.x, p.z - o.z) - (o.r + 0.6));
        return c < 0;
      }).map(([k]) => k), pts);
      assert.deepEqual(bad, [], `places inside collision: ${bad.join(", ")}`);
    } finally { await g.close(); }
  });

  test("a running jump clears the park fence; a standing one does not", async () => {
    // Act 3's "over the fence" — and the game's established illegal act — was
    // impossible: blocked() ignored height. Driven with a HELD jump key (an
    // instant press can land between frames — brain test#E24).
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true });
    const z = () => g.eval(() => window.__dog.pos.z);
    try {
      await g.toPlay();
      const F = await g.eval(() => window.__obstacles.filter((o) => o.fence).reduce((m, o) => Math.max(m, Math.abs(o.z)), 0));
      await g.place(20, F + 8); await g.page.waitForTimeout(500);
      await g.page.keyboard.down("Shift"); await g.page.keyboard.down("s");
      for (let i = 0; i < 200 && (await z()) > F + 3; i++) await g.page.waitForTimeout(16);
      await g.page.keyboard.down("Space"); await g.page.waitForTimeout(80); await g.page.keyboard.up("Space");
      await g.page.waitForTimeout(900);
      await g.page.keyboard.up("s"); await g.page.keyboard.up("Shift");
      assert.ok((await z()) < F - 1.5, `a sprint jump should land inside (z ${(await z()).toFixed(2)}, fence ${F})`);
      await g.place(20, F + 1.6); await g.page.waitForTimeout(500);
      await g.page.keyboard.down("Space"); await g.page.waitForTimeout(80); await g.page.keyboard.up("Space");
      await g.page.waitForTimeout(900);
      assert.ok((await z()) > F, "a standing jump must not carry him over");
    } finally { await g.close(); }
  });
}
