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
node run.mjs                      # a week in the town
node run.mjs --seed 99            # a different week
node run.mjs --tell hollis        # say it to someone else — this is the game
node --test tests_sim.mjs         # the gate
```

A week that turned (`--seed 300`):

```
You told Pell the carter one true thing about Greer the reeve.

It was passed on 5 times.
It changed in the retelling after 2 hops (hour 6, maude → greer).
6 of 8 people ended the week carrying it.

d1 14:00  Maude the baker repeats it to Greer the reeve's face at the tavern.
          It reached him by: you → pell → maude → greer

What followed — 1 public row:
  d3 14:00  Greer the reeve confronts Maude the baker at the tavern
```

Nobody wrote that. The utility scorer asks whether a claim is juicy, whether
the listener is present, and whether they've already heard it — being the
*subject* is none of those, so people repeat things to your face on their own.
That is the moment a week stops being talk.

## What's actually simulated

Nothing here is a bespoke story system. Every piece is a documented technique,
pulled from the `NPC-SIM` cluster in Brain's idea repository — 23 kernels that
had been researched and never built by anything.

**Rumours are tokens, not broadcasts.** *(Dwarf Fortress)* A rumour is a discrete
object attached to one person. To spread, that person has to physically be
somewhere with someone else. There is no global "the town now knows" layer, so
a story handed to a recluse dies with them. This is the constraint the whole
game hangs off.

**Home is private, and that is load-bearing.** Locations match by string, and
the first build gave every agent a schedule slot literally named `home` — so the
entire town shared one room every evening and night became a free town-wide
mixer. It was the single largest source of spread in the project and it was
nonsense: going home is how you *stop* meeting people. With homes private the
week is quieter and the numbers are honest.

**Retelling degrades — by hop, by delay, and by mouth.** A token carries a
`distortion`; past a threshold the claim itself mutates, a *witnessing* becomes
a *hearsay*, and the charge sharpens away from the truth. A true thing arrives
somewhere false without anyone having lied.

Distortion was charged per hop only at first, needing three hops to reach the
threshold — but chains top out at two, so mutation was unreachable code that
looked covered. Lowering the threshold would have been the wrong fix: the bound
was the structure, not the coefficient. So distortion now also accrues from how
long the teller sat on the story before repeating it, and from the teller's
gossip trait — a chatty mouth sharpens a story to keep it worth hearing. Both
are available at hop one, so a week-long chain degrades honestly, and the
loudest carriers are the least reliable ones.

**Hearsay can't start a fight.** Ambient gossip is banded at ±0.25, strictly
inside the 0.3 grievance a public confrontation requires. Being told a story
about a man is not the same as being wronged by him, so no amount of talk makes
anyone throw a scene. What crosses the line is always firsthand: someone
repeating it to your face, or an earlier row. The town's antagonist is made
rather than assigned, and he knows exactly who to blame — the chain of custody
is right there on the token.

**A feud burns down instead of locking.** Having your say spends part of the
grievance that caused it, and hands a fresh one to the person you said it to.
Rows therefore alternate and decay. The first cut deepened the very grudge that
triggered it, so a pair who shared a room re-enacted the same scene every hour
until Sunday.

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

Milestone 1: the loop, proven as text. 22/22 tests.

Who you tell, averaged over 20 seeds:

| you tell | reach | reeve's standing | he finds out | public rows | mutations |
|---|---|---|---|---|---|
| Pell the carter (gossip 0.9, on the road) | 4.45 / 8 | -0.27 | 4/20 | 4 | 33 |
| Maude the baker (gossip 0.85, the square) | 4.45 / 8 | -0.25 | 8/20 | 10 | 18 |
| Hollis the widow (gossip 0.55, indoors) | 2.55 / 8 | **-0.29** | **13/20** | **53** | 2 |
| Tobias the smith (gossip 0.25, the forge) | 1.75 / 8 | -0.07 | 1/20 | 1 | 6 |

Reach is not the axis it first looks like. The carter spreads it furthest and
garbles it most, and the reeve usually never learns. The widow barely leaves the
house — the story dies with two or three people — but her day intersects his, so
she says it to his face on day one and the week becomes a feud. Lowest spread,
most damage. The smith is just a bad choice.

Three different games out of one sentence, which is the whole point; a test
asserts those axes stay distinct, because the moment they collapse into one,
"who do you tell" is only "pick the biggest number" again.

Not built yet: the authored spine and drama manager (Brain's `T19` resolution —
a fixed skeleton with an invisible manager selecting vetted variants, steering
choice presentation rather than pruning branches), any renderer, and the failure
states that would make a week feel like a week.

## Why this exists

Brain's `T4 · scripted quests vs emergent systems` has been parked at 🟡
"scripted now, with objective types as the seam that leaves emergent on the
table" — waiting for something to actually test the other pole. This is that
test.
