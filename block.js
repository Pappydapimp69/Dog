/* Dog Park 3D — "the block": the city's unstructured layer.
 *
 * Playtested as: "Explore the city area more and have more objects to interact
 * with unstructured. Like a free roam. Too much hand holding." The city had
 * exactly two verbs — tip a bin, beg at the cart — and both were introduced by
 * a scripted prologue stop, so everything a player could do out there was
 * something the game had already told them to do. Wandering paid nothing.
 *
 * The three verbs here are deliberately the opposite shape: nothing points at
 * them, no objective names them, no coach line teaches them. They exist at
 * street furniture that is already standing there, and the only way to find
 * them is to walk up to something and see the prompt appear. Brain
 * wrong-sky#E8 / the `effect-gated-not-existence-gated` kernel: discovery
 * objects are ALWAYS present and answer in-fiction, rather than being spawned
 * when a quest wants them.
 *
 * Rules and copy live here (pure, seedable, unit-testable); game.js owns the
 * meshes, prompts and audio. The split is the same one reputation.js and
 * memory.js use, and it exists so the payout tables can be argued about in a
 * test instead of in a browser.
 */

// ---------------------------------------------------------------------------
// Marking
// ---------------------------------------------------------------------------
// A dog reads a post before it signs it. Each line is one page of the block's
// news — the found-story reward for going somewhere nobody sent you. The pool
// is walked in order (shuffled per run by the caller), never repeating, so
// twenty posts are twenty things learned rather than one line seen twenty
// times.
export const MARK_LINES = [
  "A courier's terrier, four times today. Anxious. In a hurry even standing still.",
  "Someone's old spaniel, slow and thorough. Been on this corner for years.",
  "Rain, three days back, and under it a butcher's van that no longer comes.",
  "Two pups off the same litter. One eats well now. One doesn't.",
  "A cat sat here long enough to mean it. That's a statement, not a passing.",
  "The bakery, on somebody's coat. Warm bread and a woman's hands.",
  "A dog that was afraid. It marked high, and it marked twice.",
  "Bleach. Somebody scrubbed this post and the street wrote it back over.",
  "A working dog — harness, leather, a whole different life.",
  "Diesel and wet rope. Whatever came through here came off a truck.",
  "Nothing at all. First one to sign a clean post is a kind of luck.",
  "An old, old mark, gone to almost nothing. A dog that stopped coming.",
  "Three dogs in one night, all bearing east. Something over there is worth it.",
  "Somebody's puppy, all over the place. No manners yet. Good for them.",
  "A hand rested here. Nicotine, wool, and dog — a person who has one.",
  "The catcher's van, faint. He parks here. Remember that.",
];

// Milestones. Kept few and far apart: a counter that dings every second post
// turns a wander into a checklist, which is the thing being fixed.
export const MARK_TIERS = [
  { n: 5, ach: "local", line: "Five posts signed. This stretch of street answers to you a little." },
  { n: 12, ach: "blockking", line: "Twelve. Anyone reading this block reads you first — you look like you live here." },
];

// How "local" the dog reads, 0..1, from posts marked. Saturating, so the tail
// is not worth grinding: half the benefit arrives by the fifth post.
export const LOCAL_FULL = 12;
export function localness(marks) {
  const n = Math.max(0, marks | 0);
  return Math.min(1, n / LOCAL_FULL) ** 0.6;
}

export function markTierReached(before, after) {
  return MARK_TIERS.find((t) => before < t.n && after >= t.n) || null;
}

// ---------------------------------------------------------------------------
// Digging
// ---------------------------------------------------------------------------
// A mound of loose earth is the one dug-shaped thing in the world, so it is
// also the whole tutorial. Each is a one-shot: the reward for covering ground
// is that there is always another one somewhere you have not been.
//
// Weights sum to 1. `item` outcomes hand back a REAL fetch prop, which is the
// point of the verb — it wires city wandering into the park's economy instead
// of leaving free roam as a side room with its own private currency.
export const DIG_TABLE = [
  { w: 0.26, kind: "bone", text: "🦴 Half a metre down — a bone, dry and perfect. Yours." },
  { w: 0.20, kind: "ball", text: "🎾 A ball, flat on one side, buried by somebody who meant to come back." },
  { w: 0.22, kind: "food", text: "🍖 Something wrapped, and still worth eating. Lucky." },
  { w: 0.20, kind: "nothing", text: "🕳️ Earth, roots, a bottle cap. You'd swear it smelled like more." },
  { w: 0.12, kind: "seen", text: "🕳️ You get a proper hole going before a window bangs open above you." },
];

export function digYield(roll) {
  let acc = 0;
  const r = Math.min(0.999999, Math.max(0, roll));
  for (const row of DIG_TABLE) { acc += row.w; if (r < acc) return row; }
  return DIG_TABLE[DIG_TABLE.length - 1];
}

// ---------------------------------------------------------------------------
// Scratching at a door
// ---------------------------------------------------------------------------
// The walk-ups on Delancey have people behind them. Scratching is the riskiest
// of the three — it is the only one that reliably puts a human's eye on you —
// and it pays the best, which is the trade that makes it a choice rather than
// a free action.
export const DOOR_TABLE = [
  { w: 0.30, kind: "food", text: "🚪 A latch, a gap, and a hand puts something down without a word." },
  { w: 0.22, kind: "kind", text: "🚪 Someone crouches to your level and just looks at you for a while." },
  { w: 0.26, kind: "none", text: "🚪 You scratch. The building doesn't answer." },
  { w: 0.22, kind: "shooed", text: "🚪 The door opens hard. \"Go on — GO ON.\" You go on." },
];

export function doorAnswer(roll) {
  let acc = 0;
  const r = Math.min(0.999999, Math.max(0, roll));
  for (const row of DOOR_TABLE) { acc += row.w; if (r < acc) return row; }
  return DOOR_TABLE[DOOR_TABLE.length - 1];
}

// A door that has just answered goes quiet for a while — otherwise the best
// outcome in the game is standing at one stoop pressing a button.
export const DOOR_COOLDOWN = 45;
export const DIG_REFILL = 120;   // a filled-in hole becomes diggable again

// ---------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------
// Deliberately generous. dog#E93: "find food" read as broken for two whole
// fixes because a 2.4-unit interact radius on an unlit prop at night is not
// findable, whatever the code does. These are things you are meant to bump
// into, so they answer from about a body-length away.
export const REACH_POST = 3.0;
export const REACH_DIG = 3.0;
export const REACH_DOOR = 3.4;

// A stable shuffle so a given run reads its posts in a fixed order (save/replay
// safe — the caller passes the run's seeded rng, not Math.random).
export function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
