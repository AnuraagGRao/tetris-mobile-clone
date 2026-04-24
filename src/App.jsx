import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import GameCanvas from './components/GameCanvas'
import TouchControls from './components/TouchControls'
import { MusicManager } from './audio/musicManager'
import { BLITZ_DURATION_MS, GAME_MODE, PURIFY_DURATION_MS, SPRINT_LINES, TetrisEngine, ZONE_DURATION_MS } from './logic/gameEngine'
import { PIECES } from './logic/tetrominoes'

const KEY_BINDINGS = {
  ArrowLeft:  { held: 'left' },
  ArrowRight: { held: 'right' },
  ArrowDown:  { held: 'softDrop' },
  ArrowUp:    { action: 'rotateCW' },
  KeyZ:       { action: 'rotateCCW' },
  KeyA:       { action: 'rotateCCW' },
  Space:      { action: 'hardDrop' },
  KeyX:       { action: 'rotate180' },
  KeyF:       { action: 'rotate180' },
  KeyC:       { action: 'hold' },
  ShiftLeft:  { action: 'activateZone' },
  ShiftRight: { action: 'activateZone' },
}

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

const playNote = (freq, duration, gain, type = 'sine', startOffset = 0) => {
  const ctx = getAudioCtx()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.connect(g)
  g.connect(ctx.destination)
  osc.type = type
  osc.frequency.value = freq
  const t = ctx.currentTime + startOffset
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + duration)
  osc.start(t)
  osc.stop(t + duration + 0.01)
}

const playArpeggio = (notes, noteDuration = 0.07, gain = 0.04, type = 'triangle') => {
  notes.forEach((freq, i) => playNote(freq, noteDuration, gain, type, i * noteDuration * 0.65))
}

// SFX helpers
const playHardDropSFX = () => {
  playNote(100, 0.15, 0.10, 'square')
  playNote(60,  0.18, 0.06, 'sawtooth', 0.04)
}
const playRotateSFX    = () => playNote(900, 0.04, 0.05, 'triangle')
const playLineClearSFX = () => playArpeggio([523, 659, 784], 0.07, 0.06, 'sine')
const playTSpinSFX     = () => playArpeggio([523, 659, 784, 1047], 0.08, 0.07, 'triangle')
const playTetrisSFX    = () => playArpeggio([392, 523, 659, 784, 1047], 0.08, 0.07, 'sine')
const playZoneActivateSFX = () => playArpeggio([262, 330, 392, 523, 784], 0.09, 0.06, 'triangle')
const playGameOverSFX  = () =>
  playArpeggio([523, 466, 415, 370, 330, 294, 262], 0.11, 0.06, 'sawtooth')
const playComboSFX = (combo) =>
  playNote(Math.min(440 + combo * 80, 1400), 0.05, 0.06, 'triangle')

const HS_KEY = 'tetris-highs'
const loadHighScores = () => {
  try { return JSON.parse(localStorage.getItem(HS_KEY) ?? '{}') } catch { return {} }
}

const PREVIEW_CELL = 10  // px per cell in the preview canvas
const PREVIEW_COLS  = 4  // canvas is always 4 cells wide
const PREVIEW_ROWS  = 2  // canvas is always 2 cells tall (enough for any trimmed piece)

function PiecePreview({ type }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!type) return

    const { matrix, color } = PIECES[type]

    // Trim empty rows/cols so the piece is always tightly centred
    const filledRows = matrix.filter(row => row.some(Boolean))
    const colMin = Math.min(...filledRows.map(row => row.findIndex(Boolean)))
    const colMax = Math.max(...filledRows.map(row => row.length - 1 - [...row].reverse().findIndex(Boolean)))
    const trimmedW = colMax - colMin + 1
    const trimmedH = filledRows.length

    const offsetX = Math.floor((PREVIEW_COLS - trimmedW) / 2) * PREVIEW_CELL
    const offsetY = Math.floor((PREVIEW_ROWS - trimmedH) / 2) * PREVIEW_CELL

    filledRows.forEach((row, ry) => {
      for (let cx = colMin; cx <= colMax; cx++) {
        if (!row[cx]) continue
        const px = offsetX + (cx - colMin) * PREVIEW_CELL
        const py = offsetY + ry * PREVIEW_CELL
        ctx.save()
        ctx.fillStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = 8
        ctx.fillRect(px + 1, py + 1, PREVIEW_CELL - 2, PREVIEW_CELL - 2)
        ctx.restore()
      }
    })
  }, [type])

  return (
    <div className="preview-box">
      {type
        ? <canvas
            ref={canvasRef}
            width={PREVIEW_COLS * PREVIEW_CELL}
            height={PREVIEW_ROWS * PREVIEW_CELL}
            className="preview-canvas"
          />
        : <span className="preview-empty">—</span>
      }
    </div>
  )
}

function App() {
  const engine  = useMemo(() => new TetrisEngine(), [])
  const engine2 = useMemo(() => new TetrisEngine(), [])

  const [state,  setState]  = useState(() => engine.getState())
  const [state2, setState2] = useState(() => engine2.getState())
  const [settings, setSettings] = useState({ das: 110, arr: 25 })
  const [gameMode, setGameMode] = useState(GAME_MODE.NORMAL)
  const [musicOn, setMusicOn] = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [highScores, setHighScores] = useState(() => loadHighScores())
  const [newHigh, setNewHigh] = useState(false)

  const heldRef  = useRef({ left: false, right: false, softDrop: false })
  const held2Ref = useRef({ left: false, right: false, softDrop: false })
  const actionRef  = useRef({})
  const action2Ref = useRef({})
  const prevGameOverRef  = useRef(false)
  const prevGameOver2Ref = useRef(false)
  const musicOnRef = useRef(false)
  const countdownActiveRef = useRef(false)
  const gameModeRef = useRef(GAME_MODE.NORMAL)

  useEffect(() => { engine.setSettings(settings) },  [engine, settings])
  useEffect(() => { engine2.setSettings(settings) }, [engine2, settings])

  // ─── Start game (resets + starts countdown) ───────────────────────────────
  const startGame = (mode) => {
    getAudioCtx()
    setGameMode(mode)
    gameModeRef.current = mode
    engine.reset(mode)
    engine2.reset(mode)
    setState(engine.getState())
    setState2(engine2.getState())
    prevGameOverRef.current  = false
    prevGameOver2Ref.current = false
    setNewHigh(false)
    heldRef.current  = { left: false, right: false, softDrop: false }
    held2Ref.current = { left: false, right: false, softDrop: false }
    actionRef.current  = {}
    action2Ref.current = {}
    countdownActiveRef.current = true
    setCountdown(3)
  }

  // ─── Countdown effect ─────────────────────────────────────────────────────
  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) {
      countdownActiveRef.current = false
      setCountdown(null)
      return
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [countdown])

  // ─── Game loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    let last = performance.now()
    let frameId = 0
    const frame = (now) => {
      const dt = Math.min(MAX_FRAME_TIME_MS, now - last)
      last = now

      if (!countdownActiveRef.current) {
        engine.update(dt, heldRef.current, actionRef.current)
        actionRef.current = {}

        const mode = gameModeRef.current
        if (mode === GAME_MODE.VERSUS) {
          engine2.update(dt, held2Ref.current, action2Ref.current)
          action2Ref.current = {}
        }
      } else {
        actionRef.current  = {}
        action2Ref.current = {}
      }

      const nextState  = engine.getState()
      const nextState2 = engine2.getState()

      // ── Versus garbage exchange ──────────────────────────────────────────
      if (gameModeRef.current === GAME_MODE.VERSUS) {
        if (nextState.lastGarbage  > 0) engine2.receiveGarbage(nextState.lastGarbage)
        if (nextState2.lastGarbage > 0) engine.receiveGarbage(nextState2.lastGarbage)
      }

      // ── P1 SFX ──────────────────────────────────────────────────────────
      if (nextState.hardDropped) playHardDropSFX()
      if (nextState.lastCombo > 0) playComboSFX(nextState.lastCombo)
      if (nextState.lastClear) {
        const { spinType, lines } = nextState.lastClear
        if (spinType === 'tSpin' || spinType === 'allSpin') playTSpinSFX()
        else if (lines === 4) playTetrisSFX()
        else if (lines > 0) playLineClearSFX()
      }
      if (nextState.gameOver && !prevGameOverRef.current) {
        playGameOverSFX()
        if (musicOnRef.current) { musicManager?.stop(); musicOnRef.current = false; setMusicOn(false) }
        // Save high score
        const hs = loadHighScores()
        const key = gameModeRef.current
        if (!hs[key] || nextState.score > hs[key]) {
          hs[key] = nextState.score
          localStorage.setItem(HS_KEY, JSON.stringify(hs))
          setHighScores({ ...hs })
          setNewHigh(true)
        }
      }
      prevGameOverRef.current  = nextState.gameOver

      // Music intensity
      if (musicOnRef.current) {
        musicManager?.setLevel?.(nextState.level)
        musicManager?.setPurifyMode?.(nextState.mode === GAME_MODE.PURIFY)
      }

      // Versus P2 game over
      if (nextState2.gameOver && !prevGameOver2Ref.current && gameModeRef.current === GAME_MODE.VERSUS) {
        if (!nextState.gameOver) {
          // P1 wins — force their game to stop too so overlay shows
          engine.gameOver = true
          engine.gameOverReason = 'win'
        }
      }
      prevGameOver2Ref.current = nextState2.gameOver

      setState(nextState)
      if (gameModeRef.current === GAME_MODE.VERSUS) setState2(nextState2)

      frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(frameId)
  }, [engine, engine2])

  // ─── Keyboard P1 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const P2_BINDINGS = {
      KeyD: { held: 'right' }, KeyA: { held: 'left' }, KeyS: { held: 'softDrop' },
      KeyW: { action: 'rotateCW' }, KeyQ: { action: 'rotateCCW' },
      KeyE: { action: 'rotate180' }, KeyR: { action: 'hold' }, KeyT: { action: 'hardDrop' },
    }
    const down = (event) => {
      // P2 in versus
      if (gameModeRef.current === GAME_MODE.VERSUS && P2_BINDINGS[event.code]) {
        if (event.repeat) return
        const b = P2_BINDINGS[event.code]
        event.preventDefault()
        if (b.held) held2Ref.current[b.held] = true
        if (b.action) { action2Ref.current[b.action] = true; if (b.action.startsWith('rotate')) playRotateSFX() }
        return
      }
      const binding = KEY_BINDINGS[event.code]
      if (!binding) return
      event.preventDefault()
      if (event.repeat) return
      if (binding.held) heldRef.current[binding.held] = true
      if (binding.action) {
        if (countdownActiveRef.current) return
        actionRef.current[binding.action] = true
        if (binding.action === 'rotateCW' || binding.action === 'rotateCCW' || binding.action === 'rotate180') playRotateSFX()
        if (binding.action === 'activateZone') playZoneActivateSFX()
        if (binding.action === 'hardDrop') playHardDropSFX()
        if (binding.action === 'pause') { engine.togglePause(); setState(engine.getState()) }
      }
    }
    const up = (event) => {
      if (gameModeRef.current === GAME_MODE.VERSUS && P2_BINDINGS[event.code]) {
        const b = P2_BINDINGS[event.code]
        if (b.held) held2Ref.current[b.held] = false
        return
      }
      const binding = KEY_BINDINGS[event.code]
      if (!binding?.held) return
      event.preventDefault()
      heldRef.current[binding.held] = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [engine])

  // ─── Touch / button helpers ───────────────────────────────────────────────
  const triggerAction = (action) => {
    if (countdownActiveRef.current) return
    actionRef.current[action] = true
    if (action === 'rotateCW' || action === 'rotateCCW' || action === 'rotate180') playRotateSFX()
    else if (action === 'hardDrop') playHardDropSFX()
  }

  const handlePress = (key, hold) => {
    if (hold) heldRef.current[key] = true
    else triggerAction(key)
  }
  const handleRelease = (key, hold) => { if (hold) heldRef.current[key] = false }

  const handleDragBegin = (dir) => {
    if (dir === 'left' || dir === 'right') heldRef.current[dir] = true
    else if (dir === 'down') heldRef.current.softDrop = true
  }
  const handleDragEnd = (dir) => {
    if (dir === 'left' || dir === 'right') heldRef.current[dir] = false
    else if (dir === 'down') heldRef.current.softDrop = false
  }
  const handleHardDrop = () => { if (!countdownActiveRef.current) { actionRef.current.hardDrop = true; playHardDropSFX() } }

  const handleZoneActivate = () => { actionRef.current.activateZone = true; playZoneActivateSFX() }

  const handlePauseToggle = () => {
    engine.togglePause()
    const s = engine.getState()
    setState(s)
    if (s.paused) {
      if (musicOnRef.current) { musicManager?.stop(); }
    } else {
      if (musicOnRef.current) { musicManager?.start(s.mode === GAME_MODE.PURIFY) }
    }
  }

  const toggleMusic = () => {
    getAudioCtx()
    if (!musicManager) return
    const ctx = sharedAudioContext
    const doToggle = () => {
      if (musicOnRef.current) {
        musicManager.stop(); musicOnRef.current = false; setMusicOn(false)
      } else {
        musicManager.start(state.mode === GAME_MODE.PURIFY)
        musicOnRef.current = true; setMusicOn(true)
      }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().then(doToggle)
    else doToggle()
  }

  // ─── Derived ──────────────────────────────────────────────────────────────
  const zoneReady = state.zoneMeter >= 100
  const isVersus  = gameMode === GAME_MODE.VERSUS
  const isPurify  = state.mode === GAME_MODE.PURIFY

  const formatTime = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  const formatElapsed = (ms) => {
    const total = Math.floor(ms / 10)
    const cs = total % 100
    const s  = Math.floor(total / 100) % 60
    const m  = Math.floor(total / 6000)
    return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
  }

  // ─── Overlay text ─────────────────────────────────────────────────────────
  const renderOverlay = (s, isP2 = false) => {
    if (!s.gameOver) return null
    const mode = s.mode
    let title = 'Game Over'
    if (isVersus) title = isP2 ? (s.gameOverReason === 'win' ? '🏆 P2 Wins!' : '💀 P2 Lost') : (s.gameOverReason === 'win' ? '🏆 P1 Wins!' : '💀 P1 Lost')
    else if (mode === GAME_MODE.SPRINT && s.gameOverReason === 'complete') title = '🏁 Sprint Done!'
    else if (s.gameOverReason === 'timeout') title = "⏱ Time's Up!"
    else if (s.gameOverReason === 'topout') title = '💀 Topped Out!'
    return (
      <div className="overlay">
        <div className="overlay-title">{title}</div>
        {newHigh && !isP2 && <div className="overlay-new-high">🏆 New Best!</div>}
        <div className="overlay-sub">Score: {s.score.toLocaleString()}</div>
        {mode === GAME_MODE.SPRINT && <div className="overlay-sub">Time: {formatElapsed(s.elapsedTime)}</div>}
        {mode === GAME_MODE.PURIFY && <div className="overlay-sub">Purified: {s.blocksPurified} blocks</div>}
        <div className="overlay-sub">Level {s.level} · {s.lines} lines</div>
        {!isP2 && (
          <button type="button" className="overlay-restart" onClick={() => startGame(gameMode)}>
            Play Again
          </button>
        )}
      </div>
    )
  }

  // ─── Stats panel ──────────────────────────────────────────────────────────
  const renderStats = (s, player = 1) => (
    <div className="stats">
      {isVersus && <div className="stats-player-label">P{player}</div>}
      <div><span>Score</span><strong>{s.score.toLocaleString()}</strong></div>
      <div><span>Level</span><strong>{s.level}{s.mode === GAME_MODE.MASTER && s.level >= 20 ? <span className="badge-20g"> 20G</span> : null}</strong></div>
      <div><span>Lines</span><strong>{s.lines}{s.mode === GAME_MODE.SPRINT ? `/${SPRINT_LINES}` : ''}</strong></div>
      {s.mode === GAME_MODE.SPRINT && <div><span>Time</span><strong>{formatElapsed(s.elapsedTime)}</strong></div>}
      {s.mode === GAME_MODE.BLITZ  && <div className="blitz-timer" style={{color: s.blitzTimer < 15000 ? '#ff4444' : '#facc15'}}>⏱ {formatTime(s.blitzTimer)}</div>}
      {highScores[s.mode] != null && <div className="high-score">Best: {highScores[s.mode].toLocaleString()}</div>}
    </div>
  )

  return (
    <main className={`app${isVersus ? ' versus' : ''}`} style={{ touchAction: 'none' }}>
      {/* ── Left panel ── */}
      <aside className="panel">
        <h1>Tetris Mobile</h1>

        <div className="mode-select">
          {[
            { mode: GAME_MODE.NORMAL,  label: 'Normal'  },
            { mode: GAME_MODE.SPRINT,  label: 'Sprint'  },
            { mode: GAME_MODE.BLITZ,   label: 'Blitz'   },
            { mode: GAME_MODE.MASTER,  label: 'Master'  },
            { mode: GAME_MODE.PURIFY,  label: 'Purify'  },
            { mode: GAME_MODE.VERSUS,  label: '1v1'     },
          ].map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              className={`mode-btn${gameMode === mode ? ' active' : ''}`}
              onClick={() => startGame(mode)}
            >{label}</button>
          ))}
        </div>

        {renderStats(state, 1)}

        {state.combo > 1 && (
          <div className="combo-indicator">x{state.combo} COMBO</div>
        )}

        {!isPurify && state.backToBack && <div className="b2b-indicator">🔥 B2B</div>}

        {isPurify ? (
          <div className="purify-stats">
            <div className="purify-timer" style={{ color: state.purifyTimer < 30000 ? '#ff4444' : '#a78bfa' }}>
              ⏱ {formatTime(state.purifyTimer)}
            </div>
            <div className="purify-count">
              <span>Blocks Purified</span>
              <strong>{state.blocksPurified}</strong>
            </div>
          </div>
        ) : (
          <div className="zone-wrap">
            <div className="zone-label">
              Zone{state.zoneActive ? ` (${Math.ceil(state.zoneTimer / 1000)}s · ${state.zoneFloor} lines)` : ''}
            </div>
            <div className="zone-meter-bar">
              <div
                className={`zone-meter-fill${state.zoneActive ? ' zone-active' : ''}${zoneReady && !state.zoneActive ? ' zone-ready' : ''}`}
                style={{ width: `${state.zoneActive ? (state.zoneTimer / ZONE_DURATION_MS) * 100 : state.zoneMeter}%` }}
              />
            </div>
            {zoneReady && !state.zoneActive && (
              <button type="button" className="action zone-btn" onClick={handleZoneActivate}>
                Activate Zone! (Shift)
              </button>
            )}
            {state.zoneActive && <div className="zone-lines">Zone captures: {state.zoneFloor}</div>}
          </div>
        )}

        <div className="queue-wrap">
          <h2>Hold</h2>
          <PiecePreview type={state.hold} />
          <h2>Next</h2>
          {state.queue.slice(0, 5).map((type, index) => (
            <PiecePreview key={`${type}-${index}`} type={type} />
          ))}
        </div>

        <div className="action-row">
          <button type="button" className="action" onClick={() => startGame(gameMode)}>Restart</button>
          <button type="button" className="action" onClick={handlePauseToggle}>{state.paused ? '▶ Resume' : '⏸ Pause'}</button>
          <button type="button" className="action" onClick={toggleMusic}>{musicOn ? '🔇 Music' : '🎵 Music'}</button>
        </div>

        <label>DAS <input type="range" min="30" max="220" step="5" value={settings.das}
          onChange={(e) => setSettings((p) => ({ ...p, das: +e.target.value }))} /> <span>{settings.das}ms</span></label>
        <label>ARR <input type="range" min="0" max="80" step="5" value={settings.arr}
          onChange={(e) => setSettings((p) => ({ ...p, arr: +e.target.value }))} /> <span>{settings.arr}ms</span></label>
      </aside>

      {/* ── P1 game area ── */}
      <section className="game-area">
        <GameCanvas
          state={state}
          onTap={() => triggerAction('rotateCW')}
          onDragBegin={handleDragBegin}
          onDragEnd={handleDragEnd}
          onHardDrop={handleHardDrop}
        />
        <TouchControls onPress={handlePress} onRelease={handleRelease} />
        {renderOverlay(state, false)}
        {state.paused && !state.gameOver && (
          <div className="overlay">
            <div className="overlay-title">⏸ Paused</div>
            <button type="button" className="overlay-restart" onClick={handlePauseToggle}>Resume</button>
          </div>
        )}
        {countdown !== null && (
          <div className="overlay countdown-overlay">
            <div className="countdown-number">{countdown === 0 ? 'GO!' : countdown}</div>
          </div>
        )}
      </section>

      {/* ── P2 game area (Versus only) ── */}
      {isVersus && (
        <section className="game-area game-area-p2">
          {renderStats(state2, 2)}
          <GameCanvas
            state={state2}
            onTap={() => { action2Ref.current.rotateCW = true }}
            onDragBegin={() => {}}
            onDragEnd={() => {}}
            onHardDrop={() => { action2Ref.current.hardDrop = true }}
          />
          {state2.pendingGarbage > 0 && (
            <div className="garbage-warning">⚠ {state2.pendingGarbage} incoming!</div>
          )}
          {renderOverlay(state2, true)}
          {countdown !== null && (
            <div className="overlay countdown-overlay">
              <div className="countdown-number">{countdown === 0 ? 'GO!' : countdown}</div>
            </div>
          )}
          <div className="p2-hint">P2: WASD + Q/E/R/T</div>
        </section>
      )}
    </main>
  )
}
export default App
