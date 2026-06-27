/* Doggo Dash — a tiny endless-runner about a very good dog.
 * Pure canvas, no dependencies. Open index.html and play.
 */
(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = H - 60; // top of the ground strip

  // --- HUD elements ---
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const treatsEl = document.getElementById("treats");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("start-btn");

  const BEST_KEY = "doggo-dash-best";
  let best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10);
  bestEl.textContent = best;

  // --- Game state ---
  const State = { MENU: "menu", PLAYING: "playing", PAUSED: "paused", OVER: "over" };
  let state = State.MENU;

  const game = {
    speed: 6,
    baseSpeed: 6,
    score: 0,
    treats: 0,
    distance: 0,
    spawnTimer: 0,
    treatTimer: 0,
    time: 0,
  };

  // --- The dog ---
  const dog = {
    x: 120,
    y: GROUND_Y,
    w: 64,
    h: 46,
    vy: 0,
    onGround: true,
    jumps: 0,
    ducking: false,
    runFrame: 0,
  };

  const GRAVITY = 0.9;
  const JUMP_V = -15;
  const MAX_JUMPS = 2;

  // --- Entities ---
  let obstacles = [];
  let collectibles = [];
  let particles = [];
  let clouds = [];
  let bushes = []; // background decoration

  function reset() {
    game.speed = game.baseSpeed;
    game.score = 0;
    game.treats = 0;
    game.distance = 0;
    game.spawnTimer = 60;
    game.treatTimer = 90;
    game.time = 0;
    dog.y = GROUND_Y;
    dog.vy = 0;
    dog.onGround = true;
    dog.jumps = 0;
    dog.ducking = false;
    obstacles = [];
    collectibles = [];
    particles = [];
    bushes = [];
    if (clouds.length === 0) {
      for (let i = 0; i < 5; i++) {
        clouds.push({ x: Math.random() * W, y: 30 + Math.random() * 120, s: 0.3 + Math.random() * 0.5, r: 18 + Math.random() * 22 });
      }
    }
  }

  // --- Input ---
  function jump() {
    if (state !== State.PLAYING) return;
    if (dog.jumps < MAX_JUMPS) {
      dog.vy = JUMP_V;
      dog.onGround = false;
      dog.jumps++;
      dog.ducking = false;
      spawnPuff(dog.x, dog.y, 6);
    }
  }

  function setDuck(on) {
    if (state !== State.PLAYING) return;
    dog.ducking = on && dog.onGround;
  }

  function startGame() {
    reset();
    state = State.PLAYING;
    overlay.classList.add("hidden");
  }

  function gameOver() {
    state = State.OVER;
    if (game.score > best) {
      best = game.score;
      localStorage.setItem(BEST_KEY, String(best));
      bestEl.textContent = best;
    }
    overlayTitle.textContent = "Good Boy! 🐾";
    overlayText.innerHTML =
      `You ran <b>${game.score}</b> meters and fetched <b>${game.treats}</b> treats.<br />` +
      `Best run: <b>${best}</b> meters.`;
    startBtn.textContent = "Run Again";
    overlay.classList.remove("hidden");
  }

  function togglePause() {
    if (state === State.PLAYING) {
      state = State.PAUSED;
      overlayTitle.textContent = "Paused";
      overlayText.innerHTML = "Catch your breath. Press <b>P</b> or the button to resume.";
      startBtn.textContent = "Resume";
      overlay.classList.remove("hidden");
    } else if (state === State.PAUSED) {
      state = State.PLAYING;
      overlay.classList.add("hidden");
    }
  }

  document.addEventListener("keydown", (e) => {
    switch (e.code) {
      case "Space":
      case "ArrowUp":
      case "KeyW":
        e.preventDefault();
        if (state === State.MENU || state === State.OVER) startGame();
        else jump();
        break;
      case "ArrowDown":
      case "KeyS":
        e.preventDefault();
        setDuck(true);
        break;
      case "KeyP":
        togglePause();
        break;
      case "Enter":
        if (state === State.MENU || state === State.OVER) startGame();
        break;
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "ArrowDown" || e.code === "KeyS") setDuck(false);
  });

  startBtn.addEventListener("click", () => {
    if (state === State.PAUSED) togglePause();
    else startGame();
  });

  // Touch / pointer: tap upper half = jump, lower half = duck
  canvas.addEventListener("pointerdown", (e) => {
    if (state === State.MENU || state === State.OVER) return startGame();
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (y > 0.6) setDuck(true);
    else jump();
  });
  canvas.addEventListener("pointerup", () => setDuck(false));
  canvas.addEventListener("pointerleave", () => setDuck(false));

  // --- Spawning ---
  const OBSTACLE_TYPES = [
    { kind: "hydrant", w: 26, h: 44, ground: true },
    { kind: "bush", w: 46, h: 30, ground: true },
    { kind: "bird", w: 40, h: 26, ground: false }, // flies — duck under it
  ];

  function spawnObstacle() {
    const t = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)];
    const o = { ...t, x: W + 20 };
    if (t.ground) {
      o.y = GROUND_Y - t.h;
    } else {
      // bird hovers at duck-height so the player must duck
      o.y = GROUND_Y - 54 - Math.random() * 10;
      o.flap = 0;
    }
    obstacles.push(o);
  }

  function spawnCollectible() {
    const isFrisbee = Math.random() < 0.4;
    const arcHeight = 60 + Math.random() * 90;
    collectibles.push({
      kind: isFrisbee ? "frisbee" : "bone",
      x: W + 20,
      y: GROUND_Y - 40 - Math.random() * arcHeight,
      r: isFrisbee ? 16 : 14,
      value: isFrisbee ? 5 : 2,
      spin: 0,
      taken: false,
    });
  }

  // --- Particles ---
  function spawnPuff(x, y, n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 3 - 1,
        vy: (Math.random() - 0.5) * 3,
        life: 1,
        r: 3 + Math.random() * 4,
        color: "rgba(220,220,230,",
      });
    }
  }
  function spawnSparkle(x, y, color) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        r: 2 + Math.random() * 3,
        color,
      });
    }
  }

  // --- Collision ---
  function dogBox() {
    const h = dog.ducking ? dog.h * 0.6 : dog.h;
    return { x: dog.x - dog.w / 2 + 6, y: dog.y - h, w: dog.w - 14, h: h - 4 };
  }
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // --- Update ---
  function update(dt) {
    if (state !== State.PLAYING) return;
    game.time += dt;

    // difficulty ramps with distance
    game.speed = game.baseSpeed + Math.min(8, game.distance / 400);
    game.distance += game.speed * dt;
    game.score = Math.floor(game.distance / 10);
    scoreEl.textContent = game.score;

    // dog physics
    dog.vy += GRAVITY;
    dog.y += dog.vy;
    if (dog.y >= GROUND_Y) {
      dog.y = GROUND_Y;
      dog.vy = 0;
      if (!dog.onGround) spawnPuff(dog.x, dog.y, 4);
      dog.onGround = true;
      dog.jumps = 0;
    }
    dog.runFrame += game.speed * dt * 0.4;

    // spawn logic
    game.spawnTimer -= game.speed * dt * 0.18;
    if (game.spawnTimer <= 0) {
      spawnObstacle();
      // gap shrinks as speed rises, with a floor for fairness
      game.spawnTimer = Math.max(48, 90 - game.distance / 60) + Math.random() * 40;
    }
    game.treatTimer -= game.speed * dt * 0.18;
    if (game.treatTimer <= 0) {
      spawnCollectible();
      game.treatTimer = 70 + Math.random() * 90;
    }

    const move = game.speed * dt;

    // obstacles
    for (const o of obstacles) {
      o.x -= move;
      if (o.kind === "bird") o.flap += dt * 0.3;
    }
    obstacles = obstacles.filter((o) => o.x + o.w > -20);

    // collision with obstacles
    const db = dogBox();
    for (const o of obstacles) {
      const ob = { x: o.x, y: o.y, w: o.w, h: o.h };
      if (overlap(db, ob)) {
        spawnSparkle(dog.x, dog.y - 20, "rgba(255,120,90,");
        return gameOver();
      }
    }

    // collectibles
    for (const c of collectibles) {
      c.x -= move;
      c.spin += dt * 0.2;
      if (!c.taken) {
        const cb = { x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2 };
        if (overlap(db, cb)) {
          c.taken = true;
          game.treats++;
          game.score += c.value;
          game.distance += c.value * 10;
          treatsEl.textContent = game.treats;
          spawnSparkle(c.x, c.y, c.kind === "frisbee" ? "rgba(255,200,60," : "rgba(255,235,180,");
        }
      }
    }
    collectibles = collectibles.filter((c) => c.x + c.r > -20 && !c.taken);

    // clouds drift
    for (const cl of clouds) {
      cl.x -= cl.s * dt;
      if (cl.x < -cl.r * 3) {
        cl.x = W + cl.r * 2;
        cl.y = 30 + Math.random() * 120;
      }
    }

    // background bushes
    if (Math.random() < 0.02) {
      bushes.push({ x: W + 20, y: GROUND_Y, s: 0.6 + Math.random() * 0.8 });
    }
    for (const b of bushes) b.x -= move * 0.5;
    bushes = bushes.filter((b) => b.x > -60);

    // particles
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.life -= dt * 0.05;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  // --- Rendering ---
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#8fd3ff");
    g.addColorStop(1, "#d8f3ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // sun
    ctx.fillStyle = "rgba(255,240,200,0.9)";
    ctx.beginPath();
    ctx.arc(W - 90, 80, 34, 0, Math.PI * 2);
    ctx.fill();

    // clouds
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (const cl of clouds) {
      puff(cl.x, cl.y, cl.r);
    }

    // distant bushes
    ctx.fillStyle = "#9fd68a";
    for (const b of bushes) {
      const r = 24 * b.s;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, Math.PI, 0);
      ctx.fill();
    }
  }

  function puff(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r, y + 4, r * 0.8, 0, Math.PI * 2);
    ctx.arc(x - r, y + 4, r * 0.8, 0, Math.PI * 2);
    ctx.arc(x + r * 0.4, y - r * 0.5, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGround() {
    ctx.fillStyle = "#6bbf59";
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = "#5aa84a";
    ctx.fillRect(0, GROUND_Y, W, 6);
    // moving grass dashes
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 3;
    const off = (game.distance * 1.0) % 40;
    for (let x = -off; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 24);
      ctx.lineTo(x + 14, GROUND_Y + 24);
      ctx.stroke();
    }
  }

  function drawDog() {
    const bob = dog.onGround ? Math.sin(dog.runFrame) * 2 : 0;
    const x = dog.x;
    const baseY = dog.y + bob;
    const duck = dog.ducking;
    const bodyH = duck ? 24 : 32;
    const bodyY = baseY - bodyH - 6;

    ctx.save();

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(x, dog.y + 2, 30, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    const fur = "#c8782f";
    const furDark = "#a85f1f";

    // legs (animated)
    ctx.strokeStyle = furDark;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    const legSwing = dog.onGround ? Math.sin(dog.runFrame) * 8 : 6;
    const legY = baseY - 6;
    // back legs
    ctx.beginPath();
    ctx.moveTo(x - 18, bodyY + bodyH);
    ctx.lineTo(x - 18 + legSwing, legY);
    ctx.moveTo(x - 8, bodyY + bodyH);
    ctx.lineTo(x - 8 - legSwing, legY);
    ctx.stroke();
    // front legs
    ctx.beginPath();
    ctx.moveTo(x + 14, bodyY + bodyH);
    ctx.lineTo(x + 14 - legSwing, legY);
    ctx.moveTo(x + 22, bodyY + bodyH);
    ctx.lineTo(x + 22 + legSwing, legY);
    ctx.stroke();

    // tail (wags)
    ctx.strokeStyle = fur;
    ctx.lineWidth = 8;
    const wag = Math.sin(dog.runFrame * 1.5) * 6;
    ctx.beginPath();
    ctx.moveTo(x - 26, bodyY + 6);
    ctx.quadraticCurveTo(x - 40, bodyY - 6 + wag, x - 44, bodyY - 14 + wag);
    ctx.stroke();

    // body
    ctx.fillStyle = fur;
    roundRect(x - 28, bodyY, 56, bodyH, 14);
    ctx.fill();

    // head
    const headX = x + 30;
    const headY = bodyY + (duck ? 2 : -4);
    ctx.fillStyle = fur;
    roundRect(headX - 14, headY - 14, 30, 28, 12);
    ctx.fill();
    // snout
    ctx.fillStyle = furDark;
    roundRect(headX + 8, headY - 2, 16, 14, 6);
    ctx.fill();
    // nose
    ctx.fillStyle = "#3a2a1a";
    ctx.beginPath();
    ctx.arc(headX + 23, headY + 4, 3, 0, Math.PI * 2);
    ctx.fill();
    // ear (flops with bob)
    ctx.fillStyle = furDark;
    ctx.beginPath();
    const earFlop = Math.sin(dog.runFrame) * 3;
    ctx.moveTo(headX - 12, headY - 12);
    ctx.quadraticCurveTo(headX - 24, headY - 4 + earFlop, headX - 14, headY + 10 + earFlop);
    ctx.quadraticCurveTo(headX - 6, headY, headX - 12, headY - 12);
    ctx.fill();
    // eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(headX + 6, headY - 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(headX + 7, headY - 2, 2, 0, Math.PI * 2);
    ctx.fill();
    // tongue when ducking or grounded fast
    if (!duck && dog.onGround) {
      ctx.fillStyle = "#e8607a";
      roundRect(headX + 18, headY + 8, 5, 8, 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawObstacle(o) {
    ctx.save();
    if (o.kind === "hydrant") {
      ctx.fillStyle = "#d63b3b";
      roundRect(o.x, o.y + 8, o.w, o.h - 8, 4);
      ctx.fill();
      ctx.fillRect(o.x - 4, o.y + o.h - 8, o.w + 8, 8);
      ctx.beginPath();
      ctx.arc(o.x + o.w / 2, o.y + 8, o.w / 2, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#9e2a2a";
      ctx.fillRect(o.x + o.w / 2 - 2, o.y, 4, 10);
    } else if (o.kind === "bush") {
      ctx.fillStyle = "#3f9e4d";
      ctx.beginPath();
      ctx.arc(o.x + 12, o.y + o.h, 14, Math.PI, 0);
      ctx.arc(o.x + 28, o.y + o.h, 16, Math.PI, 0);
      ctx.arc(o.x + 40, o.y + o.h, 12, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#ff5d8f";
      dot(o.x + 14, o.y + o.h - 14);
      dot(o.x + 34, o.y + o.h - 18);
    } else if (o.kind === "bird") {
      ctx.fillStyle = "#5a4a8a";
      const fy = Math.sin(o.flap * 6) * 6;
      // body
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, 14, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      // wings
      ctx.beginPath();
      ctx.moveTo(o.x + o.w / 2, o.y + o.h / 2);
      ctx.lineTo(o.x + 2, o.y + o.h / 2 - fy);
      ctx.lineTo(o.x + o.w / 2, o.y + o.h / 2 + 4);
      ctx.moveTo(o.x + o.w / 2, o.y + o.h / 2);
      ctx.lineTo(o.x + o.w - 2, o.y + o.h / 2 - fy);
      ctx.lineTo(o.x + o.w / 2, o.y + o.h / 2 + 4);
      ctx.fill();
      // beak
      ctx.fillStyle = "#ffb13d";
      ctx.beginPath();
      ctx.moveTo(o.x + o.w - 4, o.y + o.h / 2 - 2);
      ctx.lineTo(o.x + o.w + 6, o.y + o.h / 2);
      ctx.lineTo(o.x + o.w - 4, o.y + o.h / 2 + 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCollectible(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.kind === "frisbee") {
      ctx.rotate(Math.sin(c.spin * 4) * 0.4);
      ctx.fillStyle = "#ffcf3d";
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r, c.r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e0a800";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * 0.6, c.r * 0.27, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // bone
      ctx.rotate(c.spin);
      ctx.fillStyle = "#fff6e0";
      const r = c.r * 0.5;
      roundRect(-c.r, -r * 0.5, c.r * 2, r, r * 0.5);
      ctx.fill();
      for (const sx of [-c.r, c.r]) {
        ctx.beginPath();
        ctx.arc(sx, -r * 0.5, r * 0.6, 0, Math.PI * 2);
        ctx.arc(sx, r * 0.5, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.fillStyle = p.color + Math.max(0, p.life) + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function render() {
    drawBackground();
    drawGround();
    for (const c of collectibles) drawCollectible(c);
    for (const o of obstacles) drawObstacle(o);
    drawDog();
    drawParticles();
  }

  // --- Canvas helpers ---
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function dot(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Main loop ---
  let lastT = 0;
  function frame(t) {
    const dt = Math.min(2.5, (t - lastT) / 16.67 || 1); // normalized to 60fps steps
    lastT = t;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  reset();
  render();
  requestAnimationFrame(frame);
})();
