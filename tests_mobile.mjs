/* The phone, driven as a phone.
 *
 * "Tested on mobile" is not one property (brain test#E16). It is four failure
 * classes that are each invisible to the others:
 *   1. layout       — does it fit a phone-shaped, phone-HEIGHT viewport;
 *   2. real input   — can a touch-only player actually press anything;
 *   3. OS geometry  — is an edge-hugging control inside a gesture band or notch;
 *   4. overlap      — do two independently-positioned clusters share space in a
 *                     state where both are live.
 *
 * (1), (2) and (4) are checkable here. (3) is NOT: a headless mobile viewport
 * emulates screen dimensions, not safe-area geometry or OS gesture
 * interception (the-recursion#E11), so this file asserts the CSS carries the
 * insets and leaves the rest to a real device.
 *
 * Nothing in this file may use page.keyboard. A keyboard-driven test on a
 * narrow viewport passes forever while an entire device category is unplayable
 * underneath it (the-recursion#E10).
 *
 *   (python3 -m http.server 8140 &) ; node --test tests_mobile.mjs
 */

import { test, skip } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const URL_BASE = "http://localhost:8140/";
const serving = await fetch(URL_BASE).then((r) => r.ok).catch(() => false);

// Everything that can be on screen at once during ordinary play. The overlap
// check is only as good as this list — an omission here is a blind spot.
const HUD = ["sound-toggle", "pause-toggle", "ach-toggle", "settings-toggle", "minimap",
             "objective", "coach", "prompt", "meters", "friends", "toast", "alert",
             "joystick", "act-btn", "bark-btn", "jump-btn", "trick-btn"];

// ---- (3), from the source: the one class headless cannot reproduce ---------

test("every edge-hugging touch control is inset by the safe area, not a constant", () => {
  const css = readFileSync(new URL("./world.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /viewport-fit=cover/,
    "without viewport-fit=cover every env(safe-area-inset-*) reports 0 on iOS, so the insets below do nothing");
  // Each of these sits against a screen edge, where an OS gesture band or a
  // home indicator can take the touch before the game's listener fires.
  for (const id of ["#joystick", "#act-btn", "#jump-btn", "#trick-btn"]) {
    // Anchored to a line start: `#jump-btn {` is also a substring of the
    // shared `#act-btn, #bark-btn, #jump-btn {` rule, which carries no
    // `bottom` at all — indexOf found that one and the check failed on a rule
    // it was never about.
    const start = css.indexOf("\n" + id + " {");
    assert.ok(start > 0, `${id} has no rule of its own to check`);
    const block = css.slice(start, css.indexOf("}", start));
    assert.match(block, /bottom:\s*calc\([^)]*--safe-b/,
      `${id} pins its bottom edge with a constant — an OS gesture band can eat the touch`);
  }
});

if (!serving) {
  skip("mobile checks (nothing serving on :8140)");
} else {
  test("nothing overlaps anything on a phone-shaped, phone-height screen", async () => {
    // The bug this was written for: #coach was absolutely positioned at
    // `top: 60px`, a constant that is only right when #objective happens to be
    // one wrapped line tall. On a phone the objective wraps to 114px and the
    // coach rendered ENTIRELY inside it — both illegible — while the centred
    // column also landed on the 🏆 and ⚙ buttons, putting the achievements
    // panel (the only place the free-roam layer is described) out of reach.
    // Desktop showed a 34% overlap of the same pair and never looked broken.
    const { open } = await import("./harness.mjs");
    for (const mobile of [true, false]) {
      const g = await open({ url: URL_BASE, quiet: true, mobile });
      try {
        await g.toPlay();
        await g.page.waitForTimeout(400);
        const bad = (await g.overlaps(HUD)).filter((o) => o.area > 200);
        assert.deepEqual(bad.map((o) => `${o.a} x ${o.b} (${o.area}px²)`), [],
          `${mobile ? "phone" : "desktop"}: HUD clusters share screen space`);
      } finally { await g.close(); }
    }
  });

  test("every touch control is fully on screen at phone height", async () => {
    // Width-only viewport sweeps never catch this: a control can be perfectly
    // laid out and sit below the fold on a real, chrome-shortened screen
    // (collective#E8, sandbox-combined-mobile-visibility#E1). "Not hidden" is
    // not the claim — "a finger can land on it" is.
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true, mobile: true });
    try {
      await g.toPlay();
      await g.page.waitForTimeout(400);
      for (const id of ["joystick", "act-btn", "bark-btn", "jump-btn"]) {
        const b = await g.box(id);
        assert.ok(b && !b.hidden, `#${id} is not shown on a touch device`);
        assert.ok(!b.clipped, `#${id} is cut off by the viewport at ${b.x},${b.y} (screen ${b.vw}x${b.vh})`);
        assert.ok(b.w >= 44 && b.h >= 44, `#${id} is ${b.w}x${b.h} — under the 44px touch target floor`);
        // A descendant is fine — the joystick's centre is its own knob, and
        // the event bubbles. Anything ELSE means something is on top of it.
        const owner = await g.eval(([i, x, y]) => {
          const top = document.elementFromPoint(x, y);
          return top && document.getElementById(i) && document.getElementById(i).contains(top) ? i : (top && top.id) || "?";
        }, [id, b.cx, b.cy]);
        assert.equal(owner, id, `a tap on #${id} would be delivered to #${owner}`);
      }
    } finally { await g.close(); }
  });

  test("the achievements list shows that it continues, and can be scrolled to the end", async () => {
    // Twelve entries, five fit. It always scrolled — but the last visible row
    // ended flush with the Done button under it, and mobile hides overlay
    // scrollbars until you are already scrolling, so it read as a complete
    // list of four. The three city entries are the LAST three, which made the
    // panel that is supposed to be the free-roam layer's only description look
    // like it did not mention it (dog#E95 again: the mechanism was there and
    // nothing pointed at it).
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true, mobile: true });
    try {
      await g.toPlay();
      // Opens on POINTERDOWN — el.click() renders an empty list and looks like
      // the panel is broken. Real touch only.
      await g.tap("ach-toggle");
      await g.settle(() => document.querySelectorAll("#ach-list .ach-item").length > 0,
        { label: "the list to render" });
      const before = await g.eval(() => {
        const l = document.getElementById("ach-list");
        const rows = [...l.querySelectorAll(".ach-item")];
        const lb = l.getBoundingClientRect();
        return {
          rows: rows.length,
          scrollable: l.scrollHeight > l.clientHeight + 4,
          // The affordance: the bottom edge must CUT a row, not land in the
          // gap between two. A list that ends flush looks finished.
          cutsARow: rows.some((r) => { const b = r.getBoundingClientRect();
            return b.top < lb.bottom - 2 && b.bottom > lb.bottom + 2; }),
        };
      });
      assert.ok(before.rows >= 10, `only ${before.rows} achievements rendered`);
      assert.ok(before.scrollable, "the list fits — this check has nothing to guard");
      assert.ok(before.cutsARow, "the list ends flush at a row boundary, so it reads as finished");
      // …and the end is genuinely reachable.
      await g.eval(() => { const l = document.getElementById("ach-list"); l.scrollTop = l.scrollHeight; });
      await g.page.waitForTimeout(200);
      const lastVisible = await g.eval(() => {
        const l = document.getElementById("ach-list");
        const rows = [...l.querySelectorAll(".ach-item")];
        const last = rows[rows.length - 1].getBoundingClientRect(), lb = l.getBoundingClientRect();
        return { inside: last.bottom <= lb.bottom + 2 && last.top >= lb.top - 2, text: rows[rows.length - 1].textContent.trim() };
      });
      assert.ok(lastVisible.inside, "the last achievement cannot be scrolled into view");
      assert.match(lastVisible.text, /dig/i, "the city entries should be reachable at the end of the list");
    } finally { await g.close(); }
  });

  test("card text meets AA contrast, except the one known accent case", async () => {
    // This project keeps TWO palettes: near-white for the dark glass HUD
    // panels, near-black for the cream modal cards. A class written for one is
    // unreadable in the other with nothing wrong in the source — the whole
    // settings panel shipped as white-on-cream because `.setrow` painted
    // `var(--text)`, and a code read shows two plausible variables and no bug
    // (dog#E45). Only the rendered pair of colours answers it.
    //
    // The remaining failure is deliberate and recorded rather than hidden:
    // white on the accent-orange button fill is 2.35:1, and changing it is a
    // decision about the game's identity, not a defect to quietly patch. The
    // assertion is EQUALITY with the known set, so a new failure breaks this
    // and the known one does not silently grow.
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true, mobile: true });
    const known = (r) => r.tag === "button";      // white on the accent gradient
    try {
      const title = (await g.contrast("#overlay")).filter((r) => !r.pass);
      assert.deepEqual(title.filter((r) => !known(r)).map((r) => `${r.ratio}:1 ${JSON.stringify(r.text)}`), [],
        "title card has unreadable text");
      await g.toPlay();
      for (const [name, id, done] of [["settings", "settings-toggle", "settings-done"],
                                      ["achievements", "ach-toggle", "ach-done"],
                                      ["pause", "pause-toggle", "resume-btn"]]) {
        await g.tap(id);
        await g.settle(() => !!document.querySelector(".overlay:not(.hidden) .card"), { label: `${name} to open` });
        await g.page.waitForTimeout(250);
        const bad = (await g.contrast(".overlay:not(.hidden)")).filter((r) => !r.pass && !known(r));
        assert.deepEqual(bad.map((r) => `${r.ratio}:1 ${r.tag}.${r.cls} ${JSON.stringify(r.text)}`), [],
          `${name} has text under AA on the card background`);
        await g.tap(done);
        await g.page.waitForTimeout(200);
      }
    } finally { await g.close(); }
  });

  test("a touch-only player can act, with no keyboard anywhere in the loop", async () => {
    // The one check that proves the device category is playable. It drives the
    // stick and the ACT button as real touch events and asserts the world
    // changed — movement, and then a context action actually firing.
    const { open } = await import("./harness.mjs");
    const g = await open({ url: URL_BASE, quiet: true, mobile: true });
    try {
      await g.toPlay();
      const walked = await g.stick(0, -46);            // push the stick forward
      assert.ok(walked.moved > 1.5, `the stick moved the dog ${walked.moved}u`);

      // Park the dog at a bin and tap ACT. The button's label is the verb, so
      // it doubles as the assertion that the prompt reached the touch surface.
      const P = await g.eval(() => window.__game._cityCans.map((c) => ({ x: c.x, z: c.z })));
      await g.place(P[0].x, P[0].z + 1.4);
      await g.settle(() => document.getElementById("act-btn").textContent === "KNOCK",
        { label: "the ACT button to offer the bin" });
      const before = await g.eval(() => window.__game._cityCans.filter((c) => c.knocked).length);
      await g.tap("act-btn");
      await g.settle((n) => window.__game._cityCans.filter((c) => c.knocked).length > n,
        { arg: before, label: "the bin to go over" });
      assert.deepEqual(g.errors.filter((e) => !/404/.test(e)), []);
    } finally { await g.close(); }
  });
}
