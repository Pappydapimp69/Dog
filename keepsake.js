/* Dog Park 3D — the keepsake: one persistent object the dog carries in his mouth.
 *
 * This is NOT a fetch toy (see fetch.js — those are ephemeral park props that
 * lure NPC dogs and get thrown around). The keepsake is the story's physical
 * spine: Errol's bald tennis ball, found in the rain at the midpoint, carried
 * from Act 2 all the way into the recognition ending. It:
 *   - is acquired ONCE at a story beat and then persists across acts + saves,
 *   - emits a re-smellable scent aura (the green "park" lane — cut grass, cedar
 *     chips, a hundred dogs) so the player can always find it on the wind,
 *   - can be set down and picked back up (losing it in Act 3 is meant to sting),
 *   - can roll to a target on command (the ball rolling to Maya's shoe at the
 *     recognition scene is the story's final gesture).
 *
 * THREE is INJECTED (opts.THREE) so the state machine below is unit-testable in
 * Node with a stub — same pattern as scent.js / cutscene.js. The scent field is
 * fetched lazily via opts.getScent() because createGame() runs before world.js
 * assigns window.__scent (the same ordering hazard scent-follow already hit).
 */

// How the aura is laid. Emitting every frame would flood the field; a fixed
// step keeps it deterministic and cheap. Each deposit is a forced, sheltered
// PARK node at the ball's current spot, so the aura is re-smellable anytime: a
// set-down ball holds a stationary pool, a carried ball lays a following thread
// (the green ribbon that, in Act 3's storm, is the only warm thing left on the
// wind and pulls the player toward the fence). The field's mergeRadius + decay
// keep the moving case from piling up unbounded nodes.
const AURA_STEP = 0.55;        // seconds between scent deposits
// CARRY_Y/MOUTH_FWD scaled to match the dog's visual size (world.js's
// DOG_VISUAL_SCALE, 0.55) — unscaled, the ball floats above/ahead of the
// now-smaller mouth instead of riding it.
const CARRY_Y = 0.34;          // ball height riding the muzzle
const MOUTH_FWD = 0.69;        // how far ahead of the dog's center the muzzle is
const REST_Y = 0.22;           // ball radius — where it sits on the ground
const ROLL_SPEED = 5.2;        // world units/sec when rolling to a target

export function createKeepsake(scene, audio, opts) {
  const { THREE, getDog, getHeading, getScent } = opts;

  let has = false;        // has the ball been acquired at all (the story flag)
  let carried = false;    // in the dog's mouth vs. resting/rolling in the world
  let group = null;       // lazily built on first acquire
  let auraT = 0;          // accumulator toward the next scent deposit
  let roll = null;        // { x, z, onArrive } while rolling to a target
  const pos = { x: 0, y: REST_Y, z: 0 };  // world position when NOT carried

  const scentLane = () => {
    const sc = getScent && getScent();
    return sc ? sc.SCENT.PARK : "park"; // green lane: cedar chips + a hundred dogs
  };

  // ---- mesh: a worn bald tennis ball (a two-tone felt sphere + a seam) ----
  function build() {
    if (group || !THREE) return;
    group = new THREE.Group();
    const felt = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xc4d24a, roughness: 0.95 }));
    felt.castShadow = true;
    group.add(felt);
    // the pale worn-bald patch + the curved seam, so it reads as an old ball
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.018, 6, 24),
      new THREE.MeshStandardMaterial({ color: 0xf2f0d8, roughness: 1 }));
    seam.rotation.x = Math.PI / 2.6;
    group.add(seam);
    group.visible = false;
    scene.add(group);
  }

  // Where the ball rides when carried (just ahead of the dog's snout).
  function muzzle() {
    const d = getDog(), h = getHeading ? getHeading() : 0;
    return { x: d.x + Math.sin(h) * MOUTH_FWD, y: CARRY_Y, z: d.z + Math.cos(h) * MOUTH_FWD };
  }

  // Acquire the ball for the first time (the midpoint beat). Idempotent.
  function acquire() {
    if (has) return false;
    build();
    has = true; carried = true; roll = null; auraT = 0;
    if (group) group.visible = true;
    if (audio && audio.collect) audio.collect("ball");
    return true;
  }

  // Set it down at the dog's feet (a deliberate act — a memorial placement, or
  // freeing the mouth). Emits a strong stationary pool immediately.
  function setDown() {
    if (!has || !carried) return false;
    const d = getDog();
    carried = false; roll = null;
    pos.x = d.x; pos.y = REST_Y; pos.z = d.z;
    if (group) { group.position.set(pos.x, pos.y, pos.z); group.visible = true; }
    deposit();
    return true;
  }

  // Pick it back up (only if it's down and the dog is close enough to reach it).
  function pickUp(reach = 2.2) {
    if (!has || carried || roll) return false;
    const d = getDog();
    if (Math.hypot(d.x - pos.x, d.z - pos.z) > reach) return false;
    carried = true;
    if (audio && audio.collect) audio.collect("ball");
    return true;
  }

  // Drop it at an explicit spot (Act 3 "you lost the ball" panic beat, or the
  // capture where Vega lets him keep it right where he set it).
  function dropAt(x, z) {
    if (!has) return false;
    carried = false; roll = null;
    pos.x = x; pos.y = REST_Y; pos.z = z;
    if (group) { group.position.set(x, REST_Y, z); group.visible = true; }
    deposit();
    return true;
  }

  // Roll to a target and settle (the recognition gesture: it rolls to her shoe).
  // Takes the ball out of the mouth first if carried.
  function rollTo(x, z, onArrive) {
    if (!has) return false;
    if (carried) { const d = getDog(); pos.x = d.x; pos.z = d.z; }
    carried = false;
    pos.y = REST_Y;
    roll = { x, z, onArrive: typeof onArrive === "function" ? onArrive : null };
    if (group) group.visible = true;
    return true;
  }

  function deposit() {
    const sc = getScent && getScent();
    if (!sc) return;
    const p = carried ? muzzle() : pos;
    // force + full shelter so the keepsake's aura is re-smellable ANYTIME — even
    // standing still. A non-forced deposit is gated by the field's depositStep
    // (a source must travel ~1.6u before dropping a node), which would leave a
    // motionless held ball with no aura at all. force bypasses that; the field's
    // mergeRadius/decay still bound the node count and wash it out in the open.
    sc.emit(scentLane(), p.x, p.z, { force: true, shelter: 1 });
  }

  function update(dt) {
    if (!has || !group) return;
    if (roll) {
      const dx = roll.x - pos.x, dz = roll.z - pos.z, dd = Math.hypot(dx, dz);
      const step = ROLL_SPEED * dt;
      if (dd <= step || dd < 1e-3) {
        pos.x = roll.x; pos.z = roll.z;
        const cb = roll.onArrive; roll = null;
        group.position.set(pos.x, REST_Y, pos.z);
        if (cb) cb();
      } else {
        pos.x += (dx / dd) * step; pos.z += (dz / dd) * step;
        group.position.set(pos.x, REST_Y, pos.z);
        group.rotation.x += dt * 9; group.rotation.z += dt * 6; // rolling spin
      }
    } else if (carried) {
      const m = muzzle();
      group.position.set(m.x, m.y, m.z);
      group.rotation.y += dt * 1.5;
    } else {
      group.position.set(pos.x, REST_Y, pos.z);
    }
    // periodic aura deposit (deterministic fixed step)
    auraT += dt;
    while (auraT >= AURA_STEP) { auraT -= AURA_STEP; deposit(); }
  }

  function remove() {
    if (group) { scene.remove(group); group = null; }
    const sc = getScent && getScent();
    if (sc) sc.clearSource(scentLane());
    has = false; carried = false; roll = null;
  }

  function serialize() {
    return has ? { has: 1, carried: carried ? 1 : 0, x: +pos.x.toFixed(3), z: +pos.z.toFixed(3) } : null;
  }
  function restore(data) {
    if (!data || !data.has) { has = false; carried = false; if (group) group.visible = false; return; }
    build();
    has = true; carried = !!data.carried; roll = null; auraT = 0;
    pos.x = data.x || 0; pos.z = data.z || 0; pos.y = REST_Y;
    if (group) group.visible = true;
  }

  return {
    update, acquire, setDown, pickUp, dropAt, rollTo, remove,
    has: () => has,
    isCarried: () => carried,
    isRolling: () => !!roll,
    position: () => (carried ? muzzle() : { x: pos.x, y: REST_Y, z: pos.z }),
    serialize, restore,
    _debug: () => ({ has, carried, rolling: !!roll, x: pos.x, z: pos.z, auraT }),
  };
}
