// The town: schedules, the hourly tick, and the loop that ties the rest together.
//
// brain (schedule-intersections-trigger-social-events-plus-decaying-pairwise-
// scores): give each NPC a daily schedule of activities at specific locations;
// when two schedules INTERSECT at a location, roll a social-interaction check
// that can create or modify a relationship. That is what turns a list of
// isolated agents into a place — people meet because their days overlap, not
// because a director decided they should.
//
// It is also the player's only lever. You cannot summon anyone. To say something
// to the baker you have to be at the bakery when the baker is, which means the
// timetable is the puzzle.

import { Streams } from "./rng.js";
import { MemoryStream } from "./memory.js";
import { SocialGraph } from "./graph.js";
import { makeRumor, retell, fidelity, newsworthiness, serializeRumor } from "./rumor.js";
import { bestExchange } from "./social.js";

export const HOURS_PER_DAY = 12;   // 8am..8pm — the waking town

export class Town {
  constructor(cast, { seed = 1234, days = 7 } = {}) {
    this.seed = seed >>> 0;
    this.days = days;
    this.hour = 0;                 // absolute hours since the week began
    this.streams = new Streams(this.seed);
    this.graph = new SocialGraph();
    this.log = [];
    this.agents = new Map();
    for (const spec of cast) {
      this.agents.set(spec.id, {
        id: spec.id, name: spec.name, traits: { ...spec.traits },
        schedule: spec.schedule, carrying: [], memory: new MemoryStream(),
      });
    }
    // Seed the acquaintance graph from declared ties so the first hop has
    // somewhere to go. Everything after this is earned by interaction.
    for (const spec of cast) {
      for (const t of spec.knows || []) {
        this.graph.touch(spec.id, t, 0.3);
        this.graph.shift(spec.id, t, 0.15, 0);   // 0 hops — seeding, not an event
      }
    }
  }

  agent(id) { return this.agents.get(id); }
  timeOfDay() { return this.hour % HOURS_PER_DAY; }
  day() { return Math.floor(this.hour / HOURS_PER_DAY); }

  /** Where an agent is right now — schedules are per-hour-of-day. */
  placeOf(a) { return a.schedule[this.timeOfDay() % a.schedule.length]; }

  /** Everyone sharing a location this hour, grouped. Stable ordering. */
  gatherings() {
    const byPlace = new Map();
    for (const id of [...this.agents.keys()].sort()) {
      const a = this.agents.get(id);
      const p = this.placeOf(a);
      if (!byPlace.has(p)) byPlace.set(p, []);
      byPlace.get(p).push(a);
    }
    return byPlace;
  }

  /** The player says something. The player is just another agent id. */
  plant({ speaker, listener, about, valence, kind = "witnessed" }) {
    const t = makeRumor({ claim: { about, kind, valence }, origin: speaker, at: this.hour });
    const l = this.agent(listener);
    if (!l) return null;
    t.chain.push(listener);   // the first hop is still a hop — chain is custody, not authorship
    l.carrying.push(t);
    l.memory.add({
      kind: "told", subject: about, text: `${speaker} said something about ${about}`,
      importance: 0.5 + Math.abs(valence) * 0.4, at: this.hour, tags: ["rumor"],
    });
    this.graph.touch(speaker, listener, 0.08);
    this.graph.shift(listener, about, valence * 0.45);
    this.log.push({ at: this.hour, type: "plant", speaker, listener, about, valence });
    return t;
  }

  /**
   * One hour. Every co-located pair gets ONE chance to interact, and every
   * decision draws a CONSTANT number of rolls whether or not it fires —
   * brain (the-game-the-waiting-city#E9): an AI decision that only consumes
   * randomness on the success path desynchronises every later replay.
   */
  tick() {
    for (const [place, present] of [...this.gatherings().entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (present.length < 2) continue;
      for (let i = 0; i < present.length; i++) {
        for (let j = 0; j < present.length; j++) {
          if (i === j) continue;
          const A = present[i], B = present[j];
          const stream = `pair:${A.id}>${B.id}`;
          // exactly two rolls per ordered pair per hour, always
          const gate = this.streams.roll(stream);
          const mutateRoll = this.streams.roll(stream);

          // The best thing A could tell B: most charged, least degraded, and
          // that B hasn't already heard. Resolved BEFORE scoring so "is this
          // even news" can act as a veto rather than a wasted roll.
          const known = new Set(B.carrying.map((t) => t.id));
          const worth = (t) => Math.abs(t.claim.valence) * fidelity(t) * newsworthiness(t, this.hour);
          const tellable = [...A.carrying].filter((t) => !known.has(t.id))
            .sort((x, y) => worth(y) - worth(x) || x.id - y.id);
          const token = tellable[0];

          const ctx = {
            initiator: A, target: B, sameePlace: true,
            opinion: this.graph.opinionOf(A.id, B.id),
            strength: (this.graph.edge(A.id, B.id, false) || { strength: 0 }).strength,
            carrying: A.carrying,
            novel: !!token,
            juiciness: token ? token.claim.valence * fidelity(token) * newsworthiness(token, this.hour) : 0,
          };
          const pick = bestExchange(ctx);
          if (!pick || gate > pick.score) continue;

          this.graph.touch(A.id, B.id, 0.04);
          if (pick.exchange.id === "share-rumor" && token) {
            const passed = retell(token, B.id, this.hour, mutateRoll);
            B.carrying.push(passed);
            const weight = passed.claim.valence * 0.4 * fidelity(passed);
            this.graph.shift(B.id, passed.claim.about, weight);
            B.memory.add({
              kind: passed.mutated ? "heard-distorted" : "heard",
              subject: passed.claim.about,
              text: `${A.name} said something about ${passed.claim.about}`,
              importance: 0.35 + Math.abs(passed.claim.valence) * 0.4,
              at: this.hour, tags: ["rumor"],
            });
            this.log.push({
              at: this.hour, type: "share", place, from: A.id, to: B.id,
              about: passed.claim.about, hops: passed.hops, mutated: passed.mutated,
              valence: Number(passed.claim.valence.toFixed(3)),
            });
          } else if (pick.exchange.id === "confront") {
            this.graph.shift(A.id, B.id, -0.2);
            B.memory.add({
              kind: "humiliated", subject: A.id,
              text: `${A.name} confronted them at the ${place}`,
              importance: 0.9, at: this.hour, tags: ["conflict"],
            });
            this.log.push({ at: this.hour, type: "confront", place, from: A.id, to: B.id });
          } else if (pick.exchange.id === "confide") {
            this.graph.shift(A.id, B.id, 0.12);
            this.graph.shift(B.id, A.id, 0.1);
            B.memory.add({
              kind: "kept-secret", subject: A.id,
              text: `${A.name} confided in them`,
              importance: 0.8, at: this.hour, tags: ["trust"],
            });
            this.log.push({ at: this.hour, type: "confide", place, from: A.id, to: B.id });
          }
        }
      }
    }

    // end-of-hour bookkeeping, in a fixed order
    for (const id of [...this.agents.keys()].sort()) {
      const a = this.agents.get(id);
      const r = a.memory.reflect(this.hour);
      if (r) this.log.push({ at: this.hour, type: "reflect", who: id, about: r.subject });
    }
    this.hour++;
    if (this.timeOfDay() === 0) this.graph.decayDay();
  }

  run(hours) { for (let i = 0; i < hours; i++) this.tick(); }

  /** Everything that determines the run — this is what the fingerprint hashes. */
  serialize() {
    const agents = {};
    for (const id of [...this.agents.keys()].sort()) {
      const a = this.agents.get(id);
      agents[id] = {
        carrying: [...a.carrying].sort((x, y) => x.id - y.id).map(serializeRumor),
        memory: a.memory.serialize(),
      };
    }
    return { seed: this.seed, hour: this.hour, agents, graph: this.graph.serialize(), rng: this.streams.save() };
  }

  /** Who does the town think well or badly of, on balance? */
  standing() {
    const totals = new Map();
    for (const id of this.agents.keys()) totals.set(id, 0);
    for (const [k, e] of this.graph.edges) {
      const to = k.split("|")[1];
      if (totals.has(to)) totals.set(to, totals.get(to) + e.opinion);
    }
    return [...totals.entries()]
      .map(([id, v]) => ({ id, name: this.agent(id).name, standing: Number(v.toFixed(3)) }))
      .sort((a, b) => b.standing - a.standing || (a.id < b.id ? -1 : 1));
  }
}
