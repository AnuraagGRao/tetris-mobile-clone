import { useEffect, useRef } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH, PIECES } from '../logic/tetrominoes'

const CELL_SIZE = 26
const TAP_THRESHOLD_PX = 14
const ZONE_DURATION_MS = 8000

const drawCell = (ctx, x, y, color, alpha = 1, blur = 12) => {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2)
  ctx.restore()
}

export default function GameCanvas({ state, onTap, onSwipe }) {
  const canvasRef = useRef(null)
  const touchRef = useRef(null)
  const pulseRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !state.current) return
    const ctx = canvas.getContext('2d')

    pulseRef.current += 0.05
    const ghostAlpha = 0.12 + 0.08 * Math.sin(pulseRef.current)

    ctx.save()

    // Screen shake
    if (state.shake > 0.5) {
      const sx = (Math.random() - 0.5) * state.shake
      const sy = (Math.random() - 0.5) * state.shake * 0.5
      ctx.translate(sx, sy)
    }

    ctx.clearRect(-20, -20, canvas.width + 40, canvas.height + 40)

    // Background — zone gradient or default
    if (state.zoneActive) {
      const progress = state.zoneTimer / ZONE_DURATION_MS
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height)
      grad.addColorStop(0, `hsl(${200 + progress * 60}, 80%, 8%)`)
      grad.addColorStop(1, `hsl(${240 + progress * 40}, 90%, 5%)`)
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = '#090b16'
    }
    ctx.fillRect(-20, -20, canvas.width + 40, canvas.height + 40)

    // Grid lines
    ctx.strokeStyle = 'rgba(89, 105, 153, 0.2)'
    for (let x = 0; x <= BOARD_WIDTH; x += 1) {
      ctx.beginPath()
      ctx.moveTo(x * CELL_SIZE, 0)
      ctx.lineTo(x * CELL_SIZE, BOARD_HEIGHT * CELL_SIZE)
      ctx.stroke()
    }
    for (let y = 0; y <= BOARD_HEIGHT; y += 1) {
      ctx.beginPath()
      ctx.moveTo(0, y * CELL_SIZE)
      ctx.lineTo(BOARD_WIDTH * CELL_SIZE, y * CELL_SIZE)
      ctx.stroke()
    }

    // Board cells
    state.board.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (!cell) return
        drawCell(ctx, x * CELL_SIZE, y * CELL_SIZE, PIECES[cell].color)
      })
    })

    // Ghost piece (pulsing opacity)
    const ghostColor = PIECES[state.current.type].color
    state.current.matrix.forEach((row, py) => {
      row.forEach((cell, px) => {
        if (!cell) return
        const gx = (state.current.x + px) * CELL_SIZE
        const gy = (state.ghostY + py) * CELL_SIZE
        if (state.ghostY + py >= 0) drawCell(ctx, gx, gy, ghostColor, ghostAlpha)
      })
    })

    // Active piece
    state.current.matrix.forEach((row, py) => {
      row.forEach((cell, px) => {
        if (!cell) return
        const x = state.current.x + px
        const y = state.current.y + py
        if (y >= 0) drawCell(ctx, x * CELL_SIZE, y * CELL_SIZE, PIECES[state.current.type].color)
      })
    })

    // Zone ambient glow overlay
    if (state.zoneActive) {
      const hue = 200 + (1 - state.zoneTimer / ZONE_DURATION_MS) * 60
      ctx.save()
      ctx.globalAlpha = 0.06 + 0.04 * Math.sin(Date.now() / 180)
      const glow = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        0,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width,
      )
      glow.addColorStop(0, `hsl(${hue}, 100%, 70%)`)
      glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
    }

    // Particles — neon circles with glow
    state.particles.forEach((p) => {
      const alpha = Math.max(0, p.ttl / (p.maxTtl ?? p.ttl + 1))
      const px = p.x * CELL_SIZE
      const py = p.y * CELL_SIZE
      const radius = ((p.size ?? 6) * alpha) / 2
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = p.color ?? '#ffffff'
      ctx.shadowColor = p.color ?? '#ffffff'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(px, py, Math.max(0.5, radius), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    })

    // Floating text labels (T-SPIN DOUBLE etc.)
    if (state.floatingTexts) {
      state.floatingTexts.forEach((ft) => {
        const alpha = Math.max(0, ft.ttl / ft.maxTtl)
        const fx = ft.x * CELL_SIZE
        const fy = ft.y * CELL_SIZE
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.font = 'bold 13px monospace'
        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = '#aa66ff'
        ctx.shadowBlur = 18
        ctx.fillText(ft.text, Math.max(2, Math.min(fx, canvas.width - 130)), Math.max(12, fy))
        ctx.restore()
      })
    }

    ctx.restore()
  }, [state])

  const handlePointerDown = (event) => {
    touchRef.current = { x: event.clientX, y: event.clientY }
  }

  const handlePointerUp = (event) => {
    const start = touchRef.current
    touchRef.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)

    if (absX < TAP_THRESHOLD_PX && absY < TAP_THRESHOLD_PX) {
      onTap()
      return
    }

    if (absX > absY) {
      onSwipe(dx > 0 ? 'right' : 'left')
      return
    }

    onSwipe(dy > 0 ? 'down' : 'up')
  }

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      width={BOARD_WIDTH * CELL_SIZE}
      height={BOARD_HEIGHT * CELL_SIZE}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      role="img"
      aria-label="Tetris game board"
    />
  )
}
