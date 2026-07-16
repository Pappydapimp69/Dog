# 🐕 Dog Park 3D

A third-person 3D game: you're a **stray dog whose goal is to get adopted**.
Win over a living park, fake being someone's dog to dodge the catcher, and earn
a forever home — across four levels. Built with [three.js](https://threejs.org)
(vendored locally — **no runtime CDN, no build step**).

## The goal: get adopted (4 levels)

1. **New Dog in Town** — bond with park-goers. Walk up and press **E** to greet;
   warm, dog-loving people take to you, timid ones don't.
2. **Lay Low** — a **dog catcher** is prowling, and a scruffy stray is his type.
   **Fake being owned**: find the collar, **wash in the pond** (bark to shoo the
   ducks first!), and keep your **Suspicion** low so he loses interest. It's not
   just the disguise — a stray flanked by park-goers who clearly adore it reads
   like *someone's* dog, so **keeping friends close vouches for you** and lowers
   Suspicion (watch for the `🫂 vouched` tag). Bonding the park pays off here.
   Get caught and he hauls you off and strips your collar.
3. **Prove Yourself** — head to the **Adoption Fair** on the far side of the
   park and win over two shelter volunteers, **Priya** and **Sam**. A rival
   pup, **Rex**, is turning heads too — keep your presentation above his
   rising charm to outshine him.
4. **Forever Home** — impress **Mrs. Bell**: look your best (collar + clean) and
   win her heart, then greet her to be **adopted**. 🏡

**Maya** (gold marker) is a persistent guide who nudges the story along.

### Characters have traits and memory

Every character carries a fixed personality — *friendliness, dog-love,
suspicion, patience* — that determines how they react to you and to each other,
plus an evolving **rapport** that remembers your past interactions. Friendly
folk greet each other in passing and warm up — and **word travels**: when two
people meet they gossip about you, each nudging the other's opinion toward their
own. Win someone over and they talk you up to strangers; scare someone off and
they spread the bad word (the wary believe it fastest). Reputation only *primes*
newcomers, though — the people you bond or alienate firsthand become the park's
opinion leaders, and hearsay never quite tips a stranger into a friend or an
enemy on its own; that still takes you. Watch for the little sparks when people
chat: **gold** means good word passed, **blue** means bad. **Barking** cuts both
ways: dog-lovers enjoy it, but timid people dislike it and it raises your
Suspicion, drawing the catcher.

## Play

- **Live:** https://pappydapimp69.github.io/Dog/
- **Local:** serve the folder and open it (ES modules need http, not `file://`):

```bash
python3 -m http.server 8000
# visit http://localhost:8000
```

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Walk | `W A S D` / arrow keys | left thumbstick |
| Look around | drag the mouse | drag the right side |
| Run | hold `Shift` | — |
| Greet / pick up | `E` | ACT button |
| Bark | `B` | BARK button |
| Jump | `Space` | JUMP button |
| Mute / unmute | `M` | 🔊 button (top-right) |

Walk over a 🦴 bone or 🥏 frisbee to collect it; a new one respawns elsewhere,
so the park never runs dry.

## What's in the world

- An 80×80 fenced park with a grassy field, scattered shade patches, and a pond
- ~26 trees, fire hydrants, and a doghouse — all solid (the dog walks around them)
- **Birds** — five of them across three species (sparrow, robin, dove) that hop
  along the grass, fly, and perch on tree tops; each is the source of its own
  spatial call
- **People** strolling the park (with faint, distant chatter) and **other dogs**
  trotting around and barking
- **Ducks on the pond** that paddle around peacefully — until you enter their
  turf, when they charge, quack furiously, and peck the dog (a shove + a yelp).
  They only defend a **pursuit ring** around the pond: flee past its edge and
  they guard the boundary for a few seconds, then return and settle down (as
  long as you stay out). **Bark at them to fight back** — each bark fills an
  invisible scare meter (closer = more; it drains over time), and once it's full
  the whole flock panics and **flies off the map for ~60 seconds**, leaving the
  pond safe to cross before they return
- Park **props** all around: benches, picnic tables, trash bins, lamps, and
  flower beds
- A **perimeter ring road** just outside the fence with **cars** circulating on
  it (a couple blasting music), a distant **city** silhouette of buildings, and
  streetlights — so the traffic you hear comes from traffic you can see
- **Traffic lights** at the four corner intersections, on a fixed repeating
  cycle. Cars slow to the stop line on red/yellow, idle, then pull away on
  green, and queue behind one another. The four intersections are phase-offset
  (never all change at once), and each intersection's two directions are never
  both green
- A fully articulated dog: swinging legs, a wagging tail, and a head bob while it
  trots, plus a real-time cast shadow
- A third-person follow camera you can orbit freely

## Sound

All audio is **synthesized at runtime with the Web Audio API** — there are no
sample files to load or license.

**It's a spatial stage, not a flat mix.** A listener is synced to the camera
every frame, and world sounds play through panner nodes (HRTF + distance
falloff), so direction and volume change as you move. A procedurally generated
convolution reverb gives the whole stage one shared outdoor space. Signal flow:
positional sources + a wind bed + player SFX → shared limiter → master gain
(never clips).

- **Positional sources**: every bird (its call emits from where it physically
  is), the pond, and every **car** on the ring road (a moving engine source you
  hear approach and recede as it rounds the near side).
- **Car radios**: a couple of cars play music that is **generated on the fly** —
  an endless, never-repeating lo-fi loop (own key/tempo/pattern per car),
  lowpassed so it sounds like it's thumping from inside a passing car. Both the
  engine and the radio emit from the car's own panner, so they track it as it
  drives; the engine also drops to an idle note when the car stops at a light.
- **Three distinct bird voices**: sparrow (bright high chips), robin (mid
  melodic warble with glides), dove (low cooing). Each bird also has its own
  pitch offset and an independent, randomized call timer — no two sound alike.
- **Critters** are spatial too: each duck quacks from its position (calm, or a
  furious burst when attacking), other dogs bark spatially, and people give off
  faint chatter — all positioned in the world around you.
- **Wind is event-driven, not a bed.** A rare invisible "wind bar" sweeps across
  the map; it makes no sound itself, but as it crosses objects *they* sound off
  at their own positions — trees rustle their leaves, and the wind rushes past
  the dog. Each bar has its own intensity, so no two gusts are alike.
- **Player SFX**: paw footsteps timed to the walk cycle (quicker when running,
  with a splash variant on water), a jump whoosh, a fall-speed landing thump,
  distinct bone/frisbee pickups, and a reworked **bark** — a glottal source
  (detuned saws + subharmonic) run through a waveshaper for grit, then three
  vocal-tract formants with a mouth-opening sweep and a breath-noise onset.
- Audio starts on "Enter the Park" (browser autoplay policy). Mute with the
  🔊 button or `M`; the choice is remembered across visits.

## Cross-project knowledge

This project is developed alongside two sibling repos that Claude Code
sessions read from and write to as they work here:

- **[`ideas`](https://github.com/Pappydapimp69/ideas)** — a cross-project idea
  repository. Reusable design/architecture kernels discovered while building
  this game (e.g. boids flocking, predictive pursuit, seeded/shareable
  procedural generation, scheduled NPC routines) get mined out and filed there
  under `reference/dog-park-3d/` and the main `idea-repository.md`, so other
  projects can reuse them.
- **[`memory`](https://github.com/Pappydapimp69/memory)** — "the brain": a
  shared, cross-session knowledge base of real bugs and non-obvious design
  decisions (tagged, indexed in `PITFALLS.md`). Sessions grep it before
  writing code in a new area and propose a lesson (under `incoming/`) after a
  real fix — e.g. the module-load TDZ crash, the Web Audio scheduler stutter,
  and several agent-simulation gotchas (snapshot-then-integrate, arrival
  radii, spatial-grid boundaries, FSM guaranteed exits) all originated here
  and are filed there for reuse on any project.

Read `memory`'s `BRIEF.md` before starting new work on this codebase, and
propose a lesson there after any real bug fix — see that repo's README for
the exact contribution rules (only write to `incoming/`, never edit canon
directly).

## Files

- `index.html` — the 3D world (main page)
- `world.css` — HUD, overlay, and on-screen mobile controls
- `world.js` — the whole game: scene, lighting, world props, the dog avatar,
  input (keyboard + mouse + touch joystick), physics, and the follow camera
- `audio.js` — the procedural sound engine (spatial stage, voices, SFX, reverb)
- `birds.js` — bird meshes, hop/fly/perch behaviour, and their spatial voices
- `cars.js` — ring road, city, streetlights, traffic lights, and driving cars
- `wind.js` — sweeping wind bars that trigger sounds on the objects they cross
- `game.js` — the campaign: traits/relationships, disguises, the dog catcher,
  the persistent guide, levels, and the adoption win condition
- `critters.js` — people, other dogs, and the pond ducks (incl. the attack)
- `props.js` — static park decorations (benches, tables, bins, lamps, flowers)
- `vendor/three.module.js` — pinned three.js r160 build
- `runner.html` + `game.js` + `style.css` — the original 2D "Doggo Dash"
  endless-runner, kept as a bonus mini-game

## Design notes

The dog and every prop are built from three.js primitives (no external 3D
assets), so the whole thing is just code. Movement is camera-relative — pressing
forward always walks the way the camera faces — and the dog smoothly rotates to
face its travel direction. Obstacles use simple circular footprints for
collision, and the sun's shadow camera tracks the dog so shadows stay crisp
anywhere in the park.
