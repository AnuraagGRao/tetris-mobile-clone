import { createBag } from './randomBag'
import { I_KICKS, JLSTZ_KICKS } from './srs'
import { BOARD_HEIGHT, BOARD_WIDTH, PIECES } from './tetrominoes'

const SCORE_BY_CLEAR = [0, 100, 300, 500, 800]
const T_SPIN_SCORE = [400, 800, 1200, 1600]
const MINI_T_SPIN_SCORE = [100, 200, 400]
const ALL_SPIN_SCORE = [400, 600, 1000, 1400]
const B2B_MULTIPLIER = 1.5
const SOFT_DROP_MULTIPLIER = 20
export const ZONE_DURATION_MS = 8000
const ZONE_FILL_PER_LINE = 25
const PARTICLES_PER_CELL = 3

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

// T-Spin detection helpers
const isCellFilled = (board, bx, by) => {
  if (bx < 0 || bx >= BOARD_WIDTH || by >= BOARD_HEIGHT) return true
  if (by < 0) return false
  return board[by][bx] !== null
}

const checkTSpin = (board, piece) => {
  if (piece.type !== 'T') return null
  const cx = piece.x + 1
  const cy = piece.y + 1
  const corners = [
    isCellFilled(board, cx - 1, cy - 1), // 0: TL
    isCellFilled(board, cx + 1, cy - 1), // 1: TR
    isCellFilled(board, cx - 1, cy + 1), // 2: BL
    isCellFilled(board, cx + 1, cy + 1), // 3: BR
  ]
  const filled = corners.filter(Boolean).length
  if (filled < 2) return null
  if (filled >= 3) return 'tSpin'
  // Mini T-Spin: exactly 2 filled corners, and both front corners are among them
  // Front corners (the open face of the T) by rotation state:
  // rot 0 = bottom open: BL(2), BR(3); rot 1 = left open: TL(0), BL(2)
  // rot 2 = top open: TL(0), TR(1);    rot 3 = right open: TR(1), BR(3)
  const frontMap = [[2, 3], [0, 2], [0, 1], [1, 3]]
  const front = frontMap[piece.rotation] ?? [2, 3]
  if (front.every((i) => corners[i])) return 'tSpinMini'
  return null
}

const checkImmobile = (board, piece) =>
  collides(board, piece, piece.x - 1, piece.y) &&
  collides(board, piece, piece.x + 1, piece.y) &&
  collides(board, piece, piece.x, piece.y + 1)

const getSpinLabel = (spinType, lines, b2b) => {
  const prefix = b2b ? 'B2B ' : ''
  if (spinType === 'tSpin') {
    const names = ['', 'T-SPIN SINGLE', 'T-SPIN DOUBLE', 'T-SPIN TRIPLE']
    return prefix + (names[lines] ?? 'T-SPIN')
  }
  if (spinType === 'tSpinMini') return `${prefix}MINI T-SPIN`
  if (spinType === 'allSpin') {
    const names = ['', 'ALL-SPIN SINGLE', 'ALL-SPIN DOUBLE', 'ALL-SPIN TRIPLE']
    return prefix + (names[lines] ?? 'ALL-SPIN')
  }
  if (lines === 4) return `${prefix}TETRIS!`
  return ''
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
    this.floatingTexts = []
    this.gravityTimer = 0
    this.lockTimer = 0
    this.shake = 0
    this.backToBack = false
    this.lastActionWasRotation = false
    this.lastKickIndex = 0
    this.zoneMeter = 0
    this.zoneActive = false
    this.zoneTimer = 0
    this.zoneLines = 0
    this.lastClear = null
    this.hardDropped = false
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
    this.lastActionWasRotation = false
    return true
  }

  moveToWall(direction) {
    for (let attempts = 0; attempts < BOARD_WIDTH; attempts += 1) {
      if (!this.tryMove(direction)) break
    }
  }

  tryRotate(direction) {
    const from = this.current.rotation
    const to = (from + direction + 4) % 4
    const rotated = rotateMatrix(this.current.matrix, direction)
    const kicks = getKicks(this.current.type, from, to)
    for (let i = 0; i < kicks.length; i += 1) {
      const [kickX, kickY] = kicks[i]
      const x = this.current.x + kickX
      const y = this.current.y - kickY
      if (!collides(this.board, { ...this.current, matrix: rotated }, x, y)) {
        this.current.matrix = rotated
        this.current.rotation = to
        this.current.x = x
        this.current.y = y
        this.lockTimer = 0
        this.lastActionWasRotation = true
        this.lastKickIndex = i
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
    this.lastActionWasRotation = false
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
    this.lastActionWasRotation = false
    this.hardDropped = true
    this.shake = Math.max(this.shake, 5)
    this.lockPiece()
  }

  lockPiece() {
    // Detect spin type BEFORE merging the piece
    let spinType = null
    if (this.lastActionWasRotation) {
      if (this.current.type === 'T') {
        spinType = checkTSpin(this.board, this.current)
      } else if (this.current.type !== 'O') {
        if (checkImmobile(this.board, this.current)) spinType = 'allSpin'
      }
    }

    // Snapshot board colors for particle generation
    const boardSnapshot = this.board.map((row) => [...row])

    mergePiece(this.board, this.current)
    const { board, rows } = clearLines(this.board)
    this.board = board

    if (rows.length) {
      const cleared = rows.length
      let points = 0
      let isSpecialClear = false

      if (spinType === 'tSpin') {
        points = T_SPIN_SCORE[Math.min(cleared, T_SPIN_SCORE.length - 1)]
        isSpecialClear = true
        this.shake = Math.max(this.shake, 8)
      } else if (spinType === 'tSpinMini') {
        points = MINI_T_SPIN_SCORE[Math.min(cleared, MINI_T_SPIN_SCORE.length - 1)]
      } else if (spinType === 'allSpin') {
        points = ALL_SPIN_SCORE[Math.min(cleared, ALL_SPIN_SCORE.length - 1)]
        isSpecialClear = true
      } else {
        points = SCORE_BY_CLEAR[cleared]
        isSpecialClear = cleared === 4
      }

      const prevB2B = this.backToBack
      if (isSpecialClear && this.backToBack) {
        points = Math.floor(points * B2B_MULTIPLIER)
      }
      if (isSpecialClear) {
        this.backToBack = true
      } else if (cleared > 0 && spinType !== 'tSpinMini') {
        this.backToBack = false
      }

      this.lines += cleared
      this.score += points * this.level
      this.level = Math.floor(this.lines / 10) + 1

      if (this.zoneActive) {
        this.zoneLines += cleared
      } else {
        this.zoneMeter = Math.min(100, this.zoneMeter + cleared * ZONE_FILL_PER_LINE)
      }

      const label = getSpinLabel(spinType, cleared, prevB2B && isSpecialClear)
      if (label) {
        this.floatingTexts.push({
          text: label,
          x: this.current.x,
          y: Math.max(0, this.current.y),
          ttl: 150,
          maxTtl: 150,
        })
      }

      this.lastClear = { spinType, lines: cleared, backToBack: prevB2B && isSpecialClear }
      this.spawnEnhancedParticles(rows, boardSnapshot)
    } else if (spinType === 'tSpin') {
      // T-Spin with no line clear still scores
      this.score += T_SPIN_SCORE[0] * this.level
      this.shake = Math.max(this.shake, 6)
      this.floatingTexts.push({
        text: 'T-SPIN',
        x: this.current.x,
        y: Math.max(0, this.current.y),
        ttl: 120,
        maxTtl: 120,
      })
      this.lastClear = { spinType: 'tSpin', lines: 0, backToBack: false }
    }

    this.current = this.nextPiece()
    this.canHold = true
    this.gravityTimer = 0
    this.lockTimer = 0
    this.lastActionWasRotation = false
    if (collides(this.board, this.current, this.current.x, this.current.y)) {
      this.gameOver = true
    }
  }

  spawnEnhancedParticles(rows, boardSnapshot) {
    for (const row of rows) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const cellType = boardSnapshot[row][x]
        const color = cellType ? PIECES[cellType].color : '#ffffff'
        for (let p = 0; p < PARTICLES_PER_CELL; p += 1) {
          this.particles.push({
            x: x + 0.5 + (Math.random() - 0.5) * 0.8,
            y: row + 0.5 + (Math.random() - 0.5) * 0.8,
            ttl: 300 + Math.random() * 300,
            maxTtl: 600,
            vx: (Math.random() - 0.5) * 0.025,
            vy: -0.025 - Math.random() * 0.05,
            color,
            size: 3 + Math.random() * 4,
            gy: 0.0002 + Math.random() * 0.0001,
          })
        }
      }
    }
  }

  activateZone() {
    if (this.zoneMeter < 100 || this.zoneActive || this.gameOver) return false
    this.zoneActive = true
    this.zoneTimer = ZONE_DURATION_MS
    this.zoneLines = 0
    this.zoneMeter = 0
    return true
  }

  deactivateZone() {
    this.zoneActive = false
    this.zoneTimer = 0
    if (this.zoneLines > 0) {
      const bonus = this.zoneLines * this.zoneLines * 100 * this.level
      this.score += bonus
      this.shake = Math.min(15, 4 + this.zoneLines)
      this.floatingTexts.push({
        text: `ZONE CLEAR! +${bonus}`,
        x: 1,
        y: 9,
        ttl: 200,
        maxTtl: 200,
      })
      for (let y = 0; y < BOARD_HEIGHT; y += 3) {
        for (let x = 0; x < BOARD_WIDTH; x += 2) {
          const hue = Math.floor(Math.random() * 360)
          this.particles.push({
            x: x + Math.random(),
            y: y + Math.random(),
            ttl: 400 + Math.random() * 400,
            maxTtl: 800,
            vx: (Math.random() - 0.5) * 0.04,
            vy: -0.04 - Math.random() * 0.08,
            color: `hsl(${hue}, 100%, 60%)`,
            size: 5 + Math.random() * 6,
            gy: 0.0001,
          })
        }
      }
    }
  }

  updateParticles(dt) {
    this.particles = this.particles
      .map((p) => ({
        ...p,
        ttl: p.ttl - dt,
        x: p.x + p.vx * dt,
        y: p.y + p.vy * dt,
        vy: p.vy + (p.gy ?? 0.0002) * dt,
      }))
      .filter((p) => p.ttl > 0)
  }

  updateFloatingTexts(dt) {
    this.floatingTexts = this.floatingTexts
      .map((t) => ({ ...t, ttl: t.ttl - dt, y: t.y - 0.003 * dt }))
      .filter((t) => t.ttl > 0)
  }

  getGravity() {
    if (this.zoneActive) return 0.3
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

    // Clear per-frame event flags
    this.lastClear = null
    this.hardDropped = false

    if (actions.hold) this.holdPiece()
    if (actions.rotateCW) this.tryRotate(1)
    if (actions.rotateCCW) this.tryRotate(-1)
    if (actions.rotate180) {
      if (this.tryRotate(1)) this.tryRotate(1)
    }
    if (actions.activateZone) this.activateZone()
    if (actions.hardDrop) {
      this.hardDrop()
      return
    }

    this.updateHorizontal(dt, held)

    if (this.zoneActive) {
      this.zoneTimer -= dt
      if (this.zoneTimer <= 0) this.deactivateZone()
    }

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

    this.shake = this.shake > 0.5 ? this.shake * 0.85 : 0
    this.updateParticles(dt)
    this.updateFloatingTexts(dt)
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
      floatingTexts: this.floatingTexts,
      shake: this.shake,
      backToBack: this.backToBack,
      zoneMeter: this.zoneMeter,
      zoneActive: this.zoneActive,
      zoneTimer: this.zoneTimer,
      lastClear: this.lastClear,
      hardDropped: this.hardDropped,
    }
  }
}
