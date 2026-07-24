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
// This compiler is PURE (plain {x,y,z} out, no THREE) and Node-testable. The
// runner + effect handlers live in game.js, reusing the letterbox, the
// _cutsceneCam camera channel, control-freeze, and skip that already exist.

const TAU = Math.PI * 2;
const GOLDEN = 2.399963229728653; // golden angle — varies azimuth per shot

// Framing for a shot: distance + height off the (frozen) dog, azimuth varied by
// shot index so consecutive shots aren't identical. Keeps the dog on screen.
function frame(shotStr, dog, dy, heading, i) {
  const s = (shotStr || "").toLowerCase();
  let dist = 5, height = 2.4;
  if (/extreme close/.test(s)) { dist = 1.5; height = 0.55; }
  else if (/high wide|overhead|pull-?up|rising|aerial/.test(s)) { dist = 3.5; height = 8.5; }
  else if (/wide/.test(s)) { dist = 9; height = 4; }
  else if (/dog.?s.?eye|low angle|floor|bench level|insert/.test(s)) { dist = 2.4; height = 0.45; }
  else if (/close/.test(s)) { dist = 2.5; height = 1.0; }
  else if (/medium|two-?shot|reverse/.test(s)) { dist = 4; height = 1.7; }
  else if (/tracking|dolly|handheld/.test(s)) { dist = 4.5; height = 1.5; }
  else if (/push-?in/.test(s)) { dist = 3; height = 1.2; }
  const az = heading + Math.PI + i * GOLDEN;
  return {
    eye: { x: dog.x + Math.sin(az) * dist, y: dy + height, z: dog.z + Math.cos(az) * dist },
    look: { x: dog.x, y: dy + 0.3, z: dog.z },
  };
}

function fmtLine(d, nameOf) {
  const line = (d && d.line) || "";
  const sp = d && d.speaker;
  if (!sp || sp === "NARRATION") return line;               // narration: bare text
  const nm = (nameOf && nameOf(sp)) || sp;
  return `${nm}: ${line}`;
}

// cut: a beat's `cutscene` block. ctx: { getDog:()=>({x,z}), dogY, heading, nameOf }.
export function compileCutscene(cut, ctx = {}) {
  cut = cut || {};
  const dog = (ctx.getDog && ctx.getDog()) || { x: 0, z: 0 };
  const dy = ctx.dogY != null ? ctx.dogY : 0.35;
  const heading = ctx.heading || 0;
  const nameOf = ctx.nameOf;

  const cams = (cut.camera || [])
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => (a.c.timing_seconds || 0) - (b.c.timing_seconds || 0))
    .map(({ c }, i) => ({ t: c.timing_seconds || 0, ...frame(c.shot || "", dog, dy, heading, i) }));

  const caps = (cut.dialogue || [])
    .slice().sort((a, b) => (a.timing_seconds || 0) - (b.timing_seconds || 0))
    .map((d) => ({ t: d.timing_seconds || 0, text: fmtLine(d, nameOf) }));

  const fx = (cut.effects || [])
    .slice().sort((a, b) => (a.timing_seconds || 0) - (b.timing_seconds || 0))
    .map((e) => ({ t: e.timing_seconds || 0, type: e.type || "" }));

  const lastCue = Math.max(
    0,
    cams.length ? cams[cams.length - 1].t : 0,
    caps.length ? caps[caps.length - 1].t : 0,
    fx.length ? fx[fx.length - 1].t : 0,
  );
  // hold ~3.2s past the last cue so the final line can be read
  const dur = Math.max(cut.duration_estimate_seconds || 0, lastCue + 3.2);

  const fallbackCam = frame("medium", dog, dy, heading, 0);

  return {
    dur, cams, caps, fx,
    // latest camera key at or before t (world.js eases between keys)
    cameraAt(t) {
      let cur = cams.length ? cams[0] : fallbackCam;
      for (let i = 0; i < cams.length; i++) { if (cams[i].t <= t) cur = cams[i]; else break; }
      return cur;
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
  };
}
