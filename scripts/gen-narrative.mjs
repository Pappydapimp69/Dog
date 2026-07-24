// Regenerate narrative-data.js from the human-authored design JSON.
// Run: node scripts/gen-narrative.mjs
// Keeps design/narrative-fable-draft.json as the source of truth while giving
// the game a plain ES module to import (no runtime fetch — matches the
// codebase's all-static-modules, no-CDN convention).
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "design/narrative-fable-draft.json";
const OUT = "narrative-data.js";
const data = JSON.parse(readFileSync(SRC, "utf8"));

const banner =
`// narrative-data.js — GENERATED from ${SRC} by scripts/gen-narrative.mjs.
// Do not edit by hand; edit the JSON and re-run the generator.
`;
writeFileSync(OUT, `${banner}export const NARRATIVE = ${JSON.stringify(data, null, 2)};\n`);
console.log(`wrote ${OUT} (${data.acts.length} acts, ` +
  `${data.acts.reduce((n, a) => n + a.beats.length, 0)} beats)`);
