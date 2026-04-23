import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import GameCanvas from './components/GameCanvas'
import TouchControls from './components/TouchControls'
import { TetrisEngine } from './logic/gameEngine'
import { PIECES } from './logic/tetrominoes'

const KEY_BINDINGS = {
  ArrowLeft: { held: 'left' },
  ArrowRight: { held: 'right' },
  ArrowDown: { held: 'softDrop' },
  ArrowUp: { action: 'rotateCW' },
  KeyZ: { action: 'rotateCCW' },
  Space: { action: 'hardDrop' },
  KeyC: { action: 'hold' },
  ShiftLeft: { action: 'activateZone' },
  ShiftRight: { action: 'activateZone' },
  KeyX: { action: 'activateZone' },
}

const TRACK_URL = 'https://ncs.soundcloud.com/CARTOON-ON-AND-ON_1.mp3'
const MAX_FRAME_TIME_MS = 34
const ToneContext = window.AudioContext || window.webkitAudioContext
let sharedAudioContext

const getAudioCtx = () => {
  if (!ToneContext) return null
  if (!sharedAudioContext) sharedAudioContext = new ToneContext()
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
  playNote(85, 0.12, 0.08, 'square')
  playNote(130, 0.08, 0.04, 'sawtooth')
}
const playRotateSFX = () => playNote(680, 0.03, 0.022, 'triangle')
const playLineClearSFX = () => playArpeggio([523, 659, 784], 0.06, 0.035, 'sine')
const playTSpinSFX = () => playArpeggio([523, 659, 784, 1047], 0.07, 0.045, 'triangle')
const playTetrisSFX = () => playArpeggio([392, 523, 659, 784, 1047], 0.065, 0.045, 'sine')
const playZoneActivateSFX = () => playArpeggio([262, 330, 392, 523, 784], 0.09, 0.04, 'triangle')
const playGameOverSFX = () =>
  playArpeggio([523, 466, 415, 370, 330, 294, 262], 0.1, 0.04, 'sawtooth')

function PiecePreview({ type }) {
  if (!type) return <div className="preview-box muted">Empty</div>
  return (
    <div className="preview-box">
      <span className="preview-piece" style={{ color: PIECES[type].color }}>
        {type}
      </span>
    </div>
  )
}

function App() {
  const engine = useMemo(() => new TetrisEngine(), [])
  const [state, setState] = useState(engine.getState())
  const [settings, setSettings] = useState({ das: 110, arr: 25 })
  const heldRef = useRef({ left: false, right: false, softDrop: false })
  const actionRef = useRef({})
  const audioRef = useRef(null)
  const prevGameOverRef = useRef(false)
  const [musicOn, setMusicOn] = useState(false)

  useEffect(() => {
    engine.setSettings(settings)
  }, [engine, settings])

  useEffect(() => {
    let last = performance.now()
    let frameId = 0

    const frame = (now) => {
      const dt = Math.min(MAX_FRAME_TIME_MS, now - last)
      last = now
      engine.update(dt, heldRef.current, actionRef.current)
      actionRef.current = {}
      const nextState = engine.getState()

      // Event-driven sound triggers
      if (nextState.hardDropped) playHardDropSFX()
      if (nextState.lastClear) {
        const { spinType, lines } = nextState.lastClear
        if (spinType === 'tSpin' || spinType === 'allSpin') playTSpinSFX()
        else if (lines === 4) playTetrisSFX()
        else if (lines > 0) playLineClearSFX()
      }
      if (nextState.gameOver && !prevGameOverRef.current) playGameOverSFX()
      prevGameOverRef.current = nextState.gameOver

      setState(nextState)
      frameId = requestAnimationFrame(frame)
    }

    frameId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(frameId)
  }, [engine])

  useEffect(() => {
    const down = (event) => {
      const binding = KEY_BINDINGS[event.code]
      if (!binding) return
      event.preventDefault()
      if (binding.held) heldRef.current[binding.held] = true
      if (binding.action) {
        actionRef.current[binding.action] = true
        if (binding.action === 'rotateCW' || binding.action === 'rotateCCW') playRotateSFX()
        if (binding.action === 'activateZone') playZoneActivateSFX()
      }
    }

    const up = (event) => {
      const binding = KEY_BINDINGS[event.code]
      if (!binding || !binding.held) return
      event.preventDefault()
      heldRef.current[binding.held] = false
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const handlePress = (key, hold) => {
    if (hold) heldRef.current[key] = true
    else actionRef.current[key] = true
  }

  const handleRelease = (key, hold) => {
    if (hold) heldRef.current[key] = false
  }

  const handleSwipe = (direction) => {
    if (direction === 'left' || direction === 'right') {
      heldRef.current[direction] = true
      setTimeout(() => {
        heldRef.current[direction] = false
      }, 90)
      return
    }
    if (direction === 'down') {
      actionRef.current.hardDrop = true
      return
    }
    actionRef.current.hold = true
  }

  const triggerAction = (action) => {
    actionRef.current[action] = true
    if (action === 'rotateCW' || action === 'rotateCCW') playRotateSFX()
    else if (action === 'hardDrop') playHardDropSFX()
  }

  const handleZoneActivate = () => {
    actionRef.current.activateZone = true
    playZoneActivateSFX()
  }

  const toggleMusic = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (musicOn) {
      audio.pause()
      setMusicOn(false)
      return
    }
    try {
      await audio.play()
      setMusicOn(true)
    } catch {
      setMusicOn(false)
    }
  }

  const zoneReady = state.zoneMeter >= 100

  return (
    <main className="app" style={{ touchAction: 'none' }}>
      <aside className="panel">
        <h1>Tetris Mobile</h1>
        <p className="subtitle">tetr.io inspired • Modern Guideline feel</p>
        <div className="stats">
          <div>
            <span>Score</span>
            <strong>{state.score}</strong>
          </div>
          <div>
            <span>Level</span>
            <strong>{state.level}</strong>
          </div>
          <div>
            <span>Lines</span>
            <strong>{state.lines}</strong>
          </div>
        </div>

        {state.backToBack && <div className="b2b-indicator">🔥 B2B</div>}

        <div className="zone-wrap">
          <div className="zone-label">
            Zone{state.zoneActive ? ` (${Math.ceil(state.zoneTimer / 1000)}s)` : ''}
          </div>
          <div className="zone-meter-bar">
            <div
              className={`zone-meter-fill${state.zoneActive ? ' zone-active' : ''}${zoneReady && !state.zoneActive ? ' zone-ready' : ''}`}
              style={{
                width: `${state.zoneActive ? (state.zoneTimer / 8000) * 100 : state.zoneMeter}%`,
              }}
            />
          </div>
          {zoneReady && !state.zoneActive && (
            <button type="button" className="action zone-btn" onClick={handleZoneActivate}>
              Activate Zone! (X / Shift)
            </button>
          )}
          {state.zoneActive && (
            <div className="zone-lines">Zone lines: {state.zoneLines}</div>
          )}
        </div>

        <label>
          DAS
          <input
            type="range"
            min="30"
            max="220"
            step="5"
            value={settings.das}
            onChange={(event) => setSettings((prev) => ({ ...prev, das: Number(event.target.value) }))}
          />
          <span>{settings.das}ms</span>
        </label>

        <label>
          ARR
          <input
            type="range"
            min="0"
            max="80"
            step="5"
            value={settings.arr}
            onChange={(event) => setSettings((prev) => ({ ...prev, arr: Number(event.target.value) }))}
          />
          <span>{settings.arr}ms</span>
        </label>

        <div className="queue-wrap">
          <h2>Hold</h2>
          <PiecePreview type={state.hold} />
          <h2>Next</h2>
          {state.queue.slice(0, 5).map((type, index) => (
            <PiecePreview key={`${type}-${index}`} type={type} />
          ))}
        </div>

        <button type="button" className="action" onClick={() => engine.reset()}>
          Restart
        </button>
        <button type="button" className="action" onClick={toggleMusic}>
          {musicOn ? 'Pause Music' : 'Play NCS Loop'}
        </button>
        <audio ref={audioRef} src={TRACK_URL} loop preload="none" onError={() => setMusicOn(false)} />
      </aside>

      <section className="game-area">
        <GameCanvas state={state} onTap={() => triggerAction('rotateCW')} onSwipe={handleSwipe} />
        <TouchControls
          onPress={(key, hold) => {
            if (hold) {
              handlePress(key, hold)
              return
            }
            triggerAction(key)
          }}
          onRelease={handleRelease}
        />
        {state.gameOver ? <div className="overlay">Game Over</div> : null}
      </section>
    </main>
  )
}

export default App
