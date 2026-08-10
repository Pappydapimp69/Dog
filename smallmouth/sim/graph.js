// The relationship graph — who knows whom, how well, and how an opinion moves.
//
// Two brain kernels do the work here:
//
//  * sparse-event-triggered-relationship-graph — only simulate the PAIRS that
//    have actually interacted. The Nemesis System keeps orc-to-orc relationships
//    on the small set of pairs with a triggering encounter, not on the full
//    n² grid. In a 14-person town n² is only 91 pairs and we could brute-force
//    it, but the sparse form is what makes the town's shape legible: an edge
//    exists because something HAPPENED, so the graph is a history, not a matrix.
//
//  * graph-distance-bounded-opinion-propagation — when A's opinion of B moves,
//    propagate along RELATIONSHIP edges for one or two hops, not to everyone in
//    earshot and not by physical distance. Crusader Kings' "mutual acquaintances"
//    does exactly this: people who share a direct relation to the affected party
//    get a derived modifier, the rest of the world never hears about it.
//
// Opinion decay follows the guardrail kernel: pull toward baseline, but stop
// once |opinion| passes STICKY — strong feelings become sticky rather than
// drifting back to polite neutrality.

export const STICKY = 0.6;
export const DECAY_TOWARD_ZERO = 0.02;   // per day, below the sticky threshold
export const HOP_FALLOFF = 0.35;         // how much of a shift survives one hop
export const MAX_HOPS = 2;

/**
 * How far ambient gossip alone can move an opinion.
 *
 * brain (dog#E50): when a diffusion system (gossip/reputation/morale) writes to
 * a score that ALSO gates behaviour, band its contribution to a range strictly
 * INSIDE the gating thresholds, and treat firsthand values as the authoritative
 * source. Otherwise the single knob is over- and under-powered at once.
 *
 * Here the gate is `confront`, which needs a grievance of 0.3. So hearsay tops
 * out at 0.25 and can never, on its own, make someone start a scene in public —
 * being told a story about a man is not the same as being wronged by him. What
 * crosses the line is always something that happened to you directly.
 */
export const GOSSIP_BAND = 0.25;

const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const key = (a, b) => `${a}|${b}`;

export class SocialGraph {
  constructor() {
    this.edges = new Map();   // "a|b" -> {opinion, gossip, direct, strength, events}
  }

  /** Directed: how A feels about B. Creating on demand IS the sparse rule. */
  edge(a, b, create = true) {
    const k = key(a, b);
    let e = this.edges.get(k);
    if (!e && create) {
      e = { opinion: 0, gossip: 0, direct: 0, strength: 0, events: 0 };
      this.edges.set(k, e);
    }
    return e;
  }

  /** opinion is always the sum of its two channels — never written directly. */
  static recompute(e) {
    e.opinion = clamp(e.gossip + e.direct);
    return e;
  }

  /** Set the firsthand channel outright (tests, and seeding). */
  setDirect(a, b, v) { const e = this.edge(a, b); e.direct = clamp(v); return SocialGraph.recompute(e); }

  opinionOf(a, b) {
    const e = this.edges.get(key(a, b));
    return e ? e.opinion : 0;
  }

  /** Everyone A has an actual edge to — A's acquaintances, in stable order. */
  neighbours(a) {
    const out = [];
    for (const k of this.edges.keys()) {
      const [from, to] = k.split("|");
      if (from === a) out.push(to);
    }
    return out.sort();
  }

  /** Record that two people interacted at all — this is what creates the edge. */
  touch(a, b, strengthDelta = 0.05) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const e = this.edge(x, y);
      e.strength = Math.min(1, e.strength + strengthDelta);
      e.events++;
    }
  }

  /** Apply `delta` to one channel of an edge, respecting that channel's band. */
  #apply(a, b, delta, channel) {
    const e = this.edge(a, b);
    if (channel === "firsthand") e.direct = clamp(e.direct + delta);
    else e.gossip = clamp(e.gossip + delta, -GOSSIP_BAND, GOSSIP_BAND);
    return SocialGraph.recompute(e);
  }

  /**
   * Shift A's opinion of B, then let it ripple outward along A's edges.
   *
   * The ripple is bounded by HOP COUNT through the graph, so a shift only
   * reaches people who already have a relationship path to the person it is
   * about. Someone with no edges hears nothing, however loud the event.
   *
   * `channel` picks which of the two bands the shift lands in — "gossip"
   * (ambient, capped at GOSSIP_BAND) or "firsthand" (something that happened to
   * this person, uncapped). The ripple is ALWAYS gossip, whatever the source:
   * secondhand knowledge of a firsthand event is still secondhand.
   */
  shift(a, b, delta, hops = MAX_HOPS, channel = "gossip") {
    this.#apply(a, b, delta, channel);
    if (hops <= 0 || Math.abs(delta) < 0.01) return;
    const carried = delta * HOP_FALLOFF;
    for (const n of this.neighbours(a)) {
      if (n === b || n === a) continue;
      // n hears A's view of B, weighted by how much n actually cares about A
      const trust = Math.max(0, this.opinionOf(n, a));
      const amount = carried * (0.3 + 0.7 * trust);
      if (Math.abs(amount) < 0.01) continue;
      this.#apply(n, b, amount, "gossip");
    }
  }

  /**
   * Move A's firsthand feeling about B toward neutral, never past it.
   *
   * This is what a public row actually does to the person who started it: they
   * have had their say and some of the grievance is spent. brain (dog#E41): a
   * lifecycle needs a DECAY term, not a balanced one — without this, confronting
   * someone deepened the grudge that caused it and the pair locked into an
   * identical scene every hour they shared a room, forever.
   */
  discharge(a, b, amount) {
    const e = this.edge(a, b);
    e.direct = e.direct > 0 ? Math.max(0, e.direct - amount) : Math.min(0, e.direct + amount);
    return SocialGraph.recompute(e);
  }

  /** Daily drift toward neutral — with the sticky floor from the guardrails kernel. */
  decayDay() {
    for (const e of this.edges.values()) {
      // Hearsay always fades; that is what makes it hearsay.
      e.gossip = e.gossip > 0 ? Math.max(0, e.gossip - DECAY_TOWARD_ZERO)
                              : Math.min(0, e.gossip + DECAY_TOWARD_ZERO);
      if (Math.abs(e.direct) < STICKY) {                // strong bonds are sticky
        e.direct = e.direct > 0 ? Math.max(0, e.direct - DECAY_TOWARD_ZERO)
                                : Math.min(0, e.direct + DECAY_TOWARD_ZERO);
      }
      SocialGraph.recompute(e);
    }
  }

  serialize() {
    const out = {};
    for (const k of [...this.edges.keys()].sort()) {
      const e = this.edges.get(k);
      out[k] = {
        opinion: Number(e.opinion.toFixed(6)),
        gossip: Number(e.gossip.toFixed(6)),
        direct: Number(e.direct.toFixed(6)),
        strength: Number(e.strength.toFixed(6)), events: e.events,
      };
    }
    return out;
  }
}
