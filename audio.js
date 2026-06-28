/* Dog Park 3D — procedural sound design.
 *
 * All audio is synthesized with the Web Audio API (no sample files), so there
 * are no assets to load or license. The graph is:
 *
 *     [ambient bus] ┐
 *                   ├─→ [limiter] ─→ [master gain] ─→ destination
 *     [sfx bus]     ┘
 *
 * Ambient = wind + distant city hum + birdsong + passing traffic + pond water.
 * SFX     = footsteps, jump, land, bone/frisbee pickups, bark.
 */
export class ParkAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = localStorage.getItem("dogpark-muted") === "1";
    this.MASTER = 0.85;
    this._ambientStarted = false;
    this._birdTimer = null;
    this._trafficTimer = null;
  }

  // Must be called from a user gesture (autoplay policy).
  async start() {
    if (!this.ctx) this._build();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this._ambientStarted) { this._startAmbient(); this._ambientStarted = true; }
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

    this.ambientBus = ctx.createGain();
    this.ambientBus.gain.value = 0.9;
    this.ambientBus.connect(limiter);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.95;
    this.sfxBus.connect(limiter);

    this.noise = this._makeNoise(2);
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Paul Kellet's pink-noise approximation — warmer than white.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return buf;
  }

  _noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  now() { return this.ctx.currentTime; }

  // Drive an AudioParam between min and max with a sine LFO of given period.
  _lfo(param, min, max, periodSec) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 1 / periodSec;
    const amp = ctx.createGain();
    amp.gain.value = (max - min) / 2;
    const off = ctx.createConstantSource();
    off.offset.value = (max + min) / 2;
    param.value = 0; // let the summed sources fully drive it
    osc.connect(amp).connect(param);
    off.connect(param);
    osc.start();
    off.start();
  }

  // ---- ambient bed -------------------------------------------------------
  _startAmbient() {
    const ctx = this.ctx;

    // Wind: pink noise, low-passed, gusting.
    const wind = this._noiseSrc(true);
    const wf = ctx.createBiquadFilter();
    wf.type = "lowpass"; wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wind.connect(wf).connect(wg).connect(this.ambientBus);
    wind.start();
    this._lfo(wg.gain, 0.03, 0.085, 11);
    this._lfo(wf.frequency, 300, 600, 17);

    // Distant city hum: heavily low-passed noise + a sub rumble.
    const hum = this._noiseSrc(true);
    const hf = ctx.createBiquadFilter();
    hf.type = "lowpass"; hf.frequency.value = 180;
    const hg = ctx.createGain(); hg.gain.value = 0.045;
    hum.connect(hf).connect(hg).connect(this.ambientBus);
    hum.start();

    const rumble = ctx.createOscillator();
    rumble.type = "sine"; rumble.frequency.value = 68;
    const rg = ctx.createGain();
    rumble.connect(rg).connect(this.ambientBus);
    rumble.start();
    this._lfo(rg.gain, 0.006, 0.016, 9);

    // Pond water lapping — gain controlled by proximity (starts silent).
    const water = this._noiseSrc(true);
    const wlf = ctx.createBiquadFilter();
    wlf.type = "bandpass"; wlf.Q.value = 0.7;
    const wlg = ctx.createGain(); wlg.gain.value = 0;
    water.connect(wlf).connect(wlg).connect(this.ambientBus);
    water.start();
    this._lfo(wlf.frequency, 550, 1150, 3.3);
    this.waterGain = wlg;

    this._scheduleBirds();
    this._scheduleTraffic();
  }

  _scheduleBirds() {
    const delay = 1400 + Math.random() * 4200;
    this._birdTimer = setTimeout(() => {
      if (this._can()) this._bird();
      this._scheduleBirds();
    }, delay);
  }

  _bird() {
    const ctx = this.ctx, t0 = this.now();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain(); out.gain.value = 0.9;
    out.connect(pan).connect(this.ambientBus);
    // a little air with a short feedback delay
    const dl = ctx.createDelay(); dl.delayTime.value = 0.05;
    const fb = ctx.createGain(); fb.gain.value = 0.22;
    pan.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(this.ambientBus);

    const notes = 1 + Math.floor(Math.random() * 4);
    const baseF = 2200 + Math.random() * 2300;
    let t = t0;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      o.type = Math.random() < 0.5 ? "sine" : "triangle";
      const g = ctx.createGain();
      const f0 = baseF * (0.9 + Math.random() * 0.3);
      const f1 = f0 * (1.12 + Math.random() * 0.5);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.04);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.95, t + 0.085);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.1);
      t += 0.055 + Math.random() * 0.05;
    }
  }

  _scheduleTraffic() {
    const delay = 12000 + Math.random() * 22000;
    this._trafficTimer = setTimeout(() => {
      if (this._can()) this._whoosh();
      this._scheduleTraffic();
    }, delay);
  }

  _whoosh() {
    const ctx = this.ctx, t = this.now();
    const s = this._noiseSrc(false);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1100, t + 1.2);
    bp.frequency.exponentialRampToValueAtTime(260, t + 2.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + 2.6);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(-0.9, t);
    pan.pan.linearRampToValueAtTime(0.9, t + 2.6);
    s.connect(bp).connect(g).connect(pan).connect(this.ambientBus);
    s.start(t); s.stop(t + 2.7);
  }

  // ---- SFX ---------------------------------------------------------------
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
    // soft paw-pad thump
    const o = ctx.createOscillator();
    o.type = "sine";
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
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 700;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 0.8;
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
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 0.9;
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
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const og = ctx.createGain();
    const p = Math.min(0.18, 0.07 + 0.05 * intensity);
    og.gain.setValueAtTime(p, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
    o.connect(og).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.18);
    const s = this._noiseSrc(false);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 500;
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
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(600, t);
      o.frequency.exponentialRampToValueAtTime(1300, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
      o.connect(g).connect(this.sfxBus);
      o.start(t); o.stop(t + 0.18);
      this._bell([1318.5, 1975.5], t + 0.04, 0.12); // E6 → B6
    } else {
      // bone: a quick crunch, then a happy bell
      const s = this._noiseSrc(false);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
      s.connect(bp).connect(g).connect(this.sfxBus);
      s.start(t); s.stop(t + 0.1);
      this._bell([1046.5, 1568.0], t + 0.02, 0.1); // C6 → G6
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

  bark() {
    if (!this._can()) return;
    let t = this.now();
    const syllables = Math.random() < 0.3 ? 2 : 1;
    for (let i = 0; i < syllables; i++) {
      this._woof(t);
      t += 0.18 + Math.random() * 0.06;
    }
  }

  // A stylized "woof": a pitch-dropping voiced source through two vocal-tract
  // formants, plus a short breath/consonant noise transient.
  _woof(t) {
    const ctx = this.ctx;
    const base = 150 * (0.9 + Math.random() * 0.25);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(base * 2.0, t);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.12);
    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass"; f1.frequency.value = 900; f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter();
    f2.type = "bandpass"; f2.frequency.value = 1800; f2.Q.value = 6;
    const f2g = ctx.createGain(); f2g.gain.value = 0.5;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0.0001, t);
    vg.gain.linearRampToValueAtTime(0.22, t + 0.01);
    vg.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
    o.connect(f1).connect(vg);
    o.connect(f2).connect(f2g).connect(vg);
    vg.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.2);

    const s = this._noiseSrc(false);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.07, t);
    ng.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
    s.connect(hp).connect(ng).connect(this.sfxBus);
    s.start(t); s.stop(t + 0.06);
  }

  // 0..1 — how close the dog is to the pond.
  setWaterProximity(p) {
    if (!this.waterGain) return;
    const target = Math.max(0, Math.min(1, p)) * 0.09;
    this.waterGain.gain.setTargetAtTime(target, this.now(), 0.2);
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
