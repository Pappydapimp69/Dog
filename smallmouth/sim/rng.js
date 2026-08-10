// Seeded PRNG — the authoritative sim's only source of randomness.
//
// Two rules from brain, both learned the hard way on other projects:
//
//  1. PER-STREAM, never one shared stream. A single global stream couples every
//     probabilistic outcome to every other RNG consumer in the world, so an
//     unrelated content change (gating one NPC behind a condition) silently
//     shifts the whole sequence and flips tests that had nothing to do with it
//     (the-game-the-answering-deep#E3). Each agent — and each named subsystem —
//     draws from its own stream, so adding a townsperson cannot perturb the
//     rumours already in flight.
//
//  2. Save the RAW STATE WORDS, not a "how many times we've called it" count.
//     A count forces an O(n) replay to restore; the words restore in O(1) and
//     cannot drift.
//
// sfc32: small, fast, well-distributed, and trivially serialisable as four
// uint32s. No Math.random, no Date.now, nothing transcendental — see
// scripts/guard-sim.mjs, which fails the build if any creep in.

const FNV_OFFSET = 2166136261;

/** Deterministic 32-bit string hash — turns a stream name into a seed. */
export function hashString(str) {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  constructor(a, b, c, d) {
    this.a = a >>> 0; this.b = b >>> 0; this.c = c >>> 0; this.d = d >>> 0;
  }

  /** Derive an independent stream from a world seed + a stable name. */
  static forStream(worldSeed, name) {
    const h = hashString(`${worldSeed}::${name}`);
    // Spread the single hash across four words so streams that differ only in
    // their name still start far apart in the state space.
    return new Rng(h, hashString(`a${name}`) ^ worldSeed, hashString(`b${name}`), (h ^ 0x9e3779b9) >>> 0);
  }

  /** float in [0,1) */
  next() {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.d = (this.d + 1) >>> 0;
    t = (t + this.d) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t / 4294967296;
  }

  /** integer in [0,n) */
  int(n) { return Math.floor(this.next() * n); }

  /** uniformly pick one element (returns undefined for an empty list) */
  pick(list) { return list.length ? list[this.int(list.length)] : undefined; }

  /** O(1) save/restore — the four raw words, nothing derived. */
  save() { return [this.a, this.b, this.c, this.d]; }
  static restore(words) { return new Rng(words[0], words[1], words[2], words[3]); }
}

/**
 * A named collection of independent streams.
 *
 * `roll()` always consumes exactly ONE value from exactly one stream, which is
 * what lets a decision guarantee a constant number of draws regardless of which
 * branch it takes (the-game-the-waiting-city#E9) — a decision that draws only
 * on the "success" path desynchronises every later replay.
 */
export class Streams {
  constructor(worldSeed, saved = null) {
    this.worldSeed = worldSeed >>> 0;
    this.map = new Map();
    if (saved) for (const [name, words] of Object.entries(saved)) this.map.set(name, Rng.restore(words));
  }
  get(name) {
    let r = this.map.get(name);
    if (!r) { r = Rng.forStream(this.worldSeed, name); this.map.set(name, r); }
    return r;
  }
  roll(name) { return this.get(name).next(); }
  save() {
    const out = {};
    for (const k of [...this.map.keys()].sort()) out[k] = this.map.get(k).save();
    return out;
  }
}
