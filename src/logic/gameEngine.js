import { createBag } from './randomBag'
import { I_KICKS, JLSTZ_KICKS } from './srs'
import { BOARD_HEIGHT, BOARD_WIDTH, PIECES } from './tetrominoes'

const SCORE_BY_CLEAR = [0, 100, 300, 500, 800]
const SOFT_DROP_MULTIPLIER = 20

const DEFAULT_SETTINGS = {
  das: 110,
  arr: 25,
  lockDelay: 450,
}

const createEmptyBoard = () =>
  Array.from({ length: BOARD_HEIGHT }, () => Array.from({ length: BOARD_WIDTH }, () => null))

const cloneMatrix = (matrix) => matrix.map((row) => [...row])

const rotateMatrix = (matrix, direction) => {
  const n = matrix.length
  const rotated = Array.from({ length: n }, () => Array.from({ length: n }, () => 0))
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (direction > 0) rotated[x][n - 1 - y] = matrix[y][x]
      else rotated[n - 1 - x][y] = matrix[y][x]
    }
  }
  return rotated
}

const collides = (board, piece, x, y) => {
  for (let py = 0; py < piece.matrix.length; py += 1) {
    for (let px = 0; px < piece.matrix[py].length; px += 1) {
      if (!piece.matrix[py][px]) continue
      const boardX = x + px
      const boardY = y + py
      if (boardX < 0 || boardX >= BOARD_WIDTH || boardY >= BOARD_HEIGHT) return true
      if (boardY >= 0 && board[boardY][boardX]) return true
    }
  }
  return false
}

const mergePiece = (board, piece) => {
  for (let py = 0; py < piece.matrix.length; py += 1) {
    for (let px = 0; px < piece.matrix[py].length; px += 1) {
      if (!piece.matrix[py][px]) continue
      const x = piece.x + px
      const y = piece.y + py
      if (y >= 0 && y < BOARD_HEIGHT && x >= 0 && x < BOARD_WIDTH) {
        board[y][x] = piece.type
      }
    }
  }
}

const clearLines = (board) => {
  const rows = []
  const kept = board.filter((row, y) => {
    const filled = row.every(Boolean)
    if (filled) rows.push(y)
    return !filled
  })
  while (kept.length < BOARD_HEIGHT) {
    kept.unshift(Array.from({ length: BOARD_WIDTH }, () => null))
  }
  return { board: kept, rows }
}

const getSpawnX = (matrix) => Math.floor((BOARD_WIDTH - matrix[0].length) / 2)

const createPiece = (type) => {
  const matrix = cloneMatrix(PIECES[type].matrix)
  return {
    type,
    matrix,
    x: getSpawnX(matrix),
    y: -1,
    rotation: 0,
  }
}

const getKicks = (type, from, to) => {
  if (type === 'O') return [[0, 0]]
  const key = `${from}>${to}`
  return (type === 'I' ? I_KICKS : JLSTZ_KICKS)[key] ?? [[0, 0]]
}

const getGhostY = (board, piece) => {
  let ghostY = piece.y
  while (!collides(board, piece, piece.x, ghostY + 1)) ghostY += 1
  return ghostY
}

export class TetrisEngine {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
    this.reset()
  }

  reset() {
    this.board = createEmptyBoard()
    this.bag = createBag()
    this.queue = []
    this.hold = null
    this.canHold = true
    this.score = 0
    this.lines = 0
    this.level = 1
    this.gameOver = false
    this.particles = []
    this.gravityTimer = 0
    this.lockTimer = 0
    this.horizontalState = {
      left: { active: false, timer: 0, repeat: 0 },
      right: { active: false, timer: 0, repeat: 0 },
    }
    while (this.queue.length < 5) this.fillQueue()
    this.current = this.nextPiece()
    if (collides(this.board, this.current, this.current.x, this.current.y)) this.gameOver = true
  }

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings }
  }

  fillQueue() {
    if (!this.bag.length) this.bag = createBag()
    this.queue.push(this.bag.shift())
  }

  nextPiece() {
    const nextType = this.queue.shift()
    this.fillQueue()
    return createPiece(nextType)
  }

  tryMove(direction) {
    const nextX = this.current.x + direction
    if (collides(this.board, this.current, nextX, this.current.y)) return false
    this.current.x = nextX
    this.lockTimer = 0
    return true
  }

  moveToWall(direction) {
    for (let attempts = 0; attempts < BOARD_WIDTH; attempts += 1) {
      if (!this.tryMove(direction)) break
    }
  }

  tryRotate(direction) {
    const to = (this.current.rotation + direction + 4) % 4
    const rotated = rotateMatrix(this.current.matrix, direction)
    for (const [kickX, kickY] of getKicks(this.current.type, this.current.rotation, to)) {
      const x = this.current.x + kickX
      const y = this.current.y - kickY
      if (!collides(this.board, { ...this.current, matrix: rotated }, x, y)) {
        this.current.matrix = rotated
        this.current.rotation = to
        this.current.x = x
        this.current.y = y
        this.lockTimer = 0
        return true
      }
    }
    return false
  }

  holdPiece() {
    if (!this.canHold) return false
    const currentType = this.current.type
    this.current = this.hold ? createPiece(this.hold) : this.nextPiece()
    this.hold = currentType
    this.canHold = false
    this.lockTimer = 0
    if (collides(this.board, this.current, this.current.x, this.current.y)) {
      this.gameOver = true
    }
    return true
  }

  softDrop() {
    if (!collides(this.board, this.current, this.current.x, this.current.y + 1)) {
      this.current.y += 1
      this.score += 1
      return true
    }
    return false
  }

  hardDrop() {
    let dropped = 0
    while (!collides(this.board, this.current, this.current.x, this.current.y + 1)) {
      this.current.y += 1
      dropped += 1
    }
    this.score += dropped * 2
    this.lockPiece()
  }

  lockPiece() {
    mergePiece(this.board, this.current)
    const { board, rows } = clearLines(this.board)
    this.board = board
    if (rows.length) {
      this.lines += rows.length
      this.score += SCORE_BY_CLEAR[rows.length] * this.level
      this.level = Math.floor(this.lines / 10) + 1
      this.spawnParticles(rows)
    }
    this.current = this.nextPiece()
    this.canHold = true
    this.gravityTimer = 0
    this.lockTimer = 0
    if (collides(this.board, this.current, this.current.x, this.current.y)) {
      this.gameOver = true
    }
  }

  spawnParticles(rows) {
    const particles = []
    for (const row of rows) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        particles.push({
          x,
          y: row,
          ttl: 240,
          vx: (Math.random() - 0.5) * 0.015,
          vy: -0.03 - Math.random() * 0.03,
        })
      }
    }
    this.particles.push(...particles)
  }

  updateParticles(dt) {
    this.particles = this.particles
      .map((particle) => ({
        ...particle,
        ttl: particle.ttl - dt,
        x: particle.x + particle.vx * dt,
        y: particle.y + particle.vy * dt,
        vy: particle.vy + 0.0002 * dt,
      }))
      .filter((particle) => particle.ttl > 0)
  }

  getGravity() {
    return Math.min(2.5, 0.85 + this.level * 0.15)
  }

  updateHorizontal(dt, held) {
    const dirs = [
      { key: 'left', amount: -1 },
      { key: 'right', amount: 1 },
    ]

    for (const { key, amount } of dirs) {
      const state = this.horizontalState[key]
      if (!held[key]) {
        state.active = false
        state.timer = 0
        state.repeat = 0
        continue
      }
      if (!state.active) {
        state.active = true
        state.timer = 0
        state.repeat = 0
        this.tryMove(amount)
        continue
      }

      state.timer += dt
      if (state.timer < this.settings.das) continue

      if (this.settings.arr === 0) {
        this.moveToWall(amount)
        continue
      }

      state.repeat += dt
      while (state.repeat >= this.settings.arr) {
        this.tryMove(amount)
        state.repeat -= this.settings.arr
      }
    }
  }

  update(dt, held, actions) {
    if (this.gameOver) return

    if (actions.hold) this.holdPiece()
    if (actions.rotateCW) this.tryRotate(1)
    if (actions.rotateCCW) this.tryRotate(-1)
    if (actions.rotate180) {
      if (this.tryRotate(1)) this.tryRotate(1)
    }
    if (actions.hardDrop) {
      this.hardDrop()
      return
    }

    this.updateHorizontal(dt, held)

    this.gravityTimer += (dt / 1000) * this.getGravity() * (held.softDrop ? SOFT_DROP_MULTIPLIER : 1)
    while (this.gravityTimer >= 1) {
      if (!this.softDrop()) break
      this.gravityTimer -= 1
    }

    if (collides(this.board, this.current, this.current.x, this.current.y + 1)) {
      this.lockTimer += dt
      if (this.lockTimer >= this.settings.lockDelay) this.lockPiece()
    } else {
      this.lockTimer = 0
    }

    this.updateParticles(dt)
  }

  getState() {
    return {
      board: this.board,
      current: this.current,
      hold: this.hold,
      queue: this.queue,
      score: this.score,
      lines: this.lines,
      level: this.level,
      gameOver: this.gameOver,
      ghostY: this.current ? getGhostY(this.board, this.current) : 0,
      particles: this.particles,
    }
  }
}
