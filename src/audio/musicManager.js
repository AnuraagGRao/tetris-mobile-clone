// Procedural BGM using the Web Audio lookahead scheduling pattern.
// Plays a looping EDM/chiptune track at 140 BPM with drums, bass, and lead.

const BPM = 140
const STEP = 60 / BPM / 4 // 16th-note duration in seconds
const LOOKAHEAD = 0.12 // schedule this many seconds ahead

// ─── Frequency table (A-minor pentatonic) ────────────────────────────────────
const HZ = {
  G2: 98.0, A2: 110.0, C3: 130.8, D3: 146.8, E3: 164.8, G3: 196.0,
  A3: 220.0, C4: 261.6, D4: 293.7, E4: 329.6, G4: 392.0,
  A4: 440.0, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784.0,
}

// ─── 32-step (2-bar) patterns ─────────────────────────────────────────────────
const KICK  = [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0]
const SNARE = [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0]
const HIHAT = [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0]

const BASS = [
  'A2',null,'A2',null,'C3',null,'D3',null,
  'E3',null,'E3',null,'D3',null,'C3',null,
  'A2',null,'A2',null,'G2',null,'A2',null,
  'C3',null,'D3',null,'C3',null,'A2',null,
]
const LEAD = [
  'A4',null,null,null,'C5',null,null,null,
  'E5',null,null,null,'G5',null,'C5',null,
  'D5',null,null,null,'C5',null,null,null,
  'A4',null,null,null,null,null,null,null,
]

// ─── Purify-mode pattern (slower, Eb-minor, more ominous) ────────────────────
const PURIFY_BASS = [
  'C3',null,'C3',null,'Eb3',null,'F3',null,
  'G3',null,'G3',null,'F3',null,'Eb3',null,
  'C3',null,'Ab2',null,'C3',null,'Eb3',null,
  'F3',null,'Eb3',null,'C3',null,null,null,
]
const HZ_EXTRA = { Ab2: 103.8, Eb3: 155.6, F3: 174.6, Ab3: 207.7, Eb4: 311.1, F4: 349.2, Ab4: 415.3 }
const ALL_HZ = { ...HZ, ...HZ_EXTRA }

export class MusicManager {
  constructor(audioCtx) {
    this.ctx        = audioCtx
    this.playing    = false
    this.step       = 0
    this.nextTime   = 0
    this.tickId     = null
    this.purifyMode = false
    this.highLevel  = false

    this.masterGain = audioCtx.createGain()
    this.masterGain.gain.value = 0
    this.masterGain.connect(audioCtx.destination)

    // Pre-generate a half-second white-noise buffer (reused for every drum hit)
    const noiseLen = Math.floor(audioCtx.sampleRate * 0.5)
    this.noiseBuf = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate)
    const nd = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1
  }

  // ── Drum voices ─────────────────────────────────────────────────────────────
  _kick(t) {
    const { ctx } = this
    const osc = ctx.createOscillator()
    const g   = ctx.createGain()
    osc.connect(g); g.connect(this.masterGain)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(160, t)
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.08)
    g.gain.setValueAtTime(1.4, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
    osc.start(t); osc.stop(t + 0.15)
  }

  _snare(t) {
    const { ctx } = this
    // White-noise burst
    const ns  = ctx.createBufferSource(); ns.buffer = this.noiseBuf
    const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 1800
    const ng  = ctx.createGain()
    ns.connect(hpf); hpf.connect(ng); ng.connect(this.masterGain)
    ng.gain.setValueAtTime(0.55, t)
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    ns.start(t); ns.stop(t + 0.11)
    // Tonal body
    const osc = ctx.createOscillator(); const og = ctx.createGain()
    osc.connect(og); og.connect(this.masterGain)
    osc.type = 'triangle'; osc.frequency.value = 185
    og.gain.setValueAtTime(0.45, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
    osc.start(t); osc.stop(t + 0.08)
  }

  _hihat(t) {
    const { ctx } = this
    const ns  = ctx.createBufferSource(); ns.buffer = this.noiseBuf
    const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 9000; bpf.Q.value = 0.5
    const g   = ctx.createGain()
    ns.connect(bpf); bpf.connect(g); g.connect(this.masterGain)
    g.gain.setValueAtTime(0.16, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
    ns.start(t); ns.stop(t + 0.035)
  }

  // ── Melodic voices ───────────────────────────────────────────────────────────
  _bass(note, t) {
    if (!note) return
    const hz = ALL_HZ[note]; if (!hz) return
    const { ctx } = this
    const osc = ctx.createOscillator()
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 700; lpf.Q.value = 2.5
    const g   = ctx.createGain()
    osc.connect(lpf); lpf.connect(g); g.connect(this.masterGain)
    osc.type = 'sawtooth'; osc.frequency.value = hz
    g.gain.setValueAtTime(0.55, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 1.8)
    osc.start(t); osc.stop(t + STEP * 2)
  }

  _lead(note, t) {
    if (!note) return
    const hz = ALL_HZ[note]; if (!hz) return
    const { ctx } = this
    // Two slightly detuned square waves for width
    for (const detune of [0, 5]) {
      const osc = ctx.createOscillator(); const g = ctx.createGain()
      osc.connect(g); g.connect(this.masterGain)
      osc.type = 'square'; osc.detune.value = detune
      osc.frequency.value = hz
      g.gain.setValueAtTime(0.09, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 3.5)
      osc.start(t); osc.stop(t + STEP * 4)
    }
  }

  _lead2(note, t) {
    // Octave-up triangle wave for high-level intensity boost
    if (!note) return
    const hz = ALL_HZ[note]; if (!hz) return
    const { ctx } = this
    const osc = ctx.createOscillator(); const g = ctx.createGain()
    osc.connect(g); g.connect(this.masterGain)
    osc.type = 'triangle'; osc.frequency.value = hz * 2
    g.gain.setValueAtTime(0.04, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 2.5)
    osc.start(t); osc.stop(t + STEP * 3)
  }

  // ── Scheduler ────────────────────────────────────────────────────────────────────
  _scheduleStep(t) {
    const s    = this.step % 32
    const bass = this.purifyMode ? PURIFY_BASS[s] : BASS[s]
    if (KICK[s])  this._kick(t)
    if (SNARE[s]) this._snare(t)
    if (HIHAT[s]) this._hihat(t)
    this._bass(bass, t)
    if (!this.purifyMode) {
      this._lead(LEAD[s], t)
      if (this.highLevel) this._lead2(LEAD[s], t)
    }
    this.step += 1
  }

  _tick() {
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      this._scheduleStep(this.nextTime)
      this.nextTime += STEP
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  start(purifyMode = false) {
    if (this.playing) return
    if (this.ctx.state === 'suspended') this.ctx.resume()
    this.purifyMode = purifyMode
    this.playing    = true
    this.step       = 0
    this.nextTime   = this.ctx.currentTime + 0.06
    // Fade in
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime)
    this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime)
    this.masterGain.gain.linearRampToValueAtTime(0.22, this.ctx.currentTime + 0.5)
    this.tickId = setInterval(() => this._tick(), 12)
  }

  stop() {
    if (!this.playing) return
    // Fade out then clear interval
    const t = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(t)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t)
    this.masterGain.gain.linearRampToValueAtTime(0, t + 0.3)
    setTimeout(() => {
      clearInterval(this.tickId)
      this.tickId = null
      this.playing = false
    }, 350)
  }

  setPurifyMode(on) {
    this.purifyMode = on
  }

  setLevel(level) {
    this.highLevel = level >= 5
  }
}
