// Procedural BGM using the Web Audio lookahead scheduling pattern.
// Plays a looping EDM/chiptune track at 140 BPM with drums, bass, and lead.

const BPM = 140
const STEP = 60 / BPM / 4 // 16th-note duration in seconds
const LOOKAHEAD = 0.12 // schedule this many seconds ahead

// ─── Frequency table (A-minor pentatonic + extras) ───────────────────────────
const HZ = {
  G2: 98.0, A2: 110.0, C3: 130.8, D3: 146.8, E3: 164.8, G3: 196.0,
  A3: 220.0, C4: 261.6, D4: 293.7, E4: 329.6, G4: 392.0,
  A4: 440.0, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784.0, A5: 880.0,
}

// ─── 32-step (2-bar) drum + bass patterns ────────────────────────────────────
const KICK  = [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0]
const SNARE = [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0]
const HIHAT = [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0]
// Open hi-hat on the last 16th of each bar (the "pick-up" note)
const OPEN_HH = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]

const BASS = [
  'A2',null,'A2',null,'C3',null,'D3',null,
  'E3',null,'E3',null,'D3',null,'C3',null,
  'A2',null,'A2',null,'G2',null,'A2',null,
  'C3',null,'D3',null,'C3',null,'A2',null,
]
// Variation bass phrase (bars 3-4 of the 4-bar loop)
const BASS_B = [
  'E3',null,'E3',null,'D3',null,'C3',null,
  'A2',null,'G2',null,'A2',null,'C3',null,
  'D3',null,'E3',null,'G3',null,'E3',null,
  'D3',null,'C3',null,'A2',null,null,null,
]

// ─── Lead melody — two 32-step phrases for a 4-bar loop ──────────────────────
const LEAD = [
  'A4',null,null,null,'C5',null,null,null,
  'E5',null,null,null,'G5',null,'C5',null,
  'D5',null,null,null,'C5',null,null,null,
  'A4',null,null,null,null,null,null,null,
]
const LEAD_B = [
  'G4',null,null,null,'A4',null,'C5',null,
  'E5',null,'D5',null,'C5',null,null,null,
  'A4',null,'C5',null,'E5',null,'G5',null,
  'A5',null,null,null,'E5',null,'C5',null,
]

// ─── Purify-mode pattern (Eb-minor, ominous) ─────────────────────────────────
const PURIFY_BASS = [
  'C3',null,'C3',null,'Eb3',null,'F3',null,
  'G3',null,'G3',null,'F3',null,'Eb3',null,
  'C3',null,'Ab2',null,'C3',null,'Eb3',null,
  'F3',null,'Eb3',null,'C3',null,null,null,
]
const PURIFY_LEAD = [
  'Eb4',null,null,null,'F4',null,null,null,
  'Ab4',null,null,null,'G3',null,null,null,
  'Eb4',null,'F4',null,'Ab4',null,null,null,
  null, null,null,null,'Eb4',null,null,null,
]
const HZ_EXTRA = { Ab2: 103.8, Eb3: 155.6, F3: 174.6, Ab3: 207.7, Eb4: 311.1, F4: 349.2, Ab4: 415.3 }
const ALL_HZ = { ...HZ, ...HZ_EXTRA }

// ─── Zen mode: C-major pentatonic, slow sparse pads ──────────────────────────
const ZEN_PAD = [
  'C4',null,null,null,null,null,null,null,
  'G4',null,null,null,null,null,null,null,
  'E4',null,null,null,null,null,null,null,
  'A3',null,null,null,null,null,null,null,
]
const ZEN_MELODY = [
  null,null,null,null,'E5',null,null,null,
  null,null,null,null,'D5',null,null,null,
  null,null,null,null,'C5',null,null,null,
  null,null,null,null,'A4',null,null,null,
]

export class MusicManager {
  constructor(audioCtx) {
    this.ctx        = audioCtx
    this.playing    = false
    this.step       = 0
    this.barPhase   = 0   // 0-3, advances every 32 steps (4-bar loop)
    this.nextTime   = 0
    this.tickId     = null
    this.purifyMode = false
    this.zenMode    = false
    this.levelTier  = 0   // 0=normal, 1=high (lv5+), 2=intense (lv10+)

    this.masterGain = audioCtx.createGain()
    this.masterGain.gain.value = 0
    // Insert a low-pass filter after master gain so we can apply Zone FX
    this.lpf = audioCtx.createBiquadFilter()
    this.lpf.type = 'lowpass'
    this.lpf.frequency.value = 18000 // wide open by default
    this.lpf.Q.value = 0.7
    // Separate volume gain node (user-controlled)
    this.volumeGain = audioCtx.createGain()
    this.volumeGain.gain.value = 1.0
    this.masterGain.connect(this.lpf)
    this.lpf.connect(this.volumeGain)
    this.volumeGain.connect(audioCtx.destination)

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

  _openHihat(t) {
    const { ctx } = this
    const ns  = ctx.createBufferSource(); ns.buffer = this.noiseBuf
    const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 6500; bpf.Q.value = 0.6
    const g   = ctx.createGain()
    ns.connect(bpf); bpf.connect(g); g.connect(this.masterGain)
    g.gain.setValueAtTime(0.22, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11)
    ns.start(t); ns.stop(t + 0.12)
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
    // Octave-up triangle wave for intensity boost
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

  _chordPad(notes, t) {
    // Soft stacked sine pad — fades in slowly, sustains over 2 beats
    const { ctx } = this
    for (const note of notes) {
      const hz = ALL_HZ[note]; if (!hz) continue
      const osc = ctx.createOscillator(); const g = ctx.createGain()
      osc.connect(g); g.connect(this.masterGain)
      osc.type = 'sine'; osc.frequency.value = hz
      g.gain.setValueAtTime(0.0, t)
      g.gain.linearRampToValueAtTime(0.048, t + STEP * 2)
      g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 7.5)
      osc.start(t); osc.stop(t + STEP * 8)
    }
  }

  _purifyLead(note, t) {
    // Hollow sawtooth for an ominous Purify lead melody
    if (!note) return
    const hz = ALL_HZ[note]; if (!hz) return
    const { ctx } = this
    const osc = ctx.createOscillator()
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 900; lpf.Q.value = 3
    const g   = ctx.createGain()
    osc.connect(lpf); lpf.connect(g); g.connect(this.masterGain)
    osc.type = 'sawtooth'; osc.frequency.value = hz
    g.gain.setValueAtTime(0.065, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 3.8)
    osc.start(t); osc.stop(t + STEP * 4)
  }

  // ── Zen voices ─────────────────────────────────────────────────────
  _zenPad(note, t) {
    if (!note) return
    const hz = ALL_HZ[note]; if (!hz) return
    const { ctx } = this
    const osc = ctx.createOscillator(); const g = ctx.createGain()
    osc.connect(g); g.connect(this.masterGain)
    osc.type = 'sine'; osc.frequency.value = hz
    g.gain.setValueAtTime(0.0, t)
    g.gain.linearRampToValueAtTime(0.11, t + STEP * 3)
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 7.5)
    osc.start(t); osc.stop(t + STEP * 8)
  }

  _zenMelody(note, t) {
    if (!note) return
    const hz = ALL_HZ[note]; if (!hz) return
    const { ctx } = this
    const osc = ctx.createOscillator(); const g = ctx.createGain()
    osc.connect(g); g.connect(this.masterGain)
    osc.type = 'triangle'; osc.frequency.value = hz
    g.gain.setValueAtTime(0.07, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 3.8)
    osc.start(t); osc.stop(t + STEP * 4)
  }

  // ── Scheduler ────────────────────────────────────────────────────────────────────
  _scheduleStep(t) {
    const s = this.step % 32
    // Advance bar phase every 32 steps (one 2-bar phrase = 1 barPhase tick)
    if (s === 0 && this.step > 0) this.barPhase = (this.barPhase + 1) % 4

    if (this.zenMode) {
      this._zenPad(ZEN_PAD[s], t)
      this._zenMelody(ZEN_MELODY[s], t)
      this.step += 1
      return
    }

    // Drums — use fill pattern on last bar of every 4-bar cycle
    const isLastBar = this.barPhase === 3
    if (KICK[s])  this._kick(t)
    if (SNARE[s]) this._snare(t)
    if (HIHAT[s]) this._hihat(t)
    // Open hi-hat on the pick-up note; skip during purify (too busy)
    if (OPEN_HH[s] && !this.purifyMode) this._openHihat(t)
    // Extra kick on step 10 in the intense fill bar
    if (isLastBar && s === 10 && this.levelTier >= 1) this._kick(t)

    // Bass — alternate phrase every 2 bars (barPhase 2-3 uses BASS_B)
    const useBassB = !this.purifyMode && (this.barPhase === 2 || this.barPhase === 3)
    const bass = this.purifyMode ? PURIFY_BASS[s] : (useBassB ? BASS_B[s] : BASS[s])
    this._bass(bass, t)

    if (this.purifyMode) {
      // Ominous lead + sparse open hihats for tension
      this._purifyLead(PURIFY_LEAD[s], t)
      if (s % 8 === 0) this._openHihat(t)
    } else {
      // Lead — alternate phrase every 2 bars
      const leadNote = (this.barPhase === 1 || this.barPhase === 3) ? LEAD_B[s] : LEAD[s]
      this._lead(leadNote, t)
      if (this.levelTier >= 1) this._lead2(leadNote, t)
      // Chord pad on beat 1 and beat 3 of each bar (steps 0 and 16)
      if (s === 0)  this._chordPad(['A3', 'C4', 'E4'], t)
      if (s === 16) this._chordPad(['G3', 'C4', 'D4'], t)
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
  start(purifyMode = false, zenMode = false) {
    if (this.playing) return
    if (this.ctx.state === 'suspended') this.ctx.resume()
    this.purifyMode = purifyMode
    this.zenMode    = zenMode
    this.playing    = true
    this.step       = 0
    this.barPhase   = 0
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

  setPurifyMode(on) { this.purifyMode = on }
  setZenMode(on)    { this.zenMode    = on }

  setVolume(vol) {
    const v = Math.max(0, Math.min(1, vol))
    this.volumeGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  setLevel(level) {
    this.levelTier = level >= 10 ? 2 : level >= 5 ? 1 : 0
    // Subtly boost master volume at higher levels for energy
    if (this.playing) {
      const target = this.levelTier === 2 ? 0.28 : this.levelTier === 1 ? 0.25 : 0.22
      const t = this.ctx.currentTime
      this.masterGain.gain.cancelScheduledValues(t)
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t)
      this.masterGain.gain.linearRampToValueAtTime(target, t + 2.0)
    }
  }

  // ── Zone FX: muffle/duck the mix while Zone is active ─────────────────────
  setZoneFx(on) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const targetFreq = on ? 900 : 18000
    const targetGain = on ? 0.18 : (this.levelTier === 2 ? 0.28 : this.levelTier === 1 ? 0.25 : 0.22)
    this.lpf.frequency.cancelScheduledValues(t)
    this.lpf.frequency.setValueAtTime(this.lpf.frequency.value, t)
    this.lpf.frequency.linearRampToValueAtTime(targetFreq, t + 0.25)
    this.masterGain.gain.cancelScheduledValues(t)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t)
    this.masterGain.gain.linearRampToValueAtTime(targetGain, t + 0.35)
  }

  // ── One-shot SFX (bypass masterGain — always audible) ────────────────────────
  _sfxNote(hz, gain, dur, type = 'triangle', offset = 0) {
    const { ctx } = this
    const osc = ctx.createOscillator(); const g = ctx.createGain()
    osc.connect(g); g.connect(ctx.destination)
    osc.type = type; osc.frequency.value = hz
    const t = ctx.currentTime + offset
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.start(t); osc.stop(t + dur + 0.01)
  }

  playCountdownBeep(n) {
    // n = 3/2/1 → ascending blip, n = 0 → "GO!" fanfare
    if (!this.ctx) return
    if (this.ctx.state === 'suspended') this.ctx.resume()
    if (n > 0) {
      const freqs = [261.6, 293.7, 329.6]
      this._sfxNote(freqs[n - 1] ?? 261.6, 0.18, 0.28, 'triangle')
    } else {
      [523.3, 659.3, 784.0, 1046.5].forEach((hz, i) =>
        this._sfxNote(hz, 0.22, 0.24, 'triangle', i * 0.05))
    }
  }

  playLevelUp() {
    if (!this.ctx) return
    if (this.ctx.state === 'suspended') this.ctx.resume()
    // C4-E4-G4-C5 jingle
    [261.6, 329.6, 392.0, 523.3].forEach((hz, i) =>
      this._sfxNote(hz, 0.20, 0.22, 'sine', i * 0.07))
  }

  playZoneReady() {
    if (!this.ctx) return
    if (this.ctx.state === 'suspended') this.ctx.resume()
    [784.0, 1046.5].forEach((hz, i) =>
      this._sfxNote(hz, 0.14, 0.38, 'triangle', i * 0.14))
  }

  playZoneEnd(lines = 0) {
    if (!this.ctx) return
    if (this.ctx.state === 'suspended') this.ctx.resume()
    const base = lines >= 8
      ? [392.0, 523.3, 659.3, 784.0, 1046.5, 1318.5]
      : [392.0, 523.3, 659.3, 784.0, 1046.5]
    base.forEach((hz, i) =>
      this._sfxNote(hz, 0.16, 0.30, 'triangle', i * 0.06))
  }
}
