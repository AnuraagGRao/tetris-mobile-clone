import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { saveStoryProgress, unlockItem, saveGameResult } from '../firebase/db'
import SettingsPage from '../components/SettingsPage'
import { findLevel, getNextLevel } from '../logic/storyData'
import { PIECES } from '../logic/tetrominoes'
import { TetrisEngine, GAME_MODE, ZONE_MIN_METER } from '../logic/gameEngine'
import GameCanvas, { PIECE_COLOR_MAPS } from '../components/GameCanvas'
import { BG_TYPE_TO_PIECE_THEME } from '../logic/themeMappings'
import TouchControls from '../components/TouchControls'
import BackgroundCanvas from '../components/BackgroundCanvas'
import { StoryMusicManager } from '../audio/storyMusicManager'

// Uses shared mapping in logic/themeMappings.js

// Get piece color for a given type + piece theme
function getPieceColor(type, theme) {
  return (PIECE_COLOR_MAPS[theme]?.[type]) ?? PIECES[type]?.color ?? '#888888'
}

// ─── Local SFX (Web Audio) ──────────────────────────────────────────────────
let _stAudioCtx = null
let _stSfxVol   = 2.0
const getStAudio = () => {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!_stAudioCtx) _stAudioCtx = new Ctx()
  if (_stAudioCtx.state === 'suspended') _stAudioCtx.resume()
  return _stAudioCtx
}
const stNote = (freq, dur, gain, type = 'triangle', offset = 0) => {
  const ctx = getStAudio(); if (!ctx) return
  const osc = ctx.createOscillator(), g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.type = type; osc.frequency.value = freq
  const t = ctx.currentTime + offset
  g.gain.setValueAtTime(Math.max(0, gain) * _stSfxVol, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  osc.start(t); osc.stop(t + dur + 0.01)
}
const stNoise = (lpFreq, gain, dur, offset = 0) => {
  const ctx = getStAudio(); if (!ctx) return
  const len = Math.ceil(ctx.sampleRate * Math.min(dur, 0.5))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource(); src.buffer = buf
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lpFreq
  const g = ctx.createGain(); src.connect(flt); flt.connect(g); g.connect(ctx.destination)
  const t = ctx.currentTime + offset
  g.gain.setValueAtTime(Math.max(0, gain) * _stSfxVol, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  src.start(t); src.stop(t + dur + 0.01)
}
let _lastStMoveBeep = 0
const sfxMove     = () => { const n = performance.now(); if (n - _lastStMoveBeep < 75) return; _lastStMoveBeep = n; stNote(380, 0.022, 0.026, 'triangle') }
const sfxRotate   = () => { stNote(1100, 0.032, 0.22, 'triangle'); stNote(750, 0.020, 0.16, 'sine', 0.010) }
const sfxHold     = () =>   stNote(660, 0.018, 0.15, 'triangle')
const sfxHardDrop = () => { stNote(75, 0.18, 0.44, 'sine'); stNote(410, 0.06, 0.14, 'triangle', 0.010); stNoise(900, 0.18, 0.06, 0.012) }
const sfxClear    = (lines = 1) => { stNoise(9000, 0.18, 0.11); (lines >= 4 ? [392,523,659,784,1047] : [392,523,659,784]).forEach((f,i)=>stNote(f,0.095,0.18,'sine',i*0.062)) }
const sfxLock     = () => { const ctx = getStAudio(); if (!ctx) return; const osc = ctx.createOscillator(), g = ctx.createGain(); osc.connect(g); g.connect(ctx.destination); osc.type='sine'; const t=ctx.currentTime; osc.frequency.setValueAtTime(110,t); osc.frequency.exponentialRampToValueAtTime(52,t+0.07); g.gain.setValueAtTime(0.18*_stSfxVol,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.10); osc.start(t); osc.stop(t+0.11) }
const sfxZoneOn   = () => { stNote(784,0.18,0.16,'triangle'); stNote(1047,0.22,0.14,'triangle',0.10) }

const KEY_BINDINGS = {
  ArrowLeft:  { held: 'left' },
  ArrowRight: { held: 'right' },
  ArrowDown:  { held: 'softDrop' },
  ArrowUp:    { action: 'rotateCW' },
  KeyZ:       { action: 'rotateCCW' },
  Space:      { action: 'hardDrop' },
  KeyX:       { action: 'rotate180' },
  KeyC:       { action: 'hold' },
  Escape:     { action: 'pause' },
  KeyP:       { action: 'pause' },
}

const MAX_FRAME_MS = 34

// ─── Mini piece preview canvas ────────────────────────────────────────────────
function PieceMini({ type, pieceTheme, size = 11 }) {
  const canvasRef = useRef(null)
  const color = type ? getPieceColor(type, pieceTheme) : '#333'
  const piece = type ? PIECES[type] : null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!piece) return
    const { matrix } = piece
    const filled = matrix.filter(r => r.some(Boolean))
    if (!filled.length) return
    const colMin = Math.min(...filled.map(r => r.findIndex(Boolean)))
    const colMax = Math.max(...filled.map(r => r.length - 1 - [...r].reverse().findIndex(Boolean)))
    const tw = colMax - colMin + 1, th = filled.length
    const canvCols = Math.round(canvas.width / size)
    const canvRows = Math.round(canvas.height / size)
    const ox = Math.floor((canvCols - tw) / 2) * size
    const oy = Math.floor((canvRows - th) / 2) * size
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 5
    filled.forEach((row, ry) => {
      for (let cx = colMin; cx <= colMax; cx++) {
        if (!row[cx]) continue
        ctx.fillRect(ox + (cx - colMin) * size + 1, oy + ry * size + 1, size - 2, size - 2)
      }
    })
  }, [type, color, size, piece])

  return <canvas ref={canvasRef} width={4 * size} height={2 * size} style={{ display: 'block' }} />
}

// ─── Minimal game loop hook ────────────────────────────────────────────────────
// levelStartLinesRef: ref to the engine line count when this level started
// levelKey: changes whenever the level advances — resets the completion guard
function useStoryGameLoop(engine, targetLines, levelStartLinesRef, levelKey, onComplete, storyMusicRef, beatRef) {
  const heldRef   = useRef({ left: false, right: false, softDrop: false })
  const actionRef = useRef({})
  const [state, setState] = useState(() => engine.getState())
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const prevGameOverRef = useRef(false)

  const triggerAction = useCallback((action) => {
    actionRef.current[action] = true
  }, [])

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
    engine.togglePause()
    if (pausedRef.current) storyMusicRef?.current?.pause()
    else storyMusicRef?.current?.resume()
  }, [engine, storyMusicRef])

  const handlePress = useCallback((key, isHeld) => {
    if (isHeld) { heldRef.current[key] = true }
    else triggerAction(key)
  }, [triggerAction])

  const handleRelease = useCallback((key) => {
    heldRef.current[key] = false
  }, [])

  // Keyboard
  useEffect(() => {
    const down = (ev) => {
      const b = KEY_BINDINGS[ev.code]; if (!b) return
      ev.preventDefault(); if (ev.repeat) return
      if (b.held) heldRef.current[b.held] = true
      if (b.action) {
        if (b.action === 'pause') {
          togglePause()
        } else {
          actionRef.current[b.action] = true
        }
      }
    }
    const up = (ev) => {
      const b = KEY_BINDINGS[ev.code]; if (!b?.held) return
      ev.preventDefault(); heldRef.current[b.held] = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [engine, togglePause])

  // rAF loop — levelKey in deps resets prevGameOverRef for each new level
  useEffect(() => {
    prevGameOverRef.current = false // reset completion guard for this level/attempt
    let frameId, lastTime = performance.now()
    const frame = (now) => {
      const dt = Math.min(now - lastTime, MAX_FRAME_MS); lastTime = now

      const actions = actionRef.current
      actionRef.current = {}

      engine.update(dt, heldRef.current, actions)

      const ns = engine.getState()
      if (beatRef) beatRef.current = storyMusicRef?.current?.getBeatEnergy() ?? 0

      const linesThisLevel = ns.lines - (levelStartLinesRef?.current ?? 0)
      const levelComplete  = targetLines > 0 && linesThisLevel >= targetLines

      if ((ns.gameOver || levelComplete) && !prevGameOverRef.current) {
        prevGameOverRef.current = true
        onComplete({ score: ns.score, lines: ns.lines, linesThisLevel, gameOver: ns.gameOver })
      }

      setState(ns)
      frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(frameId)
  }, [engine, targetLines, levelKey, onComplete]) // eslint-disable-line

  return { state, paused, triggerAction, handlePress, handleRelease, togglePause }
}

// ─── Page ──────────────────────────────────────────────────────────────────────
const PHASE = { STORY: 'story', GAME: 'game', TRANSITION: 'transition', COMPLETE: 'complete', FAIL: 'fail' }

function MediaControls({ storyMusicRef, chapterColor }) {
  const [bump, setBump] = useState(0)
  const m = storyMusicRef?.current
  const now = m?.getNowPlaying?.()
  const shuffle = m?.getShuffleEachLoop?.() ?? true
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', minWidth: 260 }}>
      <div style={{ fontSize: '0.62rem', color: '#bbb', letterSpacing: '0.12em', textAlign: 'center', maxWidth: 320 }}>
        Now Playing: <span style={{ color: chapterColor, fontWeight: 700 }}>{now?.title || '—'}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => { m?.prev?.(); setBump(x=>x+1) }} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>⏮</button>
        <button onClick={() => m?.pause?.()} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>⏸</button>
        <button onClick={() => m?.resume?.()} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>▶</button>
        <button onClick={() => { m?.next?.(); setBump(x=>x+1) }} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>⏭</button>
        <button onClick={() => { const on = !(m?.getShuffleEachLoop?.()); m?.setShuffleEachLoop?.(on); setBump(x=>x+1) }} style={{ background: shuffle ? 'rgba(0,212,255,0.10)' : 'rgba(255,255,255,0.07)', border: shuffle?`1px solid ${chapterColor}`:'1px solid rgba(255,255,255,0.18)', color: shuffle?chapterColor:'#ccc', borderRadius: 6, padding: '6px 10px', fontSize: '0.70rem', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.06em' }}>
          🔀 {shuffle ? 'Shuffle On' : 'Shuffle Off'}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: '0.60rem', color: '#777' }}>Xfade</span>
        <input type="range" min={0.5} max={4} step={0.1}
          onChange={(e) => m?.setCrossfadeSeconds?.(parseFloat(e.target.value))}
          defaultValue={1.6}
          style={{ width: 160 }} />
      </div>
    </div>
  )
}

export default function StoryLevelPage() {
  const { chapterId, levelId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  // Current level — starts from URL params, advances on seamless transitions
  const [currentChapterId, setCurrentChapterId] = useState(chapterId)
  const [currentLevelId,   setCurrentLevelId]   = useState(levelId)

  const found     = useMemo(() => findLevel(currentChapterId, currentLevelId), [currentChapterId, currentLevelId])
  const nextLevel = useMemo(() => getNextLevel(currentChapterId, currentLevelId), [currentChapterId, currentLevelId])

  const [phase,      setPhase]      = useState(PHASE.STORY)
  const [finalLines, setFinalLines] = useState(0)
  const [finalScore, setFinalScore] = useState(0)
  const [saving,     setSaving]     = useState(false)
  const [storyCountdown, setStoryCountdown] = useState(null) // auto-begin countdown

  // Engine persists across seamless level transitions — never reset between levels
  const engine = useMemo(() => new TetrisEngine(), []) // eslint-disable-line

  // Line baseline: how many lines were cleared when the current level started
  const levelStartLinesRef = useRef(0)
  // When true, engine.reset() will fire on the next GAME phase entry (fresh start / retry)
  const pendingResetRef    = useRef(true)

  const storyMusicRef = useRef(null)
  const beatRef       = useRef(0)
  const [musicTick, setMusicTick] = useState(0) // force UI refresh on media actions
  const [storyMuted, setStoryMuted] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const CONFIG_KEY = 'tetris-config'
  const DEFAULT_CONFIG = { sfxEnabled: true, hapticEnabled: true, musicVolume: 1.0, sfxVolume: 2.0, das: 110, arr: 25, showOnScreenControls: false }
  const loadConfig = () => { try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') } } catch { return { ...DEFAULT_CONFIG } } }
  const [config, setConfig] = useState(loadConfig)

  // Persist + apply settings
  useEffect(() => { try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)) } catch {} }, [config])
  useEffect(() => { try { engine.setSettings({ das: config.das, arr: config.arr }) } catch {} }, [config.das, config.arr, engine])
  useEffect(() => { try { storyMusicRef.current?.setVolume?.(config.musicVolume) } catch {} }, [config.musicVolume])
  useEffect(() => { _stSfxVol = config.sfxVolume ?? 2.0 }, [config.sfxVolume])

  // Apply DAS / ARR config
  useEffect(() => {
    try {
      const cfg = JSON.parse(localStorage.getItem('tetris-config') ?? '{}')
      engine.setSettings({ das: cfg.das ?? 110, arr: cfg.arr ?? 25 })
    } catch { /* use engine defaults */ }
  }, [engine])

  // Music: start on GAME, continue through TRANSITION, stop on FAIL / COMPLETE
  useEffect(() => {
    if (phase === PHASE.GAME) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (Ctx && !storyMusicRef.current) storyMusicRef.current = new StoryMusicManager(new Ctx())
      storyMusicRef.current?.playForLevelContinuous(currentChapterId, currentLevelId)
    } else if (phase === PHASE.FAIL || phase === PHASE.COMPLETE) {
      storyMusicRef.current?.stop()
    }
    // TRANSITION and STORY: music keeps playing — intentional no-op
  }, [phase, currentChapterId, currentLevelId])

  // Cleanup music on unmount
  useEffect(() => () => { storyMusicRef.current?.stop() }, [])

  // Engine reset — only for fresh starts and explicit retries (not seamless transitions)
  useEffect(() => {
    if (phase === PHASE.GAME && pendingResetRef.current) {
      pendingResetRef.current = false
      engine.reset(GAME_MODE.NORMAL)
      levelStartLinesRef.current = 0
      const gm = found?.level?.gravityMult ?? 1.0
      engine.level = Math.max(3, Math.round(gm * 5 + 1))
    }
  }, [phase, engine, found])

  // Story auto-begin: count down from 13 s and auto-start the game
  useEffect(() => {
    if (phase !== PHASE.STORY) { setStoryCountdown(null); return }
    setStoryCountdown(13)
    let remaining = 13
    const id = setInterval(() => {
      remaining -= 1
      setStoryCountdown(remaining)
      if (remaining <= 0) {
        clearInterval(id)
        pendingResetRef.current = true
        setPhase(PHASE.GAME)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase, currentChapterId, currentLevelId]) // reset timer on each new level story screen

  // Seamless transition: advance to next level after 2.5 s overlay
  useEffect(() => {
    if (phase !== PHASE.TRANSITION) return
    const next = getNextLevel(currentChapterId, currentLevelId)
    if (!next) return
    const timer = setTimeout(() => {
      const nextFound = findLevel(next.chapterId, next.levelId)
      const gm = nextFound?.level?.gravityMult ?? 1.0
      engine.level = Math.max(3, Math.round(gm * 5 + 1))
      levelStartLinesRef.current = engine.getState().lines
      engine.togglePause()  // resume
      setCurrentChapterId(next.chapterId)
      setCurrentLevelId(next.levelId)
      setPhase(PHASE.GAME)
    }, 2500)
    return () => clearTimeout(timer)
  }, [phase, currentChapterId, currentLevelId, engine])

  const showOnScreenControls = (() => {
    try { return JSON.parse(localStorage.getItem('tetris-config') ?? '{}').showOnScreenControls ?? false }
    catch { return false }
  })()

  const handleComplete = useCallback(async ({ score, lines, linesThisLevel: ltl, gameOver }) => {
    const lt = ltl ?? lines
    setFinalScore(score)
    setFinalLines(lt)

    if (gameOver) {
      setPhase(PHASE.FAIL)
      return
    }

    // Save progress for the completed level
    if (user && found) {
      setSaving(true)
      const unlocks = [
        saveStoryProgress(user.uid, currentChapterId, currentLevelId, score, lt),
        unlockItem(user.uid, `bg_${found.level.bgType}`),
      ]
      if (found.level.themeUnlock) {
        unlocks.push(unlockItem(user.uid, found.level.themeUnlock))
      }
      // Also record a score entry for overall totals/coins under 'story' mode
      try {
        const lv = engine.getState().level || 1
        unlocks.push(saveGameResult(user.uid, 'story', score, { lines: lt, level: lv }))
      } catch {}
      Promise.all(unlocks).finally(() => setSaving(false))
    }

    const next = getNextLevel(currentChapterId, currentLevelId)
    if (next) {
      engine.togglePause()   // freeze board during cinematic overlay
      setPhase(PHASE.TRANSITION)
    } else {
      engine.togglePause()   // freeze on last level too
      setPhase(PHASE.COMPLETE)
    }
  }, [user, currentChapterId, currentLevelId, found, engine])

  const levelKey = `${currentChapterId}-${currentLevelId}`

  const { state, paused, triggerAction, handlePress, handleRelease, togglePause } = useStoryGameLoop(
    engine,
    found?.level?.targetLines || 0,
    levelStartLinesRef,
    levelKey,
    handleComplete,
    storyMusicRef,
    beatRef,
  )

  const handleDragBegin = useCallback((dir) => {
    if (dir === 'left' || dir === 'right') handlePress(dir, true)
    else if (dir === 'down') handlePress('softDrop', true)
    else if (dir === 'up') triggerAction('hold')
  }, [handlePress, triggerAction])

  const handleDragEnd = useCallback((dir) => {
    if (dir === 'left' || dir === 'right') handleRelease(dir)
    else if (dir === 'down') handleRelease('softDrop')
  }, [handleRelease])

  const handleHardDrop = useCallback(() => {
    handleRelease('softDrop')
    triggerAction('hardDrop')
  }, [handleRelease, triggerAction])

  // ── SFX triggers (edge-detected) ───────────────────────────────────────────
  const prevStateRef = useRef(null)
  useEffect(() => {
    if (!config.sfxEnabled) { prevStateRef.current = state; return }
    const prev = prevStateRef.current
    if (prev) {
      if (state.hardDropped)               sfxHardDrop()
      else if (state.pieceLocked)          sfxLock()
      if (state.lastClear?.lines > 0)      sfxClear(state.lastClear.lines)
      if (state.pieceHeld)                 sfxHold()
      if (prev.zoneActive !== state.zoneActive && state.zoneActive) sfxZoneOn()
      // Move / rotate only when the same piece is active
      if (prev.current?.type === state.current?.type) {
        if (state.current?.x !== prev.current?.x)          sfxMove()
        else if (state.current?.rotation !== prev.current?.rotation) sfxRotate()
      }
    }
    prevStateRef.current = state
  }, [state, config.sfxEnabled])

  if (!found) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#0a0a14', color: '#f87171', fontFamily: 'monospace', fontSize: '0.9rem', letterSpacing: '0.15em' }}>
        LEVEL NOT FOUND — <button onClick={() => navigate('/story')} style={{ background: 'none', border: 'none', color: '#00d4ff', cursor: 'pointer', marginLeft: 8 }}>← Back</button>
      </div>
    )
  }

  const { chapter, level } = found
  const pieceTheme     = BG_TYPE_TO_PIECE_THEME[level.bgType] ?? 'classic'
  const linesThisLevel = state.lines - levelStartLinesRef.current

  // Board alpha syncs to bass beat energy — pulses more transparent on heavy hits
  // so the background animations show through the matrix
  const beatEnergy = beatRef.current
  const boardAlpha = (phase === PHASE.GAME || phase === PHASE.TRANSITION)
    ? Math.max(0.28, 0.46 - beatEnergy * 0.18)
    : undefined

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', fontFamily: '"Courier New", monospace' }}>
      {/* Dynamic background — always visible behind the semi-transparent board */}
      <BackgroundCanvas bgType={found?.level?.bgType || 'stars'} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} beatRef={beatRef} />

      {/* Subtle darkening overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.26)', pointerEvents: 'none' }} />

      {/* ── Story intro ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === PHASE.STORY && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              style={{ textAlign: 'center', maxWidth: 440 }}
            >
              <div style={{ fontSize: '0.55rem', letterSpacing: '0.4em', color: chapter.color, marginBottom: 8, textTransform: 'uppercase' }}>
                {chapter.title} / {level.title}
              </div>
              <div style={{ fontSize: '0.68rem', color: '#888', letterSpacing: '0.18em', marginBottom: '1.5rem', textTransform: 'uppercase' }}>
                {level.subtitle}
              </div>
              <p style={{ color: '#ddd', fontSize: '0.9rem', lineHeight: 1.7, letterSpacing: '0.04em', margin: '0 0 2rem' }}>
                {level.storyBefore}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                {level.targetLines > 0 && (
                  <div style={{ fontSize: '0.65rem', color: '#666', letterSpacing: '0.14em', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '5px 14px' }}>
                    CLEAR {level.targetLines} LINES
                  </div>
                )}
                {/* Auto-begin progress bar */}
                {storyCountdown !== null && storyCountdown > 0 && (
                  <div style={{ width: 200, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 2 }}>
                    <div style={{ height: '100%', background: chapter.color, borderRadius: 2, transition: 'width 0.9s linear', width: `${((13 - storyCountdown) / 13) * 100}%` }} />
                  </div>
                )}
                <motion.button
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                  onClick={() => { pendingResetRef.current = true; setPhase(PHASE.GAME) }}
                  style={{ background: chapter.color, border: 'none', color: '#000', borderRadius: 8, padding: '11px 28px', fontSize: '0.82rem', fontWeight: 900, letterSpacing: '0.2em', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase' }}
                >
                  {storyCountdown !== null && storyCountdown > 0 ? `BEGIN (${storyCountdown}s)` : 'BEGIN'}
                </motion.button>
                <button onClick={() => navigate('/story', { replace: true })} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '0.65rem', letterSpacing: '0.12em', fontFamily: 'inherit', marginTop: 4 }}>
                  ← Back to map
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Game board (visible during GAME and TRANSITION) ─────────────── */}
      {(phase === PHASE.GAME || phase === PHASE.TRANSITION) && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', pointerEvents: phase === PHASE.TRANSITION ? 'none' : 'auto' }}>
          {/* HUD bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 14px', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.72rem', letterSpacing: '0.1em', flexShrink: 0, backdropFilter: 'blur(6px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.5rem', letterSpacing: '0.14em', color: chapter.color, fontWeight: 700 }}>{chapter.title}</span>
              <span style={{ color: '#333' }}>›</span>
              <span style={{ color: '#ccc' }}>{level.title}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {level.targetLines > 0 && (
                <span style={{ color: '#555', fontSize: '0.62rem' }}>
                  {Math.min(linesThisLevel, level.targetLines)} / {level.targetLines} lines
                </span>
              )}
              <span style={{ color: '#00d4ff', fontWeight: 700 }}>{state.score.toLocaleString()}</span>
              <button
                onClick={togglePause}
                style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: '#aaa', cursor: 'pointer', fontSize: '0.6rem', padding: '3px 8px', borderRadius: 4, fontFamily: 'inherit', letterSpacing: '0.1em' }}
              >
                {paused ? '▶' : '⏸'}
              </button>
            </div>
          </div>

          {/* Lines progress bar */}
          {level.targetLines > 0 && (
            <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }}>
              <div style={{ height: '100%', background: chapter.color, width: `${Math.min(100, (linesThisLevel / level.targetLines) * 100)}%`, transition: 'width 0.3s ease' }} />
            </div>
          )}

          {/* Middle: slim-left | canvas | hold+zone+next-right */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch' }}>
            {/* Left strip: slim score / mode accent (no controls) */}
            <div style={{ width: 6, flexShrink: 0, background: chapter.color, opacity: 0.25 }} />

            {/* Canvas */}
            <div className="mobile-canvas-wrap" style={{ background: 'transparent', flex: 1, minWidth: 0 }}>
              <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <GameCanvas
                  state={state}
                  onTap={() => triggerAction('rotateCW')}
                  onTwoFingerTap={() => {}}
                  onDragBegin={handleDragBegin}
                  onDragEnd={handleDragEnd}
                  onHardDrop={handleHardDrop}
                  themeOverride={pieceTheme}
                  boardAlpha={boardAlpha}
                />
                {/* Pause overlay */}
                {paused && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, letterSpacing: '0.2em', color: '#fff' }}>PAUSED</div>
                    <div style={{ fontSize: '0.58rem', color: chapter.color, letterSpacing: '0.22em' }}>{chapter.title} › {level.title}</div>
                    <div style={{ fontSize: '0.56rem', color: '#555', letterSpacing: '0.14em' }}>
                      Lv {state.level} · {linesThisLevel} / {level.targetLines || '∞'} lines
                    </div>
                    {/* Media controls — match Solo pause menu */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '0.25rem', alignItems: 'center' }}>
                      <div style={{ fontSize: '0.62rem', color: '#bbb', letterSpacing: '0.12em' }}>
                        Now Playing: <span style={{ color: '#fff' }}>{storyMusicRef.current?.getNowPlaying?.()?.title || '—'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button type="button"
                          onClick={() => storyMusicRef.current?.prev?.()}
                          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '5px 12px', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>⏮</button>
                        {storyMuted ? (
                          <button type="button"
                            onClick={() => { storyMusicRef.current?.resume?.(); setStoryMuted(false) }}
                            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '5px 12px', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>▶</button>
                        ) : (
                          <button type="button"
                            onClick={() => { storyMusicRef.current?.pause?.(); setStoryMuted(true) }}
                            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '5px 12px', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>⏸</button>
                        )}
                        <button type="button"
                          onClick={() => storyMusicRef.current?.next?.()}
                          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '5px 12px', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>⏭</button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.60rem', color: '#777' }}>Vol</span>
                        <input type="range" min={0} max={1} step={0.01}
                          value={config.musicVolume}
                          onChange={(e) => { const v = parseFloat(e.target.value); setConfig(prev => ({ ...prev, musicVolume: v })); storyMusicRef.current?.setVolume?.(v) }}
                          style={{ width: 180 }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setShowSettings(true)}
                        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.1em', fontFamily: 'inherit' }}
                      >
                        ⚙ Settings
                      </button>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                      onClick={togglePause}
                      style={{ background: 'none', border: `1px solid ${chapter.color}`, color: chapter.color, borderRadius: 6, padding: '8px 22px', cursor: 'pointer', fontSize: '0.8rem', letterSpacing: '0.16em', fontFamily: 'inherit', fontWeight: 700 }}
                    >
                      ▶ RESUME
                    </motion.button>
                    <button
                      onClick={() => navigate('/story', { replace: true })}
                      style={{ background: 'none', border: '1px solid rgba(255,255,255,0.18)', color: '#bbb', borderRadius: 6, padding: '7px 18px', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.12em', fontFamily: 'inherit' }}
                    >
                      ← WORLD MAP
                    </button>
                    <button
                      onClick={() => { togglePause(); pendingResetRef.current = true; setCurrentChapterId(currentChapterId); setCurrentLevelId(currentLevelId); setPhase(PHASE.STORY) }}
                      style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#555', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: '0.65rem', letterSpacing: '0.1em', fontFamily: 'inherit' }}
                    >
                      RESTART LEVEL
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right strip: Hold + Zone + Next (all on right side) */}
            <div style={{ width: 64, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 4px', gap: 5, background: 'rgba(0,0,0,0.48)', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '0.42rem', color: '#555', letterSpacing: '0.12em' }}>HOLD</div>
              <div style={{ background: 'rgba(5,7,18,0.85)', border: '1px solid rgba(80,130,200,0.18)', borderRadius: 6, padding: '3px', display: 'grid', placeItems: 'center', minHeight: '2.2rem', width: '100%' }}>
                <PieceMini type={state.hold} pieceTheme={pieceTheme} size={9} />
              </div>
              <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.07)', marginTop: 2 }} />
              <button
                onClick={() => triggerAction('activateZone')}
                disabled={state.zoneMeter < ZONE_MIN_METER || state.zoneActive}
                style={{
                  background: state.zoneActive ? 'rgba(0,229,255,0.18)' : state.zoneMeter >= ZONE_MIN_METER ? 'rgba(0,180,255,0.22)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${state.zoneActive ? '#00e5ff' : state.zoneMeter >= ZONE_MIN_METER ? '#00aaff' : 'rgba(255,255,255,0.1)'}`,
                  color: state.zoneActive ? '#00e5ff' : state.zoneMeter >= ZONE_MIN_METER ? '#80d4ff' : '#444',
                  borderRadius: 6, padding: '4px 4px', cursor: state.zoneMeter >= ZONE_MIN_METER && !state.zoneActive ? 'pointer' : 'default',
                  fontSize: '0.5rem', letterSpacing: '0.06em', fontFamily: 'inherit', width: '100%', transition: 'all 0.2s',
                }}
              >
                {state.zoneActive ? `⚡ ${Math.ceil(state.zoneTimer / 1000)}s` : `ZONE ${state.zoneMeter}%`}
              </button>
              <div style={{ width: '100%', height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${state.zoneMeter}%`, background: state.zoneActive ? '#00e5ff' : `hsl(${200 + state.zoneMeter * 0.4}, 90%, 60%)`, transition: 'width 0.15s ease', boxShadow: state.zoneActive ? '0 0 6px #00e5ff' : 'none' }} />
              </div>
              <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.07)', marginTop: 2 }} />
              <div style={{ fontSize: '0.42rem', color: '#555', letterSpacing: '0.12em' }}>NEXT</div>
              {(state.queue ?? []).slice(0, 3).map((type, i) => (
                <div key={i} style={{ background: 'rgba(5,7,18,0.85)', border: '1px solid rgba(80,130,200,0.18)', borderRadius: 5, padding: '2px', display: 'grid', placeItems: 'center', width: '100%' }}>
                  <PieceMini type={type} pieceTheme={pieceTheme} size={i === 0 ? 9 : 7} />
                </div>
              ))}
            </div>
          </div>

          {showOnScreenControls && (
            <TouchControls onPress={handlePress} onRelease={handleRelease} />
          )}
        </div>
      )}

      {/* ── Seamless level-transition overlay ─────────────────────────────── */}
      {/* Board stays frozen underneath; this fades in for 2.5s then the next level begins */}
      <AnimatePresence>
        {phase === PHASE.TRANSITION && (
          <motion.div
            key="transition-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55 }}
            style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.58)', backdropFilter: 'blur(3px)' }}
          >
            <motion.div
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: [18, 0, -6], opacity: [0, 1, 0] }}
              transition={{ duration: 2.2, times: [0, 0.2, 1], ease: 'easeInOut' }}
              style={{ textAlign: 'center', maxWidth: 440, padding: '2rem' }}
            >
              <div style={{ fontSize: '0.52rem', letterSpacing: '0.44em', color: chapter.color, marginBottom: 12, textTransform: 'uppercase' }}>
                ✦ {level.title} CLEARED ✦
              </div>
              <p style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: 1.8, letterSpacing: '0.04em', margin: '0 0 1.8rem' }}>
                {level.storyAfter}
              </p>
              {nextLevel && (() => {
                const nf = findLevel(nextLevel.chapterId, nextLevel.levelId)
                return nf ? (
                  <div style={{ fontSize: '0.58rem', color: '#555', letterSpacing: '0.18em' }}>
                    NEXT &nbsp;›&nbsp; <span style={{ color: nf.chapter.color }}>{nf.chapter.title}</span>&nbsp;/&nbsp;{nf.level.title}
                  </div>
                ) : null
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings overlay */}
      {showSettings && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.2rem' }}>
          <div style={{ position: 'relative', width: 'min(760px, 94vw)', maxHeight: '90vh', overflow: 'auto', background: 'rgba(10,12,22,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.8rem', letterSpacing: '0.16em', color: '#fff' }}>SETTINGS</div>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.18)', color: '#ccc', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit' }}>✕ Close</button>
            </div>
            <SettingsPage config={config} onConfig={setConfig} onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}

      {/* ── Completion / fail overlay ────────────────────────────────────── */}
      <AnimatePresence>
        {(phase === PHASE.COMPLETE || phase === PHASE.FAIL) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ delay: 0.15 }}
              style={{ textAlign: 'center', maxWidth: 400, background: 'rgba(10,10,20,0.92)', border: `1px solid ${phase === PHASE.COMPLETE ? chapter.color : '#f87171'}`, borderRadius: 16, padding: '2rem', backdropFilter: 'blur(12px)' }}
            >
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>
                {phase === PHASE.COMPLETE ? '✦' : '✕'}
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 900, letterSpacing: '0.14em', color: phase === PHASE.COMPLETE ? chapter.color : '#f87171', marginBottom: 4 }}>
                {phase === PHASE.COMPLETE ? 'JOURNEY COMPLETE' : 'GAME OVER'}
              </div>
              <div style={{ fontSize: '0.65rem', color: '#666', letterSpacing: '0.16em', marginBottom: '1.2rem', textTransform: 'uppercase' }}>
                {phase === PHASE.COMPLETE ? level.storyAfter : `Clear ${level.targetLines > 0 ? level.targetLines : 'all'} lines to pass.`}
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#fff', marginBottom: '0.2rem' }}>
                {finalLines} <span style={{ fontSize: '0.7rem', color: '#888', letterSpacing: '0.12em' }}>LINES</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: '0.3rem' }}>
                {finalScore.toLocaleString()} pts
              </div>
              {saving && <div style={{ fontSize: '0.65rem', color: '#888', letterSpacing: '0.1em', marginBottom: '1rem' }}>Saving…</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                {phase === PHASE.FAIL && (
                  <button
                    onClick={() => { pendingResetRef.current = true; setPhase(PHASE.STORY) }}
                    style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: '#ccc', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontSize: '0.75rem', letterSpacing: '0.12em', fontFamily: 'inherit' }}
                  >
                    RETRY
                  </button>
                )}
                <button
                  onClick={() => navigate('/story', { replace: true })}
                  style={{ background: phase === PHASE.COMPLETE ? chapter.color : 'none', border: phase === PHASE.COMPLETE ? 'none' : '1px solid rgba(255,255,255,0.1)', color: phase === PHASE.COMPLETE ? '#000' : '#888', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: phase === PHASE.COMPLETE ? 700 : 400, letterSpacing: '0.12em', fontFamily: 'inherit' }}
                >
                  {phase === PHASE.COMPLETE ? 'WORLD MAP' : 'MAP'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


