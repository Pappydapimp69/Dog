// Terminal harness — brain E1 (`sim-before-render`): prove the loop in a
// terminal before any renderer exists. If the town isn't interesting as text,
// no amount of art will save it.
//
//   node run.mjs [--seed N] [--days N] [--quiet]

import { readFileSync } from "node:fs";
import { Town } from "./sim/town.js";
import { fingerprint } from "./sim/fingerprint.js";

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const quiet = process.argv.includes("--quiet");
const seed = arg("--seed", 1234);
const days = arg("--days", 7);

const cast = JSON.parse(readFileSync(new URL("./town/cast.json", import.meta.url), "utf8"));
const town = new Town(cast, { seed, days });

// The player's one move for the week: tell the carter — the biggest gossip in
// town — that the reeve took money. It is true. What the town ends up believing
// is not up to you.
town.plant({ speaker: "you", listener: "pell", about: "greer", valence: -0.7, kind: "witnessed" });

const HOURS = days * 12;
town.run(HOURS);

if (!quiet) {
  console.log(`\nSMALLMOUTH — seed ${seed}, ${days} days\n`);
  console.log("You told Pell the carter one true thing about Greer the reeve.\n");

  const shares = town.log.filter((l) => l.type === "share");
  console.log(`It was passed on ${shares.length} times.`);
  const mutated = shares.filter((l) => l.mutated);
  if (mutated.length) {
    const first = mutated[0];
    console.log(`It changed in the retelling after ${first.hops} hops` +
                ` (hour ${first.at}, ${first.from} → ${first.to}).`);
  }

  const knows = [...town.agents.values()].filter((a) => a.carrying.length);
  console.log(`${knows.length} of ${town.agents.size} people ended the week carrying it.\n`);

  console.log("How the town sees each other by Sunday:");
  for (const s of town.standing()) {
    const bar = s.standing >= 0 ? "+".repeat(Math.round(s.standing * 4)) : "-".repeat(Math.round(-s.standing * 4));
    console.log(`  ${String(s.name).padEnd(22)} ${String(s.standing).padStart(7)}  ${bar}`);
  }

  const chain = [...town.agents.values()].flatMap((a) => a.carrying).sort((a, b) => b.hops - a.hops)[0];
  if (chain) console.log(`\nLongest chain of custody: ${chain.chain.join(" → ")}`);

  const reflections = town.log.filter((l) => l.type === "reflect");
  if (reflections.length) {
    console.log(`\n${reflections.length} people stopped and formed an opinion of their own:`);
    for (const r of reflections.slice(0, 6)) console.log(`  hour ${r.at}: ${r.who} has been thinking about ${r.about}`);
  }
}

console.log(`\nfingerprint ${fingerprint(town.serialize())}`);
