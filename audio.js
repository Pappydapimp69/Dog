/* Dog Park 3D — procedural, spatialized sound design.
 *
 * Everything is synthesized with the Web Audio API (no samples). The graph:
 *
 *   positional sources (birds, pond, road) ─┐ via PannerNode (HRTF + distance)
 *                                            ├─→ [stage bus] ─┐
 *   wind bed (non-positional) ──────────────────→ [ambient] ─┤
 *   player SFX (steps/jump/bark) ───────────────→ [sfx bus] ─┼─→ [limiter] ─→ [master] ─→ out
 *   reverb send ─→ [convolver] ─→ [wet] ──────────────────────┘
 *
 * A listener (synced to the camera every frame) gives the world a "stage": as
 * the dog moves, the direction and distance to each source changes. Each bird
 * owns its panner, so its call emits from wherever it physically is.
 */
export class ParkAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = localStorage.getItem("dogpark-muted") === "1";
    this.MASTER = 0.85;
    this._ambientStarted = false;
  }

  async start() {
    if (!this.ctx) this._build();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this._ambientStarted) { this._startStage(); this._ambientStarted = true; }
    this.ready = true;
    this._applyMute();
  }

  // ---- graph -------------------------------------------------------------
  _build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new Ctx());

    const limiter = (this.limiter = ctx.createDynamicsCompressor());
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.MASTER;
    limiter.connect(this.master).connect(ctx.destination);

    this.ambientBus = ctx.createGain(); this.ambientBus.gain.value = 0.9;
    this.ambientBus.connect(limiter);
    this.stageBus = ctx.createGain(); this.stageBus.gain.value = 1.0;
    this.stageBus.connect(limiter);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.95;
    this.sfxBus.connect(limiter);

    // shared outdoor reverb
    this.reverbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = this._makeIR();
    this.reverbWet = ctx.createGain(); this.reverbWet.gain.value = 0.4;
    this.reverbIn.connect(conv).connect(this.reverbWet).connect(limiter);

    this.noise = this._makeNoise(2);
    this.shaperCurve = this._makeShaperCurve(2.2);
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0; // Paul Kellet pink-noise approximation
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return buf;
  }

  _makeIR() {
    const ctx = this.ctx, dur = 1.6, rate = ctx.sampleRate;
    const len = Math.floor(dur * rate);
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const tt = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - tt, 2.6);
      }
      [0.011, 0.023, 0.037].forEach((rt, k) => {
        const idx = Math.floor(rt * rate);
        if (idx < len) d[idx] += 0.5 - 0.12 * k;
      });
    }
    return ir;
  }

  _makeShaperCurve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x);
    }
    return c;
  }

  _noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = loop;
    return s;
  }
  now() { return this.ctx.currentTime; }

  _lfo(param, min, max, periodSec) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = 1 / periodSec;
    const amp = ctx.createGain(); amp.gain.value = (max - min) / 2;
    const off = ctx.createConstantSource(); off.offset.value = (max + min) / 2;
    param.value = 0;
    osc.connect(amp).connect(param); off.connect(param);
    osc.start(); off.start();
  }

  // ---- spatial helpers ---------------------------------------------------
  _makePanner(send = 0.2) {
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 7;
    p.maxDistance = 140;
    p.rolloffFactor = 1.0;
    p.connect(this.stageBus);
    if (send > 0) {
      const s = ctx.createGain(); s.gain.value = send;
      p.connect(s); s.connect(this.reverbIn);
    }
    return p;
  }

  _setPannerPos(p, x, y, z) {
    if (p.positionX) {
      const t = this.now(), k = 0.03;
      p.positionX.setTargetAtTime(x, t, k);
      p.positionY.setTargetAtTime(y, t, k);
      p.positionZ.setTargetAtTime(z, t, k);
    } else {
      p.setPosition(x, y, z);
    }
  }

  // Synced to the camera each frame so the stereo image matches the view.
  updateListener(px, py, pz, fx, fy, fz) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.now(), k = 0.02;
    if (L.positionX) {
      L.positionX.setTargetAtTime(px, t, k);
      L.positionY.setTargetAtTime(py, t, k);
      L.positionZ.setTargetAtTime(pz, t, k);
      L.forwardX.setTargetAtTime(fx, t, k);
      L.forwardY.setTargetAtTime(fy, t, k);
      L.forwardZ.setTargetAtTime(fz, t, k);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  // ---- the stage ---------------------------------------------------------
  // Only the pond is a permanent positional source. Wind is now event-driven
  // (emitted by whatever a gust passes through) and traffic is real cars
  // (world spawns them and calls makeCarVoice). No flat ambient bed.
  _startStage() {
    const ctx = this.ctx;
    const pondP = this._makePanner(0.25);
    this._setPannerPos(pondP, -34, 0.5, -28);
    const water = this._noiseSrc(true);
    const wlf = ctx.createBiquadFilter(); wlf.type = "bandpass"; wlf.Q.value = 0.7;
    const wlg = ctx.createGain(); wlg.gain.value = 0.5;
    water.connect(wlf).connect(wlg).connect(pondP);
    water.start();
    this._lfo(wlf.frequency, 550, 1150, 3.3);
  }

  // A temporary positional emitter, cleaned up after `life` seconds.
  _oneShotPanner(x, y, z, send, life) {
    const p = this._makePanner(send);
    this._setPannerPos(p, x, y, z);
    setTimeout(() => { try { p.disconnect(); } catch (e) {} }, life * 1000);
    return p;
  }

  // Leaves rustling — emitted by a TREE as a wind gust sweeps through it.
  rustle(x, y, z, intensity = 0.6) {
    if (!this._can()) return;
    const ctx = this.ctx, t = this.now();
    const dur = 0.5 + intensity * 1.1;
    const dest = this._oneShotPanner(x, y, z, 0.3, dur + 0.6);
    const s = this._noiseSrc(true);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1500;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 0.5;
    const g = ctx.createGain();
    const peak = 0.05 + intensity * 0.15;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    // shimmer the band so it reads as many leaves, not one hiss
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 7 + intensity * 6;
    const lg = ctx.createGain(); lg.gain.value = 900;
    lfo.connect(lg).connect(bp.frequency);
    s.connect(hp).connect(bp).connect(g).connect(dest);
    s.start(t); s.stop(t + dur + 0.05);
    lfo.start(t); lfo.stop(t + dur + 0.05);
  }

  // The wind itself — a brief whoosh emitted from the DOG as a gust passes it.
  windGust(x, y, z, intensity = 0.6) {
    if (!this._can()) return;
    const ctx = this.ctx, t = this.now();
    const dur = 0.45 + intensity * 0.8;
    const dest = this._oneShotPanner(x, y, z, 0.2, dur + 0.6);
    const s = this._noiseSrc(true);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(280, t);
    bp.frequency.linearRampToValueAtTime(650 + intensity * 500, t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(240, t + dur);
    const g = ctx.createGain();
    const peak = 0.05 + intensity * 0.13;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(bp).connect(g).connect(dest);
    s.start(t); s.stop(t + dur + 0.05);
  }

  // ---- cars (moving positional sources) ----------------------------------
  makeCarVoice(withRadio = false) {
    const ctx = this.ctx;
    const panner = this._makePanner(0.15);

    // engine: low detuned saws + a fifth + filtered noise, lowpassed
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
    const eg = ctx.createGain(); eg.gain.value = 0.0001;
    lp.connect(eg).connect(panner);
    const base = 60 * (0.85 + Math.random() * 0.3);
    const o1 = ctx.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = base;
    const o2 = ctx.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = base * 1.5;
    const og = ctx.createGain(); og.gain.value = 0.5;
    o1.connect(og); o2.connect(og); og.connect(lp);
    const n = this._noiseSrc(true);
    const nlp = ctx.createBiquadFilter(); nlp.type = "lowpass"; nlp.frequency.value = 600;
    const ng = ctx.createGain(); ng.gain.value = 0.3;
    n.connect(nlp).connect(ng).connect(lp);
    o1.start(); o2.start(); n.start();
    eg.gain.setTargetAtTime(0.15, this.now(), 0.6); // fade engine in

    const radio = withRadio ? this._makeRadio(panner) : null;
    const self = this;
    return {
      hasRadio: !!radio,
      setPosition(x, y, z) { self._setPannerPos(panner, x, y, z); },
      stop() {
        try { o1.stop(); o2.stop(); n.stop(); } catch (e) {}
        if (radio) radio.stop();
        try { panner.disconnect(); } catch (e) {}
      },
    };
  }

  // Generative car radio — endless, never-repeating, muffled like it's heard
  // from a passing car. Each car gets its own key/tempo/pattern.
  _makeRadio(dest) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 850;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90;
    const out = ctx.createGain(); out.gain.value = 0.6;
    hp.connect(lp).connect(out).connect(dest);
    const bus = hp;

    const scales = [[0, 3, 5, 7, 10], [0, 2, 4, 7, 9], [0, 2, 3, 5, 7, 10]];
    const scale = scales[Math.floor(Math.random() * scales.length)];
    const root = 98 * Math.pow(2, Math.floor(Math.random() * 5) / 12); // ~G2, slight key shift
    const bpm = 82 + Math.random() * 46;
    const stepDur = 60 / bpm / 2; // eighth-note grid
    const density = 0.32 + Math.random() * 0.3;
    const self = this;
    const st = { alive: true, step: 0, timer: null };

    const note = (freq, t, dur, peak, type) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g).connect(bus);
      o.start(t); o.stop(t + dur + 0.02);
    };
    const kick = (t) => {
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.2);
    };
    const hat = (t) => {
      const s = self._noiseSrc(false);
      const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6000;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
      s.connect(f).connect(g).connect(bus); s.start(t); s.stop(t + 0.06);
    };

    const tick = () => {
      if (!st.alive) return;
      if (self._can()) {
        const t = self.now() + 0.06, s = st.step;
        if (s % 4 === 0) kick(t);
        if (s % 2 === 1) hat(t);
        if (s % 2 === 0) {
          const deg = s % 8 === 0 ? 0 : scale[Math.floor(Math.random() * scale.length)];
          note(root * Math.pow(2, deg / 12), t, stepDur * 1.6, 0.4, "sawtooth");
        }
        if (Math.random() < density) {
          const deg = scale[Math.floor(Math.random() * scale.length)];
          note(root * Math.pow(2, deg / 12) * 4, t, stepDur * 0.9, 0.2, "triangle");
        }
      }
      st.step++;
      st.timer = setTimeout(tick, stepDur * 1000);
    };
    tick();
    return { stop() { st.alive = false; clearTimeout(st.timer); try { out.disconnect(); } catch (e) {} } };
  }

  // ---- bird voices (one panner per bird) ---------------------------------
  makeBirdVoice(species, pitch = 1) {
    const panner = this._makePanner(0.3);
    const self = this;
    return {
      setPosition(x, y, z) { self._setPannerPos(panner, x, y, z); },
      call() { if (self._can()) self._birdCall(species, panner, pitch); },
      dispose() { try { panner.disconnect(); } catch (e) {} },
    };
  }

  _birdCall(species, dest, pitch) {
    const t = this.now();
    if (species === "sparrow") this._callSparrow(t, dest, pitch);
    else if (species === "robin") this._callRobin(t, dest, pitch);
    else this._callDove(t, dest, pitch);
  }

  _callSparrow(t, dest, pitch) {
    const ctx = this.ctx;
    const n = 2 + Math.floor(Math.random() * 4);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = Math.random() < 0.5 ? "sine" : "triangle";
      const f = (3500 + Math.random() * 1700) * pitch;
      o.frequency.setValueAtTime(f * 0.9, tt);
      o.frequency.exponentialRampToValueAtTime(f * 1.28, tt + 0.02);
      o.frequency.exponentialRampToValueAtTime(f * 0.95, tt + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.4, tt + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.06);
      o.connect(g).connect(dest);
      o.start(tt); o.stop(tt + 0.07);
      tt += 0.05 + Math.random() * 0.06;
    }
  }

  _callRobin(t, dest, pitch) {
    const ctx = this.ctx;
    const n = 4 + Math.floor(Math.random() * 5);
    let tt = t, f = (2400 + Math.random() * 900) * pitch;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = "sine";
      const nf = (2000 + Math.random() * 1600) * pitch;
      o.frequency.setValueAtTime(f, tt);
      o.frequency.exponentialRampToValueAtTime(nf, tt + 0.1);
      f = nf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.32, tt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.13);
      o.connect(g).connect(dest);
      o.start(tt); o.stop(tt + 0.15);
      tt += 0.1 + Math.random() * 0.05;
    }
  }

  _callDove(t, dest, pitch) {
    const ctx = this.ctx;
    const n = 2 + Math.floor(Math.random() * 3);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = "sine";
      const f = (560 + Math.random() * 120) * pitch;
      o.frequency.setValueAtTime(f * 0.95, tt);
      o.frequency.linearRampToValueAtTime(f * 1.05, tt + 0.08);
      o.frequency.linearRampToValueAtTime(f * 0.9, tt + 0.34);
      const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 6;
      const lg = ctx.createGain(); lg.gain.value = 7 * pitch;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(tt); lfo.stop(tt + 0.42);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.34, tt + 0.05);
      g.gain.setValueAtTime(0.34, tt + 0.2);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.4);
      o.connect(g).connect(dest);
      o.start(tt); o.stop(tt + 0.42);
      tt += 0.4 + (i === 0 ? 0.0 : Math.random() * 0.12);
    }
  }

  // ---- player SFX (present, non-positional) ------------------------------
  footstep(intensity = 0.8, water = false) {
    if (!this._can()) return;
    if (water) return this._splash(intensity);
    const ctx = this.ctx, t = this.now();
    const s = this._noiseSrc(false);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 1100 + Math.random() * 350;
    const g = ctx.createGain();
    const peak = 0.06 * intensity * (0.85 + Math.random() * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.06);
    s.connect(lp).connect(g).connect(this.sfxBus);
    s.start(t); s.stop(t + 0.08);
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.045 * intensity, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
    o.connect(og).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.08);
  }

  _splash(intensity) {
    const ctx = this.ctx, t = this.now();
    const s = this._noiseSrc(false);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 700;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11 * intensity, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
    s.connect(hp).connect(bp).connect(g).connect(this.sfxBus);
    s.start(t); s.stop(t + 0.18);
  }

  jump() {
    if (!this._can()) return;
    const ctx = this.ctx, t = this.now();
    const s = this._noiseSrc(false);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
    s.connect(bp).connect(g).connect(this.sfxBus);
    s.start(t); s.stop(t + 0.22);
  }

  land(intensity = 1) {
    if (!this._can()) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const og = ctx.createGain();
    const p = Math.min(0.18, 0.07 + 0.05 * intensity);
    og.gain.setValueAtTime(p, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
    o.connect(og).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.18);
    const s = this._noiseSrc(false);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.055 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.12);
    s.connect(lp).connect(g).connect(this.sfxBus);
    s.start(t); s.stop(t + 0.14);
  }

  collect(type) {
    if (!this._can()) return;
    const ctx = this.ctx, t = this.now();
    if (type === "frisbee") {
      const o = ctx.createOscillator(); o.type = "triangle";
      o.frequency.setValueAtTime(600, t);
      o.frequency.exponentialRampToValueAtTime(1300, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
      o.connect(g).connect(this.sfxBus);
      o.start(t); o.stop(t + 0.18);
      this._bell([1318.5, 1975.5], t + 0.04, 0.12);
    } else {
      const s = this._noiseSrc(false);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
      s.connect(bp).connect(g).connect(this.sfxBus);
      s.start(t); s.stop(t + 0.1);
      this._bell([1046.5, 1568.0], t + 0.02, 0.1);
    }
  }

  _bell(freqs, t, dur) {
    const ctx = this.ctx;
    freqs.forEach((f, i) => {
      const tt = t + i * 0.06;
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2.01;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.11, tt + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0008, tt + dur);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, tt);
      g2.gain.linearRampToValueAtTime(0.035, tt + 0.005);
      g2.gain.exponentialRampToValueAtTime(0.0008, tt + dur * 0.7);
      o.connect(g).connect(this.sfxBus);
      o2.connect(g2).connect(this.sfxBus);
      o.start(tt); o.stop(tt + dur + 0.02);
      o2.start(tt); o2.stop(tt + dur + 0.02);
    });
  }

  // ---- bark (reworked: glottal source → grit → formants → breath) --------
  bark() {
    if (!this._can()) return;
    let t = this.now();
    const syllables = Math.random() < 0.32 ? 2 : 1;
    const f0 = 235 * (0.85 + Math.random() * 0.45); // medium-dog register
    for (let i = 0; i < syllables; i++) {
      this._woof(t, f0 * (1 - i * 0.06)); // second syllable a touch lower
      t += 0.2 + Math.random() * 0.06;
    }
  }

  _woof(t, f0) {
    const ctx = this.ctx, dest = this.sfxBus, stop = t + 0.27;

    // Voiced glottal source: two detuned saws + a subharmonic for chest.
    const o1 = ctx.createOscillator(); o1.type = "sawtooth";
    const o2 = ctx.createOscillator(); o2.type = "sawtooth"; o2.detune.value = 9 + Math.random() * 9;
    const sub = ctx.createOscillator(); sub.type = "sine";
    const contour = (param, mul) => {
      param.setValueAtTime(f0 * 1.12 * mul, t);
      param.exponentialRampToValueAtTime(f0 * 1.5 * mul, t + 0.04); // quick rise
      param.exponentialRampToValueAtTime(f0 * 0.7 * mul, t + 0.2);  // then fall
    };
    contour(o1.frequency, 1); contour(o2.frequency, 1); contour(sub.frequency, 0.5);

    const src = ctx.createGain(); src.gain.value = 0.5;
    const subg = ctx.createGain(); subg.gain.value = 0.28;
    o1.connect(src); o2.connect(src); sub.connect(subg).connect(src);

    // Grit / body via waveshaper saturation.
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.shaperCurve; shaper.oversample = "2x";
    src.connect(shaper);

    // Amplitude envelope: sharp attack, short hold, natural decay.
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(0.5, t + 0.012);
    amp.gain.setValueAtTime(0.5, t + 0.05);
    amp.gain.exponentialRampToValueAtTime(0.0008, t + 0.25);
    amp.connect(dest);

    // Three vocal-tract formants; F1 sweeps as the "mouth" opens then closes.
    const forms = [[520, 8, 1.0], [1080, 9, 0.65], [2500, 11, 0.32]];
    forms.forEach(([f, q, g], i) => {
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
      if (i === 0) {
        bp.frequency.setValueAtTime(420, t);
        bp.frequency.linearRampToValueAtTime(720, t + 0.06);
        bp.frequency.linearRampToValueAtTime(500, t + 0.2);
      }
      const fg = ctx.createGain(); fg.gain.value = g;
      shaper.connect(bp).connect(fg).connect(amp);
    });

    // Breathy onset transient (the consonant of the "ruff").
    const s = this._noiseSrc(false);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    s.connect(hp).connect(ng).connect(dest);

    o1.start(t); o1.stop(stop);
    o2.start(t); o2.stop(stop);
    sub.start(t); sub.stop(stop);
    s.start(t); s.stop(t + 0.05);
  }

  // ---- mute --------------------------------------------------------------
  _can() { return this.ctx && this.ctx.state === "running" && !this.muted; }
  setMuted(m) {
    this.muted = m;
    localStorage.setItem("dogpark-muted", m ? "1" : "0");
    this._applyMute();
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
  _applyMute() {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.MASTER, this.now(), 0.05);
  }
}
