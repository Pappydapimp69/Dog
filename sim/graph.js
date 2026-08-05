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

const key = (a, b) => `${a}|${b}`;

export class SocialGraph {
  constructor() {
    this.edges = new Map();   // "a|b" -> {opinion, strength, events}
  }

  /** Directed: how A feels about B. Creating on demand IS the sparse rule. */
  edge(a, b, create = true) {
    const k = key(a, b);
    let e = this.edges.get(k);
    if (!e && create) { e = { opinion: 0, strength: 0, events: 0 }; this.edges.set(k, e); }
    return e;
  }

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

  /**
   * Shift A's opinion of B, then let it ripple outward along A's edges.
   *
   * The ripple is bounded by HOP COUNT through the graph, so a shift only
   * reaches people who already have a relationship path to the person it is
   * about. Someone with no edges hears nothing, however loud the event.
   */
  shift(a, b, delta, hops = MAX_HOPS) {
    const e = this.edge(a, b);
    e.opinion = Math.max(-1, Math.min(1, e.opinion + delta));
    if (hops <= 0 || Math.abs(delta) < 0.01) return;
    const carried = delta * HOP_FALLOFF;
    for (const n of this.neighbours(a)) {
      if (n === b || n === a) continue;
      // n hears A's view of B, weighted by how much n actually cares about A
      const trust = Math.max(0, this.opinionOf(n, a));
      const amount = carried * (0.3 + 0.7 * trust);
      if (Math.abs(amount) < 0.01) continue;
      const ne = this.edge(n, b);
      ne.opinion = Math.max(-1, Math.min(1, ne.opinion + amount));
    }
  }

  /** Daily drift toward neutral — with the sticky floor from the guardrails kernel. */
  decayDay() {
    for (const e of this.edges.values()) {
      if (Math.abs(e.opinion) >= STICKY) continue;      // strong bonds are sticky
      if (e.opinion > 0) e.opinion = Math.max(0, e.opinion - DECAY_TOWARD_ZERO);
      else if (e.opinion < 0) e.opinion = Math.min(0, e.opinion + DECAY_TOWARD_ZERO);
    }
  }

  serialize() {
    const out = {};
    for (const k of [...this.edges.keys()].sort()) {
      const e = this.edges.get(k);
      out[k] = { opinion: Number(e.opinion.toFixed(6)), strength: Number(e.strength.toFixed(6)), events: e.events };
    }
    return out;
  }
}
