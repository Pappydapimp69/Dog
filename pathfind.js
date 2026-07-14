/* Dog Park 3D — obstacle-aware pathfinding for chase AI (the catcher, Rex).
 *
 * Grid A* + obstacle-aware string-pulling, sized to the real obstacle list
 * (trees/hydrants/doghouse/city/fair props). Verified in a 5-pass sandbox
 * before landing here (brain: local/sandbox-dog-pathfinding) — reused
 * verified pitfalls from local/sandbox-astar-replan: the agent's own
 * current cell must never be rejected as blocked (occupancy gates where
 * you're allowed to GO, never whether you're allowed to already BE
 * somewhere), and the heuristic must stay admissible (octile, exact on an
 * open 8-directional grid). Path smoothing needs its OWN obstacle
 * line-of-sight check — a shortcut cleared against grid cells alone can
 * cut straight through an obstacle the search correctly routed around.
 */

const CELL = 2; // world units per grid cell — matches the sandbox

export function createPathfinder(obstacles, worldHalfExtent) {
  const gridN = Math.ceil((worldHalfExtent * 2) / CELL);

  function worldToCell(x, z) {
    return { cx: Math.floor((x + worldHalfExtent) / CELL), cz: Math.floor((z + worldHalfExtent) / CELL) };
  }
  function cellToWorld(cx, cz) {
    return { x: cx * CELL - worldHalfExtent + CELL / 2, z: cz * CELL - worldHalfExtent + CELL / 2 };
  }

  // A cell is blocked if the obstacle circle overlaps the cell's SQUARE
  // region — not merely its center point. Point-sampling only the center
  // can miss a small obstacle (effective radius smaller than CELL) that
  // sits inside a cell without covering that cell's exact center (verified:
  // a real r=0.8 hydrant at a non-center offset was missed this way,
  // letting the catcher clip through it during patrol). Closest-point-on-
  // AABB-to-circle-center is the standard correct test for this.
  const HALF = CELL / 2;
  const grid = new Uint8Array(gridN * gridN);
  for (let cz = 0; cz < gridN; cz++) {
    for (let cx = 0; cx < gridN; cx++) {
      const { x, z } = cellToWorld(cx, cz); // cell center
      for (const o of obstacles) {
        const rr = o.r + 0.6; // same padding as world.js's own blocked()
        const closestX = Math.max(x - HALF, Math.min(o.x, x + HALF));
        const closestZ = Math.max(z - HALF, Math.min(o.z, z + HALF));
        const dx = closestX - o.x, dz = closestZ - o.z;
        if (dx * dx + dz * dz < rr * rr) { grid[cz * gridN + cx] = 1; break; }
      }
    }
  }
  function isBlocked(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= gridN || cz >= gridN) return true;
    return grid[cz * gridN + cx] === 1;
  }

  const NEIGH = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  function octile(ax, az, bx, bz) {
    const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  }

  // A destination that's itself blocked (a patrol waypoint that happens to
  // sit near a small prop, a target that clipped just inside an obstacle's
  // padding) has no valid A* goal cell — falling back to steering straight
  // at the raw coordinates reintroduces the exact clipping this module
  // exists to prevent. Substitute the nearest OPEN cell instead, found by
  // an expanding ring search capped at a small radius (a real "goal is
  // deep inside an obstacle" case isn't fixable by nudging nearby).
  function nearestOpenCell(cell) {
    if (!isBlocked(cell.cx, cell.cz)) return cell;
    for (let ring = 1; ring <= 6; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue; // ring border only
          const ncx = cell.cx + dx, ncz = cell.cz + dz;
          if (!isBlocked(ncx, ncz)) return { cx: ncx, cz: ncz };
        }
      }
    }
    return cell; // deeply blocked -- caller's astar will correctly report no path
  }

  function astar(start, goal) {
    if (isBlocked(goal.cx, goal.cz)) return null;
    const startKey = start.cz * gridN + start.cx, goalKey = goal.cz * gridN + goal.cx;
    const open = new Map();
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    open.set(startKey, { cx: start.cx, cz: start.cz, g: 0, f: octile(start.cx, start.cz, goal.cx, goal.cz) });
    const closed = new Set();
    const MAX_ITER = gridN * gridN;
    let iterations = 0;
    while (open.size > 0) {
      iterations++;
      if (iterations > MAX_ITER) return null;
      let bestKey = null, best = null;
      for (const [k, v] of open) { if (!best || v.f < best.f) { best = v; bestKey = k; } }
      open.delete(bestKey);
      if (bestKey === goalKey) {
        const path = [{ cx: best.cx, cz: best.cz }];
        let k = bestKey;
        while (cameFrom.has(k)) { k = cameFrom.get(k); const cz = Math.floor(k / gridN), cx = k % gridN; path.unshift({ cx, cz }); }
        return path;
      }
      closed.add(bestKey);
      for (const [dx, dz, cost] of NEIGH) {
        const ncx = best.cx + dx, ncz = best.cz + dz, nkey = ncz * gridN + ncx;
        if (closed.has(nkey)) continue;
        if (isBlocked(ncx, ncz)) continue;
        if (dx !== 0 && dz !== 0 && isBlocked(best.cx + dx, best.cz) && isBlocked(best.cx, best.cz + dz)) continue;
        const tentativeG = best.g + cost;
        if (tentativeG < (gScore.get(nkey) ?? Infinity)) {
          gScore.set(nkey, tentativeG);
          cameFrom.set(nkey, bestKey);
          open.set(nkey, { cx: ncx, cz: ncz, g: tentativeG, f: tentativeG + octile(ncx, ncz, goal.cx, goal.cz) });
        }
      }
    }
    return null;
  }

  function circleSegmentIntersect(x1, z1, x2, z2, ox, oz, r) {
    const dx = x2 - x1, dz = z2 - z1, len2 = dx * dx + dz * dz;
    if (len2 === 0) return Math.hypot(x1 - ox, z1 - oz) < r;
    let t = ((ox - x1) * dx + (oz - z1) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx, pz = z1 + t * dz;
    return Math.hypot(px - ox, pz - oz) < r;
  }
  function hasLineOfSight(a, b) {
    for (const o of obstacles) if (circleSegmentIntersect(a.x, a.z, b.x, b.z, o.x, o.z, o.r + 0.6)) return false;
    return true;
  }
  function smoothPath(worldPath) {
    if (worldPath.length <= 2) return worldPath;
    const out = [worldPath[0]];
    let i = 0;
    while (i < worldPath.length - 1) {
      let farthest = i + 1;
      for (let j = i + 2; j < worldPath.length; j++) {
        if (hasLineOfSight(worldPath[i], worldPath[j])) farthest = j; else break;
      }
      out.push(worldPath[farthest]);
      i = farthest;
    }
    return out;
  }

  // One `pather` per chasing entity (catcher, Rex) — holds its own cached
  // path/replan cadence. Cheap: worst-case full-map A* is ~2ms (verified),
  // and this only re-runs on a ~0.35s cadence or when the cached path runs
  // out, never every frame.
  // `staggerSeed` spreads many pathers' replan cadences across different
  // frames (deterministic, not RNG — a fixed per-entity offset) so a park
  // full of wandering NPCs doesn't all replan on the same tick.
  function createPather(staggerSeed = 0) {
    return {
      path: null, pathIdx: 0, replanCD: (staggerSeed % 100) / 100 * 0.35,
      getSteerTarget(fromX, fromZ, toX, toZ, dt) {
        this.replanCD -= dt;
        const needsPath = !this.path || this.replanCD <= 0 || this.pathIdx >= this.path.length;
        if (needsPath) {
          this.replanCD = 0.35;
          const start = worldToCell(fromX, fromZ);
          const goal = nearestOpenCell(worldToCell(toX, toZ));
          const rawCells = astar(start, goal);
          if (rawCells) {
            this.path = smoothPath(rawCells.map((c) => cellToWorld(c.cx, c.cz)));
            this.pathIdx = 1; // index 0 is the agent's own current cell
          } else {
            this.path = null;
          }
        }
        if (!this.path || this.pathIdx >= this.path.length) return { x: toX, z: toZ };
        const wp = this.path[this.pathIdx];
        if (Math.hypot(wp.x - fromX, wp.z - fromZ) < 1.0) this.pathIdx++;
        return this.pathIdx < this.path.length ? this.path[this.pathIdx] : { x: toX, z: toZ };
      },
    };
  }

  return { createPather };
}
