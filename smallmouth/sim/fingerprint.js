// Canonical serialisation + fingerprint.
//
// brain: "Canonicalize (sorted-key) serialization before hashing game state for
// golden/regression tests." Object key order is an implementation detail in JS —
// two runs that are semantically identical can serialise differently and produce
// different hashes, so a golden test built on raw JSON.stringify fails for
// reasons that have nothing to do with the sim. Sort every key, every time.
//
// This is the deploy gate: same seed + same script => same fingerprint. A social
// sim is pure state, so unlike a 3D game (where brain's T11 says automated
// verification tops out at "logic, not looks") the whole thing is provable.

/** Recursively rebuild a value with every object key in sorted order. */
export function canonical(value) {
  if (value === null || typeof value !== "object") {
    // Guard the one float case that serialises inconsistently.
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`non-finite number in sim state: ${value}`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
  return out;
}

export function canonicalJSON(value) {
  // Round floats to a fixed precision on the way out. Two runs can differ in the
  // last bit from an equivalent-but-reordered float expression; that is not a
  // behaviour change and should not break the gate.
  return JSON.stringify(canonical(value), (_k, v) =>
    (typeof v === "number" && !Number.isInteger(v) ? Number(v.toFixed(6)) : v));
}

/** fnv1a-32, hex. Small, dependency-free, plenty for a golden-run gate. */
export function fingerprint(value) {
  const str = canonicalJSON(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
