/**
 * TetrisBot — Dellacherie-style placement AI
 *
 * Difficulty:
 *   easy   → 500 ms between actions, 40% random move rate
 *   medium → 150 ms between actions, 15% random
 *   hard   → 50  ms between actions, 0%  random
 *
 * Interface:  bot.update(dt, engine, held, actionRef)
 *   held      – held2Ref.current  (mutated here, then read by engine.update)
 *   actionRef – action2Ref        (ref with .current, populated for one-shot actions)
 */

import { BOARD_WIDTH, BOARD_HEIGHT, PIECES } from './tetrominoes'

// Build a quick type -> matrix lookup (base rotation only)
const PIECES_MATRICES = Object.fromEntries(
  Object.entries(PIECES).map(([k, v]) => [k, v.matrix])
)

// ─── Matrix helpers ───────────────────────────────────────────────────────────

const rotateCW = (matrix) => {
  const R = matrix.length, C = matrix[0].length
  const out = Array.from({ length: C }, () => Array(R).fill(0))
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++)
      out[c][R - 1 - r] = matrix[r][c]
  return out
}

// ─── Board simulation helpers ─────────────────────────────────────────────────

const collidesBot = (board, matrix, x, y) => {
  for (let py = 0; py < matrix.length; py++) {
    for (let px = 0; px < matrix[py].length; px++) {
      if (!matrix[py][px]) continue
      const bx = x + px, by = y + py
      if (bx < 0 || bx >= BOARD_WIDTH || by >= BOARD_HEIGHT) return true
      if (by >= 0 && board[by][bx]) return true
    }
  }
  return false
}

const dropY = (board, matrix, x) => {
  let y = 0
  while (!collidesBot(board, matrix, x, y + 1)) y++
  return y
}

const simulatePlacement = (board, matrix, x) => {
  const y   = dropY(board, matrix, x)
  const b   = board.map((r) => [...r])
  for (let py = 0; py < matrix.length; py++)
    for (let px = 0; px < matrix[py].length; px++)
      if (matrix[py][px]) {
        const by = y + py
        if (by >= 0 && by < BOARD_HEIGHT) b[by][x + px] = 'X'
      }
  let cleared = 0
  const kept = b.filter((row) => {
    if (row.every(Boolean)) { cleared++; return false }
    return true
  })
  const empty = Array.from({ length: cleared }, () => Array(BOARD_WIDTH).fill(null))
  return { board: [...empty, ...kept], cleared }
}

// ─── Heuristic (tuned Dellacherie weights) ────────────────────────────────────

const evaluate = (board, cleared) => {
  const heights = Array(BOARD_WIDTH).fill(0)
  for (let x = 0; x < BOARD_WIDTH; x++)
    for (let y = 0; y < BOARD_HEIGHT; y++)
      if (board[y][x]) { heights[x] = BOARD_HEIGHT - y; break }

  let holes = 0, coveredHoles = 0
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let blocked = false
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (board[y][x]) blocked = true
      else if (blocked) { holes++; coveredHoles += heights[x] }
    }
  }
  const aggH = heights.reduce((a, b) => a + b, 0)
  const maxH = Math.max(...heights)
  let bumpiness = 0
  for (let x = 0; x < BOARD_WIDTH - 1; x++) bumpiness += Math.abs(heights[x] - heights[x + 1])

  // Heavy penalty for stacking too high (exponential above row 14)
  const heightPenalty = maxH > 14 ? (maxH - 14) * (maxH - 14) * 8 : 0

  return cleared * 120
    - aggH      *  0.78
    - holes     * 50.0
    - coveredHoles * 1.5
    - bumpiness *  0.4
    - heightPenalty
}

// ─── Best-placement search (with 1-piece lookahead) ──────────────────────────

const bestPlacement = (board, baseMatrix, nextMatrix) => {
  let best = null
  for (let rot = 0; rot < 4; rot++) {
    let matrix = baseMatrix
    for (let r = 0; r < rot; r++) matrix = rotateCW(matrix)
    const W = matrix[0].length
    for (let x = 0; x <= BOARD_WIDTH - W; x++) {
      if (collidesBot(board, matrix, x, 0)) continue
      const { board: after, cleared } = simulatePlacement(board, matrix, x)
      let score = evaluate(after, cleared)
      // 1-piece lookahead: add best possible score for the next piece on this board
      if (nextMatrix) {
        let bestNext = -Infinity
        for (let rot2 = 0; rot2 < 4; rot2++) {
          let nm = nextMatrix
          for (let r = 0; r < rot2; r++) nm = rotateCW(nm)
          const W2 = nm[0].length
          for (let x2 = 0; x2 <= BOARD_WIDTH - W2; x2++) {
            if (collidesBot(after, nm, x2, 0)) continue
            const { board: after2, cleared: c2 } = simulatePlacement(after, nm, x2)
            const s2 = evaluate(after2, c2)
            if (s2 > bestNext) bestNext = s2
          }
        }
        if (bestNext > -Infinity) score += bestNext * 0.35  // weight lookahead at 35%
      }
      if (!best || score > best.score) best = { rot, x, score }
    }
  }
  return best
}

// ─── Bot class ────────────────────────────────────────────────────────────────

const CONFIGS = {
  easy:   { intervalMs: 480, randomRate: 0.20 },  // reduced random to avoid self-topout
  medium: { intervalMs: 140, randomRate: 0.06 },
  hard:   { intervalMs: 45,  randomRate: 0.00 },
}

export class TetrisBot {
  constructor(difficulty = 'medium') {
    this.setDifficulty(difficulty)
    this._plan      = null
    this._lastType  = null
    this._rotTimer  = 0
    this._dropTimer = 0
  }

  setDifficulty(d) {
    this.cfg = CONFIGS[d] ?? CONFIGS.medium
  }

  /**
   * Call once per frame BEFORE engine2.update().
   * Mutates `held` and `actionRef.current` to drive the engine.
   */
  update(dt, engine, held, actionRef) {
    held.left  = false
    held.right = false

    if (!engine || engine.gameOver || engine.paused) return
    const st = engine.getState()
    if (!st.current) return

    if (st.current.type !== this._lastType || !this._plan) {
      this._lastType = st.current.type
      // Get next piece matrix for lookahead
      const nextType = st.queue && st.queue[0]
      const nextMatrix = nextType ? PIECES_MATRICES[nextType] : null
      let placement = bestPlacement(st.board, st.current.matrix, nextMatrix)
      if (!placement) return
      if (Math.random() < this.cfg.randomRate) {
        // Even random placements avoid the worst positions
        const candidates = []
        for (let rot = 0; rot < 4; rot++) {
          let m = st.current.matrix
          for (let r = 0; r < rot; r++) m = rotateCW(m)
          const W = m[0].length
          for (let x = 0; x <= BOARD_WIDTH - W; x++) {
            if (!collidesBot(st.board, m, x, 0)) {
              const { board: after, cleared } = simulatePlacement(st.board, m, x)
              const sc = evaluate(after, cleared)
              candidates.push({ rot, x, score: sc })
            }
          }
        }
        // Pick from top 50% of candidates randomly
        candidates.sort((a, b) => b.score - a.score)
        const pool = candidates.slice(0, Math.max(1, Math.floor(candidates.length * 0.5)))
        const pick = pool[Math.floor(Math.random() * pool.length)]
        if (pick) placement = pick
      }
      this._plan      = { targetRot: placement.rot, targetX: placement.x, rotsDone: 0 }
      this._rotTimer  = this.cfg.intervalMs * 0.5
      this._dropTimer = this.cfg.intervalMs * 2.5
    }

    this._rotTimer  -= dt
    this._dropTimer -= dt

    const { targetRot, targetX } = this._plan
    const curX = st.current.x

    if (this._plan.rotsDone < targetRot && this._rotTimer <= 0) {
      actionRef.current.rotateCW = true
      this._plan.rotsDone++
      this._rotTimer = this.cfg.intervalMs
    }

    if (curX < targetX) held.right = true
    else if (curX > targetX) held.left = true

    if (this._plan.rotsDone >= targetRot && curX === targetX && this._dropTimer <= 0) {
      actionRef.current.hardDrop = true
      this._plan      = null
      this._dropTimer = this.cfg.intervalMs
    }
  }
}
