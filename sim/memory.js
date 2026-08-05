// NPC memory — what a townsperson knows, and what they can still bring to mind.
//
// Built directly from three brain kernels, kept separable because each is
// independently useful:
//
//  * recency-weighted-retrieval-score — Generative Agents (Park et al. 2023):
//    score = w·recency + w·importance + w·relevance, each min-max normalised,
//    recency decaying exponentially (0.995^hours) and RESETTING on access. The
//    reset is the interesting half: recalling something keeps it recallable, so
//    what a person keeps bringing up stays available and the rest sinks.
//
//  * consolidation-via-hierarchical-reflection — bound growth by ABSTRACTING,
//    not deleting. When accumulated importance since the last reflection crosses
//    a threshold, emit a summary memory that sits ABOVE the raw events and is
//    itself retrievable. Nothing is ever destroyed, so a rumour's chain of
//    custody survives even after the details stop surfacing.
//
//  * practical-guardrails-at-scale — decay with a FLOOR and hysteresis rather
//    than pure exponential (Sims 4: strong bonds go sticky past a threshold),
//    plus asymmetric retention: some events must never fade at all.
//
// That last one is where Nemesis comes in — see PIVOTAL below.

export const DECAY_PER_HOUR = 0.995;   // Generative Agents' published factor
export const REFLECT_THRESHOLD = 12;   // cumulative importance before consolidating
export const STICKY_ABOVE = 0.85;      // importance past which a memory stops decaying

/**
 * Kinds of memory that never decay, whatever the clock says.
 *
 * brain (non-decaying-pivotal-events-scoped-per-relationship): the Nemesis
 * System stores discrete, tagged, per-orc encounter events that persist
 * INDEFINITELY and only change via a NEW encounter, never via passive time
 * decay. A betrayal is not a number that drifts back to neutral because a week
 * went by — it stays exactly as sharp until something else happens between
 * those two people. This is what stops the town from politely forgetting.
 */
export const PIVOTAL = new Set(["betrayed", "defended", "humiliated", "kept-secret"]);

let _nextId = 1;
export function resetMemoryIds() { _nextId = 1; } // tests only — keeps ids stable

export class MemoryStream {
  constructor() {
    this.entries = [];        // {id, kind, subject, text, importance, at, lastAccess, tags, pivotal}
    this.sinceReflection = 0;
  }

  /**
   * @param at        world hour the event happened
   * @param importance 0..1 — how much this mattered to THIS agent
   */
  add({ kind, subject, text, importance, at, tags = [] }) {
    const pivotal = PIVOTAL.has(kind);
    const e = {
      id: _nextId++, kind, subject, text,
      importance: Math.max(0, Math.min(1, importance)),
      at, lastAccess: at, tags, pivotal, reflection: false,
    };
    this.entries.push(e);
    this.sinceReflection += e.importance;
    return e;
  }

  /** Exponential recency, but pivotal memories are exempt entirely. */
  recency(e, now) {
    if (e.pivotal) return 1;
    if (e.importance >= STICKY_ABOVE) return 1;      // sticky floor
    const hours = Math.max(0, now - e.lastAccess);
    return Math.pow(DECAY_PER_HOUR, hours);
  }

  /**
   * Retrieve the top-k memories for a situation.
   *
   * Accessing a memory RESETS its recency (lastAccess = now) — that is the
   * mechanism, not a side effect, so callers must pass the real clock.
   */
  retrieve(now, { subject = null, tags = [], k = 3 } = {}) {
    if (!this.entries.length) return [];
    const scored = this.entries.map((e) => {
      const rec = this.recency(e, now);
      let rel = 0;
      if (subject && e.subject === subject) rel += 0.6;
      if (tags.length && e.tags.some((t) => tags.includes(t))) rel += 0.4;
      return { e, rec, imp: e.importance, rel };
    });
    // min-max normalise each term independently, per the source architecture
    const norm = (get) => {
      const vals = scored.map(get);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const span = hi - lo;
      return (v) => (span < 1e-9 ? (hi > 0 ? 1 : 0) : (v - lo) / span);
    };
    const nRec = norm((s) => s.rec), nImp = norm((s) => s.imp), nRel = norm((s) => s.rel);
    for (const s of scored) s.score = nRec(s.rec) + nImp(s.imp) + nRel(s.rel);
    scored.sort((a, b) => (b.score - a.score) || (a.e.id - b.e.id)); // id tiebreak = deterministic
    const out = scored.slice(0, k).map((s) => s.e);
    for (const e of out) e.lastAccess = now;   // the reset
    return out;
  }

  /** True when enough has happened to be worth abstracting. */
  needsReflection() { return this.sinceReflection >= REFLECT_THRESHOLD; }

  /**
   * Abstract — never delete. The summary becomes its own retrievable memory
   * sitting above the raw events, and the raws stay put underneath it.
   */
  reflect(now) {
    if (!this.needsReflection()) return null;
    const recent = this.entries.filter((e) => !e.reflection).slice(-8);
    const bySubject = new Map();
    for (const e of recent) {
      if (!e.subject) continue;
      bySubject.set(e.subject, (bySubject.get(e.subject) || 0) + e.importance);
    }
    let top = null, best = -1;
    for (const k of [...bySubject.keys()].sort()) {
      if (bySubject.get(k) > best) { best = bySubject.get(k); top = k; }
    }
    this.sinceReflection = 0;
    if (!top) return null;
    const e = this.add({
      kind: "reflection", subject: top,
      text: `has been thinking a lot about ${top}`,
      importance: Math.min(1, 0.4 + best / REFLECT_THRESHOLD), at: now,
      tags: ["reflection"],
    });
    e.reflection = true;
    this.sinceReflection = 0;   // add() re-incremented it
    return e;
  }

  serialize() {
    return {
      sinceReflection: Number(this.sinceReflection.toFixed(6)),
      entries: this.entries.map((e) => ({
        id: e.id, kind: e.kind, subject: e.subject, importance: Number(e.importance.toFixed(6)),
        at: e.at, lastAccess: e.lastAccess, pivotal: e.pivotal, reflection: e.reflection,
        tags: [...e.tags].sort(), text: e.text,
      })),
    };
  }
}
