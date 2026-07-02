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

// Deterministic per-character traits, so a character is "the same person"
// every playthrough.
function traitsFor(i, role) {
  if (role === "guide") return { friendliness: 0.95, dogLover: 1.0, suspicion: 0.02, patience: 0.95 };
  if (role === "adopter") return { friendliness: 0.62, dogLover: 0.85, suspicion: 0.35, patience: 0.6 };
  const r = (n) => { const x = Math.sin((i + 1) * 97.13 + n * 41.7) * 43758.5453; return x - Math.floor(x); };
  return { friendliness: 0.3 + r(1) * 0.55, dogLover: 0.2 + r(2) * 0.7, suspicion: 0.1 + r(3) * 0.5, patience: 0.3 + r(4) * 0.5 };
}

export function createGame(scene, audio, opts) {
  const { world, pond, getDog, setDogPos, people, dogGroup, dogs, getHeading, feedDucks } = opts;
  const el = (id) => document.getElementById(id);
  const ui = {
    objective: el("objective"), levelTag: el("level-tag"), objText: el("objective-text"),
    meters: el("meters"), sus: el("susbar"), stam: el("stambar"), identity: el("identity"),
    minimap: el("minimap"), friends: el("friends"),
    prompt: el("prompt"), toast: el("toast"), alert: el("alert"),
    overlay: el("story-overlay"), title: el("story-title"), text: el("story-text"), btn: el("story-btn"),
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
  };

  // ---- persistent save (localStorage) — resume level, disguise, bond, bark ----
  const SAVE_KEY = "dogpark-save-v1";
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) { saved = null; }
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        level, collar: player.collar, bandana: player.bandana,
        barkLevel: player.barkLevel, barkXP: player.barkXP,
        rapport: people.map((p) => +p.rapport.toFixed(3)),
        achievements: [...unlocked],
      }));
    } catch (e) {}
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
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
    ducktamer: "Duck Whisperer 🦆",
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
    p.role = i === 0 ? "guide" : i === 1 ? "adopter" : "parkgoer";
    p.cname = p.role === "guide" ? "Maya" : p.role === "adopter" ? "Mrs. Bell" : GENERIC_NAMES[i % GENERIC_NAMES.length];
    p.traits = traitsFor(i, p.role);
    p.rapport = p.traits.dogLover * 0.2;
    if (saved && Array.isArray(saved.rapport) && typeof saved.rapport[i] === "number") p.rapport = saved.rapport[i];
    p.mood = 0; p.greetCD = Math.random() * 6;
    if (p.role !== "parkgoer") addMarker(p, p.role === "guide" ? 0xffd23a : 0xff6bd0);
  });
  const guide = people[0], adopter = people[1];

  function addMarker(p, color) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
    m.position.y = 2.85; m.rotation.x = Math.PI; p.group.add(m); p.marker = m;
  }

  // ---- carryable items + fetch/play system ----
  const fetchSys = createFetch(scene, audio, { getDog, getHeading, npcDogs: dogs, world });

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
          toast("🍖 Yum! Zoomies — speed boost!");
          unlock("zoomies");
        }
      } else {
        t.respawn -= dt; if (t.respawn <= 0) { t.active = true; t.group.visible = true; }
      }
    }
    if (player.speedBoostT > 0) { player.speedBoostT -= dt; if (player.speedBoostT <= 0) player.speedMul = 1; }
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

  function updateBubbles(time) {
    const d0 = getDog();
    const bob = Math.sin(time * 3) * 0.08;
    for (const d of dogs) {
      const b = d.bubble; if (!b) continue;
      if (d.holding && d.holding.kind === "frisbee") {
        const dd = dist2(d0.x, d0.z, d.pos.x, d.pos.z);
        if (dd < 6 || d.wantFlash > 0) d.revealed = true; // close inspection or a wrong offer reveals it
        if (dd < 18 || d.wantFlash > 0) {
          const emoji = d.revealed ? (d.pref === "bone" ? "🦴" : "🎾") : "🥏";
          setBubble(b, emoji, d.pos.x, 2.7 + bob, d.pos.z);
        } else b.visible = false;
      } else { b.visible = false; d.revealed = false; }
    }
    for (const p of people) {
      const b = p.bubble; if (!b) continue;
      if (p.waiting) setBubble(b, "🥏", p.pos.x, 3.2 + bob, p.pos.z);
      else if (p.ballCheer > 0) setBubble(b, "🎾", p.pos.x, 3.2 + bob, p.pos.z);
      else if (p.rapport >= 0.7) setBubble(b, "💛", p.pos.x, 3.2 + bob, p.pos.z);
      else b.visible = false;
    }
  }

  // ---- the dog catcher ----
  const catcher = buildCatcher();
  catcher.pos = new THREE.Vector3(60, 0, 60);
  catcher.group.position.copy(catcher.pos);
  catcher.state = "patrol"; catcher.wp = 0; catcher.lose = 0; catcher.legPhase = 0;
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
      intro: { t: "Heat", x: "A dog catcher works this park, and a scruffy stray is just his type. Disguise yourself: get a collar by the benches OR have a friend tie on a bandana, then wash in the pond (or wait for rain), and keep your Suspicion low so he loses interest." },
      check: () => (player.collar || player.bandana) && player.clean >= 0.6 && player.suspicion < 0.3,
      done: "You look like somebody's dog now. The catcher's lost interest. Time to find a real home.",
    },
    {
      tag: "Level 3 · Forever Home",
      text: "Look your best, then win over Mrs. Bell to get adopted.",
      intro: { t: "Forever Home", x: "Mrs. Bell wants a tidy, gentle dog to adopt. Presentation matters — keep that collar on and stay clean. Win her heart, then greet her when she adores you." },
      check: () => player.adopted,
      done: "",
    },
  ];
  let level = 0;
  let phase = "idle"; // idle | play | complete | won | arrested
  let pendingCb = null;
  let toastTimer = 0;
  let cardTimer = 0;

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
      player.barkLevel = saved.barkLevel | 0; player.barkXP = saved.barkXP | 0;
      if (saved.collar) { player.collar = true; addWearable("collar"); }
      if (saved.bandana) { player.bandana = true; addWearable("bandana"); }
    }
    applyBarkStats();
    enterLevel();
  }
  function enterLevel() {
    phase = "play";
    const L = levels[level];
    ui.levelTag.textContent = L.tag;
    ui.objText.textContent = L.text;
    ui.objective.classList.remove("hidden");
    ui.meters.classList.remove("hidden");
    const wantMinimap = !(typeof window !== "undefined" && window.__settings && window.__settings.minimap === false);
    if (ui.minimap && showMinimap && wantMinimap) ui.minimap.classList.remove("hidden");
    if (ui.friends) ui.friends.classList.remove("hidden");
    toast(L.intro.x, 7);
  }
  function completeLevel() {
    if (level >= levels.length - 1) return win();
    phase = "complete";
    const L = levels[level];
    card("Level Complete!", L.done, "Continue", () => { level++; save(); enterLevel(); }, 9000);
  }
  function win() {
    phase = "won";
    unlock("adopted");
    clearSave();
    card("🏡 Adopted!", "Mrs. Bell clips on your collar — for real this time — and walks you home. No more hiding, no more catcher. You're somebody's dog now. Good boy.", "Play again", () => location.reload());
  }
  function arrest() {
    if (phase !== "play") return;
    phase = "arrested";
    audio.yelp && audio.yelp();
    player.collar = false; if (worn.collar) worn.collar.visible = false;
    player.suspicion = 0.55;
    catcher.state = "patrol"; catcher.lose = 0;
    card("🚐 Caught!", "The dog catcher's net drops over you! He pulls off your collar and hauls you to the gate — but you squirm free. Lay lower next time.", "Shake it off", () => {
      setDogPos(0, world - 8);
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
    const ctx = contextAction();
    if (!ctx) return;
    switch (ctx.btn) {
      case "GRAB": fetchSys.tryGrab(); break;
      case "DROP": fetchSys.dropCarry(); break;
      case "THROW": { const it = fetchSys.playerThrow(); if (it) toast("You fling it — fetch! 🐾"); break; }
      case "LURE": { const it = fetchSys.playerThrow(); if (it) toast("You hurl the ball past the thief — it can't resist! 🎾"); break; }
      case "GREET": greet(ctx.person); break;
      case "PLAY": playWith(ctx.person); break;
      case "RETURN": returnTo(ctx.person); break;
      case "GIVE": giveBall(ctx.person); break;
      case "OFFER": doOffer(ctx.dog); break;
      case "FEED": doFeed(); break;
      case "ASK": askEquip(ctx.person, ctx.equip); break;
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
    save(); checkFriends(); spawnHearts(p.pos.x, p.pos.z, 4);
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

  function greet(p) {
    if (!p) return;
    const pres = presentation();
    // The final beat: she only adopts once she adores you (via play) and you look the part.
    if (p.role === "adopter" && level === 2 && p.rapport >= 0.8 && pres >= 0.6) {
      player.adopted = true;
      return toast("Mrs. Bell scoops you up — “What a wonderful, well-loved dog!”");
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
    if (level === 1) return "Carry the collar to a friend to put it on you, then wash in the pond — bark to clear the ducks!";
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
    player.barkHeat = Math.min(1.3, player.barkHeat + 0.34 * player.barkPower);
    const d = getDog();
    for (const p of people) {
      if (dist2(d.x, d.z, p.pos.x, p.pos.z) > player.barkRange) continue;
      if (p.traits.dogLover > 0.6 && p.traits.patience > 0.5) p.rapport = clamp(p.rapport + 0.04 * player.barkPower, -1, 1);
      else p.rapport = clamp(p.rapport - 0.07 * player.barkPower, -1, 1);
    }
  }

  // ---- NPC ↔ NPC: trait-driven little greetings ----
  const sparks = [];
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
      const warmth = (p.traits.friendliness + q.traits.friendliness) / 2;
      if (warmth > 0.55) { p.mood = Math.min(1, p.mood + 0.25); q.mood = Math.min(1, q.mood + 0.25); spark(p, q); }
    }
  }
  function spark(a, b) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff6bd0, emissive: 0xff6bd0, emissiveIntensity: 0.9 }));
    m.position.set((a.pos.x + b.pos.x) / 2, 2.5, (a.pos.z + b.pos.z) / 2); scene.add(m); sparks.push({ m, life: 1 });
  }

  // ---- catcher AI ----
  const CATCH = { patrol: 4, chase: 10, sight: 18, catch: 1.7, giveUp: 32 };
  function updateCatcher(dt) {
    const c = catcher, d = getDog();
    const dd = dist2(d.x, d.z, c.pos.x, c.pos.z);
    const active = level >= 1; // catcher only hunts from Level 2 on
    if (c.state === "patrol") {
      const wp = c.waypoints[c.wp];
      stepXZ(c, wp[0], wp[1], CATCH.patrol, dt);
      if (dist2(c.pos.x, c.pos.z, wp[0], wp[1]) < 2) c.wp = (c.wp + 1) % c.waypoints.length;
      if (active && dd < CATCH.sight && player.suspicion > 0.5) c.state = "chase";
    } else {
      stepXZ(c, d.x, d.z, CATCH.chase, dt);
      if (dd < CATCH.catch) return arrest();
      if (player.suspicion < 0.4 || dd > CATCH.giveUp) { c.lose += dt; if (c.lose > 2) { c.state = "patrol"; c.lose = 0; } }
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
      if (p.marker) { p.marker.rotation.y += dt * 1.5; p.marker.position.y = 2.85 + Math.sin(time * 2 + i) * 0.12; }
    });
    // sparks rise+fade
    for (const s of sparks) { s.life -= dt * 1.2; s.m.position.y += dt * 0.8; s.m.material.opacity = Math.max(0, s.life); s.m.material.transparent = true; }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) { scene.remove(sparks[i].m); sparks.splice(i, 1); }
    // items, throws, and competing dogs (always runs so a carried item tracks the dog)
    fetchSys.update(dt);
    updateBubbles(time);
    updateTreats(dt, time);
    updateHearts(dt);
    updateFriends(dt);

    if (phase === "play") {
      const d = getDog();
      // cleanliness: wash in the pond, get rinsed by rain, slowly grubby otherwise
      const inPond = dist2(d.x, d.z, pond.x, pond.z) < pond.r;
      const rainT = (typeof window !== "undefined" && window.__env && window.__env.rainT) || 0;
      const cleanRate = inPond ? 0.45 : rainT > 0.2 ? 0.09 * rainT : -0.012;
      player.clean = clamp(player.clean + dt * cleanRate, 0, 1);
      // suspicion eases toward a target set by your disguise + recent barking
      player.barkHeat = Math.max(0, player.barkHeat - dt * 0.5);
      let target = 0.58 - player.collar * 0.35 - player.bandana * 0.2 - player.clean * 0.18 + player.barkHeat * 0.3;
      target = clamp(target, 0, 1);
      player.suspicion += (target - player.suspicion) * Math.min(1, dt * 0.8);
      updateCatcher(dt);
      npcGreet(dt);
      checkFriends(); // reliable writer for friend achievements (brain: stats E3)
      if (level === 0) {
        const n = people.filter((p) => p.rapport >= 0.7).length;
        ui.objText.textContent = `Best friends (70%+) with 2 people — play fetch! (${n}/2)`;
      }
      if (levels[level].check()) completeLevel();
    }

    // catcher chase alert
    if (ui.alert) ui.alert.classList.toggle("hidden", !(phase === "play" && catcher.state === "chase"));
    // HUD
    ui.sus.style.width = Math.round(player.suspicion * 100) + "%";
    ui.sus.className = player.suspicion < 0.3 ? "low" : player.suspicion < 0.6 ? "med" : "high";
    ui.identity.textContent = `${player.collar ? "📛 collar" : "🚫 no collar"} · 🧼 ${Math.round(player.clean * 100)}%${player.bandana ? " · 🎽 bandana" : ""} · 🔊 Lv ${player.barkLevel} · 🏆 ${unlocked.size}/${Object.keys(ACH).length}`;
    if (ui.stam) ui.stam.style.width = Math.round(player.stamina * 100) + "%";
    drawMinimap(dt);
    // One context action drives the prompt, the mobile button, and the ring.
    const ctx = contextAction();
    if (ctx) {
      showPrompt(`Press E to ${ctx.verb.toLowerCase()} ${ctx.label}`);
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
    // not carrying: grab the nearer of a ground item / a person to greet
    const it = fetchSys.nearestGround(d, REACH_ITEM);
    const p = nearestPerson(d, REACH_PERSON);
    const itD = it ? dist2(d.x, d.z, it.pos.x, it.pos.z) : Infinity;
    const pD = p ? dist2(d.x, d.z, p.pos.x, p.pos.z) : Infinity;
    if (it && itD <= pD) return { verb: "Grab", btn: "GRAB", label: `the ${it.kind}`, x: it.pos.x, z: it.pos.z };
    if (p) {
      const bond = p.role === "parkgoer" || p.role === "guide" ? ` (bond ${Math.round(p.rapport * 100)}%)` : "";
      return { verb: "Greet", btn: "GREET", label: `${p.cname}${bond}`, x: p.pos.x, z: p.pos.z, person: p };
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
  };
}
