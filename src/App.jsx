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
}

const TRACK_URL = 'https://ncs.soundcloud.com/CARTOON-ON-AND-ON_1.mp3'
const MAX_FRAME_TIME_MS = 34
const ToneContext = window.AudioContext || window.webkitAudioContext
let sharedAudioContext

const playTone = (frequency = 600, duration = 0.04, gain = 0.03) => {
  if (!ToneContext) return
  if (!sharedAudioContext) sharedAudioContext = new ToneContext()
  const context = sharedAudioContext
  const oscillator = context.createOscillator()
  const gainNode = context.createGain()
  oscillator.connect(gainNode)
  gainNode.connect(context.destination)
  oscillator.frequency.value = frequency
  gainNode.gain.value = gain
  oscillator.start()
  oscillator.stop(context.currentTime + duration)
}

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
  const prevLinesRef = useRef(0)
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
      if (nextState.lines > prevLinesRef.current) playTone(900, 0.08, 0.035)
      prevLinesRef.current = nextState.lines
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
      if (binding.action) actionRef.current[binding.action] = true
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
      playTone(430, 0.03)
      return
    }
    if (direction === 'down') {
      actionRef.current.hardDrop = true
      playTone(280, 0.06)
      return
    }
    actionRef.current.hold = true
    playTone(520, 0.04)
  }

  const triggerAction = (action) => {
    actionRef.current[action] = true
    playTone(action === 'hardDrop' ? 260 : 700, action === 'hardDrop' ? 0.06 : 0.04)
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
              playTone(450, 0.03)
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
