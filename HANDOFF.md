# Session Handoff — 2026-11-06

Read this first if you're picking up this repo cold. A prior session's context
doesn't carry forward; this file is the bridge.

## Repo state

- Work branch: `claude/brain-cognitive-system-167dul`.
- Live: https://pappydapimp69.github.io/Dog/ — `.github/workflows/pages.yml`
  deploys only from `claude/dog-game-continue-oc3xqh` (a Pages environment rule
  restricts it to that branch). That branch is at `aaa2c36`, so anything after
  it is NOT live. To deploy, fast-forward it to the work branch's HEAD
  (`git push origin HEAD:refs/heads/claude/dog-game-continue-oc3xqh
  --force-with-lease=claude/dog-game-continue-oc3xqh:<known-sha>`) — confirm
  with the owner first.

## Where the work stands

The playtest scorecard rows (A2, A6, B3, B4, C1, C3, C5, C6, D1, D2) each have
a shipped fix; the commit messages say what was verified in-engine and what
still needs a person to re-score (T11: feel and "does it read as a place"
cannot be tested headlessly). There is no open work item queued.

Prologue flow (owner's design, 2026-11-06): trail -> her door -> scratch
(no answer; the door stops glowing) -> find food (tip a bin) -> sleep at the
warm vent under the Delancey underpass (refused while hungry) -> dawn -> go
back to her door unaided -> scratch -> she opens. No night timer. The trail
names and pools only the FIRST stop of each kind (bin, hydrant, cart); repeats
show "🐾 Follow her scent." and no pool; bins smell of food only within 12u.
Tests: tests_harness.mjs "her door stays shut until the dog has eaten and
slept" (mutation: an auto-opening door fails it) and "the trail guides a kind
of stop once".

Earlier change (this session): the HUD contrast audit.
- `harness.mjs` `contrast()` now composites translucent backgrounds and
  translucent text colours, and takes `{ backdrop }` for the colour behind the
  page. It used to skip translucent layers (every glass HUD panel) and treat
  text alpha as opaque, so the HUD was never measured and a 0.55-alpha card
  line passed falsely.
- Measured at `--panel` 0.62: the orange level title 2.97:1 on the day sky
  (2.2:1 on white), meter labels 4.38:1. `--panel` is now 0.82, the lowest
  alpha where every HUD text colour clears 4.5:1 even on pure white.
- `.card p.version` was 3.43:1 once its alpha was blended; now `#6f6b7a`.
- `tests_mobile.mjs` "HUD text meets AA over any scene behind the glass"
  audits every HUD panel (forced visible) over day sky, night sky and white;
  negative control: at 0.62 it fails with exactly the three measured above.

## Tests

`node --test tests_*.mjs` with `python3 -m http.server 8140` running (the
browser-driven suites skip without it). All 12 files green at the time of
writing: mobile 7/7 including both contrast checks.

## Brain (linked, full mode)

`brain start <1-2 keywords>` before work, `brain note` mid-flow, `brain save`
after. Open tension that touches this repo: 🔴 T47 (is a frame-sampled audit a
safe stand-in for a dense colour-path audit when a backdrop eases).
The HUD fix sidesteps T47: at 0.82 the HUD passes on pure white, the worst any
point of the sky path can be, so no path sampling is needed.
