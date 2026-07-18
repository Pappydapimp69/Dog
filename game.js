/* Dog Park 3D — the game layer: traits, relationships, disguises, the dog
 * catcher, a persistent story guide, and a 3-level "get adopted" campaign.
 *
 * Every character carries a fixed trait set (friendliness / dogLover /
 * suspicion / patience) that drives how warmly they react to the player and to
 * each other, plus an evolving `rapport` that remembers past interactions.
 */
import * as THREE from "./vendor/three.module.js";
import { createFetch } from "./fetch.js?v=__BUILD__";

const GENERIC_NAMES = ["Tom", "Priya", "Sam", "Dana", "Leo", "Nora", "Wes"];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// How close counts as "in reach" for the contextual action (label + E / ACT).
const REACH_PERSON = 5.5;
const REACH_ITEM = 3.2;
const STAGE_REACH = 2.5; // tight — must stand at the marked beacon spot, not just "near the stage"

// Deterministic per-character traits, so a character is "the same person"
// every playthrough.
function traitsFor(i, role) {
  if (role === "guide") return { friendliness: 0.95, dogLover: 1.0, suspicion: 0.02, patience: 0.95 };
  if (role === "adopter") return { friendliness: 0.62, dogLover: 0.85, suspicion: 0.35, patience: 0.6 };
  if (role === "volunteer") return { friendliness: 0.78, dogLover: 0.92, suspicion: 0.12, patience: 0.85 };
  const r = (n) => { const x = Math.sin((i + 1) * 97.13 + n * 41.7) * 43758.5453; return x - Math.floor(x); };
  return { friendliness: 0.3 + r(1) * 0.55, dogLover: 0.2 + r(2) * 0.7, suspicion: 0.1 + r(3) * 0.5, patience: 0.3 + r(4) * 0.5 };
}

export function createGame(scene, audio, opts) {
  const { world, pond, getDog, setDogPos, setDogHeading, people, dogGroup, dogs, getHeading, getDevice, feedDucks, setDogScare, fair, pathfinder, crowds, obstacles } = opts;
  // Obstacle-aware chase pathfinding (brain: local/sandbox-dog-pathfinding,
  // verified in a 5-pass sandbox before landing here) — one pather per
  // chasing entity, sharing the one grid world.js built against the real
  // obstacle layout.
  const catcherPather = pathfinder.createPather();
  const el = (id) => document.getElementById(id);
  const ui = {
    objective: el("objective"), levelTag: el("level-tag"), objText: el("objective-text"),
    meters: el("meters"), sus: el("susbar"), susLabel: el("sus-label"), susVal: el("sus-val"), susMeter: el("sus-meter"), stam: el("stambar"), stamVal: el("stam-val"), identity: el("identity"),
    minimap: el("minimap"), friends: el("friends"), coach: el("coach"),
    prompt: el("prompt"), toast: el("toast"), alert: el("alert"),
    overlay: el("story-overlay"), title: el("story-title"), text: el("story-text"), btn: el("story-btn"),
    cutOverlay: el("cutscene-overlay"), cutTitle: el("cutscene-title"), cutText: el("cutscene-text"),
    cutHoldFill: el("cutscene-hold-fill"), cutHint: el("cutscene-hint"),
    trickSit: el("trick-sit-btn"), trickSpin: el("trick-spin-btn"), trickSpeak: el("trick-speak-btn"),
    trickSeq: el("trick-sequence"),
  };
  const actBtn = el("act-btn"); // single context-sensitive action button (mobile)
  const barkBtn = el("bark-btn"); // shows a radial recharge sweep while cooling

  // ---- player game-state ----
  // barkRange / barkPower / barkCooldown are tunable so the bark can be upgraded
  // later (stronger, farther, faster) — the shockwave visual reads barkRange.
  const player = {
    collar: false, bandana: false, clean: 1, suspicion: 0.35, barkHeat: 0, adopted: false,
    barkRange: 13, barkPower: 1, barkCooldown: 0.45, barkCD: 0,
    barkLevel: 0, barkXP: 0, speedMul: 1, speedBoostT: 0, stamina: 1,
    knownTricks: [], trickXP: { sit: 0, spin: 0, speak: 0 },
  };

  // ---- persistent save (localStorage) — resume level, disguise, bond, bark ----
  const SAVE_KEY = "dogpark-save-v1";
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) { saved = null; }
  // Shared builder so localStorage saves and exported save CODES carry the
  // same fields (brain lesson: bundle the seed with saved state for exact
  // reproducibility — a code round-trips the whole park, not just progress).
  function buildSaveData() {
    return {
      level, collar: player.collar, bandana: player.bandana,
      barkLevel: player.barkLevel, barkXP: player.barkXP,
      knownTricks: [...player.knownTricks], trickXP: { ...player.trickXP },
      rapport: people.map((p) => +p.rapport.toFixed(3)),
      achievements: [...unlocked],
      coachDone,
      seed: (typeof window !== "undefined" && window.__seed) || null,
    };
  }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(buildSaveData())); } catch (e) {}
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  // ---- full save codes: a copyable base64 code carrying the whole save,
  // portable across devices/browsers with no backend (extends the #seed=
  // sharing precedent to progress too). ----
  function exportSaveCode() {
    try { return btoa(JSON.stringify(buildSaveData())); } catch (e) { return null; }
  }
  function importSaveCode(code) {
    let data;
    try { data = JSON.parse(atob(String(code).trim())); } catch (e) { return { ok: false, error: "That doesn't look like a valid save code." }; }
    if (!data || typeof data !== "object") return { ok: false, error: "That doesn't look like a valid save code." };
    // never trust external input — clamp/ignore anything malformed field by field
    if (Number.isFinite(data.level)) level = clamp(data.level | 0, 0, levels.length - 1);
    if (Array.isArray(data.rapport)) {
      people.forEach((p, i) => { if (typeof data.rapport[i] === "number" && Number.isFinite(data.rapport[i])) p.rapport = clamp(data.rapport[i], -1, 1); });
    }
    if (Number.isFinite(data.barkLevel)) { player.barkLevel = clamp(data.barkLevel | 0, 0, 3); player.barkXP = Number.isFinite(data.barkXP) ? Math.max(0, data.barkXP | 0) : 0; applyBarkStats(); }
    restoreTricks(data);
    if (data.collar && !player.collar) { player.collar = true; addWearable("collar"); }
    if (data.bandana && !player.bandana) { player.bandana = true; addWearable("bandana"); }
    if (Array.isArray(data.achievements)) { for (const a of data.achievements) if (ACH[a]) unlocked.add(a); }
    enterLevel(); // refresh the HUD/objective text for the (possibly new) level
    save();
    const seedNote = (data.seed && data.seed !== window.__seed) ? " (its park seed differs from this one — copy its park link too if you want the exact same park)" : "";
    return { ok: true, note: seedNote };
  }
  const unlocked = new Set(saved && saved.achievements ? saved.achievements : []);
  // Bark stats derive from level so upgrades stay clamped (brain: gamedesign E9).
  function applyBarkStats() {
    const lv = player.barkLevel = clamp(player.barkLevel, 0, 3);
    player.barkPower = 1 + lv * 0.45;
    player.barkRange = 13 + lv * 4;
  }
  // ---- achievements (persisted in the save) ----
  const ACH = {
    firstfriend: "First Friend 🐾", zoomies: "Zoomies! 🍖", bestfriends: "Best Friends 💛",
    barklord: "Bark Lord 🔊", disguised: "Master of Disguise 🥸", adopted: "Forever Home 🏡",
    ducktamer: "Duck Whisperer 🦆", showoff: "Show-off 🎓",
  };
  function unlock(id) {
    if (unlocked.has(id) || !ACH[id]) return;
    unlocked.add(id); save();
    toast(`🏆 Achievement: ${ACH[id]}`);
  }
  function checkFriends() {
    const n = people.filter((p) => p.rapport >= 0.7).length;
    if (n >= 1) unlock("firstfriend");
    if (n >= 2) unlock("bestfriends");
  }

  // ---- characters ----
  people.forEach((p, i) => {
    p.role = i === 0 ? "guide" : i === 1 ? "adopter" : i === 2 || i === 3 ? "volunteer" : "parkgoer";
    p.cname = p.role === "guide" ? "Maya" : p.role === "adopter" ? "Mrs. Bell"
      : p.role === "volunteer" ? (i === 2 ? "Priya" : "Sam") : GENERIC_NAMES[i % GENERIC_NAMES.length];
    p.traits = traitsFor(i, p.role);
    // Each park-goer favours a different trick and reacts to performances with
    // their own warmth, so showing off never plays out the same on everyone.
    p.favTrick = ["sit", "spin", "speak"][i % 3];
    p.want = null; p.wantCD = 4 + Math.random() * 12; p.wantT = 0; p.barkRapportCD = 0; p.showCD = 0;
    p.rapport = p.traits.dogLover * 0.2;
    if (saved && Array.isArray(saved.rapport) && typeof saved.rapport[i] === "number") p.rapport = saved.rapport[i];
    p.mood = 0; p.greetCD = Math.random() * 6;
    // Volunteers live at the Adoption Fair (Level 3) — home-anchor their
    // wander there instead of the whole map, and start them on-site.
    if (p.role === "volunteer" && fair && fair.volunteerSpots) {
      const spot = fair.volunteerSpots[i - 2];
      if (spot) { p.home = { x: spot.x, z: spot.z }; p.pos.set(spot.x, 0, spot.z); p.group.position.copy(p.pos); }
    }
    if (p.role !== "parkgoer") addMarker(p, p.role === "guide" ? 0xffd23a : p.role === "adopter" ? 0xff6bd0 : 0x3ad6ff);
  });
  const guide = people[0], adopter = people[1];

  // ---- Rex: a rival dog competing for adoption (Level 3). He doesn't exist
  // in the world until Level 3 begins (spawnRex), then challenges the player
  // to a two-round contest — a fetch-off, then a trick showcase — at the
  // fair. Both must be won; losing either lets the player retry.
  let rex = null;
  let contest = null; // null | { stage, fetchWin, trickWin, ... } — see startContest()
  let rexContestWon = false;
  // Survives finishContest(false) — set once the fetch-off is actually won,
  // so a re-challenge after losing JUST the trick showcase skips straight
  // back to the trick phase instead of forcing the fetch-off to be redone.
  let fetchOffWon = false;
  const REX_TRICK_SKILL = 0.4; // clamped 0.2-0.75 in the actual roll — never a guaranteed win/loss for either side
  const REX_STAMINA_CAP = 0.65; // 35% less than the player's 1.0 ceiling — same drain/recover rates, lower tank
  const REX_FETCH_SPEED_FULL = 14, REX_FETCH_SPEED_TIRED = 8; // ratio mirrors the player's 16-sprint/9-walk split

  // ---- "The Great Escape" — the interactive beat between the adoption
  // recap and actually reseeding into a new town (see win()/startEscape()).
  // Sneak to a gate on the far side of the map without waking Mrs. Bell:
  // proximity + speed near her raises a Wake meter, barking spikes it hard.
  // Reaching the gate ALWAYS succeeds regardless of the meter — it's pure
  // tension, never a blocker, so this can never soft-lock the ending.
  let escapeWake = 0, escapeAlertT = 0, escapeGate = null, escapeOwner = null, escapeSeed = null;
  let escPrevX = null, escPrevZ = null;

  // A single fixed, marked spot to start/resume the contest — matches
  // respawnAtStage()'s own anchor exactly, so triggering from here never
  // causes a jarring reposition once the cutscene snaps you there. A visible
  // beacon (same cone language as addMarker's NPC markers) replaces the old
  // fuzzy "anywhere near the stage" radius, which had no marker at all.
  const stageMark = fair && fair.stage ? { x: fair.stage.x, z: fair.stage.z + 6 } : null;
  if (stageMark) {
    const beacon = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffd23a, emissiveIntensity: 0.6 }));
    beacon.position.set(stageMark.x, 2.4, stageMark.z); beacon.rotation.x = Math.PI;
    scene.add(beacon);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(stageMark.x, 0.04, stageMark.z);
    scene.add(ring);
  }

  function spawnRexNearFair() {
    if (rex || !opts.spawnRex || !fair || !fair.volunteerSpots) return;
    const v0 = fair.volunteerSpots[0], v1 = fair.volunteerSpots[1];
    const x = (v0.x + v1.x) / 2, z = (v0.z + v1.z) / 2 + 6;
    rex = opts.spawnRex(x, z);
    rex.stamina = REX_STAMINA_CAP; rex.fetchSpeed = REX_FETCH_SPEED_FULL;
    const ribbon = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.28, 8),
      new THREE.MeshStandardMaterial({ color: 0xff3b6b, emissive: 0xff3b6b, emissiveIntensity: 0.5 }));
    ribbon.position.set(0, 1.05, 0.2); ribbon.rotation.x = Math.PI; rex.group.add(ribbon);
  }

  function addMarker(p, color) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
    m.position.y = 2.85; m.rotation.x = Math.PI; p.group.add(m); p.marker = m;
  }

  // ---- carryable items + fetch/play system ----
  const fetchSys = createFetch(scene, audio, { getDog, getHeading, npcDogs: dogs, world, pathfinder, obstacles });

  // A glowing ring that snaps under whatever is currently in reach.
  const targetRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.08, 8, 30),
    new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85 })
  );
  targetRing.rotation.x = Math.PI / 2;
  targetRing.visible = false;
  scene.add(targetRing);

  // ---- thought bubbles: a canvas-sprite that floats over a dog/person to
  // telegraph what it wants (the frisbee-thief's craving) or its state. ----
  const bubbleTex = {};
  function roundRect(cx, x, y, w, h, r) {
    cx.beginPath(); cx.moveTo(x + r, y);
    cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r);
    cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath();
  }
  function bubbleTexture(emoji) {
    if (bubbleTex[emoji]) return bubbleTex[emoji];
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const cx = cv.getContext("2d");
    cx.fillStyle = "rgba(255,255,255,0.96)"; cx.strokeStyle = "rgba(20,20,30,0.18)"; cx.lineWidth = 5;
    roundRect(cx, 14, 8, 100, 82, 22); cx.fill(); cx.stroke();
    cx.beginPath(); cx.moveTo(50, 88); cx.lineTo(60, 116); cx.lineTo(72, 88); cx.closePath();
    cx.fillStyle = "rgba(255,255,255,0.96)"; cx.fill();
    cx.font = "60px serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText(emoji, 64, 50);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 2;
    bubbleTex[emoji] = t; return t;
  }
  function makeBubble() {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
    s.scale.set(1.5, 1.5, 1.5); s.visible = false; s.renderOrder = 999; scene.add(s); return s;
  }
  function setBubble(b, emoji, x, y, z) {
    b.material.map = bubbleTexture(emoji); b.material.needsUpdate = true;
    b.visible = true; b.position.set(x, y, z);
  }
  dogs.forEach((d) => { d.bubble = makeBubble(); });
  people.forEach((p) => { p.bubble = makeBubble(); });

  // ---- bark shockwave: an expanding ring from the dog's mouth that fades out
  // over barkRange, giving visible feedback and a sense of the bark's reach. ----
  // Rings are pooled and reused (no per-bark allocate/dispose churn).
  const barkWaves = [], barkWavePool = [];
  function acquireRing() {
    let w = barkWavePool.pop();
    if (!w) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1.0, 36),
        new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2; ring.renderOrder = 998;
      w = { mesh: ring };
    }
    scene.add(w.mesh); w.mesh.visible = true;
    return w;
  }
  function spawnBarkWave() {
    const d = getDog(), h = getHeading();
    const w = acquireRing();
    w.t = 0; w.range = player.barkRange; w.mesh.material.opacity = 0.6;
    w.mesh.position.set(d.x + Math.sin(h) * 1.1, 0.28, d.z + Math.cos(h) * 1.1); // from the mouth
    barkWaves.push(w);
  }
  function updateBarkWaves(dt) {
    const DUR = 0.55;
    for (let i = barkWaves.length - 1; i >= 0; i--) {
      const w = barkWaves[i]; w.t += dt;
      const k = w.t / DUR;
      const s = 0.9 + k * (w.range - 0.9); // grow from the mouth out to barkRange
      w.mesh.scale.set(s, s, s);
      w.mesh.material.opacity = 0.6 * (1 - k); // fades over the distance it travels
      if (k >= 1) { scene.remove(w.mesh); barkWaves.splice(i, 1); barkWavePool.push(w); }
    }
  }

  // ---- juice: pooled expanding "pop" rings on pickups/bonds (idea: tween-the-transient) ----
  const pops = [], popPool = [];
  function spawnPop(x, z, color, maxR) {
    if (typeof window !== "undefined" && window.__settings && window.__settings.reduceMotion) return;
    let w = popPool.pop();
    if (!w) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 24),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.renderOrder = 996; w = { mesh: ring };
    }
    w.mesh.material.color.setHex(color); w.mesh.material.opacity = 0.7;
    w.mesh.position.set(x, 0.32, z); w.t = 0; w.max = maxR || 3;
    scene.add(w.mesh); w.mesh.visible = true; pops.push(w);
  }
  function updatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const w = pops[i]; w.t += dt; const k = w.t / 0.4;
      const s = 0.55 + k * (w.max - 0.55); w.mesh.scale.set(s, s, s);
      w.mesh.material.opacity = 0.7 * (1 - k);
      if (k >= 1) { scene.remove(w.mesh); pops.splice(i, 1); popPool.push(w); }
    }
  }

  // ---- petting hearts: pooled sprites that rise when someone bonds with you ----
  const heartTex = (() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 64;
    const cx = cv.getContext("2d"); cx.font = "52px serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText("💛", 32, 34); return new THREE.CanvasTexture(cv);
  })();
  const hearts = [], heartPool = [];
  function spawnHearts(x, z, n) {
    if (typeof window !== "undefined" && window.__settings && window.__settings.reduceMotion) return;
    for (let i = 0; i < n; i++) {
      let h = heartPool.pop();
      if (!h) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthTest: false })); s.scale.set(0.85, 0.85, 0.85); s.renderOrder = 997; h = { s }; }
      scene.add(h.s); h.s.visible = true; h.life = 1;
      h.vx = (Math.random() - 0.5) * 0.5; h.vz = (Math.random() - 0.5) * 0.5;
      h.s.material.opacity = 1;
      h.s.position.set(x + (Math.random() - 0.5), 2.3, z + (Math.random() - 0.5));
      hearts.push(h);
    }
  }
  function updateHearts(dt) {
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i]; h.life -= dt * 0.8;
      h.s.position.y += dt * 1.2; h.s.position.x += h.vx * dt; h.s.position.z += h.vz * dt;
      h.s.material.opacity = Math.max(0, h.life);
      if (h.life <= 0) { scene.remove(h.s); hearts.splice(i, 1); heartPool.push(h); }
    }
  }

  // ---- payoff-moment juice: screen confetti, a brief flash, an in-world burst.
  // The peak beats (level clear, adoption) deserve real celebration feedback,
  // not just a text card — audio-visual reward reinforcement is the core of the
  // action→feedback→reward loop. All of it is presentational and reduce-motion
  // aware (spawnHearts/spawnPop self-gate; confetti checks it directly).
  function confettiBurst(n) {
    if (typeof window !== "undefined" && window.__settings && window.__settings.reduceMotion) return;
    const host = el("confetti"); if (!host) return;
    const cols = ["#ff8a3d", "#ffd24a", "#4cdc79", "#4a90e2", "#ff6bd0", "#8b84e0", "#ffffff"];
    for (let i = 0; i < n; i++) {
      const b = document.createElement("div");
      b.className = "confetti-bit";
      b.style.left = (Math.random() * 100).toFixed(1) + "vw";
      b.style.background = cols[(Math.random() * cols.length) | 0];
      const dur = 2.2 + Math.random() * 1.9;
      b.style.animationDuration = dur.toFixed(2) + "s";
      b.style.animationDelay = (Math.random() * 0.35).toFixed(2) + "s";
      host.appendChild(b);
      setTimeout(() => b.remove(), (dur + 0.5) * 1000);
    }
  }
  function flashScreen(color) {
    const f = el("flash"); if (!f) return;
    f.style.background = color || "#fff";
    f.classList.remove("go"); void f.offsetWidth; // reflow so the animation restarts
    f.classList.add("go");
  }
  function celebrateAt(x, z) {
    spawnHearts(x, z, 8);
    const cols = [0xffd24a, 0xff6bd0, 0x4cdc79, 0x4a90e2];
    for (const c of cols) spawnPop(x + (Math.random() * 4 - 2), z + (Math.random() * 4 - 2), c, 3.4);
  }
  // Per-round sting so each contest round lands: a small burst on a win, a
  // gentle flash on a loss (kept soft — research: reinforce the attempt, don't
  // make a lost round read as failure; the toasts already say "once more").
  function roundResult(playerWon) {
    if (playerWon) { const d = getDog(); celebrateAt(d.x, d.z); }
    else flashScreen("#d8463a");
  }

  // First-fetch coach: one subtle line under the objective that names the NEXT
  // step of fetch — the game's one multi-step verb — so a brand-new player isn't
  // left guessing when they're not stood on the object the context prompt reacts
  // to. Reads the REAL fetch state each frame (teach-by-doing), and is gated to
  // Level 1, first time only; returnTo() retires it after one full fetch.
  function updateCoach() {
    if (!ui.coach) return;
    if (phase !== "play") { ui.coach.classList.add("hidden"); return; }
    // Phase 1 — teach fetch (Level 1, until the first full fetch completes).
    if (!coachDone && level === 0) {
      const carrying = !!fetchSys.carrying();
      const waiting = people.some((p) => p.waiting);
      const msg = carrying && waiting ? "🎯 Bring the 🥏 back — walk to them and press E to return it"
        : carrying ? "🎯 Carry the 🥏 to someone you've greeted, press E to play"
        : waiting ? "🎯 Fetch the 🥏 they threw — chase it down and grab it"
        : "🎯 To bond, play fetch — walk over a 🥏 frisbee to pick it up";
      if (ui.coach.textContent !== msg) ui.coach.textContent = msg;
      ui.coach.classList.remove("hidden");
      return;
    }
    // Phase 2 — teach tricks. Once fetch is known but no trick is, keep a
    // steady reminder of how each is learned; the emergent learn-by-doing was
    // too easy to miss as a single flash toast, and the Level 3 showcase
    // assumes the player already knows Sit/Spin/Speak. Shown on the levels
    // where tricks matter (L1 groundwork, L3 pre-contest), retired the moment
    // they learn one. Hidden during the contest itself.
    if (!contest && player.knownTricks.length === 0 && (level === 0 || level === 2)) {
      const msg = "🎓 Learn a trick: stand still = SIT · walk a tight circle = SPIN · bark by a friend = SPEAK";
      if (ui.coach.textContent !== msg) ui.coach.textContent = msg;
      ui.coach.classList.remove("hidden");
      return;
    }
    ui.coach.classList.add("hidden");
  }

  // ---- emergent park events: occasional spontaneous moments so the park feels
  // alive. #1 — a loose balloon drifts in; JUMP to pop it (getDog().y clears the
  // ground only mid-jump) and the nearby crowd delights: a rapport bump scaled
  // by dog-love that feeds the word-of-mouth system. Self-limiting (one at a
  // time, long cooldown), readable (a bright balloon + a first-time toast),
  // reduce-motion safe (the pop/heart particles self-gate), and cleared on any
  // non-play phase so it never lingers into a cutscene or the Rex contest.
  const BALLOON_COLS = [0xff5b6b, 0x4a90e2, 0xffd24a, 0x4cdc79, 0xff6bd0];
  let balloon = null, balloonCD = 30 + Math.random() * 30, balloonSeen = false;
  function spawnBalloon() {
    const g = new THREE.Group();
    const col = BALLOON_COLS[Math.floor(Math.random() * BALLOON_COLS.length)];
    const skin = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), skin); body.scale.y = 1.15; g.add(body);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 6), skin); knot.position.y = -0.48; g.add(knot);
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })); str.position.y = -1.05; g.add(str);
    const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 22;
    g.position.set(Math.cos(a) * r, 2.1, Math.sin(a) * r);
    scene.add(g);
    balloon = { g, vx: (Math.random() - 0.5) * 1.3, vz: (Math.random() - 0.5) * 1.3, life: 26, ph: Math.random() * 6.28, col, away: false };
  }
  function clearBalloon() { if (balloon) { scene.remove(balloon.g); balloon = null; balloonCD = 40 + Math.random() * 40; } }
  function popBalloon() {
    const p = balloon.g.position, col = balloon.col;
    scene.remove(balloon.g); balloon = null; balloonCD = 40 + Math.random() * 40;
    spawnPop(p.x, p.z, col, 4.4); spawnHearts(p.x, p.z, 5);
    if (audio.collect) audio.collect();
    for (const q of people) { // delight ripple: nearby folk warm up, most if dog-loving; feeds gossip
      if (q.role === "adopter") continue;
      const dd = dist2(p.x, p.z, q.pos.x, q.pos.z);
      if (dd > 16) continue;
      q.rapport = clamp(q.rapport + 0.05 * (0.4 + q.traits.dogLover) * (1 - dd / 16), -1, 1);
      q.mood = Math.min(1, (q.mood || 0) + 0.4);
    }
    checkFriends();
    if (!balloonSeen) { balloonSeen = true; toast("🎈 Pop! The park delights — a playful pup wins hearts."); }
  }
  function updateEvents(dt, time) {
    if (phase !== "play" || contest) { clearBalloon(); return; }
    if (!balloon) { balloonCD -= dt; if (balloonCD <= 0) spawnBalloon(); return; }
    const b = balloon, p = b.g.position;
    if (!b.away) {
      p.x += b.vx * dt; p.z += b.vz * dt;
      p.y = 2.1 + Math.sin(time * 1.3 + b.ph) * 0.15;
      b.g.rotation.z = Math.sin(time * 0.9 + b.ph) * 0.12;
      b.life -= dt;
      const d = getDog();
      if (Math.hypot(d.x - p.x, d.z - p.z) < 1.5 && d.y > 1.2) { popBalloon(); return; } // pop needs a jump
      if (b.life <= 0 || Math.hypot(p.x, p.z) > 46) b.away = true;
    } else { // un-popped: floats up and fades away
      p.y += dt * 3.2;
      for (const c of b.g.children) if (c.material) { c.material.transparent = true; c.material.opacity = Math.max(0, (c.material.opacity ?? 1) - dt * 0.5); }
      if (p.y > 14) clearBalloon();
    }
  }

  // ---- treats: quick pickups that grant a short "zoomies" sprint boost ----
  const treats = [];
  function spawnTreat(x, z) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: 0x9b5a2b, roughness: 0.85 }));
    m.castShadow = true; g.add(m);
    const beacon = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.46, 6), new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.7 }));
    beacon.rotation.x = Math.PI; beacon.position.y = 1.8; g.add(beacon);
    g.position.set(x, 0.3, z); scene.add(g);
    treats.push({ group: g, mesh: m, x, z, active: true, respawn: 0 });
  }
  [[12, -30], [-30, -12], [34, 30], [-16, 34], [46, -6], [6, 44]].forEach(([x, z]) => spawnTreat(x, z));
  function updateTreats(dt, time) {
    const d = getDog();
    for (const t of treats) {
      if (t.active) {
        t.mesh.rotation.y += dt * 1.6; t.group.position.y = 0.3 + Math.sin(time * 2 + t.x) * 0.08;
        if (dist2(d.x, d.z, t.x, t.z) < 1.7) {
          t.active = false; t.group.visible = false; t.respawn = 22; // deactivate instantly (brain: phaser E5)
          player.speedMul = 1.6; player.speedBoostT = 5;
          if (audio.collect) audio.collect("ball");
          spawnPop(t.x, t.z, 0xffcf5a, 3.4); // juice: a yellow poof
          toast("🍖 Yum! Zoomies — speed boost!");
          unlock("zoomies");
        }
      } else {
        t.respawn -= dt; if (t.respawn <= 0) { t.active = true; t.group.visible = true; }
      }
    }
    if (player.speedBoostT > 0) { player.speedBoostT -= dt; if (player.speedBoostT <= 0) player.speedMul = 1; }
  }

  // ---- hungry NPC dogs: idle dogs get peckish and go for treat pickups too,
  // occasionally beating the player to one (idea: energy-food-reproduce). The
  // population self-regulates off the same treat supply: a dog that eats
  // repeatedly earns the pack a pup (up to POP_CAP); a dog that goes too long
  // without finding food (genuine scarcity, not just idle hunger) dies (down
  // to POP_FLOOR, so the park is never emptied). Rex is a scripted contest
  // character, not part of the wild pack, and is excluded from both. ----
  const POP_CAP = 14, POP_FLOOR = 3, STARVE_DEATH_T = 45, MEALS_TO_BREED = 3;
  function wildPopCount() { let n = 0; for (const d of dogs) if (!d.isRex) n++; return n; }
  function moveDogTo(d, tx, tz, dt, sp) {
    const dx = tx - d.pos.x, dz = tz - d.pos.z, dd = Math.hypot(dx, dz) || 1;
    d.pos.x += (dx / dd) * sp * dt; d.pos.z += (dz / dd) * sp * dt;
    d.heading = Math.atan2(dx, dz); d.legPhase += dt * sp * 1.4;
    return dd;
  }
  function updateHungryDogs(dt) {
    for (let i = dogs.length - 1; i >= 0; i--) {
      const d = dogs[i];
      if (d.isRex) continue; // Rex has his own stamina/fetch state machine
      if (d.hunger === undefined) d.hunger = Math.random() * 0.4; // a little jitter so they don't all crave at once
      if (d.mealsSinceBirth === undefined) d.mealsSinceBirth = 0;
      if (d.starveT === undefined) d.starveT = 0;
      if (d.task === "hungry") {
        const t = d.hungerTarget;
        if (!t || !t.active) { d.task = null; d.hungerTarget = null; continue; } // treat taken/expired first
        if (!d._pather) d._pather = pathfinder.createPather(i);
        const steer = d._pather.getSteerTarget(d.pos.x, d.pos.z, t.x, t.z, dt);
        moveDogTo(d, steer.x, steer.z, dt, d.speed * 1.3);
        const dd = dist2(d.pos.x, d.pos.z, t.x, t.z); // distance to the TREAT, not the steering waypoint
        if (dd < 1.3) {
          t.active = false; t.group.visible = false; t.respawn = 22;
          spawnPop(t.x, t.z, 0xffcf5a, 2.2); // a smaller poof than the player's
          d.hunger = 0; d.task = null; d.hungerTarget = null; d.starveT = 0;
          d.mealsSinceBirth++;
          if (d.mealsSinceBirth >= MEALS_TO_BREED && wildPopCount() < POP_CAP && opts.spawnPup) {
            opts.spawnPup(d.pos.x, d.pos.z);
            spawnPop(d.pos.x, d.pos.z, 0xa0ffcf, 1.8);
            d.mealsSinceBirth = 0;
          }
        }
        continue;
      }
      if (d.task !== null) continue; // let a busy (fetch/hold) dog be — hunger never preempts it
      d.hunger = Math.min(1, d.hunger + dt * 0.012);
      if (d.hunger >= 1) {
        d.starveT += dt;
        if (d.starveT > STARVE_DEATH_T && wildPopCount() > POP_FLOOR) {
          scene.remove(d.group); dogs.splice(i, 1);
          spawnPop(d.pos.x, d.pos.z, 0x888888, 1.6);
          continue;
        }
      } else {
        d.starveT = 0;
      }
      if (d.hunger > 0.55) {
        let best = null, bd = 24;
        for (const t of treats) {
          if (!t.active) continue;
          const dd = dist2(d.pos.x, d.pos.z, t.x, t.z);
          if (dd < bd) { bd = dd; best = t; }
        }
        if (best) { d.task = "hungry"; d.hungerTarget = best; }
      }
    }
  }

  // ---- friends panel: named park-goers and your bond with each ----
  let friendsTimer = 0;
  function updateFriends(dt) {
    const cv = ui.friends; if (!cv || cv.classList.contains("hidden")) return;
    friendsTimer -= dt; if (friendsTimer > 0) return; friendsTimer = 0.4;
    const named = people.filter((p) => p.role !== "parkgoer" || Math.abs(p.rapport - p.traits.dogLover * 0.2) > 0.001);
    const list = (named.length ? named : people).slice().sort((a, b) => b.rapport - a.rapport).slice(0, 5);
    cv.innerHTML = "<b>Park friends</b>" + list.map((p) => {
      const pct = Math.max(0, Math.round(p.rapport * 100));
      const tag = p.role === "adopter" ? " ⭐" : p.role === "guide" ? " 🧭" : p.rapport >= 0.7 ? " 💛" : "";
      return `<div class="frow"><span>${p.cname}${tag}</span><i style="width:${Math.min(100, pct)}%"></i><em>${pct}%</em></div>`;
    }).join("");
  }

  // ---- minimap: top-down radar of the park (throttled to ~12fps) ----
  let showMinimap = true, minimapTimer = 0;
  function drawMinimap(dt) {
    const cv = ui.minimap; if (!cv || cv.classList.contains("hidden")) return;
    minimapTimer -= dt; if (minimapTimer > 0) return; minimapTimer = 0.08;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const S = cv.width, R = world;
    const mx = (v) => (v / R * 0.5 + 0.5) * S;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "rgba(18,26,22,0.55)"; ctx.fillRect(0, 0, S, S);
    // pond
    ctx.fillStyle = "rgba(90,160,230,0.65)";
    ctx.beginPath(); ctx.arc(mx(pond.x), mx(pond.z), (pond.r / R) * 0.5 * S, 0, 7); ctx.fill();
    // treats
    ctx.fillStyle = "#ffcf5a";
    for (const t of treats) if (t.active) ctx.fillRect(mx(t.x) - 1.5, mx(t.z) - 1.5, 3, 3);
    // ground items
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    for (const it of fetchSys.items) if (it.state === "ground") ctx.fillRect(mx(it.pos.x) - 1, mx(it.pos.z) - 1, 2, 2);
    // people
    for (const p of people) {
      ctx.fillStyle = p.rapport >= 0.7 ? "#7ee081" : p.role === "adopter" ? "#ff6bd0" : "#e6e6e6";
      ctx.beginPath(); ctx.arc(mx(p.pos.x), mx(p.pos.z), 2.4, 0, 7); ctx.fill();
    }
    // catcher (only a threat from level 2 on)
    if (level >= 1) {
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath(); ctx.arc(mx(catcher.pos.x), mx(catcher.pos.z), 3, 0, 7); ctx.fill();
    }
    // dog + heading
    const d = getDog(), dx = mx(d.x), dz = mx(d.z), h = getHeading();
    ctx.strokeStyle = "#ffd23a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(dx, dz); ctx.lineTo(dx + Math.sin(h) * 8, dz + Math.cos(h) * 8); ctx.stroke();
    ctx.fillStyle = "#ffd23a"; ctx.beginPath(); ctx.arc(dx, dz, 3, 0, 7); ctx.fill();
  }

  // Reaction emotes: as the dog passes, nearby park-goers show how they feel
  // about it right now — a live readout of rapport (which greeting/play build
  // and word-of-mouth spreads), so the park's opinion of you is legible at a
  // glance without opening the roster. A loud bark scares the timid outright.
  const EMOTE_R = 11;
  // Returns null when the person has no real opinion of the dog yet — a
  // never-met stranger used to show a neutral 👀 just for being nearby, so
  // walking the park lit up a wall of meaningless bubbles. Only emote when it
  // carries signal: they like you (impression made), or they're wary/scared.
  function opinionEmote(p, loud) {
    if (loud && p.traits.dogLover < 0.45 && p.traits.suspicion > 0.4) return "😨";
    const r = p.rapport;
    if (r >= 0.7) return "😍";
    if (r >= 0.35) return "😀";
    if (r >= 0.1) return "🙂";
    if (r <= -0.4) return "😠";
    if (r <= -0.1) return "😒";
    return null; // neutral / no opinion — show nothing
  }
  function updateBubbles(time) {
    const d0 = getDog();
    const bob = Math.sin(time * 3) * 0.08;
    for (const d of dogs) {
      // dogs.forEach assigned bubbles once at init, before Rex (spawned on
      // entering Level 3) or any bred pup (spawned dynamically) existed — so
      // neither ever got one and their carry-want never showed. Cover it
      // lazily here instead of trusting every future spawn site to remember.
      if (!d.bubble) d.bubble = makeBubble();
      const b = d.bubble;
      if (d.holding && d.holding.kind === "frisbee") {
        const dd = dist2(d0.x, d0.z, d.pos.x, d.pos.z);
        if (dd < 6 || d.wantFlash > 0) d.revealed = true; // close inspection or a wrong offer reveals it
        if (dd < 18 || d.wantFlash > 0) {
          const emoji = d.revealed ? (d.pref === "bone" ? "🦴" : "🎾") : "🥏";
          setBubble(b, emoji, d.pos.x, 2.7 + bob, d.pos.z);
        } else b.visible = false;
      } else { b.visible = false; d.revealed = false; }
    }
    const loud = player.barkHeat > 0.25; // you're being noisy right now
    for (const p of people) {
      const b = p.bubble; if (!b) continue;
      const near = dist2(d0.x, d0.z, p.pos.x, p.pos.z) < EMOTE_R;
      const emote = near ? opinionEmote(p, loud) : null; // null = they have no reaction to show
      if (p.waiting) setBubble(b, "🥏", p.pos.x, 3.2 + bob, p.pos.z);
      else if (p.want) setBubble(b, WANT_ICON[p.want] || "❓", p.pos.x, 3.2 + bob, p.pos.z); // asking for fetch / a trick
      else if (p.ballCheer > 0) setBubble(b, "🎾", p.pos.x, 3.2 + bob, p.pos.z);
      else if (emote) setBubble(b, emote, p.pos.x, 3.2 + bob, p.pos.z); // reacts as you pass — only if they actually feel something
      else if (p.rapport >= 0.7) setBubble(b, "💛", p.pos.x, 3.2 + bob, p.pos.z); // standing fondness, seen from afar
      else b.visible = false;
    }
  }

  // ---- the dog catcher ----
  const catcher = buildCatcher();
  catcher.pos = new THREE.Vector3(60, 0, 60);
  catcher.group.position.copy(catcher.pos);
  catcher.state = "patrol"; catcher.wp = 0; catcher.lose = 0; catcher.legPhase = 0;
  catcher.lastSeen = { x: 0, z: 0 }; catcher.invT = 0;
  catcher.waypoints = [[62, 62], [-62, 62], [-62, -62], [62, -62]];
  scene.add(catcher.group);

  function buildCatcher() {
    const g = new THREE.Group();
    const uni = new THREE.MeshStandardMaterial({ color: 0x2c4a7a, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0ac69, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.88, 0.34), uni); torso.position.y = 1.5; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), skin); head.position.y = 2.12; g.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.16, 12), uni); cap.position.y = 2.32; g.add(cap);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.22), uni); peak.position.set(0, 2.28, 0.28); g.add(peak);
    const legs = [];
    for (const sx of [-1, 1]) {
      const pv = new THREE.Group(); pv.position.set(sx * 0.16, 1.05, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.22), new THREE.MeshStandardMaterial({ color: 0x1f3358 }));
      leg.position.y = -0.5; leg.castShadow = true; pv.add(leg); g.add(pv); legs.push(pv);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0xb0b0b0 }));
    pole.rotation.z = Math.PI / 2.5; pole.position.set(0.55, 1.5, 0.7); g.add(pole);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 16), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    ring.position.set(1.05, 2.05, 1.0); g.add(ring);
    return { group: g, legs };
  }

  // ---- levels ----
  const levels = [
    {
      tag: "Level 1 · New Dog in Town",
      text: "Become best friends (70%+) with 2 people — play fetch!",
      intro: { t: "A Stray's Dream", x: "You're a stray with one dream — a home. Saying hi (E / ACT) breaks the ice, but to truly bond you play: grab a 🥏 frisbee, bring it to someone, and PLAY. They'll throw it — fetch it and bring it back! Watch out, other dogs want it too." },
      check: () => people.filter((p) => p.rapport >= 0.7).length >= 2,
      done: "The park's warming up to you! But word travels — and not everyone's a fan...",
    },
    {
      tag: "Level 2 · Lay Low",
      text: "Look owned (collar OR bandana) + stay clean to drop Suspicion below 30%.",
      intro: { t: "Heat", x: "A dog catcher works this park, and a scruffy stray is just his type — and he hunts harder after dark. Disguise yourself: there's a collar tucked in the back alleys of the city district past the far corner of the park, OR have a friend tie on a bandana. Then wash in the pond (or wait for rain), and keep your Suspicion low so he loses interest." },
      check: () => (player.collar || player.bandana) && player.clean >= 0.6 && player.suspicion < 0.3,
      done: "You look like somebody's dog now. The catcher's lost interest. Time to find a real home.",
    },
    {
      tag: "Level 3 · Prove Yourself",
      text: "Win over both shelter volunteers (70%+), and beat Rex in the fetch-off + trick showcase.",
      intro: { t: "The Adoption Fair", x: "The shelter's running an adoption fair on the far side of the park. Two volunteers, Priya and Sam, are looking for a good match — win them over. But there's competition: Rex, a charming rival pup, has shown up too. Walk up and press E to challenge him — a fetch-off, then a trick showcase, best two of three each. Beat him at both to prove you're the better dog." },
      check: () => people.filter((p) => p.role === "volunteer" && p.rapport >= 0.7).length >= 2 && rexContestWon,
      done: "The volunteers are smitten, and Rex slinks off pouting — you've earned your shot at forever.",
    },
    {
      tag: "Level 4 · Forever Home",
      text: "Look your best, then win over Mrs. Bell to get adopted.",
      intro: { t: "Forever Home", x: "Mrs. Bell wants a tidy, gentle dog to adopt. Presentation matters — keep that collar on and stay clean. Win her heart, then greet her when she adores you." },
      check: () => player.adopted,
      done: "Mrs. Bell scoops you up for good — the collar goes on to stay, and the only running left to do is victory laps around the backyard.",
    },
  ];
  let level = 0;
  let phase = "idle"; // idle | play | complete | won | arrested
  let coachDone = false; // first-fetch onboarding coach; retires after one fetch
  let pendingCb = null;
  let toastTimer = 0;
  let cardTimer = 0;
  // A brief held-gaze beat between "she adores you" and the actual adoption —
  // her body language (critters.js) is already in the sustained-gaze pose by
  // this point, so this just gives the moment room to land instead of an
  // instant cut. Guaranteed exit via a plain countdown, no state can trap it.
  let pendingAdoption = false;
  let adoptionT = 0;

  // A card can be dismissed by the button, by tapping anywhere on it, or after
  // an automatic timeout — so it can never trap the player on mobile.
  function resolveCard() {
    if (ui.overlay.classList.contains("hidden")) return;
    ui.overlay.classList.add("hidden");
    cardTimer = 0;
    const cb = pendingCb; pendingCb = null;
    if (cb) cb();
  }
  ui.btn.addEventListener("click", (e) => { e.stopPropagation(); resolveCard(); });
  ui.btn.addEventListener("pointerup", (e) => { e.stopPropagation(); resolveCard(); });
  ui.overlay.addEventListener("click", resolveCard);
  function card(title, text, btn, cb, autoMs) {
    ui.title.textContent = title; ui.text.textContent = text; ui.btn.textContent = btn;
    ui.overlay.classList.remove("hidden"); pendingCb = cb;
    cardTimer = autoMs ? autoMs / 1000 : 0;
  }
  function toast(msg, dur) { ui.toast.textContent = msg; ui.toast.classList.remove("hidden"); toastTimer = dur || 3.6; }

  // Start straight into play — resuming the saved level/disguise/bark if any.
  function begin() {
    level = 0;
    if (saved) {
      level = clamp(saved.level | 0, 0, levels.length - 1);
      coachDone = !!(saved.coachDone || (saved.level | 0) > 0); // a returning player already knows fetch
      player.barkLevel = saved.barkLevel | 0; player.barkXP = saved.barkXP | 0;
      if (saved.collar) { player.collar = true; addWearable("collar"); }
      if (saved.bandana) { player.bandana = true; addWearable("bandana"); }
      restoreTricks(saved);
    }
    applyBarkStats();
    enterLevel();
  }
  function enterLevel() {
    phase = "play";
    // Only the FIRST arrival at level 2 this session should initialize Rex's
    // contest — enterLevel() also fires from importSaveCode() (any save-code
    // import while already on level 2 re-runs this), and re-running the
    // reset there would silently wipe an in-session Rex win (rexContestWon)
    // or abort an in-progress contest that has nothing to do with the
    // imported save. `!rex` mirrors spawnRexNearFair()'s own already-spawned
    // guard, so this block truly only runs once per session.
    if (level === 2 && !rex) { rexContestWon = false; fetchOffWon = false; contest = null; spawnRexNearFair(); }
    const L = levels[level];
    ui.levelTag.textContent = L.tag;
    ui.objText.textContent = L.text;
    ui.objective.classList.remove("hidden");
    ui.meters.classList.remove("hidden");
    const wantMinimap = !(typeof window !== "undefined" && window.__settings && window.__settings.minimap === false);
    if (ui.minimap && showMinimap && wantMinimap) ui.minimap.classList.remove("hidden");
    if (ui.friends) ui.friends.classList.remove("hidden");
    // The level briefing (what to do + how) is a dismissable card, not a
    // 7-second toast — the how-to used to vanish before a new player could
    // read it, which read as "objectives aren't clear". The concise goal
    // stays pinned in the HUD (ui.objText) after the card is dismissed.
    card(L.intro.t, L.intro.x, "Let's go", null, 15000);
  }
  function completeLevel() {
    if (level >= levels.length - 1) return win();
    phase = "complete";
    const L = levels[level];
    const d = getDog();
    confettiBurst(80); celebrateAt(d.x, d.z);
    audio.levelChime && audio.levelChime();
    card("Level Complete!", L.done, "Continue", () => { level++; save(); enterLevel(); }, 9000);
  }
  function win() {
    phase = "won";
    unlock("adopted");
    // Epilogue recap: levels[3].done carries the actual adoption beat (it was
    // previously empty AND unused — completeLevel() always short-circuits
    // straight to win() on the last level, so nothing ever rendered it), plus
    // a one-line stat recap of the run before the session resets.
    const friends = people.filter((p) => p.rapport >= 0.7).length;
    const achCount = unlocked.size, achTotal = Object.keys(ACH).length;
    const rexLine = rexContestWon ? " You beat Rex fair and square." : "";
    const recap = `${levels[3].done} You made ${friends} real friend${friends === 1 ? "" : "s"} along the way, `
      + `reached Bark Lv ${player.barkLevel}, and earned ${achCount}/${achTotal} achievements.${rexLine} `
      + `But a stray's heart never fully settles — and one evening, with the gate left open, the road calls again.`;
    confettiBurst(150); // the finale earns the biggest celebration
    clearSave();
    // A new life, not a reset: escaping reseeds the whole park (same seeded
    // generator the "New random park" settings button uses) so the next
    // chapter is a genuinely different town — new streets, new faces, new
    // stray story — instead of replaying the same map from scratch. The
    // reseed+reload itself doesn't happen until the player actually earns it
    // by sneaking to the gate (see startEscape()/updateEscape()).
    card("🏡 Adopted!", recap, "Slip away into a new town", () => startEscape());
  }
  function startEscape() {
    phase = "escape";
    escapeWake = 0; escapeAlertT = 0; escPrevX = null; escPrevZ = null;
    escapeOwner = people.find((p) => p.role === "adopter") || null;
    const ox = escapeOwner ? escapeOwner.pos.x : 0, oz = escapeOwner ? escapeOwner.pos.z : 0;
    // The gate sits on the boundary, on the far side of the map from her.
    const away = Math.atan2(-oz, -ox);
    escapeGate = { x: Math.cos(away) * (world - 6), z: Math.sin(away) * (world - 6) };
    escapeSeed = Math.floor(Math.random() * 1e6);
    ui.objective.classList.remove("hidden");
    ui.meters.classList.remove("hidden");
    ui.levelTag.textContent = "The Great Escape";
    ui.objText.textContent = "Sneak to the gate — stay clear of Mrs. Bell, and don't bark!";
    toast("The house is quiet. This could be your chance... 🌙", 4.5);
  }
  function updateEscape(dt) {
    if (!escapeGate) return;
    const d = getDog();
    if (escapeAlertT > 0) escapeAlertT -= dt;
    if (escapeOwner) {
      const dist = dist2(d.x, d.z, escapeOwner.pos.x, escapeOwner.pos.z);
      const rawSpeed = escPrevX !== null ? Math.hypot(d.x - escPrevX, d.z - escPrevZ) / Math.max(dt, 1e-4) : 0;
      // A teleport/respawn spike (brain dog#E15 — same pitfall SIT's "has
      // moved" gate guards against) must not read as sprinting: entering the
      // scene, or any future scripted reposition, would otherwise register
      // an enormous one-frame "speed" and detonate the meter on arrival.
      const speed = rawSpeed < 20 ? rawSpeed : 0;
      const proximity = dist < 14 ? 1 - dist / 14 : 0;
      // Walking pace (~9, the player's non-sprint speed) is always safe, even
      // right next to her — only speed ABOVE that (sprinting) adds real risk,
      // scaled by how close she is. Calm sneaking should never accidentally
      // wake her; reckless sprinting past her should, within a few seconds.
      const excess = Math.max(0, speed - 9);
      const risk = proximity * excess * 0.1;
      const decay = escapeAlertT > 0 ? 0.05 : 0.16; // a stir makes her a light sleeper for a while — ease off
      escapeWake = clamp(escapeWake + risk * dt - decay * dt, 0, 1);
      if (escapeWake >= 1 && escapeAlertT <= 0) { escapeAlertT = 2.5; toast("Mrs. Bell stirs in her sleep... hold still!"); }
    }
    escPrevX = d.x; escPrevZ = d.z;
    if (dist2(d.x, d.z, escapeGate.x, escapeGate.z) < 3) {
      location.hash = "seed=" + escapeSeed;
      location.reload();
    }
  }
  function arrest() {
    if (phase !== "play") return;
    phase = "arrested";
    audio.yelp && audio.yelp();
    flashScreen("#d8463a"); // a brief soft-red flash so the catch lands
    player.collar = false; if (worn.collar) worn.collar.visible = false;
    player.suspicion = 0.55;
    catcher.state = "patrol"; catcher.lose = 0;
    card("🚐 Caught!", "The dog catcher's net drops over you! He pulls off your collar and hauls you to the gate — but you squirm free. Lay lower next time.", "Shake it off", () => {
      setDogPos(0, world - 8);
      resetDogVelTracking(); // the teleport isn't real movement — don't let it spike the pursuit estimate
      phase = "play";
    }, 9000);
  }

  // ---- player actions ----
  const worn = {}; // collar / bandana meshes attached to the dog
  const GREET_CAP = 0.45; // greeting alone only gets you this far — then play
  function presentation() { return player.collar * 0.4 + player.clean * 0.4 + player.bandana * 0.2; }

  function nearestPerson(d, range) {
    let best = null, bd = range;
    for (const p of people) { const dd = dist2(d.x, d.z, p.pos.x, p.pos.z); if (dd < bd) { bd = dd; best = p; } }
    return best;
  }
  function nearestWaiting(d, range) {
    let best = null, bd = range;
    for (const p of people) { if (!p.waiting) continue; const dd = dist2(d.x, d.z, p.pos.x, p.pos.z); if (dd < bd) { bd = dd; best = p; } }
    return best;
  }
  function addWearable(kind) {
    if (worn[kind]) { worn[kind].visible = true; return; }
    if (!dogGroup) return;
    let m;
    if (kind === "collar") {
      m = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 8, 16), new THREE.MeshStandardMaterial({ color: 0xd63b3b }));
      m.rotation.x = Math.PI / 2.2; m.position.set(0, 1.22, 0.95);
    } else {
      m = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.18, 3), new THREE.MeshStandardMaterial({ color: 0x2e86de }));
      m.position.set(0, 1.02, 1.1); m.rotation.x = 0.4;
    }
    dogGroup.add(m); worn[kind] = m;
  }

  function interact() {
    if (phase !== "play") return;
    // A cutscene only advances via a HELD E (tickHold), never a tap — and the
    // trick minigame's watch/input phases route input through digit keys /
    // trickInput(), not E — so a tap on E must no-op during all three (same
    // brain lesson as before: one input edge, gated by context, not two
    // systems racing to read it).
    if (contest && (contest.stage === "cutscene" || contest.stage === "trick-watch" || contest.stage === "trick-input")) return;
    const ctx = contextAction();
    if (!ctx) return;
    switch (ctx.btn) {
      case "GRAB": fetchSys.tryGrab(); break;
      case "DROP": fetchSys.dropCarry(); break;
      case "THROW": { const it = fetchSys.playerThrow(); if (it) toast("You fling it — fetch! 🐾"); break; }
      case "LURE": { const it = fetchSys.playerThrow(); if (it) toast("You hurl the ball past the thief — it can't resist! 🎾"); break; }
      case "GREET": greet(ctx.person); break;
      case "PERFORM": performTrickFor(ctx.person); break;
      case "SHOW": performShowFor(nearestCrowd(getDog())); break;
      case "PLAY": playWith(ctx.person); break;
      case "RETURN": returnTo(ctx.person); break;
      case "GIVE": giveBall(ctx.person); break;
      case "OFFER": doOffer(ctx.dog); break;
      case "FEED": doFeed(); break;
      case "ASK": askEquip(ctx.person, ctx.equip); break;
      case "CHALLENGE": startContest(); break;
      case "STARTTRICK": startTrickCutscene(); break;
    }
  }

  function throwDirFrom(p) {
    const a = Math.atan2(-p.pos.z, -p.pos.x) + (Math.random() * 1.4 - 0.7); // toward the open middle
    return { x: Math.cos(a), z: Math.sin(a) };
  }

  function playWith(p) {
    const c = fetchSys.carrying();
    if (!c || c.kind !== "frisbee") return;
    if (p.rapport < 0.3) { toast(`${p.cname} isn't sure about you yet — say hi a few more times first.`); return; }
    if (p.waiting) { toast(`${p.cname} is waiting for the frisbee back!`); return; }
    fetchSys.throwFrom({ x: p.pos.x, y: 1.2, z: p.pos.z }, throwDirFrom(p), c, 15);
    c.thrownBy = p; p.waiting = true;
    toast(`${p.cname} hurls the frisbee — go fetch! 🥏`);
  }
  function returnTo(p) {
    const c = fetchSys.carrying();
    if (!c || c.kind !== "frisbee") return;
    p.waiting = false;
    const caught = c.caught; // a leaping mid-air catch earns extra
    const it = fetchSys.takeCarry();
    it.state = "ground"; it.holder = null; it.pos.set(p.pos.x + 1.2, 0.18, p.pos.z); it.mesh.position.copy(it.pos);
    p.rapport = clamp(p.rapport + (caught ? 0.27 : 0.2), -1, 1);
    if (p.want === "fetch") clearWant(p, 12 + Math.random() * 12); // they asked to play — satisfied
    coachDone = true; // one full fetch completed — retire the onboarding coach
    save(); checkFriends(); spawnHearts(p.pos.x, p.pos.z, 4);
    spawnPop(p.pos.x, p.pos.z, p.rapport >= 0.7 ? 0xffd24a : 0xff8ad0, 3.2); // juice: bond pop
    const pct = Math.round(p.rapport * 100);
    const lead = caught ? "Spectacular mid-air catch! " : "";
    toast(`${lead}${p.cname} loves it! Bond ${pct}% ${p.rapport >= 0.7 ? "— best friends! 💛" : "— play again to bond more."}`);
  }
  function giveBall(p) {
    const c = fetchSys.carrying();
    if (!c || c.kind !== "ball") return;
    fetchSys.throwFrom({ x: p.pos.x, y: 1.2, z: p.pos.z }, throwDirFrom(p), c, 17);
    p.ballCheer = 3.5; // a ball icon pops over their head, like the frisbee throw
    toast(`${p.cname} chucks the ball — the dogs chase it! 🐕`);
  }
  function doFeed() {
    if (!feedDucks) return;
    const c = fetchSys.carrying(); if (!c) return;
    if (feedDucks()) {
      const it = fetchSys.takeCarry(); it.state = "equipped"; scene.remove(it.mesh);
      toast("🦆 You toss it to the ducks — peace on the pond!");
      unlock("ducktamer");
    } else toast("The ducks aren't around right now.");
  }
  function doOffer(dog) {
    const r = fetchSys.offerItem(dog);
    if (r === "traded") toast("You swap a 🦴 for the 🥏 — grab it! 🐾");
    else if (r === "wrong") {
      dog.revealed = true; // now its craving stays shown above its head
      toast(`Not having it! This pup wants a ${dog.pref === "bone" ? "🦴 bone" : "🎾 ball"} — look above its head.`);
    } else toast("No frisbee-thief here to bargain with.");
  }
  function askEquip(p, kind) {
    const need = kind === "bandana" ? 0.6 : 0.3;
    if (p.rapport < need) { toast(`${p.cname} won't help a stranger — bond a bit more first.`); return; }
    const it = fetchSys.takeCarry(); if (!it) return;
    it.state = "equipped"; scene.remove(it.mesh);
    if (kind === "collar") { player.collar = true; addWearable("collar"); toast(`${p.cname} buckles a collar on you — looking owned!`); }
    else { player.bandana = true; addWearable("bandana"); toast(`${p.cname} ties a snazzy bandana on you. Adorable!`); }
    save();
    if (player.collar && player.bandana) unlock("disguised");
  }

  // ---- Rex's contest: a fetch-off, then a Simon-Says trick showcase — both
  // best of 3. Each minigame opens with a hold-to-advance rules cutscene
  // (brain E11: a deliberate HOLD, not a tap, so mashing E out of habit can't
  // blow through it), and winning the fetch-off does NOT auto-advance into
  // the trick showcase — the player has to walk back up and challenge Rex
  // again on purpose.
  const TRICKS = ["sit", "spin", "speak"];
  const TRICK_LABEL = { sit: "Sit!", spin: "Spin!", speak: "Speak!" };
  // What to actually show on-screen for the called sequence: the CURRENT
  // device's real input glyph for each trick, not the trick's name — so the
  // player reads exactly what to press (e.g. "X A A B"), matching world.js's
  // own trick-input bindings (pad: A=sit/B=spin/X=speak; key: 1/2/3).
  const TRICK_GLYPH = {
    pad: { sit: { t: "A", c: "seq-a" }, spin: { t: "B", c: "seq-b" }, speak: { t: "X", c: "seq-x" } },
    key: { sit: { t: "1", c: "seq-key" }, spin: { t: "2", c: "seq-key" }, speak: { t: "3", c: "seq-key" } },
    touch: { sit: { t: "SIT", c: "seq-word" }, spin: { t: "SPIN", c: "seq-word" }, speak: { t: "SPEAK", c: "seq-word" } },
  };
  // Renders the called-sequence bar: revealed progressively during trick-watch
  // (a "?" placeholder for slots not yet called), fully visible with
  // done/current highlighting during trick-input so the player can read the
  // remaining presses off the row instead of relying on memory alone.
  function renderTrickSequence() {
    if (!ui.trickSeq) return;
    if (!contest || (contest.stage !== "trick-watch" && contest.stage !== "trick-input")) {
      ui.trickSeq.classList.add("hidden"); ui.trickSeq.innerHTML = ""; return;
    }
    const dev = getDevice ? getDevice() : "key";
    const table = TRICK_GLYPH[dev] || TRICK_GLYPH.key;
    const calledUpTo = contest.stage === "trick-watch" ? contest.watchIdx : contest.trickSeq.length;
    ui.trickSeq.innerHTML = contest.trickSeq.map((kind, i) => {
      const visible = i < calledUpTo;
      if (!visible) return `<span class="seq-badge">?</span>`;
      const g = table[kind];
      let state = "seq-called";
      if (contest.stage === "trick-input") state = i < contest.trickInputIdx ? "seq-done" : i === contest.trickInputIdx ? "seq-current" : "seq-called";
      return `<span class="seq-badge ${g.c} ${state}">${g.t}</span>`;
    }).join("");
    ui.trickSeq.classList.remove("hidden");
  }
  const HOLD_S = 0.8; // press-and-hold duration (seconds) to advance a cutscene line
  const FETCH_RULES = [
    "Priya sets up a fetch-off against Rex: best two rounds out of three.",
    "She'll throw one frisbee each round — first dog to grab it wins the round.",
    "Hold E to get ready...",
  ];
  const TRICK_RULES = [
    "Now the trick showcase — like Simon Says.",
    "Sam calls a growing sequence of tricks: Sit, Spin, or Speak.",
    "Watch the whole sequence, then repeat it back in order — 1/2/3 keys, or tap SIT/SPIN/SPEAK.",
    "Hold E to begin...",
  ];
  let holdT = 0;
  function nearestVolunteer(d) {
    let best = null, bd = Infinity;
    for (const p of people) { if (p.role !== "volunteer") continue; const dd = dist2(d.x, d.z, p.pos.x, p.pos.z); if (dd < bd) { bd = dd; best = p; } }
    return best;
  }
  // Both dogs land in front of the stage between minigames — a fixed,
  // volunteer-independent anchor (same reasoning as the fetch-off's platform
  // anchor: a wandering AI person is not a stable "you're done here" spot).
  function respawnAtStage() {
    if (!fair || !fair.stage || !rex) return;
    const sx = fair.stage.x, sz = fair.stage.z + 6;
    setDogPos(sx, sz); resetDogVelTracking(); setDogHeading(Math.PI);
    rex.pos.x = sx + 3; rex.pos.z = sz; rex.heading = Math.PI; rex.legPhase = 0; rex.task = "loiter";
  }
  // The trick showcase's performance spot: player faces the stage/judge
  // straight-on, close enough for a good judge-POV frame.
  function resetForTrickPhase() {
    if (!fair || !fair.stage || !rex) return;
    const sx = fair.stage.x, sz = fair.stage.z + 5;
    setDogPos(sx, sz); resetDogVelTracking(); setDogHeading(Math.PI);
    rex.pos.x = fair.stage.x + 4; rex.pos.z = sz; rex.heading = Math.PI; rex.legPhase = 0; rex.task = "loiter";
  }
  // The one DOM side effect every contest-stage transition away from
  // "cutscene" must carry — real (advanceCutscene) and test-only alike, so
  // a test-only shortcut can never leave the overlay stuck on screen while
  // contest.stage has already moved on (found via a screenshot, invisible
  // to any assertion that only reads contest state).
  function hideCutOverlay() { ui.cutOverlay.classList.add("hidden"); }
  function showCutsceneLine() {
    if (!contest || contest.stage !== "cutscene") return;
    ui.cutTitle.textContent = contest.cutFor === "fetch" ? "The Fetch-Off" : "The Trick Showcase";
    ui.cutText.textContent = contest.lines[contest.lineIdx];
    ui.cutOverlay.classList.remove("hidden");
    ui.cutHoldFill.style.width = "0%";
  }
  function advanceCutscene() {
    if (!contest || contest.stage !== "cutscene") return;
    contest.lineIdx++;
    if (contest.lineIdx >= contest.lines.length) {
      hideCutOverlay();
      if (contest.cutFor === "fetch") { contest.stage = "fetch-pause"; }
      else { resetForTrickPhase(); contest.trickRoundNum = 1; serveTrickRound(); }
    } else {
      showCutsceneLine();
    }
  }
  // world.js calls this every frame with whether the hold-button (E / mobile
  // ACT) is currently down — an authoritative hold-counter that resets on
  // release, never inferred from a release timestamp (brain E7/E11).
  function tickHold(held, dt) {
    if (!contest || contest.stage !== "cutscene") { holdT = 0; return; }
    if (held) {
      holdT += dt;
      ui.cutHoldFill.style.width = Math.min(100, (holdT / HOLD_S) * 100) + "%";
      if (holdT >= HOLD_S) { holdT = 0; advanceCutscene(); }
    } else {
      holdT = 0;
      ui.cutHoldFill.style.width = "0%";
    }
  }
  function startContest() {
    if (contest || !rex) return;
    const v = nearestVolunteer(getDog()) || people.find((p) => p.role === "volunteer");
    // Already won the fetch-off in an earlier attempt at this Rex challenge —
    // only the trick showcase needs replaying. cutFor:"trick" here reuses
    // advanceCutscene()'s existing end-of-cutscene branch (resetForTrickPhase
    // + serveTrickRound), the exact same path startTrickCutscene() takes
    // normally — this only changes which cutscene/phase we START at.
    contest = {
      stage: "cutscene", cutFor: fetchOffWon ? "trick" : "fetch", lines: fetchOffWon ? TRICK_RULES : FETCH_RULES, lineIdx: 0,
      volunteer: v, fetchWin: { p: fetchOffWon ? 2 : 0, r: 0 }, fetchItem: null, camT: 0, fetchTimeout: 0, pauseT: 0.4,
      trickWin: { p: 0, r: 0 }, trickSeq: [], trickInputIdx: 0, trickWindow: 0, trickRoundNum: 1,
      watchIdx: 0, watchT: 0, judgeT: 0,
    };
    showCutsceneLine();
  }
  function startTrickCutscene() {
    if (!contest || contest.stage !== "fetch-won-wait") return;
    contest.stage = "cutscene"; contest.cutFor = "trick"; contest.lines = TRICK_RULES; contest.lineIdx = 0;
    showCutsceneLine();
  }
  // Every round: despawn last round's frisbee, reset BOTH dogs to symmetric
  // starting blocks (position/heading/velocity only — never stamina, which
  // carries across the whole fetch-off on purpose), then throw fresh.
  function serveFetchRound() {
    if (contest.fetchItem) { fetchSys.despawnItem(contest.fetchItem); contest.fetchItem = null; }
    // Anchor every round to the adoption platform itself (a fixed point on
    // the stage), not the volunteer's current position — volunteers are
    // regular AI people who wander, which would make the "starting line"
    // drift round to round.
    const px0 = fair && fair.stage ? fair.stage.x : rex.pos.x;
    const pz0 = fair && fair.stage ? fair.stage.z : rex.pos.z;
    const baseAngle = Math.atan2(-pz0, -px0) + (Math.random() * 1.2 - 0.6); // toward the open middle, varied per round
    const dist = 6, spread = 3;
    const cx = px0 + Math.cos(baseAngle) * dist, cz = pz0 + Math.sin(baseAngle) * dist;
    const px = -Math.sin(baseAngle), pz = Math.cos(baseAngle);
    const playerBlock = { x: cx + px * spread, z: cz + pz * spread };
    const rexBlock = { x: cx - px * spread, z: cz - pz * spread }; // same distance from the platform AND from the throw line

    setDogPos(playerBlock.x, playerBlock.z);
    resetDogVelTracking(); // the teleport isn't real movement — don't let it spike the pursuit estimate
    setDogHeading(baseAngle);
    rex.pos.x = rexBlock.x; rex.pos.z = rexBlock.z; rex.heading = baseAngle; rex.legPhase = 0; rex.task = "loiter";

    // Throw farther each round for rising intensity (research: escalate, don't
    // repeat). Symmetric race, so a longer sprint stays fair — just more
    // dramatic. Round 0 → 13, then +2 per round contested.
    const roundsPlayed = contest.fetchWin.p + contest.fetchWin.r;
    const power = 13 + roundsPlayed * 2;
    const fris = fetchSys.spawnFrisbee(px0, pz0, true, 0xff3b6b); // contest-tagged (see lureFree), pink to match Rex's ribbon
    fetchSys.throwFrom({ x: px0, y: 1.2, z: pz0 }, { x: Math.cos(baseAngle), z: Math.sin(baseAngle) }, fris, power);
    contest.fetchItem = fris;
    contest.camT = 3; // fixed frisbee-cam + freeze window — no skip
    contest.fetchTimeout = 8; // starts counting once the freeze ends (see updateContest)
    contest.stage = "fetch";
  }
  function releaseRexHold() {
    if (!rex.holding) return;
    rex.holding.state = "ground"; rex.holding.holder = null;
    rex.holding.pos.set(rex.pos.x, rex.holding.pos.y, rex.pos.z);
    rex.holding.mesh.position.copy(rex.holding.pos);
    rex.holding = null;
  }
  // Simon-Says: round r's sequence has length r (round 1 = 1 trick, round 2 =
  // 2, round 3 = 3) — a fresh random sequence each round, not cumulative
  // across rounds (rounds are independently won/lost in the best-of-3 score).
  function serveTrickRound() {
    // Sequence grows 3 → 4 → 5 across the best-of-three (research floor: length
    // 3 is reliably reproduced, 5 is the top of the standard range). Round 1 at
    // length 1 was a freebie; starting at 3 makes every round a real memory
    // test. Rex's own success drops as it lengthens (rexChance below), so the
    // rising load stays fair and winnable.
    const len = contest.trickRoundNum + 2;
    contest.trickSeq = Array.from({ length: len }, () => TRICKS[Math.floor(Math.random() * TRICKS.length)]);
    contest.watchIdx = 0; contest.watchT = 0; contest.trickInputIdx = 0; contest.judgeT = 0;
    contest.stage = "trick-watch";
    renderTrickSequence();
  }
  function contestStatusText() {
    if (!contest) return "";
    if (contest.stage === "cutscene") return "reading the rules...";
    if (contest.stage === "fetch-won-wait") return "fetch-off won! Walk up to Rex to start the trick showcase.";
    if (contest.stage.startsWith("fetch")) return `fetch-off ${contest.fetchWin.p}-${contest.fetchWin.r}`;
    return `trick showcase ${contest.trickWin.p}-${contest.trickWin.r}`;
  }
  function finishContest(won) {
    rex.task = "loiter"; releaseRexHold();
    respawnAtStage();
    contest = null;
    hidePrompt();
    if (won) {
      rexContestWon = true;
      audio.contestWinChime && audio.contestWinChime();
      const d = getDog(); confettiBurst(90); celebrateAt(d.x, d.z); // the release after the contest's tension
      toast("Rex slinks off, pouting — you're the fair's new favorite! 🏆");
    } else {
      flashScreen("#d8463a");
      toast("Rex struts around, showing off. Walk up and challenge him again whenever you're ready.");
    }
  }
  // Called by world.js's digit-key / mobile SIT-SPIN-SPEAK handlers. Only
  // live during "trick-input" — a wrong trick or completing the sequence
  // both resolve the round immediately (real Simon Says: one mistake ends it).
  function trickInput(kind) {
    if (!contest || contest.stage !== "trick-input") return;
    const expected = contest.trickSeq[contest.trickInputIdx];
    if (kind === expected) {
      contest.trickInputIdx++;
      if (contest.trickInputIdx >= contest.trickSeq.length) resolveTrickRound(true);
      else renderTrickSequence();
    } else {
      resolveTrickRound(false);
    }
  }
  function resolveTrickRound(playerOk) {
    hidePrompt();
    const prevP = contest.trickWin.p, prevR = contest.trickWin.r;
    const seqLen = contest.trickSeq.length;
    // Longer sequences are harder for Rex too — his chance dips a bit each
    // level, clamped so neither side is ever a guaranteed win or loss.
    const rexChance = clamp(REX_TRICK_SKILL - 0.06 * (seqLen - 1), 0.15, 0.75);
    const rexOk = Math.random() < rexChance;
    if (playerOk && !rexOk) { contest.trickWin.p++; toast("Perfect sequence! Rex fumbles his."); }
    else if (!playerOk && rexOk) { contest.trickWin.r++; toast("You slip up — Rex nails his sequence."); }
    else if (playerOk && rexOk) {
      if (Math.random() < 0.5) { contest.trickWin.p++; toast("Both nail it — you edge it out on style!"); }
      else { contest.trickWin.r++; toast("Both nail it — Rex edges it out this time."); }
    } else toast("Neither of you land it this time — once more!");
    if (contest.trickWin.p > prevP) roundResult(true);        // won this round → burst
    else if (contest.trickWin.r > prevR) roundResult(false);  // Rex scored → soft flash (a draw stings neither)
    if (contest.trickWin.p >= 2) { finishContest(true); }
    else if (contest.trickWin.r >= 2) { finishContest(false); }
    else { contest.trickRoundNum++; contest.stage = "trick-pause"; contest.pauseT = 1.4; }
    renderTrickSequence(); // stage has moved on — this hides the bar via its own guard
  }
  function updateContest(dt) {
    if (!contest || !rex) return;
    // Re-render every tick while relevant (renderTrickSequence no-ops/hides
    // otherwise) so a mid-round device switch (keyboard <-> pad) is reflected
    // immediately, not just at the next reveal/input step.
    if (contest.stage === "trick-watch" || contest.stage === "trick-input") renderTrickSequence();
    if (contest.stage === "cutscene") return; // advanced only by tickHold()
    if (contest.stage === "fetch-pause") {
      contest.pauseT -= dt;
      if (contest.pauseT <= 0) serveFetchRound();
      return;
    }
    if (contest.stage === "fetch") {
      if (contest.camT > 0) {
        // frisbee-cam + freeze: both dogs are held still by world.js reading
        // _fetchFrozen; Rex only gets his chase task the instant this ends,
        // the same frame the player regains input — a simultaneous start.
        contest.camT -= dt;
        if (contest.camT <= 0) { rex.task = "fetch"; rex.fetchItem = contest.fetchItem; }
        return;
      }
      contest.fetchTimeout -= dt;
      const item = contest.fetchItem;
      const playerGot = item && fetchSys.carrying() === item;
      const rexGot = item && item.holder === rex;
      if (playerGot || rexGot || contest.fetchTimeout <= 0) {
        rex.task = "loiter";
        if (playerGot) { contest.fetchWin.p++; roundResult(true); toast("You grab it first! 🐾"); }
        else if (rexGot) { contest.fetchWin.r++; roundResult(false); toast("Rex snags it first!"); releaseRexHold(); }
        else toast("Nobody got to it in time — re-serving!");
        if (contest.fetchItem) { fetchSys.despawnItem(contest.fetchItem); contest.fetchItem = null; }
        if (contest.fetchWin.p >= 2) {
          // Fetch-off won — respawn at the stage, but do NOT auto-advance
          // into the trick showcase. The player has to walk back up to Rex
          // and challenge him again on purpose (see contextAction's
          // "fetch-won-wait" branch and the STARTTRICK interact() case).
          respawnAtStage();
          contest.stage = "fetch-won-wait";
          fetchOffWon = true;
          toast("You win the fetch-off! Walk up to Rex to start the trick showcase.");
        }
        else if (contest.fetchWin.r >= 2) { finishContest(false); }
        else { contest.stage = "fetch-pause"; contest.pauseT = 1.2; }
      }
      return;
    }
    if (contest.stage === "fetch-won-wait") return; // waits for the player's own STARTTRICK interact()
    if (contest.stage === "trick-pause") {
      contest.pauseT -= dt;
      if (contest.pauseT <= 0) serveTrickRound();
      return;
    }
    if (contest.stage === "trick-watch") {
      // The judge calls out the whole sequence, one trick at a time, with a
      // beat between each — player is frozen (world.js: _movementFrozen) and
      // the judge-POV cinematic camera is already active (_judgeCamActive).
      contest.judgeT += dt;
      contest.watchT -= dt;
      if (contest.watchT <= 0) {
        if (contest.watchIdx < contest.trickSeq.length) {
          const kind = contest.trickSeq[contest.watchIdx];
          toast(`${contest.volunteer ? contest.volunteer.cname : "The judge"} calls: "${TRICK_LABEL[kind]}"`);
          contest.watchIdx++;
          contest.watchT = 1.1;
          renderTrickSequence();
        } else {
          contest.stage = "trick-input";
          contest.trickInputIdx = 0;
          contest.trickWindow = 1.6 + 1.2 * (contest.trickSeq.length - 1); // more time for longer sequences
          showPrompt("Repeat it back: 1/2/3 or tap SIT / SPIN / SPEAK");
          renderTrickSequence();
        }
      }
      return;
    }
    if (contest.stage === "trick-input") {
      contest.judgeT += dt;
      contest.trickWindow -= dt;
      if (contest.trickWindow <= 0) resolveTrickRound(false);
    }
  }

  function greet(p) {
    if (!p) return;
    const pres = presentation();
    // The final beat: she only adopts once she adores you (via play) and you look the part.
    if (p.role === "adopter" && level === 3 && p.rapport >= 0.8 && pres >= 0.6) {
      if (player.adopted || pendingAdoption) return;
      pendingAdoption = true; adoptionT = 1.6;
      audio.adoptionChime && audio.adoptionChime();
      const dd = getDog();
      confettiBurst(120); celebrateAt(dd.x, dd.z); celebrateAt(p.pos.x, p.pos.z); // in-world burst around dog + Mrs. Bell
      return toast("Mrs. Bell holds your gaze... something clicks. 🐾");
    }
    if (p.rapport >= GREET_CAP) {
      const tip = fetchSys.carrying() ? "" : " Grab a 🥏 frisbee and PLAY to bond more!";
      return toast(`${p.cname} already likes you.${tip}`);
    }
    const score = p.traits.friendliness * 0.4 + p.traits.dogLover * 0.4 + p.rapport * 0.3
      + pres * 0.3 - p.traits.suspicion * player.suspicion * 0.5 + p.mood * 0.1 + (Math.random() * 0.2 - 0.1);
    const delta = score > 0.5 ? 0.16 : score > 0.3 ? 0.08 : -0.1;
    p.rapport = clamp(p.rapport + delta, -1, GREET_CAP);
    save(); checkFriends();
    if (delta > 0) spawnHearts(p.pos.x, p.pos.z, delta > 0.1 ? 3 : 1);
    const pct = Math.round(p.rapport * 100);
    if (p.role === "guide") return toast(`Maya: “${guideHint()}” (bond ${pct}%)`);
    if (delta > 0.1) toast(`${p.cname} beams and ruffles your fur! (bond ${pct}%)`);
    else if (delta > 0) toast(`${p.cname} gives you a pat. (bond ${pct}%)`);
    else toast(`${p.cname} backs away. (bond ${pct}%)`);
  }

  function guideHint() {
    if (level === 0) return "Saying hi breaks the ice — but to really bond, grab a 🥏 frisbee and PLAY fetch with folks!";
    if (level === 1) return "The collar's in the city district past the far corner of the park — bring it to a friend to put it on you, then wash in the pond (bark to clear the ducks)!";
    if (level === 2) return "Priya and Sam, the shelter volunteers, are at the Adoption Fair across the park — win them over just like anyone else (say hi, then fetch!). Rex is hanging around near the stage — walk up and press E to challenge him: a fetch-off, then a trick showcase, best two of three each.";
    return "Mrs. Bell wants a tidy pup — keep your collar on, stay clean, and play with her to win her heart.";
  }

  // The single bark gate: returns false (and does nothing) while recharging, so
  // mashing the button can't stack barks. On success it fires the shockwave and
  // the bark's area-of-effect, and starts the cooldown.
  function tryBark() {
    if (player.barkCD > 0) return false;
    player.barkCD = player.barkCooldown;
    spawnBarkWave();
    onBark();
    // practice makes a mightier bark — XP levels it up (clamped at Lv3)
    if (player.barkLevel < 3) {
      player.barkXP++;
      if (player.barkXP >= 6 * (player.barkLevel + 1)) {
        player.barkLevel++; player.barkXP = 0; applyBarkStats(); save();
        toast(`🔊 Bark upgraded to Lv ${player.barkLevel}! Louder & farther.`);
        if (player.barkLevel >= 3) unlock("barklord");
      }
    }
    return true;
  }
  // The bark's area-of-effect on nearby people, scaled by reach + power.
  function onBark() {
    const d = getDog();
    // A bark is loud, full stop — during the escape it's a direct risk to
    // the one thing the whole scene is about: not waking Mrs. Bell. A nice
    // reversal of the rest of the game, where barking is almost always good.
    if (phase === "escape") {
      escapeWake = clamp(escapeWake + 0.5, 0, 1);
      escapeAlertT = Math.max(escapeAlertT, 2.5);
      toast("A bark! That could wake her — careful!");
    }
    if (setDogScare) setDogScare(d.x, d.z, player.barkRange + 4); // a bark scatters the nearby pack

    // The same bark reads differently depending on who's watching: a
    // dog-loving, patient witness shrugs it off (and even warms to you),
    // while a skittish/suspicious-trait one reads it as more alarming —
    // so the heat this bark adds to the Suspicion meter is witness-weighted,
    // not a flat amount. Barking with no one nearby keeps the old baseline.
    let heatMul = 1;
    for (const p of people) {
      if (dist2(d.x, d.z, p.pos.x, p.pos.z) > player.barkRange) continue;
      if (p.traits.dogLover > 0.6 && p.traits.patience > 0.5) {
        // The rapport gain itself is on a per-NPC cooldown — barking's
        // suspicion-calming reaction stays instant every time, but the same
        // trick working forever as a rapport farm bypassed fetch/tricks/wants
        // entirely (barking is also the fastest thing to spam: 0.45s cooldown,
        // and each bark's own barkXP raises barkPower/barkRange, so it was a
        // self-reinforcing loop). One bark's worth of warmth, then a break.
        if (p.barkRapportCD <= 0) {
          p.rapport = clamp(p.rapport + 0.04 * player.barkPower, -1, 1);
          p.barkRapportCD = 14;
        }
        heatMul -= 0.12;
      } else {
        p.rapport = clamp(p.rapport - 0.07 * player.barkPower, -1, 1);
        heatMul += 0.22 * p.traits.suspicion + 0.1 * (1 - p.traits.patience);
      }
    }
    heatMul = clamp(heatMul, 0.4, 2.2);
    player.barkHeat = Math.min(1.3, player.barkHeat + 0.34 * player.barkPower * heatMul);
    trickSpeakFromBark(d); // barking by a receptive friend teaches SPEAK
  }

  // ---- NPC ↔ NPC: trait-driven greetings, and word-of-mouth about the dog ----
  // A meeting is a social event (idea kernel: schedule-intersections → social
  // events + decaying pairwise scores). The two warm up AND gossip: each nudges
  // the other's opinion of the dog toward their own, trait-gated. Only a real
  // opinion travels (conviction ~ |rapport|), dog-lovers take warm word to heart
  // while the suspicious tune it out (but believe cold word faster), and gossip
  // is BANDED to [-0.4, +0.55] so hearsay only PRIMES the malleable middle and
  // never crosses the ±0.7 decision lines — the people you bonded (or scared
  // off) firsthand stay put and become the park's opinion leaders instead of
  // being dragged around by rumor. Delivers the "word travels — and not
  // everyone's a fan" promise the Level-1 outro already makes.
  const sparks = [];
  const GOSSIP_LO = -0.4, GOSSIP_HI = 0.55, GOSSIP_K = 0.07;
  let gossipSeen = false;
  function opinionPull(speakerRap, listener) {
    const conviction = Math.max(0, Math.abs(speakerRap) - 0.15); // neutral chit-chat spreads nothing
    if (conviction <= 0) return 0;
    if (speakerRap > 0) return GOSSIP_K * conviction * listener.traits.dogLover * (1 - listener.traits.suspicion * 0.5);
    return -GOSSIP_K * conviction * (0.4 + listener.traits.suspicion * 0.6);
  }
  function gossipInto(listener, delta) {
    const r = listener.rapport;
    if (r > GOSSIP_HI || r < GOSSIP_LO) return 0; // a firsthand opinion won't budge on hearsay
    listener.rapport = clamp(r + delta, GOSSIP_LO, GOSSIP_HI);
    return listener.rapport - r;
  }
  function npcGreet(dt) {
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      p.mood = Math.max(0, p.mood - dt * 0.05);
      p.greetCD -= dt;
      if (p.greetCD > 0) continue;
      p.greetCD = 6 + Math.random() * 10;
      let q = null, bd = 3.6;
      for (let j = 0; j < people.length; j++) {
        if (j === i) continue; const o = people[j];
        const dd = dist2(p.pos.x, p.pos.z, o.pos.x, o.pos.z);
        if (dd < bd) { bd = dd; q = o; }
      }
      if (!q) continue;
      // Read BOTH opinions before writing either, so the exchange is symmetric
      // and order-independent within the pair (brain dog#E8 — snapshot, then
      // integrate; both sides of one meeting move off the same snapshot).
      const pr = p.rapport, qr = q.rapport;
      const net = gossipInto(p, opinionPull(qr, p)) + gossipInto(q, opinionPull(pr, q));
      const warmth = (p.traits.friendliness + q.traits.friendliness) / 2;
      if (warmth > 0.55) { p.mood = Math.min(1, p.mood + 0.25); q.mood = Math.min(1, q.mood + 0.25); }
      if (warmth > 0.55 || Math.abs(net) > 0.001) spark(p, q, net);
      if (!gossipSeen && Math.abs(net) > 0.02) {
        gossipSeen = true;
        toast(net > 0 ? "🗣️ Word's getting around — a new face already likes you." : "🗣️ Word's getting around — and not all of it's kind.");
      }
    }
  }
  function spark(a, b, gossip = 0) {
    // pink = a friendly warm-up; warm gold = good word passed; cool blue = bad word
    const col = gossip > 0.004 ? 0xffd24a : gossip < -0.004 ? 0x5aa9ff : 0xff6bd0;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9 }));
    m.position.set((a.pos.x + b.pos.x) / 2, 2.5, (a.pos.z + b.pos.z) / 2); scene.add(m); sparks.push({ m, life: 1 });
  }

  // "Passing for owned": a stray flanked by park-goers who clearly adore it
  // reads like someone's dog, not a stray — so an entourage of fans lowers the
  // catcher's Suspicion, the payoff that makes the whole social game (bonding +
  // word-of-mouth) feed the disguise layer. Only affection past the ice counts
  // (a doting friend at your side vouches hard; a small crowd of them, more),
  // and the adopter is excluded — she judges you firsthand, she's not cover.
  // dist2() is REAL distance (game.js:13), compared straight against the radius
  // (brain dog#E46 — never radius*radius).
  const BELOVED_R = 14, BELOVED_K = 1.4; // ~two solid friends nearby ⇒ full effect
  function belovedness(d) {
    let s = 0;
    for (const p of people) {
      if (p.role === "adopter" || p.rapport <= 0.25) continue;
      if (dist2(d.x, d.z, p.pos.x, p.pos.z) > BELOVED_R) continue;
      s += p.rapport - 0.25;
    }
    return clamp(s / BELOVED_K, 0, 1);
  }
  let vouchSeen = false;

  // ---- catcher AI ----
  const CATCH = { patrol: 4, chase: 10, sight: 18, catch: 1.7, giveUp: 32 };
  const dogVel = { x: 0, z: 0 }; let _pdx = null, _pdz = null; // for predictive pursuit
  // A teleport (e.g. the arrest respawn) isn't real movement — call this right
  // after any direct position set so the next frame doesn't read it as a
  // spurious, enormous instantaneous velocity (see brain lesson: dogVel spikes
  // ~90x max speed for one frame after a teleport if this tracking isn't reset).
  function resetDogVelTracking() { _pdx = null; _pdz = null; dogVel.x = 0; dogVel.z = 0; }
  function updateCatcher(dt) {
    const c = catcher, d = getDog();
    const dd = dist2(d.x, d.z, c.pos.x, c.pos.z);
    const active = level >= 1; // catcher only hunts from Level 2 on
    // Night makes him hunt harder: keener sight, quicker to give chase on less
    // suspicion, faster pursuit, and more dogged before he gives up.
    const night = (typeof window !== "undefined" && window.__env && window.__env.nightT) || 0;
    const sight = CATCH.sight * (1 + 0.45 * night);
    const trigger = 0.5 - 0.22 * night;   // suspicion needed to start a chase
    const bail = 0.4 - 0.18 * night;      // suspicion below which he loses interest
    const chaseSpeed = CATCH.chase * (1 + 0.16 * night);
    const giveUp = CATCH.giveUp * (1 + 0.4 * night);
    catcher.night = night; // exposed for the alert copy
    // A state change means the STEER TARGET changed meaning (a waypoint vs.
    // last-seen vs. a live predictive-lead position) — never let a cached
    // path built for the old target keep steering into the new state.
    if (c.state !== c._pfLastState) { catcherPather.path = null; c._pfLastState = c.state; }
    if (c.state === "patrol") {
      const wp = c.waypoints[c.wp];
      const steer = catcherPather.getSteerTarget(c.pos.x, c.pos.z, wp[0], wp[1], dt);
      stepXZ(c, steer.x, steer.z, CATCH.patrol, dt);
      if (dist2(c.pos.x, c.pos.z, wp[0], wp[1]) < 2) { c.wp = (c.wp + 1) % c.waypoints.length; catcherPather.path = null; }
      if (active && dd < sight && player.suspicion > trigger) c.state = "chase";
    } else if (c.state === "investigate") {
      // he lost you — head to where he last saw you before resuming patrol
      const steer = catcherPather.getSteerTarget(c.pos.x, c.pos.z, c.lastSeen.x, c.lastSeen.z, dt);
      stepXZ(c, steer.x, steer.z, CATCH.patrol * 1.5, dt);
      c.invT -= dt;
      if (active && dd < sight && player.suspicion > trigger) c.state = "chase";
      else if (c.invT <= 0 || dist2(c.pos.x, c.pos.z, c.lastSeen.x, c.lastSeen.z) < 2) c.state = "patrol";
    } else { // chase
      c.lastSeen.x = d.x; c.lastSeen.z = d.z; // remember where the dog is
      // PURSUIT (idea): aim where the dog WILL be, not where it is
      const lead = Math.min(1.4, dd / chaseSpeed);
      const rawTx = d.x + dogVel.x * lead, rawTz = d.z + dogVel.z * lead;
      const steer = catcherPather.getSteerTarget(c.pos.x, c.pos.z, rawTx, rawTz, dt);
      stepXZ(c, steer.x, steer.z, chaseSpeed, dt);
      if (setDogScare) setDogScare(c.pos.x, c.pos.z, 22); // the pack scatters from the chasing catcher
      if (dd < CATCH.catch) return arrest();
      if (player.suspicion < bail || dd > giveUp) { c.lose += dt; if (c.lose > 1.5) { c.state = "investigate"; c.invT = 5; c.lose = 0; } }
      else c.lose = 0;
    }
    c.legPhase += c.state === "chase" ? dt * 10 : dt * 4;
    const sw = Math.sin(c.legPhase) * 0.5;
    c.legs[0].rotation.x = sw; c.legs[1].rotation.x = -sw;
    c.group.position.set(c.pos.x, 0, c.pos.z);
  }
  function stepXZ(e, tx, tz, sp, dt) {
    const dx = tx - e.pos.x, dz = tz - e.pos.z, m = Math.hypot(dx, dz) || 1;
    e.pos.x += (dx / m) * sp * dt; e.pos.z += (dz / m) * sp * dt;
    e.group.rotation.y = Math.atan2(dx, dz);
  }

  // ---- per-frame ----
  // ---- trick learning ------------------------------------------------------
  // Tricks are LEARNED by doing the action each one is — none of which is
  // chasing frisbee, so they break up the fetch-for-rapport grind:
  //   SIT   — hold still (a confused/idle player still gets rewarded)
  //   SPIN  — walk a tight circle (heading sweeps while you stay put)
  //   SPEAK — bark next to a receptive friend (who you pick matters)
  // Once known, a trick can be PERFORMED near a friend for rapport — a real
  // alternative to fetch. _pendingTrickAnim is drained by world.js to play the
  // pose in free-roam (the same procedural sit/spin/speak used in the showcase).
  const TRICK_LEARN = { sit: 7, spin: 3, speak: 3 }; // sit stays the passive one, but 5 reps was still too fast
  const TRICK_NAMES = { sit: "SIT", spin: "SPIN", speak: "SPEAK" };
  // "fetch" must NOT reuse 🥏 — that emoji already means "waiting for a
  // frisbee I was just thrown back" (p.waiting, checked first below). Reusing
  // it here made "wants to start playing fetch" and "wants their throw back"
  // visually identical, so the bubble stopped reliably telling you which.
  const WANT_ICON = { fetch: "🙋", sit: "🪑", spin: "🌀", speak: "💬" };
  let sitIdleT = 0, sitCD = 0, spinAccum = 0, spinAnchorT = 0, spinCD = 0, speakCD = 0;
  let spinAnchor = null, prevDX = null, prevDZ = null, prevHeading = null;
  let trickHintShown = false, dogHasMoved = false, dogMoveT = 0;
  let _pendingTrickAnim = null;

  function restoreTricks(data) {
    if (Array.isArray(data.knownTricks)) player.knownTricks = data.knownTricks.filter((k) => k in player.trickXP);
    if (data.trickXP && typeof data.trickXP === "object") {
      for (const k of ["sit", "spin", "speak"]) {
        const v = data.trickXP[k];
        if (Number.isFinite(v)) player.trickXP[k] = clamp(v | 0, 0, TRICK_LEARN[k]);
      }
    }
  }
  function knowsTrick(k) { return player.knownTricks.includes(k); }
  function grantTrickRep(kind) {
    if (knowsTrick(kind)) return;
    player.trickXP[kind] = Math.min(TRICK_LEARN[kind], (player.trickXP[kind] || 0) + 1);
    _pendingTrickAnim = kind; // the dog visibly practises what it's learning
    if (player.trickXP[kind] >= TRICK_LEARN[kind]) {
      player.knownTricks.push(kind); save();
      toast(`🎓 Your dog learned ${TRICK_NAMES[kind]}! Perform it near a friend to bond.`);
      if (player.knownTricks.length >= 3) unlock("showoff");
    } else {
      toast(`🐾 Practising ${TRICK_NAMES[kind]}… (${player.trickXP[kind]}/${TRICK_LEARN[kind]})`);
    }
  }
  function updateTrickLearning(dt) {
    if (sitCD > 0) sitCD -= dt;
    if (spinCD > 0) spinCD -= dt;
    if (speakCD > 0) speakCD -= dt;
    if (phase !== "play" || contest) { prevDX = null; return; } // no learning mid-contest/paused
    const d = getDog(), h = getHeading ? getHeading() : 0;
    if (prevDX !== null) {
      const speed = Math.hypot(d.x - prevDX, d.z - prevDZ) / Math.max(dt, 1e-4);
      // "Has moved" must be real locomotion, not a teleport/respawn spike (brain
      // dog#E15): count only sustained IN-RANGE speed, ignoring huge one-frame jumps.
      if (speed > 1 && speed < 20) dogMoveT += dt;
      if (dogMoveT > 1.2) dogHasMoved = true;
      // SIT — sustained stillness (only after the player has actually gone somewhere)
      if (!knowsTrick("sit") && dogHasMoved) {
        if (speed < 0.4) sitIdleT += dt; else sitIdleT = 0;
        if (sitIdleT > 0.8 && !trickHintShown) {
          trickHintShown = true;
          toast("🐾 Hold still to teach SIT · walk a tight circle for SPIN · bark by a friend for SPEAK.", 5.5);
        }
        if (sitIdleT > 3.5 && sitCD <= 0) { sitIdleT = 0; sitCD = 7; grantTrickRep("sit"); } // longer hold + more reps
      }
      // SPIN — a tight circle: heading sweeps while net position stays put.
      // Two guard rails against gaming it without actually circling:
      //  1. SIGNED accumulation, not abs() — zigzagging back and forth flips
      //     sign each reversal and cancels out, so only a genuine consistent
      //     winding direction (an actual circle) ever reaches the threshold.
      //  2. A stale-anchor timeout — winding up 2 full turns has to happen
      //     within a few real seconds of walking, not accumulate slowly over
      //     an arbitrary stretch of idle small movements.
      if (!knowsTrick("spin")) {
        if (!spinAnchor || Math.hypot(d.x - spinAnchor.x, d.z - spinAnchor.z) > 4) {
          spinAnchor = { x: d.x, z: d.z }; spinAccum = 0; spinAnchorT = 0; // wandered off — not a circle
        } else {
          spinAnchorT += dt;
          if (spinAnchorT > 6) { spinAccum = 0; spinAnchorT = 0; } // took too long — not a deliberate spin
          if (prevHeading !== null) {
            let dh = h - prevHeading;
            while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
            spinAccum += dh; // signed
            if (Math.abs(spinAccum) > Math.PI * 4 && spinCD <= 0) { spinAccum = 0; spinAnchorT = 0; spinCD = 2.5; grantTrickRep("spin"); } // ~2 consistent turns
          }
        }
      }
    }
    prevDX = d.x; prevDZ = d.z; prevHeading = h;
  }
  // Called from onBark: barking near a receptive friend teaches SPEAK. Who you
  // bark at matters — a dog-loving, already-bonded witness responds; an
  // indifferent stranger doesn't.
  function trickSpeakFromBark(d) {
    if (knowsTrick("speak") || speakCD > 0) return;
    // Always say SOMETHING — barking with no reaction and no explanation was
    // the "too vague" complaint: the player had no way to tell "nobody's
    // close enough" apart from "someone's close but not won over yet."
    let bestScore = 0, bestP = null, anyoneNear = false;
    for (const p of people) {
      if (dist2(d.x, d.z, p.pos.x, p.pos.z) > player.barkRange) continue;
      anyoneNear = true;
      const receptive = p.traits.dogLover * 0.6 + Math.max(0, p.rapport) * 0.6;
      if (receptive > bestScore) { bestScore = receptive; bestP = p; }
    }
    if (bestScore > 0.45) { speakCD = 3.5; grantTrickRep("speak"); return; }
    speakCD = 2.5; // brief cooldown on the explanation too, so it can't spam every bark
    if (!anyoneNear) toast("🐾 Bark near a friendly park-goer to start teaching SPEAK.");
    else toast(`🐾 ${bestP.cname} isn't won over by barking yet — bond with them more first.`);
  }
  // ---- NPC wants: each park-goer periodically ASKS for something — a game of
  // fetch (🥏) or their favourite trick — shown as a thought bubble. Satisfying
  // the ask bonds. This keeps fetch central (it's actively wanted, not just an
  // option) and makes tricks occasional, SPECIFIC requests, not a blanket
  // replacement for fetch.
  function rollWant(p) {
    p.want = Math.random() < 0.5 ? "fetch" : p.favTrick;
    p.wantT = 30; // a want never sticks forever (guaranteed exit — brain dog#E11)
  }
  function clearWant(p, cd) { p.want = null; p.wantT = 0; p.wantCD = cd; }
  function updateWants(dt) {
    if (phase !== "play" || contest) return;
    for (const p of people) {
      if (p.showCD > 0) p.showCD -= dt; // trick show-off cooldown (all roles)
      if (p.role === "adopter") continue; // Mrs. Bell runs her own adoption arc
      if (p.want) {
        p.wantT -= dt;
        if (p.wantT <= 0) clearWant(p, 8 + Math.random() * 10); // expired unsatisfied
      } else if (p.wantCD > 0) {
        p.wantCD -= dt;
      } else if (p.rapport >= 0.25 && p.rapport < 1 && !p.waiting) {
        rollWant(p); // only once you're past the ice, and never for a maxed bond
      }
    }
  }
  // Perform the trick an NPC asked for — offered (via contextAction) only when
  // they want that specific trick AND you know it, so the ask always matches.
  function performTrickFor(p) {
    // Their explicit ask (if you know it) pays the most; otherwise ANY trick you
    // know is a valid show-off — so tricks are a real non-fetch way to keep
    // bonding in the late game (greeting caps at 0.45, and fetch used to be the
    // only path past it), not gated on them asking for one specific trick.
    const asked = (p.want && p.want !== "fetch" && knowsTrick(p.want)) ? p.want : null;
    const kind = asked || (knowsTrick(p.favTrick) ? p.favTrick : player.knownTricks[0]);
    if (!kind) return;
    _pendingTrickAnim = kind;
    // An ask lands bigger; a general show-off is a steadier, smaller gain on a
    // per-person cooldown, so it complements fetch's big hits instead of
    // replacing them. Their warmth still scales the payoff.
    const react = (asked ? 0.15 : 0.09) * (0.6 + p.traits.friendliness * 0.8);
    p.rapport = clamp(p.rapport + react, -1, 1);
    spawnHearts(p.pos.x, p.pos.z, 4);
    spawnPop(p.pos.x, p.pos.z, 0xffd24a, 3.2);
    if (asked) clearWant(p, 12 + Math.random() * 12); // satisfied — a while before they ask again
    p.showCD = 7 + Math.random() * 5; // brief lull before the same pup is wowed again
    save(); checkFriends();
    toast(`${p.cname} loves your ${TRICK_NAMES[kind]}! Bond ${Math.round(p.rapport * 100)}%${p.rapport >= 0.7 ? " 💛" : ""}`);
  }

  // ---- crowd trick shows: perform for everyone gathered at a live crowd
  // (critters.js's emergent gather spots). Mirrors critters.js's own
  // CROWD.joinR/appealMax so "who's in the crowd" agrees with what the ring
  // visually shows. Reaction is rapport-scaled per the original design: a
  // stranger barely reacts, a bonded friend reacts a lot — and the show nets
  // a rapport shift across everyone actually gathered, not just one NPC.
  // dist2() (game.js:13) is a plain Math.hypot — REAL distance, not squared,
  // despite the name (critters.js's own near2() is the squared one) — compare
  // directly against the radius, never radius*radius, or "within 8" quietly
  // becomes "within 64" and every gathering looks the same oversized crowd.
  const SHOW_JOIN_R = 8, SHOW_APPEAL_MAX = 4;
  function nearestCrowd(d) {
    if (!crowds) return null;
    let best = null, bd = SHOW_JOIN_R;
    for (const c of crowds) { const dd = dist2(d.x, d.z, c.pos.x, c.pos.z); if (dd < bd) { bd = dd; best = c; } }
    return best;
  }
  function performShowFor(c) {
    if (!player.knownTricks.length || !c) return;
    if (c._showCD > 0) { toast("The crowd just saw a trick — give them a moment."); return; }
    const members = people.filter((p) => p.role !== "adopter" && dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z) < SHOW_JOIN_R);
    if (!members.length) return;
    // favour whichever known trick the most members in THIS crowd prefer
    const tally = { sit: 0, spin: 0, speak: 0 };
    for (const p of members) if (knowsTrick(p.favTrick)) tally[p.favTrick]++;
    let kind = player.knownTricks[0];
    for (const k of player.knownTricks) if (tally[k] > tally[kind]) kind = k;
    _pendingTrickAnim = kind;
    c._showCD = 10;
    let net = 0;
    for (const p of members) {
      const match = p.favTrick === kind;
      // low rapport -> barely reacts; high rapport -> reacts a lot (design intent)
      const weight = 0.25 + Math.max(0, p.rapport) * 0.9;
      const delta = (match ? 0.1 : 0.035) * weight * (0.6 + p.traits.friendliness * 0.8);
      p.rapport = clamp(p.rapport + delta, -1, 1);
      net += delta;
    }
    c.appeal = Math.min(SHOW_APPEAL_MAX, c.appeal + 0.6); // a good show draws the gathering in further
    spawnHearts(c.pos.x, c.pos.z, Math.min(8, 2 + members.length));
    spawnPop(c.pos.x, c.pos.z, 0xffd24a, 3.6);
    save(); checkFriends();
    toast(`🎪 The crowd of ${members.length} loves your ${TRICK_NAMES[kind]}! (+${net.toFixed(2)} rapport overall)`);
  }

  function update(dt, time) {
    // toast fade
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.add("hidden"); }
    // card auto-dismiss fallback (so a popup can never trap the player)
    if (cardTimer > 0) { cardTimer -= dt; if (cardTimer <= 0) resolveCard(); }
    // bark recharge + shockwave animation
    if (player.barkCD > 0) player.barkCD = Math.max(0, player.barkCD - dt);
    updateBarkWaves(dt);
    // radial recharge sweep on the bark button (feedback + upgrade cue)
    if (barkBtn) {
      const frac = player.barkCooldown > 0 ? player.barkCD / player.barkCooldown : 0;
      if (frac > 0.02) {
        const deg = (1 - frac) * 360;
        barkBtn.style.background = `conic-gradient(#5b6bff ${deg}deg, rgba(91,107,255,0.28) ${deg}deg)`;
        barkBtn.classList.add("cooling");
      } else if (barkBtn.classList.contains("cooling")) {
        barkBtn.style.background = ""; barkBtn.classList.remove("cooling");
      }
    }
    // markers bob
    people.forEach((p, i) => {
      if (p.ballCheer > 0) p.ballCheer -= dt;
      if (p.barkRapportCD > 0) p.barkRapportCD -= dt;
      if (p.marker) { p.marker.rotation.y += dt * 1.5; p.marker.position.y = 2.85 + Math.sin(time * 2 + i) * 0.12; }
    });
    // sparks rise+fade
    for (const s of sparks) { s.life -= dt * 1.2; s.m.position.y += dt * 0.8; s.m.material.opacity = Math.max(0, s.life); s.m.material.transparent = true; }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) { scene.remove(sparks[i].m); sparks.splice(i, 1); }
    // items, throws, and competing dogs (always runs so a carried item tracks the dog)
    fetchSys.update(dt);
    updateTrickLearning(dt);
    updateWants(dt);
    if (crowds) for (const c of crowds) if (c._showCD > 0) c._showCD -= dt;
    updateBubbles(time);
    updateEvents(dt, time);
    updateTreats(dt, time);
    updateHearts(dt);
    updatePops(dt);
    updateFriends(dt);

    if (pendingAdoption) {
      adoptionT -= dt;
      if (adoptionT <= 0) { pendingAdoption = false; player.adopted = true; }
    }

    // Rex's stamina: same drain/recover rates as the player's, just a lower
    // ceiling (35% less tank) — ticks whenever he exists, carries across the
    // whole fetch-off with no reset between rounds, and gates his chase speed
    // exactly like the player's own sprint cutoff.
    if (rex) {
      const chasing = rex.task === "fetch";
      if (chasing) rex.stamina = Math.max(0, rex.stamina - dt * 0.34);
      else rex.stamina = Math.min(REX_STAMINA_CAP, rex.stamina + dt * 0.28);
      rex.fetchSpeed = rex.stamina > 0.05 ? REX_FETCH_SPEED_FULL : REX_FETCH_SPEED_TIRED;
    }

    if (phase === "play") {
      const d = getDog();
      // estimate the dog's velocity so the catcher can lead its target (pursuit)
      if (_pdx !== null) { dogVel.x = (d.x - _pdx) / Math.max(dt, 1e-3); dogVel.z = (d.z - _pdz) / Math.max(dt, 1e-3); }
      _pdx = d.x; _pdz = d.z;
      // cleanliness: wash in the pond, get rinsed by rain, slowly grubby otherwise
      const inPond = dist2(d.x, d.z, pond.x, pond.z) < pond.r;
      const rainT = (typeof window !== "undefined" && window.__env && window.__env.rainT) || 0;
      const cleanRate = inPond ? 0.45 : rainT > 0.2 ? 0.09 * rainT : -0.012;
      player.clean = clamp(player.clean + dt * cleanRate, 0, 1);
      // suspicion eases toward a target set by your disguise + cleanliness +
      // recent barking — and, now, by how "owned" you look: an entourage of
      // adoring park-goers vouches for you (belovedness), reading like family.
      player.barkHeat = Math.max(0, player.barkHeat - dt * 0.5);
      player._beloved = belovedness(d);
      let target = 0.58 - player.collar * 0.35 - player.bandana * 0.2 - player.clean * 0.18 - player._beloved * 0.22 + player.barkHeat * 0.3;
      target = clamp(target, 0, 1);
      player.suspicion += (target - player.suspicion) * Math.min(1, dt * 0.8);
      if (!vouchSeen && player._beloved > 0.5 && level >= 1) {
        vouchSeen = true;
        toast("🫂 Surrounded by fans, you read like someone's dog — the catcher's less sure. Keep friends close.");
      }
      updateCatcher(dt);
      npcGreet(dt);
      updateHungryDogs(dt);
      checkFriends(); // reliable writer for friend achievements (brain: stats E3)
      if (level === 0) {
        const n = people.filter((p) => p.rapport >= 0.7).length;
        ui.objText.textContent = `Best friends (70%+) with 2 people — play fetch! (${n}/2)`;
      }
      if (level === 2) {
        const nv = people.filter((p) => p.role === "volunteer" && p.rapport >= 0.7).length;
        const rexTxt = rexContestWon ? "beaten! 🏆" : contest ? contestStatusText() : "walk up to him and press E to challenge him";
        ui.objText.textContent = `Win over both volunteers (70%+) (${nv}/2) — Rex: ${rexTxt}`;
      }
      updateContest(dt);
      if (levels[level].check()) completeLevel();
    }
    if (phase === "escape") updateEscape(dt);

    // catcher chase alert (copy sharpens at night, when he's relentless) —
    // or, during the escape, the same banner repurposed as a "she's stirring" cue.
    if (ui.alert) {
      const chasing = phase === "play" && catcher.state === "chase";
      const stirring = phase === "escape" && escapeAlertT > 0;
      ui.alert.classList.toggle("hidden", !(chasing || stirring));
      if (chasing) ui.alert.textContent = (catcher.night > 0.4)
        ? "🌙 Night patrol — the catcher's relentless! Get to the light and lower your Suspicion!"
        : "🚨 Dog catcher! Run — lose him or lower your Suspicion!";
      else if (stirring) ui.alert.textContent = "😴 Mrs. Bell is stirring — freeze and stay quiet!";
    }
    // HUD — the suspicion/energy meters carry a glanceable state word + a
    // contextual danger halo; the identity row is discrete chips, not a run-on.
    let susCls, susState;
    if (phase === "escape") {
      if (ui.susLabel) ui.susLabel.textContent = "Don't wake her!";
      ui.sus.style.width = Math.round(escapeWake * 100) + "%";
      susCls = escapeWake < 0.4 ? "low" : escapeWake < 0.75 ? "med" : "high";
      susState = escapeWake < 0.4 ? "Calm" : escapeWake < 0.75 ? "Stirring" : "Waking!";
    } else {
      if (ui.susLabel) ui.susLabel.textContent = "Suspicion";
      ui.sus.style.width = Math.round(player.suspicion * 100) + "%";
      susCls = player.suspicion < 0.3 ? "low" : player.suspicion < 0.6 ? "med" : "high";
      susState = player.suspicion < 0.3 ? "Safe" : player.suspicion < 0.6 ? "Rising" : "High!";
    }
    ui.sus.className = susCls;
    if (ui.susVal) { ui.susVal.textContent = susState; ui.susVal.className = "mval " + susCls; }
    if (ui.susMeter) ui.susMeter.classList.toggle("danger", susCls === "high");
    if (ui.stam) ui.stam.style.width = Math.round(player.stamina * 100) + "%";
    if (ui.stamVal) { const low = player.stamina < 0.3; ui.stamVal.textContent = low ? "Low" : ""; ui.stamVal.className = low ? "mval med" : "mval"; }
    const chips = [
      player.collar ? "📛 collar" : "🚫 no collar",
      `🧼 ${Math.round(player.clean * 100)}%`,
      player.bandana ? "🎽 bandana" : null,
      (player._beloved || 0) > 0.15 ? `🫂 ${Math.round((player._beloved || 0) * 100)}% vouched` : null,
      `🔊 Lv ${player.barkLevel}`,
      player.knownTricks.length ? `🎓 ${player.knownTricks.length}/3` : null,
      `🏆 ${unlocked.size}/${Object.keys(ACH).length}`,
    ].filter(Boolean);
    const idHTML = chips.map((c) => `<span class="chip">${c}</span>`).join("");
    if (idHTML !== ui._identityHTML) { ui.identity.innerHTML = idHTML; ui._identityHTML = idHTML; } // rebuild only on change
    updateCoach();
    drawMinimap(dt);
    // One context action drives the prompt, the mobile button, and the ring.
    const ctx = contextAction();
    if (ctx) {
      const dev = getDevice ? getDevice() : "key";
      const actKey = dev === "pad" ? "X" : "E"; // X → interact, matches world.js's edge(2) binding (A is jump)
      showPrompt(`Press ${actKey} to ${ctx.verb.toLowerCase()} ${ctx.label}`);
      setAct(ctx.btn, true);
      targetRing.visible = true;
      targetRing.position.set(ctx.x, 0.16, ctx.z);
      const s = 1 + Math.sin(time * 6) * 0.06;
      targetRing.scale.set(s, s, s);
    } else {
      hidePrompt(); setAct("ACT", false); targetRing.visible = false;
    }
  }

  // The single most relevant action in the player's reach right now (or null).
  function contextAction() {
    if (phase !== "play") return null;
    const d = getDog();
    const c = fetchSys.carrying();
    if (c) {
      // near the pond, a ball or bone can be tossed to pacify the ducks
      if ((c.kind === "ball" || c.kind === "bone") && feedDucks && dist2(d.x, d.z, pond.x, pond.z) < pond.r + 6) {
        return { verb: "Feed", btn: "FEED", label: "the ducks", x: pond.x, z: pond.z };
      }
      if (c.kind === "frisbee") {
        const w = nearestWaiting(d, REACH_PERSON);
        if (w) return { verb: "Return", btn: "RETURN", label: `the frisbee to ${w.cname}`, x: w.pos.x, z: w.pos.z, person: w };
        const p = nearestPerson(d, REACH_PERSON);
        if (p) return { verb: "Play", btn: "PLAY", label: `with ${p.cname}`, x: p.pos.x, z: p.pos.z, person: p };
        return { verb: "Drop", btn: "DROP", label: "the frisbee", x: d.x, z: d.z };
      }
      if (c.kind === "ball") {
        // a ball-loving frisbee-thief can be lured off the frisbee by a thrown ball
        const dh = fetchSys.dogHoldingFrisbeeNear(d, REACH_PERSON + 5);
        if (dh && dh.pref === "ball") return { verb: "Lure", btn: "LURE", label: "the thief with the ball", x: dh.pos.x, z: dh.pos.z, dog: dh };
        const p = nearestPerson(d, REACH_PERSON);
        if (p) return { verb: "Give", btn: "GIVE", label: `${p.cname} the ball`, x: p.pos.x, z: p.pos.z, person: p };
        return { verb: "Throw", btn: "THROW", label: "the ball", x: d.x, z: d.z };
      }
      if (c.kind === "bone") {
        // offer to ANY frisbee-thief — a bone-lover trades, a ball-lover reveals it wants a ball
        const dh = fetchSys.dogHoldingFrisbeeNear(d, REACH_PERSON);
        if (dh) return { verb: "Offer", btn: "OFFER", label: dh.revealed && dh.pref !== "bone" ? "the bone (it wants a ball!)" : "the bone to that pup", x: dh.pos.x, z: dh.pos.z, dog: dh };
        return { verb: "Drop", btn: "DROP", label: "the bone", x: d.x, z: d.z };
      }
      if (c.kind === "bandana" || c.kind === "collar") {
        const p = nearestPerson(d, REACH_PERSON);
        if (p) return { verb: c.kind === "collar" ? "Collar up" : "Wear it", btn: "ASK", label: `${p.cname} for help`, x: p.pos.x, z: p.pos.z, person: p, equip: c.kind };
        return { verb: "Drop", btn: "DROP", label: `the ${c.kind}`, x: d.x, z: d.z };
      }
      return { verb: "Drop", btn: "DROP", label: "it", x: d.x, z: d.z };
    }
    // Both contest phases are triggered from the ONE fixed, marked spot (the
    // beacon in front of the stage) — not by acting on Rex, and not by any
    // fuzzy "somewhere near the stage" radius, so the trigger point always
    // matches exactly where respawnAtStage() puts you when the cutscene
    // starts (no surprise reposition).
    const stageNear = stageMark && dist2(d.x, d.z, stageMark.x, stageMark.z) < STAGE_REACH;
    if (level === 2 && rex && !contest && !rexContestWon && stageNear) {
      const label = fetchOffWon ? "Rex to a trick showcase rematch" : "Rex to a contest";
      return { verb: "Challenge", btn: "CHALLENGE", label, x: stageMark.x, z: stageMark.z };
    }
    // Fetch-off won, trick showcase not auto-started — the player must walk
    // back to the marked spot and choose to begin it.
    if (level === 2 && rex && contest && contest.stage === "fetch-won-wait" && stageNear) {
      return { verb: "Start", btn: "STARTTRICK", label: "the trick showcase", x: stageMark.x, z: stageMark.z };
    }
    // not carrying: grab the nearer of a ground item / a person to greet
    const it = fetchSys.nearestGrabbable(d, REACH_ITEM);
    const p = nearestPerson(d, REACH_PERSON);
    const itD = it ? dist2(d.x, d.z, it.pos.x, it.pos.z) : Infinity;
    const pD = p ? dist2(d.x, d.z, p.pos.x, p.pos.z) : Infinity;
    if (it && itD <= pD) return { verb: "Grab", btn: "GRAB", label: `the ${it.kind}`, x: it.pos.x, z: it.pos.z };
    if (p) {
      // An NPC asking for their favourite trick — biggest payoff, offered when
      // you know that exact trick; otherwise the bubble tells them what to learn.
      if (p.want && p.want !== "fetch" && knowsTrick(p.want)) {
        return { verb: "Perform", btn: "PERFORM", label: `${TRICK_NAMES[p.want]} for ${p.cname}`, x: p.pos.x, z: p.pos.z, person: p };
      }
      // Past the greeting cap, greeting stops helping — so once you know a trick,
      // showing it off is a non-fetch way to keep bonding (cooldown-gated). This
      // gives the late stages variety instead of fetch-only. The adopter's
      // adoption-sealing greet still wins once she adores you.
      const adoptionReady = p.role === "adopter" && level === 3 && p.rapport >= 0.8 && presentation() >= 0.6;
      const bondable = p.role === "parkgoer" || p.role === "volunteer" || p.role === "adopter";
      if (!adoptionReady && bondable && player.knownTricks.length && p.rapport >= GREET_CAP && (p.showCD || 0) <= 0) {
        return { verb: "Show off", btn: "PERFORM", label: `a trick for ${p.cname}`, x: p.pos.x, z: p.pos.z, person: p };
      }
      const bond = p.role === "parkgoer" || p.role === "guide" ? ` (bond ${Math.round(p.rapport * 100)}%)` : "";
      return { verb: "Greet", btn: "GREET", label: `${p.cname}${bond}`, x: p.pos.x, z: p.pos.z, person: p };
    }
    // Nobody closer to interact with individually — if you're standing in a
    // live gather spot and know a trick, put on a show for the whole crowd.
    const nc = nearestCrowd(d);
    if (nc && player.knownTricks.length) {
      return { verb: "Show", btn: "SHOW", label: "off a trick for the crowd", x: nc.pos.x, z: nc.pos.z };
    }
    return null;
  }
  function setAct(label, on) { if (!actBtn) return; actBtn.textContent = label; actBtn.classList.toggle("dim", !on); }
  function showPrompt(t) { ui.prompt.textContent = t; ui.prompt.classList.remove("hidden"); }
  function hidePrompt() { ui.prompt.classList.add("hidden"); }

  return {
    update, begin, interact, tryBark, onBark, player, people, catcher, fetchSys,
    get level() { return level; }, get phase() { return phase; },
    // test hooks
    _greetRole: (role) => greet(people.find((p) => p.role === role)),
    _playRole: (role) => playWith(people.find((p) => p.role === role)),
    _returnRole: (role) => returnTo(people.find((p) => p.role === role)),
    _arrest: arrest, presentation,
    _barkWaveCount: () => barkWaves.length,
    _dogVel: () => ({ x: dogVel.x, z: dogVel.z }),
    exportSaveCode, importSaveCode, clearSave,
    get _contest() { return contest ? { ...contest } : null; }, get _rexContestWon() { return rexContestWon; },
    get _fetchOffWon() { return fetchOffWon; },
    _setFetchOffWonForTest: (v) => { fetchOffWon = !!v; },
    _forceTrickStage: () => { if (contest) { hideCutOverlay(); contest.fetchWin.p = 2; contest.stage = "trick-pause"; contest.pauseT = 0.05; } },
    _forceTrickPhase: () => { if (contest) { hideCutOverlay(); contest.fetchWin.p = 2; resetForTrickPhase(); contest.trickRoundNum = 1; serveTrickRound(); } },
    // Jump straight to "fetch-off just won, waiting on the player's own
    // STARTTRICK interact()" without playing the round out — for testing the
    // no-auto-advance gate and the STARTTRICK walk-up path in isolation.
    _forceFetchWon: () => { if (contest) { hideCutOverlay(); contest.fetchWin.p = 2; respawnAtStage(); contest.stage = "fetch-won-wait"; } },
    // Test-only: drop whatever contest is in progress, for isolating one
    // scenario at a time without waiting out RNG-dependent round outcomes.
    _resetContestForTest: () => { hideCutOverlay(); contest = null; if (rex) rex.task = "loiter"; },
    // world.js reads these every frame to drive the frisbee-cam freeze/handback.
    get _fetchFrozen() { return !!(contest && contest.stage === "fetch" && contest.camT > 0); },
    get _fetchTargetPos() {
      return contest && contest.fetchItem ? { x: contest.fetchItem.pos.x, y: contest.fetchItem.pos.y, z: contest.fetchItem.pos.z } : null;
    },
    // Movement is frozen during the fetch-cam freeze, any rules cutscene, and
    // the whole trick minigame (watch + input) — one flag world.js checks to
    // gate WASD/jump; the sub-mode getters below say WHICH camera to use.
    get _movementFrozen() {
      return !!(contest && (
        (contest.stage === "fetch" && contest.camT > 0) ||
        contest.stage === "cutscene" || contest.stage === "trick-watch" || contest.stage === "trick-input"
      ));
    },
    get _judgeCamActive() { return !!(contest && (contest.stage === "trick-watch" || contest.stage === "trick-input")); },
    get _judgeCamT() { return contest ? (contest.judgeT || 0) : 0; },
    get _judgePos() { return fair && fair.stage ? { x: fair.stage.x, z: fair.stage.z - 1 } : null; },
    get _trickInputActive() { return !!(contest && contest.stage === "trick-input"); },
    tickHold, trickInput,
    // free-roam trick performance: world.js drains this to play the pose
    get _pendingTrickAnim() { return _pendingTrickAnim; },
    _consumeTrickAnim: () => { const k = _pendingTrickAnim; _pendingTrickAnim = null; return k; },
    // test hooks (emergent events)
    _spawnBalloon: () => { if (phase === "play" && !contest && !balloon) spawnBalloon(); },
    _balloonPos: () => (balloon ? { x: balloon.g.position.x, z: balloon.g.position.z } : null),
    // test hooks (population self-regulation)
    _treats: () => treats.map((t) => ({ x: t.x, z: t.z, active: t.active })),
    _wildPopCount: wildPopCount,
    // test hooks (Rex/bubble state, for auditing the thought-bubble system)
    _rexHolding: () => (rex && rex.holding ? { kind: rex.holding.kind, isContest: !!rex.holding.isContest } : null),
    _rexBubble: () => (rex && rex.bubble ? { visible: rex.bubble.visible, revealed: !!rex.revealed } : null),
    // test hooks (trick learning)
    get knownTricks() { return player.knownTricks; },
    get trickXP() { return player.trickXP; },
    _learnTrickNow: (k) => { if (!player.knownTricks.includes(k)) { player.trickXP[k] = 3; player.knownTricks.push(k); } },
    _context: contextAction, _perform: performTrickFor,
    _forceWin: win,
    // test hooks (the escape scene)
    _forceEscape: () => startEscape(),
    get _escapeGate() { return escapeGate ? { x: escapeGate.x, z: escapeGate.z } : null; },
    get _escapeWake() { return escapeWake; },
    get _escapeOwnerPos() { return escapeOwner ? { x: escapeOwner.pos.x, z: escapeOwner.pos.z } : null; },
  };
}
