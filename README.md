# 🐕 Doggo Dash

A tiny browser game about a very good dog who runs through the park fetching
treats and dodging obstacles. Pure HTML5 canvas — **no build step, no
dependencies**. Just open it.

## Play

Open `index.html` in any modern browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Jump / double-jump | `Space`, `↑`, `W` | tap upper screen |
| Duck (under birds) | `↓`, `S` | tap lower screen |
| Pause / resume | `P` | — |
| Start / restart | `Space`, `Enter`, button | tap |

## How it works

- **Endless runner.** The dog runs automatically; the world scrolls and speeds
  up the farther you get.
- **Obstacles** — fire hydrants and bushes on the ground (jump), birds at
  duck-height (duck under them).
- **Collectibles** — 🥏 frisbees (+5) and 🦴 bones (+2). Each catch also nudges
  your distance forward, so fetching is always worth it.
- **Score** is distance in meters plus treat bonuses. Your best run is saved in
  `localStorage`.

## Files

- `index.html` — page shell, HUD, and overlay screens
- `style.css` — layout and presentation
- `game.js` — the whole game: input, physics, spawning, collision, rendering

## Design notes

Everything is drawn with canvas primitives (no sprite assets), so the dog,
obstacles, and treats are all procedural. Difficulty ramps with distance but the
obstacle gap has a fairness floor so it never becomes impossible. The dog uses a
2-jump air budget and a duck hitbox, giving two independent ways to read and
clear hazards.
