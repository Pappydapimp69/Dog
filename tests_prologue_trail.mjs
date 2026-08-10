// The opening scent hunt — every stop must have a way to finish it.
//
// This is a SOURCE-level check, not a behavioural one, and that is deliberate.
// buildTrailStops/prologueInteract live inside game.js behind a THREE import,
// so a browser run is the only way to exercise them — and the bug this guards
// was invisible in a browser too, because the failure mode is "no prompt ever
// appears", which asserts as nothing happening. What shipped was a stop KIND
// with no matching completion branch, and that is a fact about the text of the
// file, so check it there.
//
// The bug: legs[0] declares `want: null`, so the first stop of the game is
// always a "sniff". prologueInteract() handled "can" and "cart" and fell
// through to `return false` for everything else, and contextAction() returned
// null for it — no verb, no prompt, no object. The stop completed on a silent
// 1.6s dwell within 3.2 units of an unmarked coordinate. Reported four times
// as "the trail leads to nothing", and each previous fix addressed placement,
// spacing or signalling — never whether the player could ACT.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./game.js", import.meta.url), "utf8");
const between = (startRe, endRe) => {
  const i = src.search(startRe);
  assert.ok(i >= 0, `could not locate ${startRe}`);
  const rest = src.slice(i);
  const j = rest.search(endRe);
  return rest.slice(0, j > 0 ? j : rest.length);
};

const buildFn = between(/function buildTrailStops\(/, /\n  function /);
const interactFn = between(/function prologueInteract\(/, /\n  function /);

/** Every `kind:` a stop can be created with, in the order the route builds them. */
const routeKinds = () => {
  const lit = [...buildFn.matchAll(/kind:\s*"([a-z]+)"/g)].map((m) => m[1]);
  // `kind: hit.kind` covers the two prop kinds a leg can ask for via `want`.
  const wanted = [...buildFn.matchAll(/want:\s*"([a-z]+)"/g)].map((m) => m[1]);
  return new Set([...lit, ...wanted]);
};

test("every stop kind the route can produce has a completion branch", () => {
  const handled = new Set([...interactFn.matchAll(/st\.kind === "([a-z]+)"/g)].map((m) => m[1]));
  handled.add("door");   // the door is completed by the arrival check, not by a verb
  const missing = [...routeKinds()].filter((k) => !handled.has(k)).sort();
  assert.deepEqual(missing, [],
    `stop kind(s) with no way to finish them: ${missing.join(", ")}`);
});

test("a sniff stop is completable by pressing the button, not only by waiting", () => {
  assert.match(interactFn, /st\.kind === "sniff"/,
    "prologueInteract must handle sniff — dwell alone is an invisible verb");
  assert.match(interactFn, /advanceStop\(\)/);
});

test("every stop kind that can be active offers a prompt", () => {
  // contextAction's hunt branch is what draws the on-screen verb. A kind it
  // omits is a stop the player is standing on with nothing on screen.
  // Anchor inside contextAction — interact() carries the same guard clause and
  // appears earlier in the file, so an unanchored search reads the wrong one.
  const ctxFn = between(/function contextAction\(/, /\n  function /);
  const hunt = ctxFn.slice(0, ctxFn.search(/if \(phase !== "play"/));
  for (const k of ["can", "cart", "sniff"]) {
    assert.match(hunt, new RegExp(`"${k}"`), `no prompt is offered at a "${k}" stop`);
  }
});

test("a sniff stop's reach is not a can's reach", () => {
  // 3.2u suits a visible metre-wide bin. An unmarked point in the road needs
  // more, or arriving depends on the player's exact line through it.
  const m = src.match(/const SNIFF_REACH = ([\d.]+);/);
  assert.ok(m, "SNIFF_REACH must be a named constant, not a literal in two places");
  assert.ok(Number(m[1]) > 3.2, `SNIFF_REACH is ${m[1]}, no wider than a can's 3.2`);
  assert.match(src, /st\.kind === "sniff" \? SNIFF_REACH/,
    "the arrival check must use SNIFF_REACH for sniff stops");
});

test("a trail leg pools its destination so the end of it is a place", () => {
  const lay = between(/function layMayaTrail\(/, /\n  function /);
  assert.match(lay, /Math\.cos\(a\)/, "the destination needs a ring of nodes, not a line that stops");
  assert.match(lay, /to\.x \+ Math\.cos/, "the ring must be centred on the stop itself");
});

// ── the headlight hazard ───────────────────────────────────────────────────
// "Stay out of the headlights" was an instruction with nothing on screen to
// obey: the exposure test ran on an invisible slab and the van carried two
// 0.4-unit emissive boxes that threw no light. Reported as "expected to see
// the headlights".

test("the beam drawn and the volume tested come from the same constants", () => {
  const check = between(/function updatePatrolVan\(/, /\n  function /);
  assert.match(check, /dist < VAN_BEAM\b/, "the exposure test must use VAN_BEAM, not a literal");
  assert.match(check, /Math\.abs\(dz\) < VAN_BEAM_W/, "…and VAN_BEAM_W for the half-width");
  const build = between(/function buildPatrolVan\(/, /\n  \/\/ Dennis/);
  assert.match(build, /VAN_BEAM_W, VAN_BEAM_W \* [\d.]+, VAN_BEAM/,
    "the beam mesh must be sized from the same two constants");
});

test("the beam does not taper to nothing at the bumper", () => {
  // The test volume is a slab of constant half-width. A point-source cone
  // would leave the player caught while standing outside the drawn light.
  const build = between(/function buildPatrolVan\(/, /\n  \/\/ Dennis/);
  assert.match(build, /CylinderGeometry\(VAN_BEAM_W/,
    "a truncated cone, not ConeGeometry — the near end has real width");
});

test("the van patrols the route, not a fixed span around the spawn", () => {
  const setup = between(/Sweep the stretch the ROUTE actually covers/, /\n    \};/);
  assert.match(setup, /prologue\.stops/, "the span must be derived from the route's own stops");
  assert.doesNotMatch(setup, /vanSpan\s*=\s*\d+/, "a fixed span patrols a block the player may never visit");
});

// ── route length ───────────────────────────────────────────────────────────

test("route length is budgeted against sprint speed, not walk speed", () => {
  // Two previous passes measured the convenient quantity: first the
  // perpendicular offset, then world units at the walk speed of 9. Players
  // sprint at 16, where the same 125-unit route is ~2s a leg — which is what
  // it was reported as, twice.
  assert.match(buildFn, /SPRINT SECONDS/, "the budget must be stated in the units the player feels");
  const legs = [...buildFn.matchAll(/\{ x: at\(/g)].length;
  assert.ok(legs >= 7, `only ${legs} legs — path length has to come from the walk, not the endpoints`);
});

console.log("prologue trail: stop kinds, verbs, prompts, reach, pooling, beam and route budget");

// ── the underpass ──────────────────────────────────────────────────────────
// dog#E94: the deck was built along `startHeading`, the bearing from the spawn
// to Maya's door, so a 26x13 slab of civic infrastructure was oriented by
// wherever a doorway happened to be — and swung ~100° into two walk-ups the
// first time the door moved. The clearance rule added then kept it out of the
// buildings without addressing the cause: the angle was still arbitrary, and
// still door-derived, so it sat skewed across its own carriageway.

test("the underpass takes its angle from the street, never from the door", () => {
  const src = readFileSync(new URL("./game.js", import.meta.url), "utf8");
  const call = src.match(/const underpass = buildUnderpass\(([^)]*)\)/);
  assert.ok(call, "buildUnderpass call not found");
  assert.doesNotMatch(call[1], /startHeading|door/,
    `underpass angle still derives from the door: buildUnderpass(${call[1]})`);
  assert.match(src, /const roadRunsAlongX = /,
    "the angle must be derived from which way the carriageway runs");
});

test("the deck is perpendicular to the carriageway, not along it", () => {
  // A bridge crosses a street. The deck's long axis is local x (26 units), so
  // on a road running along world x the group must be turned a quarter turn —
  // parallel would lay the span down the road the dog is standing in.
  const src = readFileSync(new URL("./game.js", import.meta.url), "utf8");
  assert.match(src, /roadRunsAlongX \? Math\.PI \/ 2 : 0/,
    "expected a quarter turn on an x-running road and none on a z-running one");
});
