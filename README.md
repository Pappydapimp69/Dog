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
- A fully articulated dog: swinging legs, a wagging tail, and a head bob while it
  trots, plus a real-time cast shadow
- A third-person follow camera you can orbit freely

## Sound

All audio is **synthesized at runtime with the Web Audio API** — there are no
sample files to load or license. The graph routes an ambient bus and an SFX bus
through a shared limiter into a master gain, so levels stay balanced and never
clip.

- **Ambient city-park bed** (no music): gusting wind, a distant city hum with a
  sub rumble, randomized birdsong (varied calls, stereo-panned, with a touch of
  air delay), an occasional car whooshing past across the stereo field, and
  water lapping that fades in as you approach the pond.
- **SFX**: paw footsteps timed to the walk cycle (quicker when running, with a
  splash variant on water), a jump whoosh, a landing thump scaled by fall speed,
  distinct bone (crunch + bell) and frisbee (catch + bell) pickups, and a
  two-formant synthesized bark.
- Audio starts on "Enter the Park" (browser autoplay policy). Mute with the
  🔊 button or `M`; the choice is remembered across visits.

## Files

- `index.html` — the 3D world (main page)
- `world.css` — HUD, overlay, and on-screen mobile controls
- `world.js` — the whole game: scene, lighting, world props, the dog avatar,
  input (keyboard + mouse + touch joystick), physics, and the follow camera
- `audio.js` — the procedural sound engine (ambient bed + SFX)
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
