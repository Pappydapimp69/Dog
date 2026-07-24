// scent.js — deterministic scent-trail field + Scent View for Dog Park 3D.
//
// The core new verb: the dog perceives the world scent-first. A moving scent
// SOURCE (a person, the dog itself, a carried object) lays down a trail of
// discrete deposit nodes; each node's strength decays every sim tick under the
// Ant System rule  tau <- (1 - rho) * tau  (+ a deposit delta when reinforced).
// Making rho (evaporation rate) PER-NODE is what turns tracking into a puzzle:
// exposed / rained-on nodes decay fast, sheltered nodes (under awnings, cars,
// doorways) persist — so following a trail becomes "find the next surviving
// anchor", not a straight line.
//   Source (brain): [SIMULATION / spatial-decay-fields / pheromone-style-per-cell-decay
//   / scent-trail-tracking] — ACO evaporation/deposit recurrence, per-cell rho
//   generalization. Sandbox-verified (exponential ratio, shelter divergence,
//   steady-state delta/rho).
//
// Determinism (brain [gamedev][state][coop] test#E2): the field ticks on a
// FIXED sim step, never on render dt, and uses no Math.random()/Date.now(). Same
// deposits + same tick count => identical field, so it is save/replay safe.
//
// This file's FIELD logic imports no three.js and is unit-testable in plain
// Node. Rendering is attached separately via attachRenderer(THREE, scene).

// ------------------------------------------------------------------ pure field

// One scent identity == one color lane. Kept as plain data so the field is
// engine-agnostic; the renderer maps id -> tint.
export const SCENT = {
  MAYA:  "maya",   // amber   — the woman with the treat
  ERROL: "errol",  // blue-gray — the man underneath her scent (memory)
  PARK:  "park",   // green   — cedar chips + a hundred dogs (the ball / the run)
  DOG:   "dog",    // faint   — the dog's own backtrail
};

const DEFAULTS = {
  tick: 0.25,            // sim seconds per field tick (fixed; decoupled from fps)
  floor: 0.04,           // below this a node is culled (illegible)
  depositTau: 1.0,       // strength of a fresh deposit
  reinforce: 0.6,        // added to an existing node when a source re-treads it
  depositStep: 1.6,      // world units a source travels before dropping a node
  mergeRadius: 1.2,      // deposits within this of a same-source node reinforce it
  rhoSheltered: 0.03,    // slow evaporation under cover
  rhoExposed: 0.16,      // faster in the open
  rhoRainBonus: 0.55,    // exposed rho scales up to +this*rain (rain erodes fast)
  maxNodesPerSource: 400,// bound cost; weakest pruned when exceeded (logged)
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const finite = (v, fb = 0) => (Number.isFinite(v) ? v : fb); // brain dog#E3: guard boundaries

export class ScentField {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    // nodes: flat array of {id,x,z,tau,rho,tau0}. Flat + per-frame linear scans
    // are fine at our node counts; a grid bucket can come later if profiling asks.
    this.nodes = [];
    this._acc = 0;          // sim-time accumulator toward the next fixed tick
    this._ticks = 0;        // total ticks advanced (determinism / debug)
    this._lastDeposit = {}; // id -> {x,z} last drop point, for depositStep spacing
    this.dropped = 0;       // total nodes pruned by the per-source cap (never silent)
  }

  reset() {
    this.nodes.length = 0;
    this._acc = 0; this._ticks = 0; this._lastDeposit = {}; this.dropped = 0;
  }

  // rho for a deposit given local cover (0 exposed .. 1 fully sheltered) and rain.
  _rho(shelter01, rain01) {
    const s = clamp01(finite(shelter01));
    const r = clamp01(finite(rain01));
    const exposed = this.cfg.rhoExposed + this.cfg.rhoRainBonus * r;
    // lerp exposed->sheltered by cover; sheltered spots ignore most of the rain.
    return exposed + (this.cfg.rhoSheltered - exposed) * s;
  }

  // Lay/reinforce scent for a source at a world point. shelter01: local cover,
  // rain01: current rain intensity. Returns the affected node (or null if the
  // source hasn't travelled depositStep since its last drop).
  deposit(id, x, z, shelter01 = 0, rain01 = 0, force = false) {
    x = finite(x); z = finite(z);
    const last = this._lastDeposit[id];
    if (!force && last) {
      const dx = x - last.x, dz = z - last.z;
      if (dx * dx + dz * dz < this.cfg.depositStep * this.cfg.depositStep) return null;
    }
    this._lastDeposit[id] = { x, z };
    const rho = this._rho(shelter01, rain01);

    // reinforce a nearby same-source node if one exists (steady state -> delta/rho)
    const mr2 = this.cfg.mergeRadius * this.cfg.mergeRadius;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.id !== id) continue;
      const dx = x - n.x, dz = z - n.z;
      if (dx * dx + dz * dz <= mr2) {
        n.tau += this.cfg.reinforce;
        n.rho = rho;                 // refresh to current conditions
        if (n.tau > n.tau0) n.tau0 = n.tau;
        return n;
      }
    }
    const node = { id, x, z, tau: this.cfg.depositTau, rho, tau0: this.cfg.depositTau };
    this.nodes.push(node);
    this._enforceCap(id);
    return node;
  }

  _enforceCap(id) {
    const cap = this.cfg.maxNodesPerSource;
    let count = 0;
    for (let i = 0; i < this.nodes.length; i++) if (this.nodes[i].id === id) count++;
    if (count <= cap) return;
    // prune the weakest nodes of this source until under cap.
    const mine = [];
    for (let i = 0; i < this.nodes.length; i++) if (this.nodes[i].id === id) mine.push(this.nodes[i]);
    mine.sort((a, b) => a.tau - b.tau);
    const toDrop = count - cap;
    const drop = new Set(mine.slice(0, toDrop));
    this.nodes = this.nodes.filter((n) => !drop.has(n));
    this.dropped += toDrop; // caller can surface this; never dropped silently
  }

  // Advance the field by real sim seconds. Applies whole fixed ticks; leftover
  // time accumulates for the next call (so variable fps stays deterministic).
  update(dtSeconds) {
    this._acc += finite(dtSeconds);
    let steps = 0;
    while (this._acc >= this.cfg.tick) { this._acc -= this.cfg.tick; steps++; }
    if (steps > 0) this._decay(steps);
    return steps;
  }

  _decay(steps) {
    const survivors = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      // tau <- (1-rho)^steps * tau  (exponential; steps folds N ticks into one)
      n.tau *= Math.pow(1 - n.rho, steps);
      if (n.tau >= this.cfg.floor) survivors.push(n);
    }
    this.nodes = survivors;
    this._ticks += steps;
  }

  // Aggregate strength of a source within radius of a point (0 if none).
  strengthAt(x, z, radius, id = null) {
    x = finite(x); z = finite(z);
    const r2 = radius * radius;
    let sum = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (id && n.id !== id) continue;
      const dx = x - n.x, dz = z - n.z;
      if (dx * dx + dz * dz <= r2) sum += n.tau;
    }
    return sum;
  }

  // Bearing toward the strongest nearby node of a source: {x,z} unit vector +
  // strength + distance, or null if nothing legible in range. This is the
  // follow-the-trail query AND the simplified "air scent toward a strong source".
  bearing(x, z, radius, id) {
    x = finite(x); z = finite(z);
    const r2 = radius * radius;
    let best = null, bestScore = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (id && n.id !== id) continue;
      const dx = n.x - x, dz = n.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      // prefer strong AND near: tau divided by (1 + distance)
      const d = Math.sqrt(d2);
      const score = n.tau / (1 + d);
      if (score > bestScore) { bestScore = score; best = { n, dx, dz, d }; }
    }
    if (!best) return null;
    const d = best.d || 1e-6;
    return { x: best.dx / d, z: best.dz / d, strength: best.n.tau, dist: best.d };
  }

  count(id = null) {
    if (!id) return this.nodes.length;
    let c = 0;
    for (let i = 0; i < this.nodes.length; i++) if (this.nodes[i].id === id) c++;
    return c;
  }

  // Serialize just enough to restore the field (determinism-friendly save).
  serialize() {
    return {
      t: this._ticks,
      n: this.nodes.map((n) => [n.id, +n.x.toFixed(3), +n.z.toFixed(3),
                                +n.tau.toFixed(4), +n.rho.toFixed(4), +n.tau0.toFixed(4)]),
    };
  }
  restore(data) {
    if (!data) return;
    this._ticks = data.t | 0;
    this.nodes = (data.n || []).map(([id, x, z, tau, rho, tau0]) =>
      ({ id, x, z, tau, rho, tau0 }));
  }
}

// ------------------------------------------------------------ render + control
// Browser-only factory (matches createTraffic/createCritters convention). THREE
// is INJECTED via opts so the field logic above stays Node-testable. Owns the
// field, a THREE.Points cloud for the "drifting motes" look, and the Scent View
// desaturation veil (#scent-veil, toggled like #cinema).
//
//   createScent(scene, audio, {
//     THREE, getDog:()=>Vector3, getRain:()=>0..1, shelterAt:(x,z)=>0..1,
//     maxPoints, field:{...ScentField opts}
//   }) -> { update, setView, emit, bearingTo, strengthOf, clearSource, view, ... }

const SRC_RGB = {
  maya:  [1.00, 0.72, 0.26], // amber
  errol: [0.55, 0.63, 0.80], // blue-gray
  park:  [0.44, 0.86, 0.46], // green
  dog:   [0.78, 0.80, 0.90], // faint
};

function dotTexture(THREE) {
  const s = 64, cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d");
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.7)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export function createScent(scene, audio, opts = {}) {
  const THREE = opts.THREE;
  if (!THREE) throw new Error("createScent needs opts.THREE");
  const getDog = opts.getDog || (() => ({ x: 0, z: 0 }));
  const getRain = opts.getRain || (() => 0);
  const shelterAt = opts.shelterAt || (() => 0);
  const field = new ScentField(opts.field);

  const MAX = opts.maxPoints || 2400;
  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage); colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("color", colAttr);
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({
    map: dotTexture(THREE), size: 0.95, sizeAttenuation: true,
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 3;
  scene.add(points);

  const veil = (typeof document !== "undefined") && document.getElementById("scent-veil");
  let viewOn = false;      // effective (rendered) state
  let keyView = false;     // per-frame key-driven request (world.js hold-F)
  let forceVal = null;     // cutscene override: true|false forces, null defers to key
  const depositTau = field.cfg.depositTau;

  function _apply() {
    const eff = forceVal !== null ? forceVal : keyView;
    if (eff === viewOn) return;
    viewOn = eff;
    points.visible = eff;
    if (veil) veil.classList.toggle("hidden", !eff);
  }
  // Per-frame, key-driven (world.js polls hold-F). Ignored while a force is set.
  function setView(on) { keyView = !!on; _apply(); }
  // Cutscene/scripted override: forceView(true|false) wins over the key,
  // forceView(null) releases back to key control. Lets a cutscene switch Scent
  // View on (awakening, recognition) or off (pound scent-silence) without the
  // per-frame key poll fighting it.
  function forceView(v) { forceVal = (v == null ? null : !!v); _apply(); }

  // Lay/reinforce a scent point for a source at a world point (narrative + dog).
  function emit(id, x, z, o = {}) {
    const shelter = (o.shelter != null) ? o.shelter : shelterAt(x, z);
    const rain = (o.rain != null) ? o.rain : getRain();
    return field.deposit(id, x, z, shelter, rain, !!o.force);
  }
  // Follow query: unit bearing to the strongest nearby node of a source.
  function bearingTo(id, radius = 40) {
    const p = getDog(); return field.bearing(p.x, p.z, radius, id);
  }
  // Local strength of a source near the dog (for "am I on the trail / how hot").
  function strengthOf(id, radius = 6) {
    const p = getDog(); return field.strengthAt(p.x, p.z, radius, id);
  }
  function clearSource(id) {
    field.nodes = field.nodes.filter((n) => n.id !== id);
    delete field._lastDeposit[id];
  }

  function update(dt, time) {
    field.update(dt);                 // fixed-tick decay (deterministic)
    const p = getDog();
    if (p) emit("dog", p.x, p.z);     // the dog's own faint backtrail
    if (!viewOn) return;
    let i = 0;
    const nodes = field.nodes;
    for (let k = 0; k < nodes.length && i < MAX; k++) {
      const n = nodes[k];
      const rgb = SRC_RGB[n.id] || SRC_RGB.dog;
      let b = n.tau / depositTau; if (b > 1) b = 1; if (b < 0.08) b = 0.08;
      const y = 0.32 + 0.14 * Math.sin(time * 1.1 + i * 0.7); // scent hanging in air
      const j = i * 3;
      positions[j] = n.x; positions[j + 1] = y; positions[j + 2] = n.z;
      colors[j] = rgb[0] * b; colors[j + 1] = rgb[1] * b; colors[j + 2] = rgb[2] * b;
      i++;
    }
    geo.setDrawRange(0, i);
    posAttr.needsUpdate = true; colAttr.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  return {
    update, setView, forceView, emit, bearingTo, strengthOf, clearSource, field, SCENT,
    get view() { return viewOn; },
    serialize: () => field.serialize(),
    restore: (d) => field.restore(d),
    _debug: () => ({ view: viewOn, nodes: field.nodes.length,
                     drawn: geo.drawRange.count, dropped: field.dropped }),
  };
}
