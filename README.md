# 🐕 Dog Park 3D

A third-person 3D world you walk around as a good dog, fetching bones and
frisbees across an open park. Built with [three.js](https://threejs.org)
(vendored locally — **no runtime CDN, no build step**).

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
| Jump | `Space` | JUMP button |
| Bark | `B` | BARK button |
| Mute / unmute | `M` | 🔊 button (top-right) |

Walk over a 🦴 bone or 🥏 frisbee to collect it; a new one respawns elsewhere,
so the park never runs dry.

## What's in the world

- An 80×80 fenced park with a grassy field, scattered shade patches, and a pond
- ~26 trees, fire hydrants, and a doghouse — all solid (the dog walks around them)
- **Birds** — five of them across three species (sparrow, robin, dove) that hop
  along the grass, fly, and perch on tree tops; each is the source of its own
  spatial call
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
  is), the pond, and a distant road/city off the west edge that sends an
  occasional car whoosh from that direction.
- **Three distinct bird voices**: sparrow (bright high chips), robin (mid
  melodic warble with glides), dove (low cooing). Each bird also has its own
  pitch offset and an independent, randomized call timer — no two sound alike.
- **Wind** stays a soft non-positional bed (wind is everywhere).
- **Player SFX**: paw footsteps timed to the walk cycle (quicker when running,
  with a splash variant on water), a jump whoosh, a fall-speed landing thump,
  distinct bone/frisbee pickups, and a reworked **bark** — a glottal source
  (detuned saws + subharmonic) run through a waveshaper for grit, then three
  vocal-tract formants with a mouth-opening sweep and a breath-noise onset.
- Audio starts on "Enter the Park" (browser autoplay policy). Mute with the
  🔊 button or `M`; the choice is remembered across visits.

## Files

- `index.html` — the 3D world (main page)
- `world.css` — HUD, overlay, and on-screen mobile controls
- `world.js` — the whole game: scene, lighting, world props, the dog avatar,
  input (keyboard + mouse + touch joystick), physics, and the follow camera
- `audio.js` — the procedural sound engine (spatial stage, voices, SFX, reverb)
- `birds.js` — bird meshes, hop/fly/perch behaviour, and their spatial voices
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
