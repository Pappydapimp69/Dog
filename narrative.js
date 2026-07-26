// narrative.js — runtime controller over the authored story (narrative-data.js).
//
// Separation of concerns:
//   - narrative-data.js  = Fable's STORY (acts, beats, characters, cutscenes).
//     Generated from design/narrative-fable-draft.json; pure prose + cutscene
//     direction, no gameplay strings.
//   - OBJECTIVES (below)  = the GAMEPLAY-facing objective line per playable
//     beat — kept in code because it's a game concern, not narrative, and may
//     later reference live state. Keeps the JSON pristine.
//
// The controller tracks a current-beat pointer over the flattened beat order,
// and is save/restore-friendly (persists the beat id, robust to reordering).
// Pure data/state: no THREE, Node-testable.

import { NARRATIVE } from "./narrative-data.js?v=__BUILD__";

// Gameplay objective text per beat id. Emoji + one short imperative line, in the
// style the HUD already uses. Cutscene-only beats have no entry (objective()
// returns null). Only Act 1 is wired for now; later acts fill in as built.
const OBJECTIVES = {
  "a-treat-in-the-rain":     "🐾 Follow her scent — hold F to see it.",
  "the-trail-through-the-rain": "🐾 Follow the amber trail before the rain takes it.",
  "the-locked-door":         "🚪 Her scent ends here. Remember this door.",
  "first-night-alive":       "🌧 Survive the night — find food, stay out of the headlights.",
  "dawn-and-cinnamon":       "🌅 Dawn. Follow her to work.",
  "crossing-the-grid":       "🐾 Keep her scent through the morning crowd.",
  "the-under-scent":         "👃 Get close — there's something older under her scent.",
};

export function createNarrative(data = NARRATIVE) {
  // Flatten beats in act order; build indexes.
  const flat = [];               // [{beat, act, i}]
  const beatById = new Map();
  const actById = new Map();
  const nameByChar = new Map();
  const locById = new Map();
  for (const l of (data.locations || [])) locById.set(l.id, l);
  for (const c of (data.characters || [])) {
    // captions want a short name — the display name up to the first parenthetical
    nameByChar.set(c.id, (c.name || c.id).split(" (")[0]);
  }
  for (const act of data.acts) {
    actById.set(act.id, act);
    for (const beat of act.beats) {
      const entry = { beat, act, i: flat.length };
      flat.push(entry);
      beatById.set(beat.id, entry);
    }
  }

  let cur = 0; // index into flat

  const at = (i) => (i >= 0 && i < flat.length ? flat[i] : null);

  const api = {
    data,
    title: data.title,
    count: flat.length,

    // --- lookups ---
    beat(id) { const e = beatById.get(id); return e ? e.beat : null; },
    nameOf(charId) { return nameByChar.get(charId) || charId; },
    act(id) { return actById.get(id) || null; },
    location(id) { return locById.get(id) || null; },
    // Where a beat is SET. Every beat carries a location_id, but nothing read
    // it until cutscenes needed to be staged somewhere specific rather than
    // wherever the dog happened to be standing.
    locationOfBeat(id) {
      const e = beatById.get(id);
      return e ? (locById.get(e.beat.location_id) || null) : null;
    },
    locationIdOfBeat(id) {
      const e = beatById.get(id);
      return e ? (e.beat.location_id || null) : null;
    },
    actOfBeat(id) { const e = beatById.get(id); return e ? e.act : null; },
    allBeatIds() { return flat.map((e) => e.beat.id); },

    // --- current pointer ---
    current() { const e = at(cur); return e ? e.beat : null; },
    currentAct() { const e = at(cur); return e ? e.act : null; },
    currentId() { const e = at(cur); return e ? e.beat.id : null; },
    index() { return cur; },
    isLast() { return cur >= flat.length - 1; },

    // Move to a beat by id. Returns the beat, or null if unknown (pointer
    // unchanged on unknown id, so a bad call can't desync the story).
    goTo(id) {
      const e = beatById.get(id);
      if (!e) return null;
      cur = e.i;
      return e.beat;
    },
    // Advance to the next beat in story order; returns it or null at the end.
    advance() {
      if (cur >= flat.length - 1) return null;
      cur++;
      return flat[cur].beat;
    },

    // --- gameplay-facing derivations ---
    // Objective line for a beat (defaults to current). null = no HUD objective
    // (a pure cutscene / unauthored beat).
    objective(id) {
      const bid = id || api.currentId();
      return (bid && OBJECTIVES[bid]) || null;
    },
    // Cutscene block for a beat if it wants one, else null.
    cutscene(id) {
      const b = id ? api.beat(id) : api.current();
      return (b && b.cutscene && b.cutscene.needed) ? b.cutscene : null;
    },

    // --- save/restore (persist the beat id, not the index) ---
    save() { return { beat: api.currentId() }; },
    restore(s) {
      if (s && s.beat && beatById.has(s.beat)) { cur = beatById.get(s.beat).i; return true; }
      return false;
    },
  };
  return api;
}
