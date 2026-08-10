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

// ── the movement basis ─────────────────────────────────────────────────────
// The follow-cam must never steer the dog. Building "forward" from the live
// camera yaw means the player holds forward, the camera eases round, forward
// rotates with it, the dog curves, and that rotates the camera further — a
// spiral the player feels as the camera fighting them. So the basis is its own
// yaw: frozen while movement is held, re-synced on release, and turned by
// player look only.

/** Mirrors world.js: auto rotation moves the view alone. */
const autoTurn = (s, dYaw) => ({ ...s, camYaw: s.camYaw + dYaw });
/** Mirrors lookBy: player look turns both by the same amount. */
const playerLook = (s, dYaw) => (dYaw ? { ...s, camYaw: s.camYaw + dYaw, moveYaw: s.moveYaw + dYaw } : s);
/** Mirrors the per-frame recentre: idle re-syncs the basis to the view. */
const frame = (s, moving) => (moving ? s : { ...s, moveYaw: s.camYaw });

test("automatic rotation does not change what the stick means", () => {
  let s = { camYaw: 0, moveYaw: 0 };
  for (let i = 0; i < 120; i++) { s = frame(s, true); s = autoTurn(s, 0.01); }
  assert.ok(Math.abs(s.camYaw - 1.2) < 1e-9, "the view did come around");
  assert.equal(s.moveYaw, 0, "…and the movement basis did not move with it");
});

test("player look does change what the stick means", () => {
  let s = { camYaw: 0, moveYaw: 0 };
  s = frame(s, true);
  s = playerLook(s, 0.8);
  assert.equal(s.moveYaw, 0.8, "a camera the player aimed should steer");
  assert.equal(s.camYaw, 0.8);
});

test("the basis recentres when the controls are released", () => {
  let s = { camYaw: 0, moveYaw: 0 };
  for (let i = 0; i < 120; i++) { s = frame(s, true); s = autoTurn(s, 0.01); }
  assert.equal(s.moveYaw, 0, "still held while moving");
  s = frame(s, false);                       // let go
  assert.ok(Math.abs(s.moveYaw - s.camYaw) < 1e-9, "release re-syncs the basis to the view");
});

test("a zero-delta look is not a look", () => {
  // The pad is polled every frame. If a neutral right stick counted as aiming,
  // the follow-cam would be suspended forever whenever a controller is plugged in.
  const s = { camYaw: 0.3, moveYaw: 0.3 };
  assert.deepEqual(playerLook(s, 0), s);
  const src = readFileSync(new URL("./world.js", import.meta.url), "utf8");
  assert.match(src, /const lookBy = \(dYaw\) => \{\s*\n\s*if \(!dYaw\) return;/,
    "lookBy must bail on a zero delta");
});

test("world.js builds the movement basis from moveYaw, never camYaw", () => {
  const src = readFileSync(new URL("./world.js", import.meta.url), "utf8");
  assert.match(src, /tmpForward\.set\(-Math\.sin\(moveYaw\)/,
    "forward must come from the held basis, not the live camera yaw");
  assert.doesNotMatch(src, /tmpForward\.set\(-Math\.sin\(camYaw\)/,
    "a camYaw-derived basis is the feedback spiral this exists to prevent");
  assert.match(src, /Math\.hypot\(ix, iz\) <= 0\.01\) moveYaw = camYaw/,
    "the basis must re-sync while there is no movement input");
});

// ── handover ───────────────────────────────────────────────────────────────
// Freezing the basis stopped the camera steering the dog but let the two
// frames drift apart. They agree only when the stick is pure forward: travel
// sits THETA off the basis, the camera converges to travel + PI, so it parks
// THETA away and the controls are THETA stale — 90° when strafing, inverted
// when reversing. Once the camera has arrived, the basis migrates to it.

const CAM_ALIGNED = 0.08, CTRL_RESYNC_RATE = 0.9, CTRL_THETA = 0.35, CTRL_THETA_ANALOG = 2.2;

/**
 * A whole world, reduced to the three angles that matter. `theta` is the
 * stick's angle off forward and stays fixed — the player is holding still.
 */
function sim(theta, secs, { moveYaw = 0, camYaw = 0, gate = CTRL_THETA } = {}) {
  const dt = 1 / 60;
  let t = 0;
  for (let i = 0; i < secs * 60; i++) {
    // One threshold gates BOTH: outside it this is a strafe, and nothing moves.
    if (Math.abs(theta) < gate) t += dt; else t = 0;
    const heading = moveYaw + Math.PI + theta;      // travel, in world terms
    if (t > CAM_FOLLOW_DELAY) {
      const delta = shortest(camYaw, heading + Math.PI);
      const ramp = Math.min(1, (t - CAM_FOLLOW_DELAY) / CAM_FOLLOW_EASE);
      camYaw += delta * Math.min(1, CAM_FOLLOW_RATE * ramp * dt);
      if (Math.abs(delta) < CAM_ALIGNED && Math.abs(theta) < gate) {
        moveYaw += shortest(moveYaw, camYaw) * Math.min(1, CTRL_RESYNC_RATE * dt);
      }
    }
  }
  return { moveYaw, camYaw, stale: Math.abs(shortest(moveYaw, camYaw)) };
}

test("holding forward never disturbs anything", () => {
  // theta 0 is the case that was already correct; the handover must not break it.
  const s = sim(0, 8);
  assert.ok(s.stale < 1e-6, `pure forward drifted ${s.stale}`);
});

test("a strafe moves neither frame, so they cannot drift apart", () => {
  // Chasing a handover here is impossible, not merely hard: camera-follows-
  // travel and controls-follow-camera cannot both hold off-centre — the whole
  // arrangement rotates forever and the gap converges to theta, not to zero.
  // So a strafe is left alone, and costs nothing.
  assert.ok(sim(Math.PI / 2, 12).stale < 1e-9, "strafing should leave both frames still");
});

test("reversing no longer inverts the controls", () => {
  // The old worst case: the camera swung a half-turn to sit behind the travel
  // while the basis held, so forward meant backward.
  assert.ok(sim(Math.PI, 14).stale < 1e-9, "backing up should leave both frames still");
});

test("no stick angle leaves the controls badly stale", () => {
  // The reason there is ONE threshold and not two. A separate, wider limit for
  // the follow leaves a band where the camera swings and the basis does not
  // hand over — the reported bug again, just narrower.
  let worst = 0, at = 0;
  for (let th = 0; th <= Math.PI; th += 0.02) {
    const s = sim(th, 12).stale;
    if (s > worst) { worst = s; at = th; }
  }
  assert.ok(worst < 0.30,
    `worst stale ${(worst * 57.3).toFixed(1)}° at theta ${(at * 57.3).toFixed(0)}°`);
});

test("the basis only moves once the camera has arrived", () => {
  // Chasing a still-swinging camera means both frames move and neither
  // converges. Half a second in, the camera is mid-swing and the basis must
  // not have started.
  let moveYaw = 0, camYaw = 0, t = 0;
  const dt = 1 / 60, theta = Math.PI / 2;
  for (let i = 0; i < 0.5 * 60; i++) {
    t += dt;
    const heading = moveYaw + Math.PI + theta;
    if (t > CAM_FOLLOW_DELAY) {
      const delta = shortest(camYaw, heading + Math.PI);
      camYaw += delta * Math.min(1, CAM_FOLLOW_RATE * dt);
      if (Math.abs(delta) < CAM_ALIGNED) moveYaw += shortest(moveYaw, camYaw) * CTRL_RESYNC_RATE * dt;
    }
  }
  assert.equal(moveYaw, 0, "the basis moved while the camera was still swinging");
});

test("the handover is slower than the camera it follows", () => {
  assert.ok(CTRL_RESYNC_RATE < CAM_FOLLOW_RATE,
    "a basis that outruns the camera reads as a second thing moving, not as settling");
});

// ── analog vs digital ──────────────────────────────────────────────────────
// The theta gate was keyboard-shaped and killed the follow outright on touch.
// Holding W gives ix = 0 and theta = 0 exactly; a thumbstick is a continuous
// 2D vector, so theta is arbitrary almost always, the timer reset every frame,
// and the camera never moved on mobile.

const engages = (theta, gate) => {
  // Start the camera deliberately off so there is something to converge — at
  // theta 0 it is already where it wants to be, and "camYaw moved" would read
  // a correct camera as a disengaged one.
  const start = 1.0;
  const s = sim(theta, 6, { gate, camYaw: start });
  return Math.abs(s.camYaw - start) > 1e-6;
};

test("a thumbstick angle no longer blocks the follow", () => {
  for (const theta of [0.3, 0.52, Math.PI / 2, 2.0]) {
    assert.ok(engages(theta, CTRL_THETA_ANALOG),
      `analog input at ${(theta * 57.3).toFixed(0)}° should still follow`);
  }
});

test("hard reverse still never swings the camera, on either input", () => {
  assert.ok(!engages(Math.PI, CTRL_THETA_ANALOG), "backing toward the camera must not spin it");
  assert.ok(!engages(Math.PI, CTRL_THETA), "…on keys either");
});

test("digital input keeps the tight gate", () => {
  // The spiral only bites where the player cannot correct continuously.
  assert.ok(engages(0, CTRL_THETA), "W alone must follow");
  assert.ok(!engages(Math.PI / 4, CTRL_THETA), "W+A is a strafe on keys, not travel");
  assert.ok(CTRL_THETA_ANALOG > CTRL_THETA, "analog must be the wider of the two");
});

test("the constants here match world.js", () => {
  const src = readFileSync(new URL("./world.js", import.meta.url), "utf8");
  for (const [name, want] of [["CAM_FOLLOW_DELAY", CAM_FOLLOW_DELAY],
                              ["CAM_FOLLOW_RATE", CAM_FOLLOW_RATE],
                              ["CAM_FOLLOW_EASE", CAM_FOLLOW_EASE],
                              ["CTRL_THETA", CTRL_THETA],
                              ["CTRL_RESYNC_RATE", CTRL_RESYNC_RATE],
                              ["CAM_ALIGNED", CAM_ALIGNED],
                              ["CTRL_THETA_ANALOG", CTRL_THETA_ANALOG]]) {
    const m = src.match(new RegExp(`const ${name} = ([\\d.]+)`));
    assert.ok(m, `${name} is not a named constant in world.js`);
    assert.equal(Number(m[1]), want, `${name} drifted — this file is now testing a fiction`);
  }
  // Player look must go through lookBy on BOTH input surfaces. That single
  // funnel is what guarantees the two invariants together: the follow-cam is
  // suspended, AND the movement basis turns with the view. A look path that
  // wrote camYaw directly would silently get neither.
  const calls = (src.match(/^\s*lookBy\(/gm) || []).length;
  assert.ok(calls >= 2, `only ${calls} lookBy call site(s) — expected pointer look and pad look`);
  // camYaw may only be written by lookBy itself and by the auto-follow easing.
  // Any other assignment is a look path that skipped the funnel.
  const writes = src.split("\n").filter((l) => /(^|[^.\w])camYaw\s*[-+]?=[^=]/.test(l));
  for (const w of writes) {
    assert.ok(/camYaw \+= dYaw|camYaw \+= delta|let camYaw|camYaw = Math\.atan2/.test(w),
      `camYaw written outside lookBy / the follow easing: ${w.trim()}`);
  }
  assert.match(src, /reduceMotion.*\n?.*camFollowT|!reduceMotion && dogState\.speed/,
    "reduce-motion must opt out of an unrequested camera rotation");
});

console.log("follow-cam: shortest-arc, delay, ease-in, settling, and constant parity");
