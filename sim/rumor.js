// Rumours — the game's only real currency.
//
// brain (rumor-as-traveling-token-not-broadcast): model a rumour as a discrete
// TOKEN attached to a specific agent, never as information that becomes globally
// true the instant it happens. Dwarf Fortress requires an NPC to have either
// witnessed an event or been told by someone who did, and further spread
// requires that NPC to physically travel and meet someone. Kill every witness
// before they leave and propagation stops dead, because there is no omniscient
// broadcast layer underneath.
//
// That constraint is the whole game. You cannot "tell the town" anything. You
// can tell ONE person, in a place, at an hour, and then it is out of your hands.
//
// Mutation on retelling is the second half. A token carries a `distortion` that
// grows each hop, and past a threshold the claim itself changes — which is how a
// true thing arrives somewhere as a false one without anybody lying.

export const DISTORT_PER_HOP = 0.18;
export const MUTATE_ABOVE = 0.5;

let _nextId = 1;
export function resetRumorIds() { _nextId = 1; }

/**
 * @param claim   {about, kind, valence}  what is being said about whom
 * @param origin  agent id who first said it (the player is just another id)
 */
export function makeRumor({ claim, origin, at }) {
  return {
    id: _nextId++,
    claim: { ...claim },
    origin,
    bornAt: at,
    distortion: 0,
    hops: 0,
    chain: [origin],        // chain of custody — who carried it, in order
    mutated: false,
  };
}

/**
 * Hand a rumour on. Returns a NEW token — the teller keeps theirs, because
 * having told someone doesn't make you forget.
 *
 * `roll` must be a single pre-drawn value in [0,1). Taking it as an argument
 * rather than drawing inside keeps the caller's roll budget constant regardless
 * of whether the rumour happens to mutate (brain: a decision that draws only on
 * one branch desynchronises replay).
 */
export function retell(token, to, at, roll) {
  const next = {
    ...token,
    claim: { ...token.claim },
    distortion: token.distortion + DISTORT_PER_HOP,
    hops: token.hops + 1,
    chain: [...token.chain, to],
  };
  if (next.distortion >= MUTATE_ABOVE && roll < next.distortion) {
    next.mutated = true;
    // The claim drifts: valence sharpens away from the truth, and a "saw"
    // becomes a "heard they" — the shape of how stories actually degrade.
    next.claim.valence = Math.max(-1, Math.min(1,
      next.claim.valence + (next.claim.valence >= 0 ? 0.35 : -0.35)));
    next.claim.kind = next.claim.kind === "witnessed" ? "secondhand" : next.claim.kind;
  }
  return next;
}

/** How much this token still resembles what was originally said. */
export function fidelity(token) {
  return Math.max(0, 1 - token.distortion);
}

/** Half-life, in hours, of a piece of news being worth repeating at all. */
export const NEWS_HALFLIFE = 20;

/**
 * How much this is still worth telling anyone.
 *
 * Without this the town saturates: over a 7-day week every seed pushed the
 * rumour to all 8 people, so WHO you told made no difference and there was no
 * game in the choice. Gossip has a shelf life — a week-old story is not worth
 * the breath, so a rumour handed to someone who rarely meets anyone dies with
 * them. That failure mode is the thing that makes the opening move a decision.
 */
export function newsworthiness(token, now) {
  return Math.pow(0.5, Math.max(0, now - token.bornAt) / NEWS_HALFLIFE);
}

export function serializeRumor(t) {
  return {
    id: t.id, origin: t.origin, bornAt: t.bornAt, hops: t.hops,
    distortion: Number(t.distortion.toFixed(6)), mutated: t.mutated,
    chain: [...t.chain],
    claim: { about: t.claim.about, kind: t.claim.kind, valence: Number(t.claim.valence.toFixed(6)) },
  };
}
