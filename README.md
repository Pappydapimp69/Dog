# Smallmouth

A village where the only verb is *telling*.

You get one week and one sentence. You can say it to exactly one person, in one
place, at one hour — and then it is out of your hands. It travels because people
carry it, it changes because people retell it, and by Sunday the town believes
something you did not write.

**Milestone 1 is the simulation, in a terminal.** No renderer, no art, no
browser. Brain's `E1 · sim-before-render` kernel says prove the loop as text
first: if the town isn't interesting to read, no amount of art will save it.

```
node run.mjs                 # a week in the town
node run.mjs --seed 99       # a different week
node --test tests_sim.mjs    # the gate
```

## What's actually simulated

Nothing here is a bespoke story system. Every piece is a documented technique,
pulled from the `NPC-SIM` cluster in Brain's idea repository — 23 kernels that
had been researched and never built by anything.

**Rumours are tokens, not broadcasts.** *(Dwarf Fortress)* A rumour is a discrete
object attached to one person. To spread, that person has to physically be
somewhere with someone else. There is no global "the town now knows" layer, so
a story handed to a recluse dies with them. This is the constraint the whole
game hangs off.

**Retelling degrades.** A token carries a `distortion` that grows each hop; past
a threshold the claim itself mutates — a *witnessing* becomes a *hearsay*, and
the charge sharpens away from the truth. A true thing arrives somewhere false
without anyone having lied.

**News has a shelf life.** Worth-repeating decays with a ~20-hour half-life.
Without this the town saturated on every seed from every starting person, and
the opening move was decorative. Now a badly-chosen confidant lets the story die
short of the whole town — which is what makes it a decision.

**Memory is scored, not stored.** *(Generative Agents, Park et al. 2023)*
Retrieval weighs recency + importance + relevance, each min-max normalised, with
recency decaying exponentially and **resetting on access** — so what a person
keeps bringing up stays available and everything else sinks.

**Consolidation abstracts, never deletes.** Once accumulated importance crosses a
threshold an NPC emits a *reflection* that sits above the raw events and is
itself retrievable. Chains of custody survive even after the details stop
surfacing.

**Some things never fade.** *(Nemesis System)* Betrayals, humiliations and kept
secrets are tagged pivotal and are exempt from decay entirely. A grudge is
exactly as sharp a year later. Everything else drifts toward neutral — but stops
drifting once it's strong enough, so real bonds go sticky rather than politely
dissolving.

**Opinion travels by graph, not by earshot.** *(Crusader Kings)* When A's view of
B moves, it propagates along existing relationship edges for two hops, weighted
by how much each listener actually trusts the speaker. Someone with no edges
hears nothing however loud the week was.

**One engine, both directions.** *(Comme il Faut / Prom Week)* A social exchange
is a symmetric object any two agents can be the subject of. The player is just
an agent id — everything you can do, the town does to each other, through the
same code path. NPC-to-NPC gossip needed no separate system.

**Decisions are utility-scored.** *(Dave Mark's IAUS)* Each consideration passes
its raw input through its own response curve, and scores **multiply** rather than
sum, so a single 0.0 is a true veto. Addition lets "this person isn't here" get
outvoted by an unrelated high score.

## Determinism

Same seed + same opening move ⇒ same fingerprint. That's the deploy gate.

A social sim is pure state, so unlike a 3D build — where Brain's open tension
`T11` says automated verification tops out at *logic, not looks* — every claim
in `tests_sim.mjs` is provable in a terminal.

Three rules the sim holds to, each learned elsewhere and re-applied here:

- **Per-agent RNG streams, never one shared stream.** A single stream couples
  every outcome to every other consumer, so adding one townsperson silently
  shifts the rumours already in flight.
- **Constant rolls per decision.** Every ordered pair draws exactly two values
  per hour whether or not anything happens. A decision that only consumes
  randomness on the success path desynchronises every later replay.
- **No ambient `Math.random` / `Date.now` in the sim.** A test greps for them.

## Status

Milestone 1: the loop, proven as text. 16/16 tests.

Not built yet: the authored spine and drama manager (Brain's `T19` resolution —
a fixed skeleton with an invisible manager selecting vetted variants, steering
choice presentation rather than pruning branches), any renderer, and the failure
states that would make a week feel like a week.

## Why this exists

Brain's `T4 · scripted quests vs emergent systems` has been parked at 🟡
"scripted now, with objective types as the seam that leaves emergent on the
table" — waiting for something to actually test the other pole. This is that
test.
