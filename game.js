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
  const { world, pond, getDog, setDogPos, people, dogGroup, dogs, getHeading } = opts;
  const el = (id) => document.getElementById(id);
  const ui = {
    objective: el("objective"), levelTag: el("level-tag"), objText: el("objective-text"),
    meters: el("meters"), sus: el("susbar"), identity: el("identity"),
    prompt: el("prompt"), toast: el("toast"),
    overlay: el("story-overlay"), title: el("story-title"), text: el("story-text"), btn: el("story-btn"),
  };
  const actBtn = el("act-btn"); // single context-sensitive action button (mobile)

  // ---- player game-state ----
  const player = { collar: false, bandana: false, clean: 1, suspicion: 0.35, barkHeat: 0, adopted: false };

  // ---- characters ----
  people.forEach((p, i) => {
    p.role = i === 0 ? "guide" : i === 1 ? "adopter" : "parkgoer";
    p.cname = p.role === "guide" ? "Maya" : p.role === "adopter" ? "Mrs. Bell" : GENERIC_NAMES[i % GENERIC_NAMES.length];
    p.traits = traitsFor(i, p.role);
    p.rapport = p.traits.dogLover * 0.2;
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
      text: "Grab a collar + wash in the pond to drop Suspicion below 30%.",
      intro: { t: "Heat", x: "A dog catcher works this park, and a scruffy stray is just his type. Disguise yourself: find the collar by the benches, wash in the pond (shoo the ducks first — bark!), and keep your Suspicion low so he loses interest." },
      check: () => player.collar && player.clean >= 0.6 && player.suspicion < 0.3,
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

  // Start straight into play — no blocking intro card to tap through.
  function begin() { level = 0; enterLevel(); }
  function enterLevel() {
    phase = "play";
    const L = levels[level];
    ui.levelTag.textContent = L.tag;
    ui.objText.textContent = L.text;
    ui.objective.classList.remove("hidden");
    ui.meters.classList.remove("hidden");
    toast(L.intro.x, 7);
  }
  function completeLevel() {
    if (level >= levels.length - 1) return win();
    phase = "complete";
    const L = levels[level];
    card("Level Complete!", L.done, "Continue", () => { level++; enterLevel(); }, 9000);
  }
  function win() {
    phase = "won";
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
      case "GREET": greet(ctx.person); break;
      case "PLAY": playWith(ctx.person); break;
      case "RETURN": returnTo(ctx.person); break;
      case "GIVE": giveBall(ctx.person); break;
      case "OFFER": doOffer(ctx.dog); break;
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
    const it = fetchSys.takeCarry();
    it.state = "ground"; it.holder = null; it.pos.set(p.pos.x + 1.2, 0.18, p.pos.z); it.mesh.position.copy(it.pos);
    p.rapport = clamp(p.rapport + 0.2, -1, 1);
    const pct = Math.round(p.rapport * 100);
    toast(`${p.cname} loves it! Bond ${pct}% ${p.rapport >= 0.7 ? "— best friends! 💛" : "— play again to bond more."}`);
  }
  function giveBall(p) {
    const c = fetchSys.carrying();
    if (!c || c.kind !== "ball") return;
    fetchSys.throwFrom({ x: p.pos.x, y: 1.2, z: p.pos.z }, throwDirFrom(p), c, 17);
    toast(`${p.cname} chucks the ball — the dogs chase it! 🐕`);
  }
  function doOffer(dog) {
    if (fetchSys.offerBone(dog)) toast("You swap a 🦴 for the 🥏 — grab it!");
    else toast("This pup isn't tempted by that.");
  }
  function askEquip(p, kind) {
    const need = kind === "bandana" ? 0.6 : 0.3;
    if (p.rapport < need) { toast(`${p.cname} won't help a stranger — bond a bit more first.`); return; }
    const it = fetchSys.takeCarry(); if (!it) return;
    it.state = "equipped"; scene.remove(it.mesh);
    if (kind === "collar") { player.collar = true; addWearable("collar"); toast(`${p.cname} buckles a collar on you — looking owned!`); }
    else { player.bandana = true; addWearable("bandana"); toast(`${p.cname} ties a snazzy bandana on you. Adorable!`); }
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

  // Called when the player barks.
  function onBark() {
    player.barkHeat = Math.min(1.3, player.barkHeat + 0.34);
    const d = getDog();
    for (const p of people) {
      if (dist2(d.x, d.z, p.pos.x, p.pos.z) > 6) continue;
      if (p.traits.dogLover > 0.6 && p.traits.patience > 0.5) p.rapport = clamp(p.rapport + 0.04, -1, 1);
      else p.rapport = clamp(p.rapport - 0.07, -1, 1);
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
    // markers bob
    people.forEach((p, i) => { if (p.marker) { p.marker.rotation.y += dt * 1.5; p.marker.position.y = 2.85 + Math.sin(time * 2 + i) * 0.12; } });
    // sparks rise+fade
    for (const s of sparks) { s.life -= dt * 1.2; s.m.position.y += dt * 0.8; s.m.material.opacity = Math.max(0, s.life); s.m.material.transparent = true; }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) { scene.remove(sparks[i].m); sparks.splice(i, 1); }
    // items, throws, and competing dogs (always runs so a carried item tracks the dog)
    fetchSys.update(dt);

    if (phase === "play") {
      const d = getDog();
      // cleanliness: wash in the pond, slowly get grubby otherwise
      const inPond = dist2(d.x, d.z, pond.x, pond.z) < pond.r;
      player.clean = inPond ? Math.min(1, player.clean + dt * 0.45) : Math.max(0, player.clean - dt * 0.012);
      // suspicion eases toward a target set by your disguise + recent barking
      player.barkHeat = Math.max(0, player.barkHeat - dt * 0.5);
      let target = 0.58 - player.collar * 0.35 - player.bandana * 0.08 - player.clean * 0.18 + player.barkHeat * 0.3;
      target = clamp(target, 0, 1);
      player.suspicion += (target - player.suspicion) * Math.min(1, dt * 0.8);
      updateCatcher(dt);
      npcGreet(dt);
      if (levels[level].check()) completeLevel();
    }

    // HUD
    ui.sus.style.width = Math.round(player.suspicion * 100) + "%";
    ui.sus.className = player.suspicion < 0.3 ? "low" : player.suspicion < 0.6 ? "med" : "high";
    ui.identity.textContent = `${player.collar ? "📛 collar" : "🚫 no collar"} · 🧼 ${Math.round(player.clean * 100)}%${player.bandana ? " · 🎽 bandana" : ""}`;
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
      if (c.kind === "frisbee") {
        const w = nearestWaiting(d, REACH_PERSON);
        if (w) return { verb: "Return", btn: "RETURN", label: `the frisbee to ${w.cname}`, x: w.pos.x, z: w.pos.z, person: w };
        const p = nearestPerson(d, REACH_PERSON);
        if (p) return { verb: "Play", btn: "PLAY", label: `with ${p.cname}`, x: p.pos.x, z: p.pos.z, person: p };
        return { verb: "Drop", btn: "DROP", label: "the frisbee", x: d.x, z: d.z };
      }
      if (c.kind === "ball") {
        const p = nearestPerson(d, REACH_PERSON);
        if (p) return { verb: "Give", btn: "GIVE", label: `${p.cname} the ball`, x: p.pos.x, z: p.pos.z, person: p };
        return { verb: "Throw", btn: "THROW", label: "the ball", x: d.x, z: d.z };
      }
      if (c.kind === "bone") {
        const dh = fetchSys.dogHoldingFrisbeeNear(d, REACH_PERSON);
        if (dh && dh.pref === "bone") return { verb: "Offer", btn: "OFFER", label: "the bone", x: dh.pos.x, z: dh.pos.z, dog: dh };
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
    update, begin, interact, onBark, player, people, catcher, fetchSys,
    get level() { return level; }, get phase() { return phase; },
    // test hooks
    _greetRole: (role) => greet(people.find((p) => p.role === role)),
    _playRole: (role) => playWith(people.find((p) => p.role === role)),
    _returnRole: (role) => returnTo(people.find((p) => p.role === role)),
    _arrest: arrest, presentation,
  };
}
