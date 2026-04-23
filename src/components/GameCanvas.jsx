import { useEffect, useRef } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH, PIECES } from '../logic/tetrominoes'

const CELL_SIZE = 26
const TAP_THRESHOLD_PX = 14

const drawCell = (ctx, x, y, color, alpha = 1) => {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2)
  ctx.restore()
}

export default function GameCanvas({ state, onTap, onSwipe }) {
  const canvasRef = useRef(null)
  const touchRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !state.current) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = '#090b16'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

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

    state.board.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (!cell) return
        drawCell(ctx, x * CELL_SIZE, y * CELL_SIZE, PIECES[cell].color)
      })
    })

    const ghostColor = PIECES[state.current.type].color
    state.current.matrix.forEach((row, py) => {
      row.forEach((cell, px) => {
        if (!cell) return
        const gx = (state.current.x + px) * CELL_SIZE
        const gy = (state.ghostY + py) * CELL_SIZE
        if (state.ghostY + py >= 0) drawCell(ctx, gx, gy, ghostColor, 0.2)
      })
    })

    state.current.matrix.forEach((row, py) => {
      row.forEach((cell, px) => {
        if (!cell) return
        const x = state.current.x + px
        const y = state.current.y + py
        if (y >= 0) drawCell(ctx, x * CELL_SIZE, y * CELL_SIZE, PIECES[state.current.type].color)
      })
    })

    state.particles.forEach((particle) => {
      drawCell(
        ctx,
        particle.x * CELL_SIZE,
        particle.y * CELL_SIZE,
        '#ffffff',
        Math.max(0, particle.ttl / 240),
      )
    })
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
