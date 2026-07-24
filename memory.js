/* Dog Park 3D — memory flashes: Errol's under-scent, made playable.
 *
 * The story's engine is the gap between how PRESENT Errol is in scent and how
 * ABSENT he is in the world. Strong Errol-scent sources (the blue-gray under-
 * scent beneath Maya's cinnamon, later his empty house, his chair, the ball)
 * detonate brief memory vignettes — a porch, a thrown ball, a man's laugh, the
 * word "Biscuit". Each flash:
 *   - fires exactly ONCE (a discovery, not a repeatable trigger — brain
 *     lockstep#E5: deactivate a one-shot the instant it's taken),
 *   - plays that beat's authored cutscene (which carries its own scent-override
 *     + white-bloom + comfort-restore effect cues — see game.js applyCutEffect),
 *   - and collecting them ALL unlocks the "curtain call" trick the recognition
 *     scene needs in Act 3.
 *
 * Pure logic, no THREE — unit-testable in Node with stubbed callbacks (same
 * pattern as scent/cutscene/keepsake). Two trigger paths:
 *   1. scent-driven: the dog dwells in a strong Errol source (the in-world
 *      mechanic; fires as Act 2 lays Errol nodes),
 *   2. explicit trigger(id): a story beat fires it directly (and the test hook).
 */

// The Errol memory flashes, in story order. beatId points at the authored
// cutscene; `source` is the scent lane whose local strength arms the flash;
// `threshold` is how hot that source must be near the dog to detonate. The
// first is the bakery discovery (learns his name); the rest land as Act 2's
// under-scent geometry arrives. `dwell` guards against a one-frame graze.
const FLASHES = [
  { id: "under-scent", beatId: "the-under-scent",       source: "errol", threshold: 0.32, dwell: 0.6 },
  { id: "the-chair",   beatId: "the-chair-on-the-curb", source: "errol", threshold: 0.55, dwell: 0.8 },
];

export function createMemoryFlashes(opts) {
  const o = opts || {};
  const getScent = o.getScent || (() => null);
  const playCutscene = o.playCutscene || null; // (beatId, onDone) => void
  const narrative = o.narrative || null;
  const grantCurtainCall = o.grantCurtainCall || (() => {});
  const isBusy = o.isBusy || (() => false);    // don't fire over an active cutscene/menu
  const onFlash = o.onFlash || (() => {});     // notify (toast, sfx) — optional
  const flashes = Array.isArray(o.flashes) ? o.flashes : FLASHES;

  const seen = new Set();
  let curtainUnlocked = false;
  const dwellT = {};        // per-flash accumulated time over threshold
  let firing = false;       // guard: one flash resolves before another can arm

  function armedByScent(f) {
    const sc = getScent();
    if (!sc || typeof sc.strengthOf !== "function") return false;
    // strengthOf reads the source's strength near the dog (see scent.js)
    return sc.strengthOf(sc.SCENT ? sc.SCENT[f.source.toUpperCase()] || f.source : f.source, 6) >= f.threshold;
  }

  function fire(f) {
    if (seen.has(f.id) || firing) return false;
    seen.add(f.id);
    delete dwellT[f.id];
    onFlash(f);
    const done = () => { firing = false; maybeUnlock(); };
    const cut = narrative && typeof narrative.cutscene === "function" ? narrative.cutscene(f.beatId) : null;
    if (playCutscene && cut) { firing = true; playCutscene(cut, done); }
    else { maybeUnlock(); } // headless / no-cutscene path still counts the flash
    return true;
  }

  function maybeUnlock() {
    if (curtainUnlocked) return;
    if (flashes.every((f) => seen.has(f.id))) {
      curtainUnlocked = true;
      grantCurtainCall();
    }
  }

  // Force-fire a flash by id (a story beat, or a test). Honors the one-shot.
  function trigger(id) {
    const f = flashes.find((x) => x.id === id);
    return f ? fire(f) : false;
  }

  function update(dt) {
    if (firing || curtainUnlocked && seen.size === flashes.length) return;
    for (const f of flashes) {
      if (seen.has(f.id)) continue;
      if (armedByScent(f)) {
        dwellT[f.id] = (dwellT[f.id] || 0) + dt;
        if (dwellT[f.id] >= f.dwell) { fire(f); return; } // one per frame
      } else if (dwellT[f.id]) {
        dwellT[f.id] = 0; // left the source before the dwell completed — reset
      }
    }
  }

  function serialize() {
    return (seen.size || curtainUnlocked)
      ? { seen: [...seen], curtain: curtainUnlocked ? 1 : 0 }
      : null;
  }
  function restore(data) {
    seen.clear(); curtainUnlocked = false;
    for (const k in dwellT) delete dwellT[k];
    if (!data) return;
    if (Array.isArray(data.seen)) for (const id of data.seen) if (flashes.some((f) => f.id === id)) seen.add(id);
    if (data.curtain) { curtainUnlocked = true; grantCurtainCall(); }
    else maybeUnlock(); // a save that saw every flash but predates the unlock still grants it
  }

  return {
    update, trigger, serialize, restore,
    hasSeen: (id) => seen.has(id),
    count: () => seen.size,
    total: () => flashes.length,
    allSeen: () => flashes.every((f) => seen.has(f.id)),
    curtainCallUnlocked: () => curtainUnlocked,
    _debug: () => ({ seen: [...seen], curtain: curtainUnlocked, firing, dwell: { ...dwellT } }),
  };
}
