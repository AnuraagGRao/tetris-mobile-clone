import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import './App.css'
import GameCanvas from './components/GameCanvas'
import TouchControls from './components/TouchControls'
import ThemeSwitcher from './components/ThemeSwitcher'
import AboutPage from './components/AboutPage'
import SettingsPage from './components/SettingsPage'
import { useTheme } from './contexts/ThemeContext'
import { MusicManager } from './audio/musicManager'
import {
  BLITZ_DURATION_MS, GAME_MODE, PURIFY_DURATION_MS,
  SPRINT_LINES, TetrisEngine, ZONE_DURATION_MS, ZONE_MIN_METER,
} from './logic/gameEngine'
import { TetrisBot } from './logic/tetrisBot'
import { PIECES } from './logic/tetrominoes'

// ─── Key bindings ─────────────────────────────────────────────────────────────
const KEY_BINDINGS = {
  ArrowLeft:  { held: 'left' },
  ArrowRight: { held: 'right' },
  ArrowDown:  { held: 'softDrop' },
  ArrowUp:    { action: 'rotateCW' },
  KeyZ:       { action: 'rotateCCW' },
  Space:      { action: 'hardDrop' },
  KeyX:       { action: 'rotate180' },
  KeyF:       { action: 'rotate180' },
  KeyC:       { action: 'hold' },
  ShiftLeft:  { action: 'activateZone' },
  ShiftRight: { action: 'activateZone' },
  Escape:     { action: 'pause' },
  KeyP:       { action: 'pause' },
}

const P2_BINDINGS = {
  KeyD: { held: 'right' }, KeyA: { held: 'left' }, KeyS: { held: 'softDrop' },
  KeyW: { action: 'rotateCW' }, KeyQ: { action: 'rotateCCW' },
  KeyE: { action: 'rotate180' }, KeyR: { action: 'hold' }, KeyT: { action: 'hardDrop' },
}

// ─── Audio ────────────────────────────────────────────────────────────────────
const MAX_FRAME_TIME_MS = 34
const ToneContext = window.AudioContext || window.webkitAudioContext
let sharedAudioContext
let musicManager

const getAudioCtx = () => {
  if (!ToneContext) return null
  if (!sharedAudioContext) {
    sharedAudioContext = new ToneContext()
    musicManager = new MusicManager(sharedAudioContext)
  }
  return sharedAudioContext
}

const playNote = (freq, duration, gain, type = 'sine', offset = 0) => {
  const ctx = getAudioCtx(); if (!ctx) return
  const osc = ctx.createOscillator(), g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.type = type; osc.frequency.value = freq
  const t = ctx.currentTime + offset
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + duration)
  osc.start(t); osc.stop(t + duration + 0.01)
}
const arp = (notes, dur = 0.07, gain = 0.04, type = 'triangle') =>
  notes.forEach((f, i) => playNote(f, dur, gain, type, i * dur * 0.65))

// Noise burst helper for whooshes/impacts
const playNoise = (lpFreq, gain, dur, offset = 0) => {
  const ctx = getAudioCtx(); if (!ctx) return
  const len = Math.ceil(ctx.sampleRate * Math.min(dur, 0.5))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource(); src.buffer = buf
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lpFreq
  const g = ctx.createGain()
  src.connect(flt); flt.connect(g); g.connect(ctx.destination)
  const t = ctx.currentTime + offset
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  src.start(t); src.stop(t + dur + 0.01)
}

// Move SFX — subtle, rate-limited so DAS doesn't spam it
let _lastMoveBeep = 0
const playMoveSFX = () => {
  const now = performance.now(); if (now - _lastMoveBeep < 75) return
  _lastMoveBeep = now
  playNote(380, 0.022, 0.026, 'triangle')
}

const playRotateSFX = () => {
  playNote(1100, 0.032, 0.048, 'triangle')
  playNote(750,  0.022, 0.030, 'sine', 0.010)
}

const playLockSFX = () => {
  // Soft low thud for gravity/soft-drop locks
  const ctx = getAudioCtx(); if (!ctx) return
  const osc = ctx.createOscillator(); const g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.type = 'sine'
  const t = ctx.currentTime
  osc.frequency.setValueAtTime(110, t)
  osc.frequency.exponentialRampToValueAtTime(52, t + 0.07)
  g.gain.setValueAtTime(0.07, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.10)
  osc.start(t); osc.stop(t + 0.11)
}

const playHardDropSFX = () => {
  // Deep bass thud + high click + noise
  playNote(75, 0.18, 0.14, 'sine')
  playNote(280, 0.06, 0.07, 'square', 0.006)
  playNoise(600, 0.08, 0.10, 0.006)
}

const playLineClearSFX = () => {
  playNoise(9000, 0.055, 0.08)
  arp([392, 523, 659, 784], 0.095, 0.065, 'sine')
}

const playTSpinSFX = () => {
  arp([330, 415, 523, 659, 784], 0.10, 0.075, 'triangle')
  playNote(330, 0.20, 0.028, 'sine', 0.06)
}

const playTetrisSFX = () => {
  arp([262, 330, 392, 523, 659, 784, 1047], 0.09, 0.08, 'sine')
  playNote(131, 0.35, 0.065, 'sine', 0.12)
}

const playAllClearSFX = () => {
  // Full chromatic sweep + bass boom
  const fs = [262,294,330,349,392,440,494,523,587,659,698,784,880,988,1047,1319]
  fs.forEach((f, i) => playNote(f, 0.14, 0.075, 'sine', i * 0.038))
  playNote(65,  0.45, 0.10, 'sine', 0.22)
  playNote(131, 0.30, 0.08, 'sine', 0.22)
  playNoise(10000, 0.09, 0.22, 0.12)
}

const playB2BSFX = () => arp([1047, 1319, 1568], 0.065, 0.065, 'sine')

const playLevelUpSFX = () => arp([261.6, 329.6, 392.0, 523.3], 0.10, 0.12, 'triangle')

const playZoneActivateSFX = () => {
  arp([131, 165, 196, 262, 330, 392, 523, 784], 0.13, 0.075, 'triangle')
  playNoise(2500, 0.07, 0.16, 0.06)
}

const playGameOverSFX = () => {
  arp([523, 466, 415, 370, 330, 294, 262, 233, 220], 0.12, 0.09, 'sawtooth')
  playNote(55, 0.5, 0.08, 'sine', 0.12)
  playNoise(700, 0.055, 0.4, 0.06)
}

const playComboSFX = (c) => {
  const base = Math.min(440 + c * 80, 1400)
  playNote(base, 0.09, 0.07, 'triangle')
  if (c >= 3) playNote(base * 1.26, 0.07, 0.055, 'triangle', 0.022)
  if (c >= 5) playNote(base * 1.5,  0.06, 0.045, 'sine',     0.044)
}

const playZenResetSFX = () => arp([784, 880, 1047, 1319], 0.20, 0.04, 'sine')

const playHoldSFX = () => {
  playNote(660, 0.045, 0.038, 'triangle')
  playNote(990, 0.035, 0.028, 'triangle', 0.018)
}

const playZoneMeterMilestoneSFX = (tier) => {
  // tier: 1 = 50%, 2 = 75%
  if (tier === 2) {
    playNote(880, 0.07, 0.08, 'triangle')
    playNote(1320, 0.05, 0.06, 'triangle', 0.03)
  } else {
    playNote(660, 0.06, 0.06, 'triangle')
  }
}

const playLineClearHaptic = (lines) => {
  if (lines >= 4) return [20, 5, 20, 5, 20, 5, 60]
  if (lines === 3) return [15, 5, 15, 5, 15]
  if (lines === 2) return [12, 5, 12]
  return [10]
}

const playCountdownTickSFX = (second) => {
  // Rising pitch + urgency as it counts down to 1
  const freq = 660 + (10 - second) * 55
  playNote(freq, 0.07, 0.12, 'square')
  if (second <= 3) playNote(freq * 1.5, 0.05, 0.06, 'sine', 0.028)
}

// ─── Config / settings storage ───────────────────────────────────────────────
const CONFIG_KEY = 'tetris-config'
const DEFAULT_CONFIG = { sfxEnabled: true, hapticEnabled: true, musicVolume: 1.0, das: 110, arr: 25 }
const loadConfig = () => {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') } }
  catch (e) { console.warn('Failed to load config:', e); return { ...DEFAULT_CONFIG } }
}

// ─── High-score storage ───────────────────────────────────────────────────────
const HS_KEY = 'tetris-highs'
const loadHighScores = () => {
  try { return JSON.parse(localStorage.getItem(HS_KEY) ?? '{}') } catch { return {} }
}

// ─── PiecePreview ─────────────────────────────────────────────────────────────
const PREV_CELL = 10
const PREV_COLS = 4
const PREV_ROWS = 2

function PiecePreview({ type, small = false }) {
  const canvasRef = useRef(null)
  const cell = small ? 8 : PREV_CELL

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!type) return
    const { matrix, color } = PIECES[type]
    const filled = matrix.filter(r => r.some(Boolean))
    const colMin = Math.min(...filled.map(r => r.findIndex(Boolean)))
    const colMax = Math.max(...filled.map(r => r.length - 1 - [...r].reverse().findIndex(Boolean)))
    const tw = colMax - colMin + 1, th = filled.length
    const ox = Math.floor((PREV_COLS - tw) / 2) * cell
    const oy = Math.floor((PREV_ROWS - th) / 2) * cell
    filled.forEach((row, ry) => {
      for (let cx = colMin; cx <= colMax; cx++) {
        if (!row[cx]) continue
        ctx.save()
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8
        ctx.fillRect(ox + (cx - colMin) * cell + 1, oy + ry * cell + 1, cell - 2, cell - 2)
        ctx.restore()
      }
    })
  }, [type, cell])

  const w = PREV_COLS * cell, h = PREV_ROWS * cell
  return (
    <div className="preview-box" style={small ? { height: '1.8rem' } : undefined}>
      {type
        ? <canvas ref={canvasRef} width={w} height={h} className="preview-canvas" />
        : <span className="preview-empty">—</span>}
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const { setTheme } = useTheme()
  const engine  = useMemo(() => new TetrisEngine(), [])
  const engine2 = useMemo(() => new TetrisEngine(), [])

  const [state,  setState]  = useState(() => engine.getState())
  const [state2, setState2] = useState(() => engine2.getState())
  const [config, setConfig] = useState(loadConfig)
  const [gameMode, setGameMode]   = useState(GAME_MODE.NORMAL)
  const [purifyDifficulty, setPurifyDifficulty] = useState('normal')
  const [botDifficulty, setBotDifficulty]       = useState('medium')
  const [botEnabled, setBotEnabled]             = useState(true)
  const [musicOn, setMusicOn]     = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [highScores, setHighScores] = useState(() => loadHighScores())
  const [newHigh, setNewHigh]     = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const checkMobile = () => window.innerWidth < 768 || (window.innerHeight < 600 && ('ontouchstart' in window || navigator.maxTouchPoints > 0))
  const checkLandscape = () => window.innerHeight < 600 && window.innerWidth > window.innerHeight && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  const [isMobile, setIsMobile]       = useState(checkMobile)
  const [isLandscape, setIsLandscape] = useState(checkLandscape)
  const [showMobileModes, setShowMobileModes] = useState(false)
  const [zenResetting, setZenResetting] = useState(false)
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('tetris-zoom') || 1))
  const [isUiHidden, setIsUiHidden] = useState(false)
  const cycleZoom = () => setZoom(z => {
    const next = z >= 1.5 ? 1 : z >= 1.25 ? 1.5 : 1.25
    localStorage.setItem('tetris-zoom', next)
    return next
  })

  const heldRef   = useRef({ left: false, right: false, softDrop: false })
  const held2Ref  = useRef({ left: false, right: false, softDrop: false })
  const gpHeldRef  = useRef({ left: false, right: false, softDrop: false })
  const actionRef  = useRef({})
  const action2Ref = useRef({})
  const prevGameOverRef  = useRef(false)
  const prevGameOver2Ref = useRef(false)
  const prevLevelRef      = useRef(1)
  const prevBackToBackRef = useRef(false)
  const prevZoneMeterRef  = useRef(0)
  const prevZoneActiveRef = useRef(false)
  const musicOnRef  = useRef(false)
  const countdownActiveRef = useRef(false)
  const gameModeRef = useRef(GAME_MODE.NORMAL)
  const purifyDiffRef = useRef('normal')
  const botDiffRef    = useRef('medium')
  const botEnabledRef = useRef(true)
  const isMobileRef   = useRef(window.innerWidth < 768 || (window.innerHeight < 600 && ('ontouchstart' in window || navigator.maxTouchPoints > 0)))
  const botRef        = useRef(null)
  const zenResettingRef = useRef(false)
  const prevBlitzSecRef  = useRef(null)
  const prevPurifySecRef = useRef(null)
  const configRef         = useRef(config)
  useEffect(() => { configRef.current = config }, [config])

  // Persist config changes
  useEffect(() => { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)) }, [config])

  // Sync engine DAS/ARR from config
  useEffect(() => { engine.setSettings({ das: config.das, arr: config.arr }) },  [engine, config.das, config.arr])
  useEffect(() => { engine2.setSettings({ das: config.das, arr: config.arr }) }, [engine2, config.das, config.arr])

  // Resize → isMobile
  useEffect(() => {
    const handler = () => {
      const m = window.innerWidth < 768 || (window.innerHeight < 600 && ('ontouchstart' in window || navigator.maxTouchPoints > 0))
      const ls = window.innerHeight < 600 && window.innerWidth > window.innerHeight && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
      isMobileRef.current = m
      setIsMobile(m)
      setIsLandscape(ls)
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // ─── Visual Viewport sync ───────────────────────────────────────────────────
  // Keeps --app-height in sync with the *visual* viewport so that mobile-layout
  // fills exactly the visible area even when the browser chrome is animating in/out.
  const syncAppHeight = useCallback(() => {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight
    document.documentElement.style.setProperty('--app-height', `${h}px`)
  }, [])

  useEffect(() => {
    syncAppHeight()
    const vvp = window.visualViewport
    if (vvp) {
      vvp.addEventListener('resize', syncAppHeight)
      vvp.addEventListener('scroll', syncAppHeight)
    }
    window.addEventListener('resize', syncAppHeight)
    return () => {
      if (vvp) {
        vvp.removeEventListener('resize', syncAppHeight)
        vvp.removeEventListener('scroll', syncAppHeight)
      }
      window.removeEventListener('resize', syncAppHeight)
    }
  }, [syncAppHeight])

  // Re-sync whenever the UI hidden state changes so the canvas fills the freed
  // space on the very first toggle without requiring a second tap.
  useEffect(() => {
    syncAppHeight()
    // Belt-and-suspenders: nudge layout engine after the CSS transition starts
    const id = setTimeout(syncAppHeight, 50)
    return () => clearTimeout(id)
  }, [isUiHidden, syncAppHeight])

  // Toggle handler — forces a repaint immediately after state update
  const handleUiToggle = useCallback(() => {
    setIsUiHidden(h => !h)
    // schedule height re-sync after React has committed the class change:
    // rAF fires after the next paint; the 1 ms follow-up catches browsers that
    // defer the visual-viewport update until after the first frame (Mobile Safari).
    requestAnimationFrame(() => {
      syncAppHeight()
      setTimeout(syncAppHeight, 1)
    })
  }, [syncAppHeight])

  // Sync infection-timer multiplier: give mobile portrait players 1.5× more reaction time
  useEffect(() => {
    const mult = isMobile && !isLandscape ? 1.5 : 1.0
    engine.setTouchMultiplier(mult)
    engine2.setTouchMultiplier(mult)
  }, [engine, engine2, isMobile, isLandscape])

  // PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
      // Only show the banner if not already installed (standalone)
      if (!window.matchMedia('(display-mode: standalone)').matches) {
        setShowInstallBanner(true)
      }
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') { setInstallPrompt(null); setShowInstallBanner(false) }
  }

  const handleInstallFromAbout = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') { setInstallPrompt(null); setShowInstallBanner(false) }
  }

  const handleDismissInstall = () => setShowInstallBanner(false)

  const renderInstallBanner = () => showInstallBanner ? (
    <div className="pwa-install-banner">
      <span className="pwa-install-text">📲 Add Tetris to your home screen for the best experience</span>
      <div className="pwa-install-actions">
        <button type="button" className="pwa-install-btn" onClick={handleInstall}>Install</button>
        <button type="button" className="pwa-dismiss-btn" onClick={handleDismissInstall}>✕</button>
      </div>
    </div>
  ) : null

  const handleZenTopOut = () => {
    // Guard against multiple top-out callbacks firing during the same lock/spawn cycle.
    if (zenResettingRef.current) return
    zenResettingRef.current = true
    setZenResetting(true)
    playZenResetSFX()
    engine.zenClearBoard()
    setState(engine.getState())
    setTimeout(() => {
      zenResettingRef.current = false
      setZenResetting(false)
    }, 380)
  }

  // ─── Start game ────────────────────────────────────────────────────────────
  const startGame = (mode) => {
    getAudioCtx()
    setGameMode(mode); gameModeRef.current = mode
    const diff = purifyDiffRef.current
    engine.reset(mode, diff)
    engine2.reset(mode, diff)
    setState(engine.getState()); setState2(engine2.getState())
    prevGameOverRef.current = false; prevGameOver2Ref.current = false
    prevLevelRef.current = 1; prevBackToBackRef.current = false; prevZoneMeterRef.current = 0; prevZoneActiveRef.current = false
    zenResettingRef.current = false
    prevBlitzSecRef.current = null; prevPurifySecRef.current = null
    setZenResetting(false)
    setNewHigh(false)
    heldRef.current  = { left: false, right: false, softDrop: false }
    held2Ref.current = { left: false, right: false, softDrop: false }
    actionRef.current = {}; action2Ref.current = {}
    // Create bot for versus
    if (mode === GAME_MODE.VERSUS) {
      botRef.current = new TetrisBot(botDiffRef.current)
    }
    // Zen: wire topout handler + auto-apply zen theme
    if (mode === GAME_MODE.ZEN) {
      engine.setTopOutHandler(handleZenTopOut)
      setTheme('zen')
    } else {
      engine.setTopOutHandler(null)
    }
    countdownActiveRef.current = true
    setCountdown(3)
    setShowMobileModes(false)
  }

  // ─── Countdown ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) {
      countdownActiveRef.current = false
      setCountdown(null)
      musicManager?.playCountdownBeep?.(0) // "GO!" fanfare
      return
    }
    musicManager?.playCountdownBeep?.(countdown) // 3, 2, 1 beeps
    const id = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [countdown])

  // ─── Game loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let last = performance.now(), frameId = 0
    const frame = (now) => {
      const dt = Math.min(MAX_FRAME_TIME_MS, now - last); last = now
      if (!countdownActiveRef.current) {
        const held = {
          left:     heldRef.current.left     || gpHeldRef.current.left,
          right:    heldRef.current.right    || gpHeldRef.current.right,
          softDrop: heldRef.current.softDrop || gpHeldRef.current.softDrop,
        }
        engine.update(dt, held, actionRef.current)
        actionRef.current = {}
        const mode = gameModeRef.current
        if (mode === GAME_MODE.VERSUS) {
          // Bot drives P2
          const useBotForP2 = isMobileRef.current || botEnabledRef.current
          if (useBotForP2 && botRef.current) {
            botRef.current.update(dt, engine2, held2Ref.current, action2Ref)
          }
          engine2.update(dt, held2Ref.current, action2Ref.current)
          action2Ref.current = {}
        }
      } else {
        actionRef.current = {}; action2Ref.current = {}
      }

      const ns  = engine.getState()
      const ns2 = engine2.getState()

      if (gameModeRef.current === GAME_MODE.VERSUS) {
        if (ns.lastGarbage  > 0) engine2.receiveGarbage(ns.lastGarbage)
        if (ns2.lastGarbage > 0) engine.receiveGarbage(ns2.lastGarbage)
      }

      const cfg = configRef.current
      const sfxOn = cfg.sfxEnabled
      const hapticOn = cfg.hapticEnabled
      const doVibrate = (pattern) => { if (hapticOn) navigator.vibrate?.(pattern) }

      if (ns.hardDropped) {
        if (sfxOn) playHardDropSFX()
      } else if (ns.pieceLocked) {
        if (sfxOn) playLockSFX()
        doVibrate(6)
      }
      if (ns.pieceHeld) {
        if (sfxOn) playHoldSFX()
        doVibrate(8)
      }
      if (ns.lastCombo > 0 && sfxOn) playComboSFX(ns.lastCombo)
      if (ns.lastClear) {
        const { spinType, lines, isAllClear } = ns.lastClear
        if (isAllClear) {
          if (sfxOn) playAllClearSFX()
          doVibrate([20, 5, 20, 5, 20, 5, 60])
        } else if (spinType === 'tSpin' || spinType === 'allSpin') {
          if (sfxOn) playTSpinSFX()
          doVibrate([10, 10, 30])
        } else if (lines === 4) {
          if (sfxOn) playTetrisSFX()
          doVibrate([20, 5, 20, 5, 20, 5, 60])
        } else if (lines > 0) {
          if (sfxOn) playLineClearSFX()
          doVibrate(playLineClearHaptic(lines))
        }
      }
      // B2B streak start
      if (ns.backToBack && !prevBackToBackRef.current && sfxOn) playB2BSFX()
      prevBackToBackRef.current = ns.backToBack
      // Level up
      if (ns.level > prevLevelRef.current && sfxOn) playLevelUpSFX()
      prevLevelRef.current = ns.level
      // Zone meter milestones (50%, 75%) + zone ready (100%)
      const prevMeter = prevZoneMeterRef.current
      if (!ns.zoneActive) {
        if (ns.zoneMeter >= 100 && prevMeter < 100) {
          musicManager?.playZoneReady?.()
          doVibrate([10, 10, 10, 10, 20])
        } else if (ns.zoneMeter >= 75 && prevMeter < 75) {
          if (sfxOn) playZoneMeterMilestoneSFX(2)
          doVibrate([8, 8, 15])
        } else if (ns.zoneMeter >= 50 && prevMeter < 50) {
          if (sfxOn) playZoneMeterMilestoneSFX(1)
          doVibrate(10)
        }
      }
      prevZoneMeterRef.current = ns.zoneMeter
      // Zone end — play fanfare when zone deactivates
      if (prevZoneActiveRef.current && !ns.zoneActive && ns.zoneEndResult) {
        musicManager?.playZoneEnd?.(ns.zoneEndResult.lines ?? 0)
        doVibrate([0, 80, 30, 80, 30, 120])
      }
      // Zone FX: toggle low-pass and ducking on BGM when Zone activates/deactivates
      if (!prevZoneActiveRef.current && ns.zoneActive) {
        musicManager?.setZoneFx?.(true)
      }
      if (prevZoneActiveRef.current && !ns.zoneActive) {
        musicManager?.setZoneFx?.(false)
      }
      prevZoneActiveRef.current = ns.zoneActive

      // 10-second countdown ticks for Blitz and Purify timers
      if (!ns.gameOver && !ns.paused) {
        if (ns.mode === GAME_MODE.BLITZ && ns.blitzTimer > 0 && ns.blitzTimer <= 10000) {
          const sec = Math.ceil(ns.blitzTimer / 1000)
          if (prevBlitzSecRef.current !== null && sec !== prevBlitzSecRef.current) {
            if (sfxOn) playCountdownTickSFX(sec)
          }
          prevBlitzSecRef.current = sec
        } else {
          prevBlitzSecRef.current = null
        }
        if (ns.mode === GAME_MODE.PURIFY && ns.purifyTimer > 0 && ns.purifyTimer <= 10000) {
          const sec = Math.ceil(ns.purifyTimer / 1000)
          if (prevPurifySecRef.current !== null && sec !== prevPurifySecRef.current) {
            if (sfxOn) playCountdownTickSFX(sec)
          }
          prevPurifySecRef.current = sec
        } else {
          prevPurifySecRef.current = null
        }
      }

      if (ns.gameOver && !prevGameOverRef.current && gameModeRef.current !== GAME_MODE.ZEN) {
        if (sfxOn) playGameOverSFX()
        doVibrate([100, 50, 100, 50, 100])
        if (musicOnRef.current) { musicManager?.stop(); musicOnRef.current = false; setMusicOn(false) }
        const hs = loadHighScores(), key = gameModeRef.current
        if (!hs[key] || ns.score > hs[key]) {
          hs[key] = ns.score
          localStorage.setItem(HS_KEY, JSON.stringify(hs))
          setHighScores({ ...hs }); setNewHigh(true)
        }
      }
      prevGameOverRef.current = ns.gameOver
      if (musicOnRef.current) {
        musicManager?.setLevel?.(ns.level)
        musicManager?.setPurifyMode?.(ns.mode === GAME_MODE.PURIFY)
        musicManager?.setZenMode?.(ns.mode === GAME_MODE.ZEN)
      }
      if (ns2.gameOver && !prevGameOver2Ref.current && gameModeRef.current === GAME_MODE.VERSUS) {
        if (!ns.gameOver) { engine.gameOver = true; engine.gameOverReason = 'win' }
      }
      prevGameOver2Ref.current = ns2.gameOver
      setState(ns)
      if (gameModeRef.current === GAME_MODE.VERSUS) setState2(ns2)
      frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(frameId)
  }, [engine, engine2])

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (ev) => {
      const sfxOn = configRef.current.sfxEnabled
      if (!isMobileRef.current && gameModeRef.current === GAME_MODE.VERSUS && !botEnabledRef.current && P2_BINDINGS[ev.code]) {
        if (ev.repeat) return
        const b = P2_BINDINGS[ev.code]; ev.preventDefault()
        if (b.held) held2Ref.current[b.held] = true
        if (b.action) { action2Ref.current[b.action] = true; if (b.action.startsWith('rotate') && sfxOn) playRotateSFX() }
        return
      }
      const b = KEY_BINDINGS[ev.code]; if (!b) return
      ev.preventDefault(); if (ev.repeat) return
      if (b.held) {
        heldRef.current[b.held] = true
        if ((b.held === 'left' || b.held === 'right') && sfxOn) playMoveSFX()
      }
      if (b.action) {
        if (countdownActiveRef.current && b.action !== 'pause') return
        actionRef.current[b.action] = true
        if ((b.action === 'rotateCW' || b.action === 'rotateCCW' || b.action === 'rotate180') && sfxOn) playRotateSFX()
        if (b.action === 'activateZone') {
          if (sfxOn) playZoneActivateSFX()
          if (configRef.current.hapticEnabled) navigator.vibrate?.([20, 10, 40])
        }
        if (b.action === 'hardDrop' && sfxOn) playHardDropSFX()
        if (b.action === 'pause') handlePauseToggle()
      }
    }
    const up = (ev) => {
      if (!isMobileRef.current && gameModeRef.current === GAME_MODE.VERSUS && !botEnabledRef.current && P2_BINDINGS[ev.code]) {
        const b = P2_BINDINGS[ev.code]; if (b.held) held2Ref.current[b.held] = false; return
      }
      const b = KEY_BINDINGS[ev.code]; if (!b?.held) return
      ev.preventDefault(); heldRef.current[b.held] = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [engine]) // eslint-disable-line

  // ─── Touch/button helpers ──────────────────────────────────────────────────
  const triggerAction = (action) => {
    if (countdownActiveRef.current) return
    actionRef.current[action] = true
    const sfxOn = configRef.current.sfxEnabled
    const hapticOn = configRef.current.hapticEnabled
    if (action === 'rotateCW' || action === 'rotateCCW' || action === 'rotate180') {
      if (sfxOn) playRotateSFX()
      if (hapticOn) navigator.vibrate?.(10)
    } else if (action === 'hardDrop') {
      if (sfxOn) playHardDropSFX()
      if (hapticOn) navigator.vibrate?.([15, 30, 15])
    } else if (action === 'activateZone') {
      if (sfxOn) playZoneActivateSFX()
      if (hapticOn) navigator.vibrate?.([20, 10, 40])
    } else if (action === 'hold') {
      if (hapticOn) navigator.vibrate?.(8)
    }
  }
  const handlePress   = (key, hold) => {
    const sfxOn = configRef.current.sfxEnabled
    const hapticOn = configRef.current.hapticEnabled
    if (hold) {
      heldRef.current[key] = true
      if (key === 'left' || key === 'right') { if (sfxOn) playMoveSFX(); if (hapticOn) navigator.vibrate?.(8) }
      else if (key === 'softDrop' && hapticOn) navigator.vibrate?.(5)
    } else {
      triggerAction(key)
    }
  }
  const handleRelease = (key, hold) => { if (hold) heldRef.current[key] = false }
  const handleDragBegin = (dir) => {
    if (dir === 'left' || dir === 'right') heldRef.current[dir] = true
    else if (dir === 'down') heldRef.current.softDrop = true
    else if (dir === 'up') triggerAction('hold')
  }
  const handleDragEnd = (dir) => {
    if (dir === 'left' || dir === 'right') heldRef.current[dir] = false
    else if (dir === 'down') heldRef.current.softDrop = false
  }
  const handleHardDrop = () => {
    if (!countdownActiveRef.current) {
      heldRef.current.softDrop = false
      actionRef.current.hardDrop = true
      if (configRef.current.sfxEnabled) playHardDropSFX()
      if (configRef.current.hapticEnabled) navigator.vibrate?.([15, 30, 15])
    }
  }
  const handleZoneActivate = () => {
    actionRef.current.activateZone = true
    if (configRef.current.sfxEnabled) playZoneActivateSFX()
    if (configRef.current.hapticEnabled) navigator.vibrate?.([20, 10, 40])
  }

  // ─── Gamepad ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const AXIS_DEAD = 0.35
    // button index → held key
    const GP_HELD_MAP = { 13: 'softDrop', 14: 'left', 15: 'right' }
    // button index → action name
    const GP_ACTION_MAP = {
      12: 'hardDrop',     // D-pad up
      0:  'rotateCCW',    // A / Cross
      1:  'rotateCW',     // B / Circle
      2:  'rotateCCW',    // X / Square
      3:  'rotate180',    // Y / Triangle
      4:  'hold',         // LB / L1
      5:  'hold',         // RB / R1
      6:  'activateZone', // LT / L2
      7:  'activateZone', // RT / R2
      9:  'pause',        // Start
    }
    const prevButtons = {} // gamepad index → { buttonIndex: wasPressed }
    let rafId
    const poll = () => {
      const gamepads = navigator.getGamepads?.()
      if (gamepads) {
        let gpLeft = false, gpRight = false, gpSoftDrop = false
        for (const gp of gamepads) {
          if (!gp) continue
          if (!prevButtons[gp.index]) prevButtons[gp.index] = {}
          const prev = prevButtons[gp.index]
          // Held: D-pad
          for (const [bi, key] of Object.entries(GP_HELD_MAP)) {
            if (gp.buttons[bi]?.pressed) {
              if (key === 'left')     gpLeft     = true
              if (key === 'right')    gpRight    = true
              if (key === 'softDrop') gpSoftDrop = true
            }
          }
          // Held: left analog stick
          const ax = gp.axes[0] ?? 0
          const ay = gp.axes[1] ?? 0
          if (ax < -AXIS_DEAD) gpLeft     = true
          if (ax >  AXIS_DEAD) gpRight    = true
          if (ay >  AXIS_DEAD) gpSoftDrop = true
          // Actions: rising edge only
          for (const [bi, action] of Object.entries(GP_ACTION_MAP)) {
            const pressed = !!gp.buttons[bi]?.pressed
            if (pressed && !prev[bi]) {
              if (action === 'pause') {
                engine.togglePause()
                if (gameModeRef.current === GAME_MODE.VERSUS) engine2.togglePause()
                const s = engine.getState(); setState(s)
                if (s.paused) { if (musicOnRef.current) musicManager?.stop() }
                else { if (musicOnRef.current) musicManager?.start(s.mode === GAME_MODE.PURIFY, s.mode === GAME_MODE.ZEN) }
              } else if (!countdownActiveRef.current) {
                actionRef.current[action] = true
                const sfxOn = configRef.current.sfxEnabled
                if ((action === 'rotateCW' || action === 'rotateCCW' || action === 'rotate180') && sfxOn) playRotateSFX()
                else if (action === 'hardDrop' && sfxOn) playHardDropSFX()
                else if (action === 'activateZone') {
                  if (sfxOn) playZoneActivateSFX()
                  if (configRef.current.hapticEnabled) navigator.vibrate?.([20, 10, 40])
                }
              }
            }
            prev[bi] = pressed
          }
        }
        gpHeldRef.current.left     = gpLeft
        gpHeldRef.current.right    = gpRight
        gpHeldRef.current.softDrop = gpSoftDrop
      }
      rafId = requestAnimationFrame(poll)
    }
    rafId = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(rafId)
  }, [engine, engine2]) // eslint-disable-line

  const handlePauseToggle = () => {
    engine.togglePause()
    if (gameModeRef.current === GAME_MODE.VERSUS) engine2.togglePause()
    const s = engine.getState(); setState(s)
    if (s.paused) { if (musicOnRef.current) musicManager?.stop() }
    else { if (musicOnRef.current) musicManager?.start(s.mode === GAME_MODE.PURIFY, s.mode === GAME_MODE.ZEN) }
  }

  const toggleMusic = () => {
    getAudioCtx(); if (!musicManager) return
    const doToggle = () => {
      if (musicOnRef.current) {
        musicManager.stop(); musicOnRef.current = false; setMusicOn(false)
      } else {
        musicManager.start(state.mode === GAME_MODE.PURIFY, state.mode === GAME_MODE.ZEN)
        musicManager.setVolume(configRef.current.musicVolume)
        musicOnRef.current = true; setMusicOn(true)
      }
    }
    const ctx = sharedAudioContext
    if (ctx?.state === 'suspended') ctx.resume().then(doToggle); else doToggle()
  }

  // Sync music volume when config changes
  useEffect(() => {
    if (musicOnRef.current) musicManager?.setVolume?.(config.musicVolume)
  }, [config.musicVolume])

  const setBotDiff = (d) => { setBotDifficulty(d); botDiffRef.current = d; botRef.current?.setDifficulty(d) }
  const setPurifyDiff = (d) => { setPurifyDifficulty(d); purifyDiffRef.current = d }

  // ─── Derived ────────────────────────────────────────────────────────────────
  const zoneReady  = state.zoneMeter >= ZONE_MIN_METER
  const isVersus   = gameMode === GAME_MODE.VERSUS
  const isPurify   = state.mode === GAME_MODE.PURIFY
  const showZone   = state.mode === GAME_MODE.NORMAL || state.mode === GAME_MODE.VERSUS

  const fmt = (ms) => {
    const t = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(t / 60), s = t % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  const fmtElapsed = (ms) => {
    const t = Math.floor(ms / 10), cs = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000)
    return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
  }

  // ─── Overlay ────────────────────────────────────────────────────────────────
  const renderOverlay = (s, isP2 = false) => {
    if (!s.gameOver) return null
    if (s.mode === GAME_MODE.ZEN) return null  // zen never shows game-over
    let title = 'GAME OVER'
    if (isVersus) title = isP2 ? (s.gameOverReason === 'win' ? '🏆 P2 WINS' : '💀 P2 LOST') : (s.gameOverReason === 'win' ? '🏆 P1 WINS' : '💀 P1 LOST')
    else if (s.mode === GAME_MODE.SPRINT && s.gameOverReason === 'complete') title = '🏁 SPRINT DONE'
    else if (s.gameOverReason === 'timeout') title = "⏱ TIME'S UP"
    else if (s.gameOverReason === 'topout') title = '💀 GAME OVER'
    return (
      <div className="overlay">
        <div className="overlay-title">{title}</div>
        {newHigh && !isP2 && <div className="overlay-new-high">🏆 New Best!</div>}
        <div className="overlay-sub">Score: {s.score.toLocaleString()}</div>
        {s.mode === GAME_MODE.SPRINT && <div className="overlay-sub">Time: {fmtElapsed(s.elapsedTime)}</div>}
        {s.mode === GAME_MODE.PURIFY && <div className="overlay-sub">Purified: {s.blocksPurified} blocks</div>}
        <div className="overlay-sub">Lv {s.level} · {s.lines} lines</div>
        {!isP2 && <button type="button" className="overlay-restart" onClick={() => startGame(gameMode)}>Play Again</button>}
      </div>
    )
  }

  const renderPauseOverlay = (s) => s.paused && !s.gameOver ? (
    <div className="overlay">
      <div className="overlay-title">PAUSED</div>
      <button type="button" className="overlay-restart" onClick={handlePauseToggle}>Resume</button>
    </div>
  ) : null

  const renderCountdown = () => countdown !== null ? (
    <div className="overlay countdown-overlay">
      <div className="countdown-number">{countdown === 0 ? 'GO!' : countdown}</div>
    </div>
  ) : null

  const renderZoneEnd = (s) => (
    <AnimatePresence>
      {s.zoneEndResult && (
        <motion.div className="zone-end-overlay"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}>
          <div className="zone-end-number">{s.zoneEndResult.lines}</div>
          <div className="zone-end-label">ZONE LINES!</div>
          <div className="zone-end-bonus">+{s.zoneEndResult.bonus.toLocaleString()}</div>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '10% 18%', pointerEvents: 'none' }}>
            {Array.from({ length: Math.min(12, s.zoneEndResult.lines || 0) }).map((_, i) => (
              <motion.div key={i}
                initial={{ scaleX: 1, opacity: 0.9 }}
                animate={{ scaleX: 0, opacity: 0 }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.7, ease: 'easeIn' }}
                style={{ height: 6, background: 'linear-gradient(90deg,#fff,#00cfff)', borderRadius: 4, filter: 'drop-shadow(0 0 6px #00cfff)' }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  // ─── Zone meter fill ────────────────────────────────────────────────────────
  const zoneFillPct = state.zoneActive
    ? (state.zoneTimer / (state.zoneDuration || ZONE_DURATION_MS)) * 100
    : state.zoneMeter
  const zoneFillClass = `zone-meter-fill${state.zoneActive ? ' zone-active' : ''}${zoneReady && !state.zoneActive ? ' zone-ready' : ''}`

  // ─── MODES ──────────────────────────────────────────────────────────────────
  const MODES = [
    { mode: GAME_MODE.NORMAL, label: 'Normal' },
    { mode: GAME_MODE.SPRINT, label: 'Sprint' },
    { mode: GAME_MODE.BLITZ,  label: 'Blitz'  },
    { mode: GAME_MODE.MASTER, label: 'Master' },
    { mode: GAME_MODE.PURIFY, label: 'Purify' },
    { mode: GAME_MODE.VERSUS, label: '1v1'    },
    { mode: GAME_MODE.ZEN,    label: '🧘 Zen'  },
  ]

  const modeButtons = (
    <>
      {MODES.map(({ mode, label }) => (
        <button key={mode} type="button" className={`mode-btn${gameMode === mode ? ' active' : ''}`}
          onClick={() => startGame(mode)}>{label}</button>
      ))}
    </>
  )

  // ─── Left flank (desktop) ───────────────────────────────────────────────────
  const leftFlank = (
    <div className="flank flank-left">
      <div>
        <div className="flank-label">Hold</div>
        <PiecePreview type={state.hold} />
      </div>

      <div className="stat-block">
        <div className="stat-item">
          <span className="label">Score</span>
          <span className="value small">{state.score.toLocaleString()}</span>
        </div>
        <div className="stat-item">
          <span className="label">Level</span>
          <span className="value">
            {state.level}
            {state.mode === GAME_MODE.MASTER && state.level >= 20 && <span className="badge-20g">20G</span>}
          </span>
        </div>
        <div className="stat-item">
          <span className="label">Lines</span>
          <span className="value">{state.lines}{state.mode === GAME_MODE.SPRINT ? `/${SPRINT_LINES}` : ''}</span>
        </div>
        {state.mode === GAME_MODE.SPRINT && (
          <div className="stat-item"><span className="label">Time</span><span className="value small">{fmtElapsed(state.elapsedTime)}</span></div>
        )}
        {state.mode === GAME_MODE.BLITZ && (
          <div className="blitz-timer-display" style={{ color: state.blitzTimer < 15000 ? '#f87171' : '#facc15' }}>
            ⏱ {fmt(state.blitzTimer)}
          </div>
        )}
        {highScores[state.mode] != null && (
          <div className="high-score-line">Best: {highScores[state.mode].toLocaleString()}</div>
        )}
      </div>

      {isPurify ? (
        <div>
          <div className="purify-timer-display" style={{ color: state.purifyTimer < 30000 ? '#f87171' : '#8b5cf6' }}>
            {fmt(state.purifyTimer)}
          </div>
          <div className="purify-count-row">
            <span>Purified</span>
            <strong>{state.blocksPurified}</strong>
          </div>
          <div className="purify-difficulty-select" style={{ marginTop: '0.4rem' }}>
            {[['easy','Easy'],['normal','Normal'],['hard','Hard']].map(([d, label]) => (
              <button key={d} type="button" className={`diff-btn${purifyDifficulty === d ? ' active' : ''}`}
                onClick={() => setPurifyDiff(d)}>{label}</button>
            ))}
          </div>
        </div>
      ) : showZone ? (() => {
        const R = 26, circ = 2 * Math.PI * R
        const fillPct = state.zoneActive
          ? (state.zoneTimer / (state.zoneDuration || ZONE_DURATION_MS))
          : state.zoneMeter / 100
        const offset = circ * (1 - fillPct)
        const circClass = `zone-circle-fill${state.zoneActive ? ' zone-active' : ''}${zoneReady && !state.zoneActive ? ' zone-ready' : ''}`
        return (
          <div className="zone-block">
            <div className="flank-label">Zone</div>
            <div className="zone-circle-wrap">
              <svg className="zone-circle-svg" width="64" height="64" viewBox="0 0 64 64">
                <defs>
                  <linearGradient id="zoneFillGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#1e90ff" />
                    <stop offset="100%" stopColor="#00cfff" />
                  </linearGradient>
                  <linearGradient id="zoneActiveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#8844ff" />
                    <stop offset="100%" stopColor="#00cfff" />
                  </linearGradient>
                </defs>
                <circle className="zone-circle-bg" cx="32" cy="32" r={R} />
                <circle className={circClass} cx="32" cy="32" r={R}
                  strokeDasharray={circ}
                  strokeDashoffset={offset} />
              </svg>
              <div className="zone-circle-label">
                {state.zoneActive
                  ? <><span className="zone-pct">{Math.ceil(state.zoneTimer / 1000)}s</span><span>ZONE</span></>
                  : <><span className="zone-pct">{state.zoneMeter}%</span>{zoneReady && <span>READY</span>}</>
                }
              </div>
            </div>
            {zoneReady && !state.zoneActive && (
              <button type="button" className="zone-status" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.65rem', color: 'var(--c-zone)', textDecoration: 'underline' }}
                onClick={handleZoneActivate}>▶ Activate (Shift)</button>
            )}
            {state.zoneActive && <div className="zone-status">Floor: {state.zoneFloor} rows</div>}
          </div>
        )
      })() : null}

      {state.combo > 1 && (
        <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--c-warn)', textShadow: '0 0 10px #f59e0b' }}>
          x{state.combo} COMBO
        </div>
      )}
      {!isPurify && state.backToBack && (
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#ffcc44', letterSpacing: '0.08em' }}>
          🔥 B2B{state.b2bCount > 1 ? ` x${state.b2bCount}` : ''}
        </div>
      )}
    </div>
  )

  // ─── Right flank (desktop) ──────────────────────────────────────────────────
  const rightFlank = (
    <div className="flank flank-right">
      <div>
        <div className="flank-label">Next</div>
        <div className="queue-list">
          {state.queue.slice(0, 5).map((type, i) => <PiecePreview key={`${type}-${i}`} type={type} />)}
        </div>
      </div>

      {isVersus && (
        <div className="bot-controls">
          <div className="flank-label">Bot AI</div>
          <div className="diff-row">
            {['easy', 'medium', 'hard'].map(d => (
              <button key={d} type="button" className={`diff-btn${botDifficulty === d ? ' active' : ''}`}
                onClick={() => setBotDiff(d)}>{d[0].toUpperCase() + d.slice(1)}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: '0.5rem' }}>
        <button type="button" className="icon-btn" style={{ width: '100%', justifyContent: 'center', fontSize: '0.72rem' }} onClick={() => setShowSettings(true)}>⚙ Settings</button>
      </div>
    </div>
  )

  // ─── Versus sidebar (desktop) ────────────────────────────────────────────────
  const renderVersusSidebar = (s, side = 'left') => (
    <div className="versus-sidebar">
      {side === 'left' ? (
        <>
          <div className="flank-label">Hold</div>
          <PiecePreview type={s.hold} />
          <div className="flank-label" style={{ marginTop: '0.5rem' }}>Score</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{s.score.toLocaleString()}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--c-muted)' }}>Lv {s.level}</div>
        </>
      ) : (
        <>
          <div className="flank-label">Next</div>
          {s.queue.slice(0, 3).map((t, i) => <PiecePreview key={`${t}-${i}`} type={t} small />)}
        </>
      )}
    </div>
  )

  // ─── Desktop render ─────────────────────────────────────────────────────────
  const renderDesktop = () => (
    <>
      <header className="site-header">
        <div className="site-logo">TET<span>R</span><span className="logo-i">I</span>S</div>
        <div className="header-controls">
          <button type="button" className="icon-btn" onClick={() => startGame(gameMode)}>↺ Restart</button>
          <button type="button" className="icon-btn" onClick={handlePauseToggle}>
            {state.paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button type="button" className={`icon-btn${musicOn ? ' active' : ''}`} onClick={toggleMusic}>
            {musicOn ? '🔇' : '🎵'} Music
          </button>
          <button type="button" className="icon-btn" onClick={cycleZoom} title="Cycle zoom">
            🔍 {Math.round(zoom * 100)}%
          </button>
          <ThemeSwitcher />
          <button type="button" className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">⚙ Settings</button>
          <button type="button" className="icon-btn" onClick={() => setShowAbout(true)} title="About">ℹ About</button>
        </div>
      </header>

      <nav className="mode-strip">{modeButtons}</nav>

      <div className="play-area">
        {leftFlank}

        {isVersus ? (
          <div className="versus-wrap">
            {/* P1 */}
            <div className="versus-player">
              <div className="versus-player-label">Player 1</div>
              <div className="versus-board-row">
                {renderVersusSidebar(state, 'left')}
                <div className="game-area">
                  <div className="game-canvas-wrap">
                    <GameCanvas state={state} onTap={() => triggerAction('rotateCW')}
                      onDragBegin={handleDragBegin} onDragEnd={handleDragEnd} onHardDrop={handleHardDrop} />
                    {renderOverlay(state, false)}
                    {renderPauseOverlay(state)}
                    {renderZoneEnd(state)}
                    {renderCountdown()}
                  </div>
                </div>
                {renderVersusSidebar(state, 'right')}
              </div>
              {state.pendingGarbage > 0 && <div style={{ color: '#fca5a5', fontSize: '0.8rem' }}>⚠ {state.pendingGarbage} incoming</div>}
            </div>

            {/* VS divider */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 0.5rem', fontSize: '1.4rem', fontWeight: 900, color: 'var(--c-muted)', alignSelf: 'center' }}>VS</div>

            {/* P2 (Bot) */}
            <div className="versus-player">
              <div className="versus-player-label bot">Bot AI — {botDifficulty}</div>
              <div className="versus-board-row">
                {renderVersusSidebar(state2, 'left')}
                <div className="game-area">
                  <div className="game-canvas-wrap">
                    <GameCanvas state={state2} onTap={() => {}} onDragBegin={() => {}} onDragEnd={() => {}} onHardDrop={() => {}} />
                    {renderOverlay(state2, true)}
                    {renderCountdown()}
                  </div>
                  {state2.pendingGarbage > 0 && (
                    <div className="garbage-warning">⚠ {state2.pendingGarbage} incoming</div>
                  )}
                </div>
                {renderVersusSidebar(state2, 'right')}
              </div>
              <div className="p2-hint">Keyboard P2: WASD·Q·E·R·T (if bot disabled)</div>
            </div>
          </div>
        ) : (
          <div className="game-area">
            {state.combo > 1 && (
              <div className="combo-display">
                <div className="combo-number">{state.combo}</div>
                <div className="combo-label">COMBO</div>
              </div>
            )}
      {!isPurify && state.backToBack && <div className="b2b-badge">🔥 B2B{state.b2bCount > 1 ? ` x${state.b2bCount}` : ''}</div>}
            <div className={`game-canvas-wrap${zenResetting ? ' zen-clearing' : ''}`}>
              <GameCanvas state={state} onTap={() => triggerAction('rotateCW')}
                onDragBegin={handleDragBegin} onDragEnd={handleDragEnd} onHardDrop={handleHardDrop} />
              {renderOverlay(state, false)}
              {renderPauseOverlay(state)}
              {renderZoneEnd(state)}
              {renderCountdown()}
            </div>
            <div className="game-hud-bottom">
              {state.mode === GAME_MODE.SPRINT && <span>⏱ <span className="hud-val">{fmtElapsed(state.elapsedTime)}</span></span>}
              {state.mode !== GAME_MODE.SPRINT && state.mode !== GAME_MODE.BLITZ && <span />}
              <span style={{ textAlign: 'center' }}>
                {showZone && zoneReady && !state.zoneActive && (
                  <button type="button" onClick={handleZoneActivate}
                    style={{ background: 'rgba(0,229,255,0.15)', border: '1px solid var(--c-accent)', color: 'var(--c-accent)', borderRadius: '6px', padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', animation: 'zone-ready-pulse 0.5s infinite alternate' }}>
                    ⚡ Zone
                  </button>
                )}
                {state.zoneActive && <span style={{ color: 'var(--c-zone)', fontWeight: 700 }}>⚡ ZONE {Math.ceil(state.zoneTimer / 1000)}s</span>}
              </span>
              <span />
            </div>
          </div>
        )}

        {rightFlank}
      </div>
    </>
  )

  // ─── Mobile landscape (swipe + controller only) ────────────────────────────
  const renderMobileLandscape = () => (
    <div className="mobile-ls">

      {/* Left context panel: difficulty controls (Versus / Purify only) */}
      {(isVersus || isPurify) && (
        <div className="ls-left">
          {isVersus && (
            <>
              <div className="ls-diff-title">Bot AI</div>
              {['easy', 'medium', 'hard'].map(d => (
                <button key={d} type="button"
                  className={`ls-diff-btn${botDifficulty === d ? ' active' : ''}`}
                  onClick={() => setBotDiff(d)}>
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </>
          )}
          {isPurify && (
            <>
              <div className="ls-diff-title">Purify</div>
              {['easy', 'normal', 'hard'].map(d => (
                <button key={d} type="button"
                  className={`ls-diff-btn${purifyDifficulty === d ? ' active' : ''}`}
                  onClick={() => setPurifyDiff(d)}>
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Centre: HUD bar + zone bar + canvas */}
      <div className="ls-centre">
        {/* stat bar */}
        <div className="ls-hud">
          <div className="ls-stat">
            <span className="l">HOLD</span>
            <PiecePreview type={state.hold} small />
          </div>
          <div className="ls-stat">
            <span className="l">Score</span>
            <span className="v">{state.score.toLocaleString()}</span>
          </div>
          <div className="ls-stat">
            <span className="l">Lv</span>
            <span className="v">{state.level}</span>
          </div>
          <div className="ls-stat">
            <span className="l">Lines</span>
            <span className="v">{state.lines}{state.mode === GAME_MODE.SPRINT ? `/${SPRINT_LINES}` : ''}</span>
          </div>
          {state.mode === GAME_MODE.BLITZ && (
            <div className="ls-stat">
              <span className="l">Time</span>
              <span className="v" style={{ color: state.blitzTimer < 15000 ? '#f87171' : '#facc15' }}>{fmt(state.blitzTimer)}</span>
            </div>
          )}
          {state.mode === GAME_MODE.PURIFY && (
            <div className="ls-stat">
              <span className="l">Left</span>
              <span className="v" style={{ color: state.purifyTimer < 30000 ? '#f87171' : '#a78bfa' }}>{fmt(state.purifyTimer)}</span>
            </div>
          )}
          <div className="ls-stat">
            <span className="l">Next</span>
            <div style={{ display: 'flex', gap: '0.15rem' }}>
              {state.queue.slice(0, 2).map((t, i) => <PiecePreview key={`${t}-${i}`} type={t} small />)}
            </div>
          </div>
        </div>

        {/* zone bar */}
        {showZone && (
          <div className="mobile-zone-bar">
            <div className={`mobile-zone-fill${state.zoneActive ? ' zone-active' : ''}${zoneReady && !state.zoneActive ? ' zone-ready' : ''}`}
              style={{ width: `${zoneFillPct}%` }} />
          </div>
        )}

        {/* board */}
        <div className={`ls-canvas-wrap${zenResetting ? ' zen-clearing' : ''}`}>
          <GameCanvas state={state} onTap={() => triggerAction('rotateCW')}
            onDragBegin={handleDragBegin} onDragEnd={handleDragEnd} onHardDrop={handleHardDrop} />
          {renderOverlay(state, false)}
          {renderPauseOverlay(state)}
          {renderZoneEnd(state)}
          {renderCountdown()}
        </div>
      </div>

      {/* ── Right: actions + controls ── */}
      <div className="ls-right">
        {/* primary action buttons */}
        <button type="button" className="ls-action-btn ls-pause-btn" onClick={handlePauseToggle}>
          <span className="ls-btn-icon">{state.paused ? '▶' : '⏸'}</span>
          <span className="ls-btn-label">{state.paused ? 'Resume' : 'Pause'}</span>
        </button>

        {/* zone button — prominent when ready */}
        {showZone && (
          <button type="button"
            className={`ls-zone-btn${state.zoneActive ? ' active' : ''}${zoneReady && !state.zoneActive ? ' ready' : ''}`}
            disabled={!zoneReady && !state.zoneActive}
            onClick={handleZoneActivate}>
            <span>⚡</span>
            <span className="ls-btn-label">{state.zoneActive ? 'ZONE ON' : zoneReady ? 'ZONE!' : `Zone ${state.zoneMeter}%`}</span>
          </button>
        )}

        {/* utility row */}
        <div className="ls-util ls-util-3">
          <button type="button" className={`ls-util-btn${musicOn ? ' active' : ''}`} onClick={toggleMusic}>🎵</button>
          <button type="button" className="ls-util-btn" onClick={() => startGame(gameMode)}>↺</button>
          <button type="button" className="ls-util-btn" onClick={() => setShowAbout(true)}>ℹ</button>
        </div>
        <div className="ls-util ls-util-3">
          <button type="button" className="ls-util-btn" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
        <div className="ls-theme"><ThemeSwitcher /></div>

        {/* mode selector */}
        <div className="ls-modes">
          {[
            { mode: GAME_MODE.NORMAL,  label: 'Normal'  },
            { mode: GAME_MODE.SPRINT,  label: 'Sprint'  },
            { mode: GAME_MODE.BLITZ,   label: 'Blitz'   },
            { mode: GAME_MODE.MASTER,  label: 'Master'  },
            { mode: GAME_MODE.ZEN,     label: 'Zen'     },
            { mode: GAME_MODE.PURIFY,  label: 'Purify'  },
            { mode: GAME_MODE.VERSUS,  label: '1v1'     },
          ].map(({ mode, label }) => (
            <button key={mode} type="button"
              className={`ls-mode-btn${gameMode === mode ? ' active' : ''}`}
              onClick={() => startGame(mode)}>{label}</button>
          ))}
        </div>
      </div>

    </div>
  )

  // ─── Mobile non-versus ──────────────────────────────────────────────────────
  const renderMobileNormal = () => (
    <div className={`mobile-layout${isUiHidden ? ' ui-hidden' : ''}`}>
      {/* Floating UI toggle tab — always visible on the right bezel */}
      <button
        type="button"
        className="ui-toggle-tab"
        onClick={handleUiToggle}
        aria-label={isUiHidden ? 'Show controls' : 'Hide controls'}
      >
        {isUiHidden ? '▲' : '▼'}
      </button>
      {/* HUD */}
      <div className="mobile-hud">
        <div className="mobile-hud-hold">
          <div style={{ fontSize: '0.5rem', letterSpacing: '0.1em', color: 'var(--c-muted)', textTransform: 'uppercase' }}>Hold</div>
          <PiecePreview type={state.hold} small />
        </div>
        <div className="mobile-hud-center">
          <div className="mobile-stat">
            <span className="l">Score</span>
            <span className="v" style={{ fontSize: '0.95rem' }}>{state.score.toLocaleString()}</span>
          </div>
          <div className="mobile-stat">
            <span className="l">Lv</span>
            <span className="v">{state.level}</span>
          </div>
          <div className="mobile-stat">
            <span className="l">Lines</span>
            <span className="v">{state.lines}{state.mode === GAME_MODE.SPRINT ? `/${SPRINT_LINES}` : ''}</span>
          </div>
          {state.mode === GAME_MODE.BLITZ && (
            <div className="mobile-stat">
              <span className="l">Time</span>
              <span className="v" style={{ color: state.blitzTimer < 15000 ? '#f87171' : '#facc15', fontSize: '0.95rem' }}>{fmt(state.blitzTimer)}</span>
            </div>
          )}
          {state.mode === GAME_MODE.PURIFY && (
            <div className="mobile-stat">
              <span className="l">Left</span>
              <span className="v" style={{ color: state.purifyTimer < 30000 ? '#f87171' : '#a78bfa', fontSize: '0.9rem' }}>{fmt(state.purifyTimer)}</span>
            </div>
          )}
        </div>
        <div className="mobile-hud-next">
          <div style={{ fontSize: '0.5rem', letterSpacing: '0.1em', color: 'var(--c-muted)', textTransform: 'uppercase' }}>Next</div>
          {state.queue.slice(0, 3).map((t, i) => <PiecePreview key={`${t}-${i}`} type={t} small />)}
        </div>
      </div>

      {/* Zone bar - only in Normal and Versus modes */}
      {showZone && (
        <div className="mobile-zone-bar">
          <div className={`mobile-zone-fill${state.zoneActive ? ' zone-active' : ''}${zoneReady && !state.zoneActive ? ' zone-ready' : ''}`}
            style={{ width: `${zoneFillPct}%` }} />
        </div>
      )}
      <div className={`mobile-canvas-wrap${zenResetting ? ' zen-clearing' : ''}`}>
        <GameCanvas state={state} onTap={() => triggerAction('rotateCW')}
          onDragBegin={handleDragBegin} onDragEnd={handleDragEnd} onHardDrop={handleHardDrop} />
        {renderOverlay(state, false)}
        {renderPauseOverlay(state)}
        {renderZoneEnd(state)}
        {renderCountdown()}
      </div>

      {/* Bottom panel: same controls as landscape */}
      <div className="pt-panel">
        {/* Pause */}
        <button type="button" className="ls-action-btn ls-pause-btn" style={{ gridColumn: '1 / -1' }} onClick={handlePauseToggle}>
          <span className="ls-btn-icon">{state.paused ? '▶' : '⏸'}</span>
          <span className="ls-btn-label">{state.paused ? 'Resume' : 'Pause'}</span>
        </button>

        {/* Zone */}
        {showZone && (
          <button type="button"
            className={`ls-zone-btn${state.zoneActive ? ' active' : ''}${zoneReady && !state.zoneActive ? ' ready' : ''}`}
            disabled={!zoneReady && !state.zoneActive}
            onClick={handleZoneActivate}>
            <span>⚡</span>
            <span className="ls-btn-label">{state.zoneActive ? 'ZONE ON' : zoneReady ? 'ZONE!' : `Zone ${state.zoneMeter}%`}</span>
          </button>
        )}

        {/* Utilities */}
        <div className="ls-util ls-util-4">
          <button type="button" className={`ls-util-btn${musicOn ? ' active' : ''}`} onClick={toggleMusic}>🎵</button>
          <button type="button" className="ls-util-btn" onClick={() => startGame(gameMode)}>↺</button>
          <button type="button" className="ls-util-btn" onClick={() => setShowAbout(true)}>ℹ</button>
          <button type="button" className="ls-util-btn" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
        <div className="ls-theme"><ThemeSwitcher /></div>

        {/* Mode grid */}
        <div className="ls-modes">
          {[
            { mode: GAME_MODE.NORMAL, label: 'Normal' },
            { mode: GAME_MODE.SPRINT, label: 'Sprint' },
            { mode: GAME_MODE.BLITZ,  label: 'Blitz'  },
            { mode: GAME_MODE.MASTER, label: 'Master' },
            { mode: GAME_MODE.ZEN,    label: 'Zen'    },
            { mode: GAME_MODE.PURIFY, label: 'Purify' },
            { mode: GAME_MODE.VERSUS, label: '1v1'    },
          ].map(({ mode, label }) => (
            <button key={mode} type="button"
              className={`ls-mode-btn${gameMode === mode ? ' active' : ''}`}
              onClick={() => startGame(mode)}>{label}</button>
          ))}
        </div>

        {/* Difficulty (Versus or Purify) */}
        {isVersus && (
          <div className="pt-diff-section">
            <div className="pt-diff-label">Bot AI</div>
            <div className="pt-diff-row">
              {['easy', 'medium', 'hard'].map(d => (
                <button key={d} type="button"
                  className={`ls-diff-btn${botDifficulty === d ? ' active' : ''}`}
                  onClick={() => setBotDiff(d)}>
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
        {isPurify && (
          <div className="pt-diff-section">
            <div className="pt-diff-label">Purify</div>
            <div className="pt-diff-row">
              {['easy', 'normal', 'hard'].map(d => (
                <button key={d} type="button"
                  className={`ls-diff-btn${purifyDifficulty === d ? ' active' : ''}`}
                  onClick={() => setPurifyDiff(d)}>
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  )

  // ─── Mobile versus (vs bot) ─────────────────────────────────────────────────
  const renderMobileVersus = () => (
    <div className="mobile-versus-layout">
      {/* Bot mini area */}
      <div className="bot-mini-area">
        <div className="bot-canvas-wrap">
          <GameCanvas state={state2} onTap={() => {}} onDragBegin={() => {}} onDragEnd={() => {}} onHardDrop={() => {}}
            className="bot-canvas" />
        </div>
        <div className="bot-info">
          <div className="bot-name">Bot AI</div>
          <div className="bot-diff-row">
            {['easy', 'medium', 'hard'].map(d => (
              <button key={d} type="button" className={`bot-diff-btn${botDifficulty === d ? ' active' : ''}`}
                onClick={() => setBotDiff(d)}>{d[0].toUpperCase() + d.slice(1)}</button>
            ))}
          </div>
          {state2.pendingGarbage > 0 && <div className="bot-incoming">⚠ {state2.pendingGarbage} lines incoming!</div>}
          {state2.gameOver && <div className="bot-incoming" style={{ color: '#4ade80' }}>Bot defeated!</div>}
        </div>
      </div>

      {/* Zone bar - only in Normal and Versus modes */}
      {showZone && (
        <div className="mobile-zone-bar">
          <div className={`mobile-zone-fill${state.zoneActive ? ' zone-active' : ''}${zoneReady && !state.zoneActive ? ' zone-ready' : ''}`}
            style={{ width: `${zoneFillPct}%` }} />
        </div>
      )}

      {/* Player HUD */}
      <div className="mobile-hud">
        <div className="mobile-hud-hold">
          <div style={{ fontSize: '0.5rem', letterSpacing: '0.1em', color: 'var(--c-muted)', textTransform: 'uppercase' }}>Hold</div>
          <PiecePreview type={state.hold} small />
        </div>
        <div className="mobile-hud-center">
          <div className="mobile-stat"><span className="l">Score</span><span className="v" style={{ fontSize: '0.95rem' }}>{state.score.toLocaleString()}</span></div>
          <div className="mobile-stat"><span className="l">Lv</span><span className="v">{state.level}</span></div>
          <div className="mobile-stat"><span className="l">Lines</span><span className="v">{state.lines}</span></div>
        </div>
        <div className="mobile-hud-next">
          <div style={{ fontSize: '0.5rem', letterSpacing: '0.1em', color: 'var(--c-muted)', textTransform: 'uppercase' }}>Next</div>
          {state.queue.slice(0, 3).map((t, i) => <PiecePreview key={`${t}-${i}`} type={t} small />)}
        </div>
      </div>

      {/* Board */}
      <div className="mobile-canvas-wrap">
        <GameCanvas state={state} onTap={() => triggerAction('rotateCW')}
          onDragBegin={handleDragBegin} onDragEnd={handleDragEnd} onHardDrop={handleHardDrop} />
        {renderOverlay(state, false)}
        {renderPauseOverlay(state)}
        {renderZoneEnd(state)}
        {renderCountdown()}
      </div>

      {/* Action strip */}
      <div className="mobile-action-strip">
        <button type="button" className="icon-btn" onClick={() => startGame(gameMode)}>↺</button>
        <button type="button" className="icon-btn" onClick={handlePauseToggle}>{state.paused ? '▶' : '⏸'}</button>
        <button type="button" className={`icon-btn${musicOn ? ' active' : ''}`} onClick={toggleMusic}>🎵</button>
        {zoneReady && !state.zoneActive && (
          <button type="button" className="icon-btn" style={{ color: 'var(--c-zone)', borderColor: 'var(--c-zone)' }} onClick={handleZoneActivate}>⚡</button>
        )}
      </div>

    </div>
  )

  // ─── Root render ─────────────────────────────────────────────────────────────
  return (
    <div className={`app${state.zoneActive ? ' zone-active' : ''}`} style={!isMobile ? { '--board-w': `calc(260px * ${zoom})` } : undefined}>
      {renderInstallBanner()}
      {isMobile
        ? (isLandscape ? renderMobileLandscape() : (isVersus ? renderMobileVersus() : renderMobileNormal()))
        : renderDesktop()
      }
      {showAbout && (
        <AboutPage
          onClose={() => setShowAbout(false)}
          installPrompt={installPrompt}
          onInstall={handleInstallFromAbout}
        />
      )}
      {showSettings && (
        <SettingsPage
          config={config}
          onConfig={setConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
