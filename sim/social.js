// The social exchange — one engine, both directions.
//
// brain (symmetric-social-exchange-object-same-engine-for-player-and-npc): model
// interaction as a first-class object any two agents can be the subject of, not
// a player-facing system with a bolted-on NPC-NPC variant. Comme il Faut (Prom
// Week) evaluates every exchange through the same declarative considerations
// regardless of who is involved — so NPC-to-NPC gossip needs no separate code
// path, it is the same call with different arguments.
//
// That is why the player here is just an agent id. Everything the player can do,
// the town can do to each other, using this file.
//
// Scoring follows the utility-AI kernels:
//  * each consideration passes its raw input through its OWN response curve
//    (decoupling "what the input means" from "how much it matters"), and
//  * scores COMBINE BY MULTIPLICATION, not addition, so any single 0.0 is a
//    true veto — with addition, "this person isn't here" can be outvoted by an
//    unrelated high score and the agent does something impossible.

export const curves = {
  linear: (x) => x,
  quadratic: (x) => x * x,
  inverse: (x) => 1 - x,
  logistic: (x) => 1 / (1 + Math.exp(-12 * (x - 0.5))),
  step: (t) => (x) => (x >= t ? 1 : 0),
};

/** A consideration is {name, input(ctx) -> 0..1, curve}. */
export function score(considerations, ctx) {
  let total = 1;
  for (const c of considerations) {
    const raw = Math.max(0, Math.min(1, c.input(ctx)));
    const v = c.curve(raw);
    if (v <= 0) return 0;          // veto — stop early, the action is impossible
    total *= v;
  }
  return total;
}

/**
 * The exchanges any two agents can have. Symmetric by construction: `ctx` names
 * an initiator and a target and nothing in here asks which one is the player.
 */
// Curve choice matters more than it looks. An early version scored "motivated"
// as logistic(|opinion|); opinions in a young town sit around 0.15, logistic is
// centred on 0.5, so it returned ~0.01 — and because considerations MULTIPLY,
// that one number vetoed every share in the game. The rumour never left the
// first person it was told to. Response curves have to be sighted on the range
// the input actually occupies, not on 0..1 in the abstract.
export const EXCHANGES = [
  {
    id: "share-rumor",
    considerations: [
      // must actually be carrying something to share
      { name: "has-rumor", input: (c) => (c.carrying.length ? 1 : 0), curve: curves.linear },
      // must be co-located — the anti-broadcast rule, as a veto
      { name: "co-located", input: (c) => (c.sameePlace ? 1 : 0), curve: curves.linear },
      // and they must not already be carrying it. A veto here rather than a
      // post-hoc check so the score reflects the real chance of the exchange.
      { name: "is-news", input: (c) => (c.novel ? 1 : 0), curve: curves.linear },
      // strangers exchange less than acquaintances, but not nothing — a town
      // where only friends talk never spreads anything
      { name: "acquainted", input: (c) => 0.25 + 0.75 * c.strength, curve: curves.linear },
      // the juicier the claim, the more it wants telling
      { name: "juicy", input: (c) => Math.abs(c.juiciness), curve: curves.linear },
      { name: "chatty", input: (c) => c.initiator.traits.gossip, curve: curves.linear },
    ],
  },
  {
    id: "confide",
    considerations: [
      { name: "co-located", input: (c) => (c.sameePlace ? 1 : 0), curve: curves.linear },
      { name: "close", input: (c) => Math.max(0, c.opinion), curve: curves.step(0.2) },
      { name: "trusting", input: (c) => c.initiator.traits.trust, curve: curves.quadratic },
    ],
  },
  {
    id: "confront",
    considerations: [
      { name: "co-located", input: (c) => (c.sameePlace ? 1 : 0), curve: curves.linear },
      // a real grievance, not a mild one — the step is the threshold for
      // "this is worth a scene in public"
      { name: "grievance", input: (c) => Math.max(0, -c.opinion), curve: curves.step(0.3) },
      { name: "bold", input: (c) => c.initiator.traits.boldness, curve: curves.quadratic },
    ],
  },
];

/**
 * Pick the best exchange for this pair, or null if none clears the floor.
 *
 * Consumes NO randomness at all — selection is a pure function of state, so
 * adding an exchange type cannot shift anyone else's RNG stream.
 */
export function bestExchange(ctx, floor = 0.08) {
  let best = null, bestScore = floor;
  for (const ex of EXCHANGES) {
    const s = score(ex.considerations, ctx);
    if (s > bestScore) { bestScore = s; best = ex; }
  }
  return best ? { exchange: best, score: bestScore } : null;
}
