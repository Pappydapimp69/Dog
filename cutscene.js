// cutscene.js — compile an authored narrative cutscene block into an executable,
// time-based timeline the game can play through its existing cutscene channel.
//
// Fable's cutscene direction is PROSE: camera "shots" name a framing and a
// subject in words ("extreme close-up on rain beading on the rear window"),
// effects and dialogue are timed to seconds. We can't execute the prose targets
// literally, so we translate the SHOT VOCABULARY into generic dog-relative
// framings (the dog is the one subject the engine always has), lay the dialogue
// out as timed captions, and map effect types onto real engine actions. Result:
// a functional, timed, captioned, camera-moving cutscene now; pixel-exact
// framing of a specific prose shot is a later human polish pass (the honest
// "logic not looks" boundary — brain tension T11).
//
// MOTION (the thing that makes a shot cinematic rather than a still): a shot is
// not a fixed camera KEY, it is a MOVE. Every shot type carries a start and an
// end framing plus a lateral arc, swept across the shot's own duration on one
// continuous eased curve (brain MOTION/camera: one-continuous-eased-curve beats
// punch-hold-release — a literal flat hold reads as mechanical), with a small
// deterministic handheld drift on top so even a "static, held" shot breathes.
// Shot boundaries are hard CUTS, not glides across the world: `cameraAt` reports
// the shot index so the runner can snap instead of easing between two shots.
//
// STAGING: the prose notes describe what the ACTORS do inside a shot ("Biscuit
// walks a few steps after the car, stops at the rain line, and sits"). Those are
// mined into a timed `staging` track of coarse action cues, mapped onto real
// engine actions by game.js exactly the way `effects` already are — same
// vocabulary-in-prose, engine-action-out contract, unknown cues are no-ops.
//
// This compiler is PURE (plain {x,y,z} out, no THREE) and Node-testable. The
// runner + effect handlers live in game.js, reusing the letterbox, the
// _cutsceneCam camera channel, control-freeze, and skip that already exist.

const GOLDEN = 2.399963229728653; // golden angle — varies azimuth per shot

// Motion profile per shot type. d0/d1 = distance off the subject at the shot's
// start/end (d1 < d0 is a push-in, d1 > d0 a pull-back), h0/h1 = eye height the
// same way, arc = radians of lateral orbit swept across the shot, drift =
// handheld amplitude in world units. Matched in order, so the SPECIFIC patterns
// ("extreme close", "static wide … held") must precede the general ones
// ("close", "wide") or they'd never be reached.
const SHOT_MOTION = [
  // an insert this tight still creeps closer — that creep is the whole shot
  [/extreme close/, { d0: 1.9, d1: 1.3, h0: 0.62, h1: 0.5, arc: 0.10, drift: 0.012 }],
  // the authored "slow push-in": long travel, low arc, so the move reads as one
  // deliberate approach rather than a drift
  [/push-?in|pushing in/, { d0: 4.0, d1: 1.7, h0: 1.4, h1: 0.85, arc: 0.06, drift: 0.008 }],
  // crane/aerial: rises AND pulls back, the "leaving him behind" move
  [/pull-?back|pull-?up|rising|crane|aerial|overhead|high wide/,
    { d0: 3.2, d1: 8.5, h0: 2.0, h1: 9.5, arc: 0.30, drift: 0 }],
  // "static … held" is not a locked-off tripod: it's a held frame with life in
  // it. Nearly no travel, but never literally zero (that's what reads as dead).
  [/static|held|locked/, { d0: 9.4, d1: 8.7, h0: 4.0, h1: 3.7, arc: 0.07, drift: 0.006 }],
  [/wide/, { d0: 9.5, d1: 8.2, h0: 4.2, h1: 3.5, arc: 0.16, drift: 0.006 }],
  // a tracking/handheld shot is mostly LATERAL — the big arc is the point
  [/tracking|dolly|handheld|follow/, { d0: 4.8, d1: 4.2, h0: 1.6, h1: 1.4, arc: 0.55, drift: 0.030 }],
  // dog's-eye / inside-the-crate: floor height, and it creeps in
  [/dog.?s.?eye|low angle|floor|bench level|insert|crate|ground level/,
    { d0: 2.8, d1: 2.1, h0: 0.50, h1: 0.42, arc: 0.12, drift: 0.020 }],
  [/close/, { d0: 2.9, d1: 2.25, h0: 1.1, h1: 0.95, arc: 0.10, drift: 0.010 }],
  [/medium|two-?shot|reverse|over-?the-?shoulder/,
    { d0: 4.4, d1: 3.6, h0: 1.8, h1: 1.6, arc: 0.22, drift: 0.012 }],
];
const DEFAULT_MOTION = { d0: 5.4, d1: 4.6, h0: 2.5, h1: 2.2, arc: 0.18, drift: 0.010 };

function motionFor(shotStr) {
  const s = (shotStr || "").toLowerCase();
  for (const [re, m] of SHOT_MOTION) if (re.test(s)) return m;
  return DEFAULT_MOTION;
}

// Coarse staging cues mined from a shot's prose (its target + notes). Same
// contract as `effects`: a vocabulary token out, game.js decides what it means,
// anything unmatched is simply absent. Deliberately few and physical — these
// are the beats an engine can actually perform on the figures it has.
const STAGING = [
  ["dog-sit", /\bsits?\b|\bsitting\b|the sit is the shot/],
  ["dog-walk", /walks? a few steps|walks? after|steps? out|steps? after|following the car|walks? toward/],
  ["dog-look", /watch(es|ing)?\b|looks? (up|back|off|after|toward)|stares?|gaz(e|ing)/],
  ["car-leave", /taillights|driv(es|ing) away|pull(s|ing) away|receding|engine (fade|and radio)/],
  ["human-turn", /can.?t look|turns? (away|back)|won.?t meet|looks? away/],
  ["human-crouch", /unlatch|crouch|kneel|reaches? (in|down)|hands? (unlatching|opening)/],
  ["drop-item", /drops? (a|the) (strip|chicken|treat)|chicken strip drops/],
  ["dog-eat", /eat(s|ing)?\b|chew|swallow|takes? the treat|mouth|nose (entering|in) frame/],
  // was `holds? out`, which matches "hold out"/"holds out" but not "holding
  // out" — the ACTUAL phrasing used for the beat's kneel-and-offer shot, so
  // Maya's model never got built until a later shot happened to also mention
  // "palm". `hold(s|ing)? out` catches all three tenses.
  ["human-offer", /offers?|hold(s|ing)? out|palm|kneel|crouch(es|ing)? (down|to)|treat in (her|his)/],
  // A named character crossing frame at the START of a shot needs to actually
  // be built and walking, not appear only once she happens to kneel — these
  // three complete her blocking for a beat that is otherwise entirely about her.
  ["char-enter", /passing (left to right|by|through)|walking fast|head down/],
  ["char-stop-turn", /stopping|turning back|stops?,? .*turn/],
  ["char-leave", /walking away|recedes? into|standing.*walking away/],
];
function stagingFor(cam) {
  const s = `${cam.target || ""} ${cam.notes || ""}`.toLowerCase();
  const out = [];
  for (const [cue, re] of STAGING) if (re.test(s)) out.push(cue);
  return out;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (p) => p * p * (3 - 2 * p); // smoothstep: eased in AND out

function fmtLine(d, nameOf) {
  const line = (d && d.line) || "";
  const sp = d && d.speaker;
  if (!sp || sp === "NARRATION") return line;               // narration: bare text
  const nm = (nameOf && nameOf(sp)) || sp;
  return `${nm}: ${line}`;
}

// Broad shot types whose whole point is showing the PLACE, not just the dog —
// they bias toward ctx.locationAnchor (below) when no character resolves.
const LOCATION_BIAS_SHOT = /wide|overhead|aerial|establishing|static|held|locked|pull-?back|pull-?up|rising|crane/;

// cut: a beat's `cutscene` block. ctx: { getDog:()=>({x,z}), dogY, heading, nameOf,
// charPos?: (targetText)=>{x,z}|null, locationAnchor?: {x,z}|null }. charPos is
// optional and generic: when a shot's prose TARGET names a character the caller
// can actually resolve to a live world position (e.g. a cutscene-only prop like
// Dennis), the shot becomes a real two-shot (both dog and character framed
// together) instead of a pure dog-relative azimuth guess. locationAnchor is the
// beat's SET — a fixed point (e.g. the built location's key landmark) — used the
// same way for broad shots that name no specific character: without it, a "wide"
// shot orbits the dog alone regardless of where the scene is actually staged,
// so an authored location never reads on screen. charPos takes priority when
// both would apply. Callers/tests that omit either, or shots that resolve
// neither, get the original dog-only framing unchanged.
export function compileCutscene(cut, ctx = {}) {
  cut = cut || {};
  const dog0 = (ctx.getDog && ctx.getDog()) || { x: 0, z: 0 };
  const dy = ctx.dogY != null ? ctx.dogY : 0.35;
  const heading = ctx.heading || 0;
  const nameOf = ctx.nameOf;

  // Each shot keeps its motion profile and base azimuth rather than a baked
  // eye/look, so the framing can be re-evaluated every frame — both against
  // shot-local time (the move) and against a LIVE subject position (the dog can
  // now be staged to walk mid-shot, and the camera must follow it).
  const shots = (cut.camera || [])
    .slice()
    .sort((a, b) => (a.timing_seconds || 0) - (b.timing_seconds || 0))
    .map((c, i) => ({
      t: c.timing_seconds || 0,
      dur: 0,                                   // filled once the total is known
      m: motionFor(c.shot || ""),
      az: heading + Math.PI + i * GOLDEN,       // vary the side we shoot from
      seed: i * GOLDEN,
      cp: (ctx.charPos && ctx.charPos(c.target || ""))
        || (LOCATION_BIAS_SHOT.test((c.shot || "").toLowerCase()) ? (ctx.locationAnchor || null) : null),
      cues: stagingFor(c),
    }));

  const caps = (cut.dialogue || [])
    .slice().sort((a, b) => (a.timing_seconds || 0) - (b.timing_seconds || 0))
    .map((d) => ({ t: d.timing_seconds || 0, text: fmtLine(d, nameOf) }));

  const fx = (cut.effects || [])
    .slice().sort((a, b) => (a.timing_seconds || 0) - (b.timing_seconds || 0))
    .map((e) => ({ t: e.timing_seconds || 0, type: e.type || "" }));

  // Staging cues fire at their shot's start, flattened into one timed track so
  // the runner can treat them exactly like effects (fire-once + skip parity).
  const stage = [];
  for (const s of shots) for (const cue of s.cues) stage.push({ t: s.t, type: cue });

  const lastCue = Math.max(
    0,
    shots.length ? shots[shots.length - 1].t : 0,
    caps.length ? caps[caps.length - 1].t : 0,
    fx.length ? fx[fx.length - 1].t : 0,
  );
  // hold ~3.2s past the last cue so the final line can be read
  const dur = Math.max(cut.duration_estimate_seconds || 0, lastCue + 3.2);

  // A shot runs until the next one starts; the last runs out the clock. This is
  // what gives each move a duration to be eased across.
  for (let i = 0; i < shots.length; i++) {
    shots[i].dur = Math.max(0.1, (i + 1 < shots.length ? shots[i + 1].t : dur) - shots[i].t);
  }

  // Evaluate a shot's framing at absolute time `tAbs` against a live subject.
  function evalShot(s, tAbs, dogNow) {
    const dog = dogNow || dog0;
    const p = clamp01((tAbs - s.t) / s.dur);
    const e = smooth(p);
    const dist = s.m.d0 + (s.m.d1 - s.m.d0) * e;
    const height = s.m.h0 + (s.m.h1 - s.m.h0) * e;
    // sweep the arc symmetrically about the shot's base azimuth, so the shot
    // arrives at its framing rather than starting there
    const az = s.az + s.m.arc * (e - 0.5);
    // Two-shot: frame the dog/character MIDPOINT so both land in frame, instead
    // of purely orbiting the dog.
    const cx = s.cp ? (dog.x + s.cp.x) / 2 : dog.x;
    const cz = s.cp ? (dog.z + s.cp.z) / 2 : dog.z;
    // Handheld: a deterministic drift (no Math.random — the compiler stays pure
    // and the timeline stays replayable), scaled by the shot's own amplitude.
    const w = s.m.drift;
    return {
      eye: {
        x: cx + Math.sin(az) * dist + w * Math.sin(tAbs * 2.7 + s.seed),
        y: dy + height + w * 0.6 * Math.sin(tAbs * 3.9 + s.seed * 1.7),
        z: cz + Math.cos(az) * dist + w * Math.cos(tAbs * 2.1 + s.seed * 0.6),
      },
      look: { x: cx, y: dy + 0.3, z: cz },
    };
  }

  // Back-compat surface: `cams[i]` is still one entry per authored shot, and its
  // eye/look are that shot's OPENING framing (where the cut lands).
  const cams = shots.map((s) => ({ t: s.t, dur: s.dur, ...evalShot(s, s.t, null) }));

  const fallback = { t: 0, dur: Math.max(0.1, dur), m: DEFAULT_MOTION, az: heading + Math.PI, seed: 0, cp: null };

  return {
    dur, cams, caps, fx, stage, shots,
    // The camera at time t — a live point on the current shot's MOVE, not a
    // fixed key. `shot` is the index of the shot in play so the runner can hard
    // cut on a boundary instead of gliding the camera across the world.
    // `dogNow` is optional: pass the live subject when the dog is staged to move.
    cameraAt(t, dogNow) {
      let idx = -1;
      for (let i = 0; i < shots.length; i++) { if (shots[i].t <= t) idx = i; else break; }
      // before the first cue (t < shot[0].t) we're already on shot 0's frame
      const s = idx < 0 ? (shots[0] || fallback) : shots[idx];
      return { shot: idx < 0 ? 0 : idx, ...evalShot(s, t, dogNow) };
    },
    // latest caption at or before t ("" before the first line)
    captionAt(t) {
      let cur = "";
      for (let i = 0; i < caps.length; i++) { if (caps[i].t <= t) cur = caps[i].text; else break; }
      return cur;
    },
    // effects fired in (prevT, t] — so each fires exactly once as time advances
    effectsBetween(prevT, t) {
      const out = [];
      for (let i = 0; i < fx.length; i++) if (fx[i].t > prevT && fx[i].t <= t) out.push(fx[i].type);
      return out;
    },
    // all remaining effect types after prevT — used on skip for watch/skip parity
    effectsAfter(prevT) {
      const out = [];
      for (let i = 0; i < fx.length; i++) if (fx[i].t > prevT) out.push(fx[i].type);
      return out;
    },
    // staging cues fired in (prevT, t] — same fire-once contract as effects
    stagingBetween(prevT, t) {
      const out = [];
      for (let i = 0; i < stage.length; i++) if (stage[i].t > prevT && stage[i].t <= t) out.push(stage[i].type);
      return out;
    },
    // all remaining staging cues after prevT — applied in "instant" form on skip
    // so the world lands where a full watch would have left it
    stagingAfter(prevT) {
      const out = [];
      for (let i = 0; i < stage.length; i++) if (stage[i].t > prevT) out.push(stage[i].type);
      return out;
    },
  };
}
