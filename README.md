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

Walk over a 🦴 bone or 🥏 frisbee to collect it; a new one respawns elsewhere,
so the park never runs dry.

## What's in the world

- An 80×80 fenced park with a grassy field, scattered shade patches, and a pond
- ~26 trees, fire hydrants, and a doghouse — all solid (the dog walks around them)
- A fully articulated dog: swinging legs, a wagging tail, and a head bob while it
  trots, plus a real-time cast shadow
- A third-person follow camera you can orbit freely

## Files

- `index.html` — the 3D world (main page)
- `world.css` — HUD, overlay, and on-screen mobile controls
- `world.js` — the whole game: scene, lighting, world props, the dog avatar,
  input (keyboard + mouse + touch joystick), physics, and the follow camera
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
