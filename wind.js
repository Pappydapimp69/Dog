/* Dog Park 3D — wind.
 *
 * Wind is not a constant bed. A rare, invisible "wind bar" — a vertical plane —
 * spawns at one edge of the map with a random direction and an intensity, then
 * sweeps across to the far side. The bar makes no sound itself: as it crosses
 * an object, THAT object emits a sound at its own position. A tree rustles its
 * leaves; the dog briefly hears the wind rush past.
 */
import * as THREE from "./vendor/three.module.js";

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

export function createWind(scene, audio, opts) {
  const trees = opts.trees || [];
  const getDog = opts.getDog;
  const WORLD = opts.world || 80;
  const reach = WORLD * 1.7;

  let bar = null;
  let spawnTimer = rand(10, 22); // first gust comes a little sooner

  const DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
  ];

  function spawn() {
    const d = pick(DIRS);
    const dir = new THREE.Vector2(d[0], d[1]).normalize();
    bar = {
      dir,
      offset: -reach,
      prev: -reach,
      end: reach,
      speed: rand(11, 22),
      intensity: rand(0.25, 1.0),
      hit: new Set(),
      dogHit: false,
    };
  }

  const proj = (x, z, dir) => x * dir.x + z * dir.y;

  function update(dt) {
    if (!bar) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) { spawn(); spawnTimer = rand(24, 55); } // rare
      return;
    }
    bar.prev = bar.offset;
    bar.offset += bar.speed * dt;

    // Trees crossed this step → rustle at the tree's position.
    for (let i = 0; i < trees.length; i++) {
      if (bar.hit.has(i)) continue;
      const p = proj(trees[i].x, trees[i].z, bar.dir);
      if (bar.prev < p && p <= bar.offset) {
        bar.hit.add(i);
        audio.rustle(trees[i].x, trees[i].topY - 1.5, trees[i].z, bar.intensity * rand(0.75, 1.1));
      }
    }

    // Dog crossed → brief wind whoosh at the dog.
    if (!bar.dogHit && getDog) {
      const dog = getDog();
      const p = proj(dog.x, dog.z, bar.dir);
      if (bar.prev < p && p <= bar.offset) {
        bar.dogHit = true;
        audio.windGust(dog.x, (dog.y || 0) + 1, dog.z, bar.intensity);
      }
    }

    if (bar.offset >= bar.end) bar = null;
  }

  return {
    update,
    get active() { return !!bar; },
    get intensity() { return bar ? bar.intensity : 0; },
    forceSpawn: spawn, // test hook
  };
}
