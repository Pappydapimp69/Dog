/* Dog Park 3D — reputation → recognition. Word of mouth, aggregated.
 *
 * The whole back half of the story runs on a promise the player didn't know they
 * were making: every trick performed for a stranger was a message in a bottle
 * addressed to Maya. When Biscuit is in the pound, the neighborhood does the
 * work — the crossing guard, the kids, Lupe reading a flyer — and the number of
 * voices in that montage is the reputation the player actually built.
 *
 * IMPORTANT (brain dog#E50): the game's gossip/word-of-mouth diffusion WRITES to
 * `rapport`, and rapport ALSO gates goals — so that diffusion is carefully
 * banded inside the gating thresholds. This module does the opposite thing: it
 * only READS rapport to derive a recognition picture. It never writes rapport,
 * so it cannot auto-complete a goal, cross the firsthand-earned friend line, or
 * undo a bond by construction. Keep it that way — aggregate by reading, gate by
 * reading, never feed a derived aggregate back into the score it came from.
 */

export const FRIEND_LINE = 0.7;        // the game's befriend threshold (rapport)
export const ACQUAINTANCE_LINE = 0.4;  // warm enough to carry news, not yet a friend

const nameOf = (p) => p.cname || p.name || null;

// Read-only aggregate. friends = firm bonds (they'd testify); warmth = a softer
// score that also counts acquaintances fractionally, for tuning the montage.
export function renownScore(people) {
  let friends = 0, warmth = 0;
  for (const p of people || []) {
    const r = p.rapport || 0;
    if (r >= FRIEND_LINE) { friends++; warmth += 1; }
    else if (r >= ACQUAINTANCE_LINE) {
      warmth += ((r - ACQUAINTANCE_LINE) / (FRIEND_LINE - ACQUAINTANCE_LINE)) * 0.5;
    }
  }
  return { friends, warmth: +warmth.toFixed(3) };
}

// The montage's carriers, strongest bond first, capped. "The scale of this beat
// scales with the player's actual reputation" — more/warmer people, more voices.
export function recognitionVoices(people, cap = 6) {
  return (people || [])
    .filter((p) => (p.rapport || 0) >= ACQUAINTANCE_LINE && nameOf(p))
    .sort((a, b) => (b.rapport || 0) - (a.rapport || 0))
    .slice(0, Math.max(0, cap))
    .map((p) => ({ name: nameOf(p), role: p.role || "parkgoer", rapport: +(p.rapport || 0).toFixed(3) }));
}

// The trigger gate: enough firm friends that word plausibly reaches Maya. Read-
// only — being "ready" never mutates anyone's rapport.
export function recognitionReady(people, minFriends = 2) {
  return renownScore(people).friends >= minFriends;
}

// A compact, serialization-friendly snapshot the HUD / finale can consume.
export function recognitionState(people, minFriends = 2) {
  const { friends, warmth } = renownScore(people);
  const voices = recognitionVoices(people);
  return {
    friends, warmth,
    ready: friends >= minFriends,
    voiceCount: voices.length,
    voices,
  };
}
