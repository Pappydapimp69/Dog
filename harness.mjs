/* Headless driver for Dog Park 3D.
 *
 * Why this exists: every "not verified in-engine" note in this project's recent
 * history traces to the same wall — a throwaway Playwright script that could
 * not reliably get the built game into a state worth looking at. The cost was
 * paid six or seven separate times, always by flailing at buttons, never by
 * reading the boot state. What was actually in the way:
 *
 *  1. Character creation is a THREE-step wizard behind one button whose label
 *     changes (slot -> coat -> name -> start). Clicking "Start New Game" once
 *     does nothing visible and looks like a broken harness.
 *  2. `startGame` fires on ANY keydown, so pressing W at the title screen
 *     starts a run. A test that then asserted "the dog did not move" was
 *     reading a legitimately frozen prologue cutscene, not an input failure.
 *     I spent a long time debugging focus and event plumbing that was fine.
 *  3. The prologue opens on chained cutscenes. `_movementFrozen` is true
 *     throughout, by design.
 *  4. #cinema covers the screen and eats pointer events, so Playwright's
 *     actionability checks time out on buttons that are genuinely there.
 *
 * Method follows brain dog#E2/#E22: headless rAF runs well under wall-clock and
 * the ratio is not stable, so NOTHING here sleeps a computed duration. Every
 * step polls the game's own state for the transition it wants. `settle()` is
 * the only primitive; everything else is built from it.
 *
 *   import { open } from "./harness.mjs";
 *   const g = await open();          // booted, at the title
 *   await g.newRun();                // through the wizard, into the prologue
 *   await g.toPlay();                // past the prologue, free to move
 *   await g.walk("KeyW", 2);         // move and confirm the dog actually moved
 *   await g.shot("park");
 *   await g.close();
 */

/* Playwright is a GLOBAL install here, and node resolves bare specifiers from
 * the IMPORTING file's directory — so `import "playwright"` works from a
 * scratch dir that happens to have a node_modules and fails from inside this
 * repo, which has neither node_modules nor a package.json. Resolving it
 * explicitly means the harness runs from anywhere with no setup step to
 * forget, which is the point of committing it rather than rewriting it each
 * time. */
const PLAYWRIGHT_PATHS = ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs",
                          "/opt/node22/lib/node_modules/playwright"];
let chromium = null;
for (const spec of PLAYWRIGHT_PATHS) {
  try { ({ chromium } = await import(spec)); break; } catch (e) { /* try the next */ }
}
if (!chromium) throw new Error("harness: could not resolve playwright from any known location");

const SCRATCH = "/tmp/claude-0/-home-user/d1d70558-2fa2-5cda-b6de-08026fd865d4/scratchpad";

/** Poll `fn` in the page until truthy. Never a fixed wait (dog#E22). */
async function settle(page, fn, { timeout = 30000, label = "condition", arg } = {}) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
  } catch (e) {
    const state = await page.evaluate(() => {
      const g = window.__game;
      return g ? { phase: g.phase, frozen: g._movementFrozen, cutscene: g._cutsceneActive } : "no __game";
    }).catch(() => "page gone");
    throw new Error(`harness: timed out waiting for ${label}. state=${JSON.stringify(state)}`);
  }
}

/* A phone, as honestly as a headless browser can be one.
 *
 * Height is NOT the device's raw resolution: real browser chrome (status bar,
 * address bar) eats a large fraction of it, and testing width without testing
 * height is how bottom-anchored UI ends up below the fold (brain#E13,
 * collective#E8). 390x664 is an iPhone 14 with Safari's chrome showing.
 *
 * `hasTouch` matters more than the size. A keyboard-driven test on a narrow
 * viewport proves the LAYOUT survives a phone and nothing about whether a
 * touch-only player can press anything — an entire device category can be
 * unplayable underneath a green suite (the-recursion#E10). Anything checking
 * mobile must drive `tap`, never `press`.
 */
export const PHONE = {
  viewport: { width: 390, height: 664 },
  hasTouch: true, isMobile: true, deviceScaleFactor: 3,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
             "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

export async function open({ url = "http://localhost:8140/", viewport = { width: 1100, height: 620 },
                             quiet = false, mobile = false } = {}) {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--use-gl=swiftshader"],
  });
  const context = await browser.newContext(mobile ? PHONE : { viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => { errors.push(String(e.message)); if (!quiet) console.log("PAGEERROR:", e.message); });
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });

  await page.goto(url, { waitUntil: "load" });
  await settle(page, () => !!window.__game && !!window.__dog, { label: "the game to boot", timeout: 90000 });

  const api = {
    page, browser, errors,

    /** Everything worth knowing about where we are, in one object. */
    state: () => page.evaluate(() => ({
      phase: window.__game.phase,
      level: window.__game.level,
      frozen: window.__game._movementFrozen,
      cutscene: window.__game._cutsceneActive,
      pos: { x: +window.__dog.pos.x.toFixed(1), z: +window.__dog.pos.z.toFixed(1) },
      speed: +window.__dog.speed.toFixed(2),
      nightT: +(window.__env?.nightT ?? 0).toFixed(2),
      objective: document.getElementById("objective-text")?.textContent || "",
    })),

    settle: (fn, opts) => settle(page, fn, opts),

    /**
     * Click a button by id THROUGH any overlay. #cinema is fixed, inset 0 and
     * takes pointer events, so a normal Playwright click waits forever on
     * actionability for an element that is visible and enabled.
     */
    click: (id) => page.evaluate((i) => {
      const el = document.getElementById(i);
      if (!el) throw new Error(`no #${i}`);
      el.click();
      return true;
    }, id),

    /**
     * Through character creation into the run. The wizard is slot -> coat ->
     * name -> start behind ONE button, so this clicks until the phase actually
     * changes rather than assuming a count.
     */
    async newRun() {
      for (let i = 0; i < 6; i++) {
        if ((await page.evaluate(() => window.__game.phase)) !== "idle") break;
        await api.click("start-btn");
        await page.waitForTimeout(150);   // one paint for the wizard to swap steps
      }
      await settle(page, () => window.__game.phase !== "idle", { label: "the run to start" });
      return api;
    },

    /** Advance every queued cutscene, polling for the end of the chain. */
    async skipCutscenes({ tries = 120 } = {}) {
      for (let i = 0; i < tries; i++) {
        if (!(await page.evaluate(() => window.__game._cutsceneActive))) break;
        await page.evaluate(() => window.__game.advanceCinematic && window.__game.advanceCinematic());
        await page.waitForTimeout(120);
      }
      return api;
    },

    /** Dismiss any story/level card that is up. Returns how many it cleared. */
    async clearCards({ tries = 12 } = {}) {
      let n = 0;
      for (let i = 0; i < tries; i++) {
        const clicked = await page.evaluate(() => {
          for (const sel of ["#story-overlay", "#cutscene-overlay", "#ach-overlay", "#settings-overlay", "#pause-overlay"]) {
            const ov = document.querySelector(sel);
            if (ov && !ov.classList.contains("hidden")) {
              const btn = ov.querySelector("button");
              if (btn) { btn.click(); return true; }
            }
          }
          return false;
        });
        if (!clicked) break;
        n++;
        await page.waitForTimeout(150);
      }
      return n;
    },

    /**
     * All the way to free play: run started, prologue struck, no cards, and
     * movement actually unfrozen. This is the state almost every check wants
     * and the one that used to take a bespoke script each time.
     */
    async toPlay() {
      if ((await page.evaluate(() => window.__game.phase)) === "idle") await api.newRun();
      await api.skipCutscenes();
      await page.evaluate(() => window.__game._completePrologue && window.__game._completePrologue());
      await settle(page, () => window.__game.phase === "play", { label: "phase to reach play" });
      await api.clearCards();
      await api.skipCutscenes();
      await settle(page, () => !window.__game._movementFrozen, { label: "movement to unfreeze" });
      return api;
    },

    /**
     * Into the prologue's scent hunt, where four of the reported bugs live
     * (trail stops, the food beat, the headlight van, the underpass). The
     * route is not built at newRun() — it is built by beginFollow, after the
     * cold-open cutscene chain, so this advances those and then waits for the
     * route itself rather than for a phase.
     */
    async toTrail() {
      if ((await page.evaluate(() => window.__game.phase)) === "idle") await api.newRun();
      await api.skipCutscenes();
      await settle(page, () => !!window.__game._prologueStops(),
        { label: "the trail route to be built", timeout: 40000 });
      return api;
    },

    /** Put the dog somewhere. Clears velocity tracking the way a teleport must. */
    place: (x, z) => page.evaluate(([px, pz]) => {
      window.__dog.pos.x = px; window.__dog.pos.z = pz;
    }, [x, z]),

    /**
     * Hold a key until the dog has actually travelled `units`, then release.
     * Asserting on distance rather than on a duration is the whole point:
     * headless frame pacing is not wall-clock (dog#E2) so "hold for 700ms"
     * covers an unpredictable distance, and "the dog did not move" is the
     * failure this harness exists to tell apart from "input did not arrive".
     */
    async walk(key = "KeyW", units = 3, { timeout = 15000 } = {}) {
      const from = (await api.state()).pos;
      await page.keyboard.down(key);
      try {
        await settle(page,
          ([fx, fz, u]) => Math.hypot(window.__dog.pos.x - fx, window.__dog.pos.z - fz) >= u,
          { timeout, label: `the dog to travel ${units}u holding ${key}`, arg: [from.x, from.z, units] });
      } finally {
        await page.keyboard.up(key);
      }
      const to = (await api.state()).pos;
      return { from, to, moved: +Math.hypot(to.x - from.x, to.z - from.z).toFixed(2) };
    },

    press: (key) => page.keyboard.press(key),

    /**
     * Where an element actually is, and whether a finger could land on it.
     * `onScreen` is the box intersected with the viewport — "not hidden" is not
     * the same claim as "reachable" for bottom-anchored controls on a short
     * screen (sandbox-combined-mobile-visibility#E1).
     */
    box: (id) => page.evaluate((i) => {
      const el = document.getElementById(i);
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const vw = innerWidth, vh = innerHeight;
      const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      return {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
        // checkVisibility, not the element's own computed style: a child of a
        // display:none parent reports its OWN display, so a style-only check
        // says the mobile controls are up on the title screen (they are inside
        // a hidden overlay). That false positive is worse than no check.
        hidden: !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        onScreen: Math.round(ix * iy),                       // visible area in px²
        clipped: Math.round(ix * iy) < Math.round(r.width * r.height) - 1,
        // What the OS would hand the touch to at this element's own centre.
        topAtCentre: (document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)) || {}).id || null,
        vw, vh,
      };
    }, id),

    /**
     * Which pairs of these ids visibly overlap on screen, and by how much.
     * "Each cluster is not hidden" is not the claim that matters — nothing
     * enforces that two independently-positioned clusters never share screen
     * space, and a desktop viewport never exercises the narrow case at all
     * (dog#E25, brain#E13). Asserts element-vs-element, not off-screen-edge.
     */
    async overlaps(ids) {
      const boxes = {};
      for (const id of ids) { const b = await api.box(id); if (b && !b.hidden && b.onScreen) boxes[id] = b; }
      const out = [];
      const keys = Object.keys(boxes);
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const a = boxes[keys[i]], b = boxes[keys[j]];
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (w > 0 && h > 0) out.push({ a: keys[i], b: keys[j], area: w * h,
          frac: +(w * h / Math.min(a.w * a.h, b.w * b.h)).toFixed(2) });
      }
      return out.sort((p, q) => q.area - p.area);
    },

    /**
     * A REAL touch, at the element's own centre — not el.click(), which skips
     * hit-testing and would happily "press" a button under an overlay, and not
     * page.keyboard, which is a different device entirely.
     */
    async tap(id) {
      const b = await api.box(id);
      if (!b) throw new Error(`harness: no #${id} to tap`);
      if (b.hidden) throw new Error(`harness: #${id} is hidden`);
      if (!b.onScreen) throw new Error(`harness: #${id} is off-screen at ${b.x},${b.y} (viewport ${b.vw}x${b.vh})`);
      await page.touchscreen.tap(b.cx, b.cy);
      return b;
    },

    /**
     * Drag the on-screen stick with a REAL touch, held until the dog has
     * actually travelled — same rule as walk(): assert distance, never a
     * duration, because headless frame pacing is not wall-clock (dog#E2).
     *
     * Driven through CDP's Input.dispatchTouchEvent rather than a synthesized
     * TouchEvent, for two reasons. Playwright's touchscreen API only taps, so
     * there is no drag; and the joystick listens on POINTER events, which a
     * hand-made TouchEvent does not produce — a synthetic touch would dispatch
     * cleanly, change nothing, and the test would read as "touch input is
     * broken" when it had never been delivered.
     */
    async stick(dx, dy, { units = 2, timeout = 15000 } = {}) {
      const b = await api.box("joystick");
      if (!b || b.hidden) throw new Error("harness: no joystick on screen");
      const cdp = await page.context().newCDPSession(page);
      const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
      const pt = (x, y) => ({ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 });
      const from = (await api.state()).pos;
      await send("touchStart", [pt(b.cx, b.cy)]);
      try {
        await send("touchMove", [pt(b.cx + dx, b.cy + dy)]);
        await settle(page,
          ([fx, fz, u]) => Math.hypot(window.__dog.pos.x - fx, window.__dog.pos.z - fz) >= u,
          { timeout, label: `the dog to travel ${units}u on the stick`, arg: [from.x, from.z, units] });
      } finally {
        await send("touchEnd", []);
        await cdp.detach().catch(() => {});
      }
      const to = (await api.state()).pos;
      return { from, to, moved: +Math.hypot(to.x - from.x, to.z - from.z).toFixed(2) };
    },

    eval: (fn, arg) => page.evaluate(fn, arg),
    shot: async (name) => { const path = `${SCRATCH}/${name}.png`; await page.screenshot({ path }); return path; },
    close: () => browser.close(),
    mobile,
  };
  return api;
}
