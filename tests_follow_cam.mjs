// Follow-cam: the orbit eases behind the dog after sustained movement.
//
// The engagement itself is a FEEL change and this file does not pretend to
// test it — driving the build to a moving dog headlessly did not work, which
// is brain T11 (automated 3D verification tops out at logic, not looks). What
// IS testable is the arithmetic, and that is where the real bug lives: an
// angle approach that does not take the shortest way round sends the camera a
// full turn the wrong way whenever the heading crosses the ±PI seam, which is
// a spin the player sees and cannot explain.
//
// The functions are re-stated here rather than imported because world.js is a
// browser module that builds a scene on load. A source check at the bottom
// keeps the constants honest against the real file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TAU = Math.PI * 2;
/** Signed shortest angular distance from `from` to `to`, in (-PI, PI]. */
const shortest = (from, to) => ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;

const CAM_FOLLOW_DELAY = 1.0, CAM_FOLLOW_RATE = 1.1, CAM_FOLLOW_EASE = 0.7;

/** One frame of the follow. Mirrors the block in world.js. */
function step(yaw, heading, followT, dt) {
  if (followT <= CAM_FOLLOW_DELAY) return yaw;
  const delta = shortest(yaw, heading + Math.PI);
  const ramp = Math.min(1, (followT - CAM_FOLLOW_DELAY) / CAM_FOLLOW_EASE);
  return yaw + delta * Math.min(1, CAM_FOLLOW_RATE * ramp * dt);
}

/** Run `secs` of movement at 60fps and report the final offset from behind. */
function settle(yaw0, heading, secs) {
  let yaw = yaw0, t = 0;
  const dt = 1 / 60;
  for (let i = 0; i < secs * 60; i++) { t += dt; yaw = step(yaw, heading, t, dt); }
  return Math.abs(shortest(yaw, heading + Math.PI));
}

test("the approach always takes the shortest way round", () => {
  // The seam. Heading just past +PI with the camera just under -PI is a two
  // degree gap that a naive (to - from) reads as nearly a full turn.
  assert.ok(Math.abs(shortest(-3.13, 3.13)) < 0.05, "across the -PI/+PI seam it is a small step");
  assert.ok(shortest(-3.13, 3.13) < 0, "…and it goes the near way, not the long way");
  assert.ok(Math.abs(shortest(0.1, 0.2) - 0.1) < 1e-9);
  for (let a = -Math.PI; a < Math.PI; a += 0.13)
    for (let b = -Math.PI; b < Math.PI; b += 0.17)
      assert.ok(Math.abs(shortest(a, b)) <= Math.PI + 1e-9, `overshoot at ${a},${b}`);
});

test("nothing moves before the delay", () => {
  const yaw = 0.0;
  assert.equal(step(yaw, 2.0, 0.0, 1 / 60), yaw);
  assert.equal(step(yaw, 2.0, CAM_FOLLOW_DELAY, 1 / 60), yaw);
  assert.notEqual(step(yaw, 2.0, CAM_FOLLOW_DELAY + 0.2, 1 / 60), yaw);
});

test("it starts imperceptibly and stays slow", () => {
  // First frame after engaging must be a hair, not a snap — the ease ramp is
  // what stops the camera lurching the instant the timer trips.
  const first = Math.abs(step(0, Math.PI, CAM_FOLLOW_DELAY + 1 / 60, 1 / 60));
  assert.ok(first < 0.002, `first frame moved ${first.toFixed(4)} rad — too abrupt`);
  // A quarter turn should take a beat to close, not a frame.
  assert.ok(settle(0, -Math.PI / 2, 0.35) > 0.9, "still well short a third of a second in");
});

test("it does settle behind the dog, from any starting angle", () => {
  for (let h = -Math.PI; h < Math.PI; h += 0.4) {
    const off = settle(0, h, 6);
    assert.ok(off < 0.06, `heading ${h.toFixed(2)} left ${off.toFixed(3)} rad off behind after 6s`);
  }
});

test("the worst case — a full turnaround — is smooth, not a spin", () => {
  // Camera dead in front of the dog. Every frame must be a small step; a
  // seam bug shows up here as one enormous frame.
  let yaw = 0, t = 0, worst = 0;
  const dt = 1 / 60, heading = 0;         // target is PI away
  for (let i = 0; i < 6 * 60; i++) {
    t += dt;
    const next = step(yaw, heading, t, dt);
    worst = Math.max(worst, Math.abs(shortest(yaw, next)));
    yaw = next;
  }
  assert.ok(worst < 0.05, `largest single frame was ${worst.toFixed(3)} rad`);
  assert.ok(Math.abs(shortest(yaw, heading + Math.PI)) < 0.06, "and it lands behind");
});

test("the constants here match world.js", () => {
  const src = readFileSync(new URL("./world.js", import.meta.url), "utf8");
  for (const [name, want] of [["CAM_FOLLOW_DELAY", CAM_FOLLOW_DELAY],
                              ["CAM_FOLLOW_RATE", CAM_FOLLOW_RATE],
                              ["CAM_FOLLOW_EASE", CAM_FOLLOW_EASE]]) {
    const m = src.match(new RegExp(`const ${name} = ([\\d.]+)`));
    assert.ok(m, `${name} is not a named constant in world.js`);
    assert.equal(Number(m[1]), want, `${name} drifted — this file is now testing a fiction`);
  }
  // Manual look must suspend it on BOTH input surfaces, or the follow drags
  // the player off an angle they deliberately chose. Every site that writes
  // camYaw from player input has to call it — checked per site, not by
  // counting, so adding a third look path fails here instead of passing on
  // a total that happens to still add up.
  const lookSites = src.split("\n")
    .map((l, i) => [l, i])
    .filter(([l]) => /camYaw -=/.test(l))
    .map(([, i]) => src.split("\n").slice(i, i + 6).join("\n"));
  assert.ok(lookSites.length >= 2, "expected a pointer-look and a pad-look site");
  for (const site of lookSites) {
    assert.match(site, /suspendFollowCam\(\)/,
      "a player-driven camYaw write that does not suspend the follow-cam");
  }
  assert.match(src, /reduceMotion.*\n?.*camFollowT|!reduceMotion && dogState\.speed/,
    "reduce-motion must opt out of an unrequested camera rotation");
});

console.log("follow-cam: shortest-arc, delay, ease-in, settling, and constant parity");
