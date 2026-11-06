/* Dog Park 3D — the story chain: Act 2 from "Making a Name" to Act 3's "The
 * Gate Opens", as one ordered, saved sequence of beats.
 *
 * Pure logic, no THREE — Node-testable (same pattern as reputation/memory).
 * game.js STAGES each beat (spawns its people and props, checks its goal);
 * this module only owns ORDER and PERSISTENCE, so:
 *   - a beat's entities exist only once the beat is entered (brain
 *     the-game-prologue#E9: nothing the player did earlier can pre-solve or
 *     soft-lock a beat whose targets did not exist yet);
 *   - advancing is guarded by the beat you claim to be finishing, so a stale
 *     callback from an earlier beat can never skip the current one;
 *   - tests advance through the SAME advance() the game uses (brain dog#E24:
 *     a hook that hand-copies state skips the side effects that matter);
 *   - the index round-trips through save (brain sandbox-edges#E14: a story
 *     unlock must survive a reload/respawn, not live only in memory).
 */

export const STORY = [
  // Act 2 — What the Coat Carried (after the bakery's under-scent)
  "making-a-name",
  "the-old-scent-runs-deep",
  "the-empty-house",
  "the-chair-on-the-curb",
  "the-washing-rain",
  "two-at-the-fence",
  // Act 3 — The Gate
  "the-storm",
  "over-the-fence",
  "caught",
  "the-gray-kennel",
  "word-travels",
  "cinnamon-through-the-bleach",
  "papers-and-a-leash",
  "the-gate-opens",
];

export function createStory({ onEnter = () => {}, onExit = () => {} } = {}) {
  let idx = -1;          // -1 = not started; STORY.length = finished
  const api = {
    started: () => idx >= 0,
    done: () => idx >= STORY.length,
    index: () => idx,
    current: () => (idx >= 0 && idx < STORY.length ? STORY[idx] : null),
    /** Begin the chain (no-op once started). */
    start() {
      if (idx >= 0) return false;
      idx = 0; onEnter(STORY[0], 0);
      return true;
    },
    /** Finish `from` and enter the next beat. Refuses unless `from` is current. */
    advance(from) {
      if (idx < 0 || idx >= STORY.length || STORY[idx] !== from) return false;
      onExit(from, idx);
      idx++;
      if (idx < STORY.length) onEnter(STORY[idx], idx);
      return true;
    },
    serialize: () => idx,
    /** Restore a saved index and re-enter that beat so its world is rebuilt. */
    restore(saved) {
      const n = Number.isInteger(saved) ? saved : -1;
      idx = Math.max(-1, Math.min(STORY.length, n));
      if (idx >= 0 && idx < STORY.length) onEnter(STORY[idx], idx, { restored: true });
      return idx;
    },
  };
  return api;
}

// ---- Still-air windows ------------------------------------------------------
// "The under-scent is old and faint, only readable at dawn and dusk when the
// air goes still." The world clock (world.js) runs a 240 s day: dawn ramp at
// u in [0, 0.05), dusk ramp at [2/3, 2/3+0.05). The ramps alone are 12 s each —
// 10% of the day — so the window is widened around each ramp. Measured on that
// clock: the worst wait for the next window is ~130 s (late morning), which is
// why the beat also offers a rest that skips to it (see restTarget).
export const STILL_AIR = { dawn: [-0.05, 0.08], dusk: [0.62, 0.75] };
export function stillAir(u) {
  const x = ((u % 1) + 1) % 1;
  const inDawn = x >= 1 + STILL_AIR.dawn[0] || x < STILL_AIR.dawn[1];
  const inDusk = x >= STILL_AIR.dusk[0] && x < STILL_AIR.dusk[1];
  return inDawn ? "dawn" : inDusk ? "dusk" : null;
}
/** Day-phase fraction to skip forward so the clock lands just inside the next window. */
export function restTarget(u) {
  const x = ((u % 1) + 1) % 1;
  if (stillAir(x)) return 0;
  const starts = [STILL_AIR.dusk[0] + 0.01, 1 + STILL_AIR.dawn[0] + 0.01];
  for (const s of starts) if (s > x) return s - x;
  return 1 + STILL_AIR.dusk[0] + 0.01 - x;
}

// ---- Designed surrender -----------------------------------------------------
// "Inputs respond weaker and slower over ~10 seconds until the dog stops." Used
// once. A smoothstep fall so the first seconds still feel like running.
export const SURRENDER_SECONDS = 10;
export function surrenderGain(t) {
  const x = Math.min(1, Math.max(0, t / SURRENDER_SECONDS));
  return 1 - x * x * (3 - 2 * x);
}

// ---- The gray kennel's hold card -------------------------------------------
// "STRAY HOLD — 72 HRS", day-stamped in hard cuts: 72. 48. 24.
export const HOLD_STAMPS = [72, 48, 24];

// ---- Open Case: Vega searches where he probably is -------------------------
// Brain seven#E47 (search theory): after a failed search, scale that area's
// probability by (1 - POD) and search where probability x detection is
// highest; treating a searched area as CLEARED is the classic error — he may
// simply not have been seen. A sighting resets that place to certainty.
export const SEARCH_POD = 0.6;           // chance a search of the right spot finds him
const MERGE = 8;                         // a report this close to a known spot raises it
export function createSearch(spots) {
  const s = (spots || []).map((p) => ({ x: p.x, z: p.z, p: p.p == null ? 0.5 : p.p }));
  const api = {
    spots: s,
    /** Index of the spot to search next (highest probability; detection uniform). */
    next() { let best = 0; for (let i = 1; i < s.length; i++) if (s[i].p > s[best].p) best = i; return best; },
    /** He wasn't found there: discount, never clear. */
    searched(i) { if (s[i]) s[i].p *= 1 - SEARCH_POD; },
    /** He was seen at (x, z). */
    report(x, z) {
      for (const p of s) if (Math.hypot(p.x - x, p.z - z) < MERGE) { p.p = 1; p.x = x; p.z = z; return; }
      s.push({ x, z, p: 1 });
    },
  };
  return api;
}
