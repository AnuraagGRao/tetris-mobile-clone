import { createBag } from './randomBag'
import { I_KICKS, JLSTZ_KICKS } from './srs'
import { BOARD_HEIGHT, BOARD_WIDTH, PIECES } from './tetrominoes'

export const GAME_MODE = { NORMAL: 'normal', SPRINT: 'sprint', BLITZ: 'blitz', MASTER: 'master', PURIFY: 'purify', VERSUS: 'versus' }
export const PURIFY_DURATION_MS = 180000
export const BLITZ_DURATION_MS  = 120000
export const SPRINT_LINES       = 40

const SCORE_BY_CLEAR = [0, 100, 300, 500, 800]
const T_SPIN_SCORE = [400, 800, 1200, 1600]
const MINI_T_SPIN_SCORE = [100, 200, 400]
const ALL_SPIN_SCORE = [400, 600, 1000, 1400]
const B2B_MULTIPLIER = 1.5
const SOFT_DROP_MULTIPLIER = 20
export const ZONE_DURATION_MS = 8000
const ZONE_FILL_PER_LINE = 25
const PARTICLES_PER_CELL = 3

// Garbage lines sent per clear type in Versus mode
const GARBAGE_BY_LINES = [0, 0, 1, 2, 4]
const TSPIN_GARBAGE    = [2, 2, 4, 6]   // tspin 0/1/2/3 lines
const COMBO_GARBAGE    = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5]

const DEFAULT_SETTINGS = {
  das: 110,
  arr: 25,
  lockDelay: 450,
}

const createEmptyBoard = () =>
  Array.from({ length: BOARD_HEIGHT }, () => Array.from({ length: BOARD_WIDTH }, () => null))

const createInfectedRow = () => {
  const row = Array(BOARD_WIDTH).fill(null)
  const holes = new Set()
  while (holes.size < 3) holes.add(Math.floor(Math.random() * BOARD_WIDTH))
  for (let x = 0; x < BOARD_WIDTH; x++) {
    if (!holes.has(x)) row[x] = 'INF'
  }
  return row
}

// Column-based purify board: infected blocks stand in isolated vertical columns.
// A single tetromino landing on a column instantly purifies the cells it covers.
const createPurifyBoard = () => {
  const board = createEmptyBoard()
  const infectedCols = []
  while (infectedCols.length < 5) {
    const c = Math.floor(Math.random() * BOARD_WIDTH)
    if (!infectedCols.includes(c)) infectedCols.push(c)
  }
  const infHeight = 6 + Math.floor(Math.random() * 3)
  for (const col of infectedCols) {
    for (let y = BOARD_HEIGHT - infHeight; y < BOARD_HEIGHT; y++) {
      board[y][col] = 'INF'
    }
  }
  return { board, infectedCols }
}

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
    this.mode = GAME_MODE.NORMAL
    this.reset()
  }

  reset(mode = this.mode) {
    this.mode = mode
    if (mode === GAME_MODE.PURIFY) {
      const { board, infectedCols } = createPurifyBoard()
      this.board = board
      this.infectedCols = infectedCols
    } else {
      this.board = createEmptyBoard()
      this.infectedCols = []
    }
    this.bag = createBag()
    this.queue = []
    this.hold = null
    this.canHold = true
    this.score = 0
    this.lines = 0
    this.level = 1
    this.gameOver = false
    this.gameOverReason = null
    this.particles = []
    this.floatingTexts = []
    this.gravityTimer = 0
    this.lockTimer = 0
    this.lockResets = 0
    this.lowestY = 0
    this.lockFlash = false
    this.shake = 0
    this.backToBack = false
    this.combo = 0
    this.lastCombo = 0
    this.paused = false
    this.elapsedTime = 0
    this.lastActionWasRotation = false
    this.lastKickIndex = 0
    this.zoneMeter = 0
    this.zoneActive = false
    this.zoneTimer = 0
    this.zoneLines = 0
    this.lastClear = null
    this.hardDropped = false
    this.blocksPurified = 0
    this.purifyTimer = PURIFY_DURATION_MS
    this.blitzTimer  = BLITZ_DURATION_MS
    this.infectionTimer = 10000 + Math.random() * 5000
    // Versus / garbage
    this.pendingGarbage = 0
    this.lastGarbage = 0
    // Zone floor (lines captured during Zone sitting at the bottom)
    this.zoneFloor = 0
    this.horizontalState = {
      left: { active: false, timer: 0, repeat: 0 },
      right: { active: false, timer: 0, repeat: 0 },
    }
    while (this.queue.length < 5) this.fillQueue()
    this.current = this.nextPiece()
    this.lowestY = this.current.y
    if (collides(this.board, this.current, this.current.x, this.current.y)) {
      this.gameOver = true
      this.gameOverReason = 'topout'
    }
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
    this.lastActionWasRotation = false
    if (this.lockResets < 15) { this.lockTimer = 0; this.lockResets += 1 }
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
        this.lastActionWasRotation = true
        this.lastKickIndex = i
        if (this.lockResets < 15) { this.lockTimer = 0; this.lockResets += 1 }
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
      this.gameOverReason = 'topout'
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

    // Count INF cells the piece will overwrite — purification on contact
    if (this.mode === GAME_MODE.PURIFY) {
      for (let py = 0; py < this.current.matrix.length; py += 1) {
        for (let px = 0; px < this.current.matrix[py].length; px += 1) {
          if (!this.current.matrix[py][px]) continue
          const bx = this.current.x + px
          const by = this.current.y + py
          if (by >= 0 && by < BOARD_HEIGHT && bx >= 0 && bx < BOARD_WIDTH) {
            if (this.board[by][bx] === 'INF') this.blocksPurified += 1
          }
        }
      }
      this.score = this.blocksPurified * 10
    }

    this.lockFlash = true
    mergePiece(this.board, this.current)

    let rows
    if (this.zoneActive) {
      // During Zone: complete rows are captured at the board bottom as ZONE cells
      // (play area shrinks upward; ZONE rows act as a rising solid floor)
      const activeHeight = BOARD_HEIGHT - this.zoneFloor
      const activePart = this.board.slice(0, activeHeight)
      const completedRows = []
      const remaining = activePart.filter((row, y) => {
        if (row.every(Boolean)) { completedRows.push(y); return false }
        return true
      })
      while (remaining.length < activeHeight) remaining.unshift(Array(BOARD_WIDTH).fill(null))
      const zoneRow = () => Array(BOARD_WIDTH).fill('ZONE')
      const zonePart = Array.from({ length: completedRows.length }, zoneRow)
      this.board = [...remaining, ...zonePart, ...this.board.slice(activeHeight)]
      this.zoneFloor += completedRows.length
      rows = completedRows
    } else {
      const result = clearLines(this.board)
      this.board = result.board
      rows = result.rows
    }

    if (rows.length) {
      const cleared = rows.length
      let points = 0
      let isSpecialClear = false

      if (this.mode === GAME_MODE.PURIFY) {
        // Purify mode: score = blocksPurified * 10, no standard line points
        this.score = this.blocksPurified * 10
        isSpecialClear = false
      } else if (spinType === 'tSpin') {
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
      if (this.mode !== GAME_MODE.PURIFY) {
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
      } else {
        this.lines += cleared
      }
      this.level = Math.floor(this.lines / 10) + 1

      // Combo
      this.combo += 1
      this.lastCombo = this.combo
      if (this.mode !== GAME_MODE.PURIFY) {
        this.score += 50 * this.combo * this.level
      }

      // Sprint end check
      if (this.mode === GAME_MODE.SPRINT && this.lines >= SPRINT_LINES) {
        this.gameOver = true
        this.gameOverReason = 'complete'
      }

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

      // Versus mode: compute outgoing garbage
      if (this.mode === GAME_MODE.VERSUS) {
        let garbage = 0
        if (spinType === 'tSpin' || spinType === 'allSpin') {
          garbage = TSPIN_GARBAGE[Math.min(cleared, TSPIN_GARBAGE.length - 1)]
        } else {
          garbage = GARBAGE_BY_LINES[Math.min(cleared, GARBAGE_BY_LINES.length - 1)]
        }
        if (prevB2B && isSpecialClear) garbage += 1
        garbage += COMBO_GARBAGE[Math.min(this.combo, COMBO_GARBAGE.length - 1)]
        this.lastGarbage = garbage
      }
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
      this.combo = 0
      this.lastCombo = 0
    } else {
      this.combo = 0
      this.lastCombo = 0
    }

    this.current = this.nextPiece()
    this.lowestY = this.current.y
    this.lockResets = 0
    this.canHold = true
    this.gravityTimer = 0
    this.lockTimer = 0
    this.lastActionWasRotation = false

    // Apply received garbage just before the new piece appears (Versus mode)
    if (this.pendingGarbage > 0) {
      this._applyGarbage(this.pendingGarbage)
      this.pendingGarbage = 0
    }

    if (collides(this.board, this.current, this.current.x, this.current.y)) {
      this.gameOver = true
      this.gameOverReason = 'topout'
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
    this.zoneFloor = 0
    this.zoneMeter = 0
    return true
  }

  addInfectionLayer() {
    this.board.shift()
    const newRow = Array(BOARD_WIDTH).fill(null)
    for (const col of this.infectedCols) newRow[col] = 'INF'
    this.board.push(newRow)
    this.shake = Math.max(this.shake, 4)
    this.floatingTexts.push({
      text: '⚠ INFECTION SPREADING!',
      x: 0,
      y: 10,
      ttl: 120,
      maxTtl: 120,
    })
    if (collides(this.board, this.current, this.current.x, this.current.y)) {
      this.gameOver = true
      this.gameOverReason = 'topout'
    }
  }

  deactivateZone() {
    this.zoneActive = false
    this.zoneTimer = 0
    if (this.zoneFloor > 0) {
      // Remove all captured ZONE rows and restore empty rows at the top
      this.board = [
        ...Array(this.zoneFloor).fill(null).map(() => Array(BOARD_WIDTH).fill(null)),
        ...this.board.slice(0, BOARD_HEIGHT - this.zoneFloor),
      ]
      const bonus = this.zoneFloor * this.zoneFloor * 100 * this.level
      this.score += bonus
      this.shake = Math.min(15, 4 + this.zoneFloor)
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
      this.zoneFloor = 0
      this.zoneLines = this.zoneFloor // already 0 now
    }
  }

  // Versus: receive garbage from opponent
  receiveGarbage(lines) {
    this.pendingGarbage += lines
  }

  _applyGarbage(lines) {
    const gapCol = Math.floor(Math.random() * BOARD_WIDTH)
    const garbageRows = Array.from({ length: lines }, () => {
      const row = Array(BOARD_WIDTH).fill('GBG')
      row[gapCol] = null
      return row
    })
    // Shift board up by `lines` rows, add garbage at bottom
    this.board = [...this.board.slice(lines), ...garbageRows]
    this.shake = Math.max(this.shake, 4)
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
    if (this.mode === GAME_MODE.MASTER) return Math.min(8, 1.2 + this.level * 0.35)
    if (this.mode === GAME_MODE.BLITZ)  return Math.min(3.5, 0.85 + this.level * 0.22)
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
    this.lastClear = null
    this.hardDropped = false
    this.lockFlash = false
    this.lastCombo = 0
    this.lastGarbage = 0

    if (this.gameOver || this.paused) return

    // Elapsed time tracking (Sprint / Blitz)
    if (this.mode === GAME_MODE.SPRINT || this.mode === GAME_MODE.BLITZ) {
      this.elapsedTime += dt
    }

    // Blitz countdown
    if (this.mode === GAME_MODE.BLITZ) {
      this.blitzTimer -= dt
      if (this.blitzTimer <= 0) {
        this.blitzTimer = 0
        this.gameOver = true
        this.gameOverReason = 'timeout'
        return
      }
    }

    // Purify mode: countdown and infection spread
    if (this.mode === GAME_MODE.PURIFY) {
      this.purifyTimer -= dt
      if (this.purifyTimer <= 0) {
        this.purifyTimer = 0
        this.gameOver = true
        this.gameOverReason = 'timeout'
        return
      }
      this.infectionTimer -= dt
      if (this.infectionTimer <= 0) {
        this.addInfectionLayer()
        this.infectionTimer = 10000 + Math.random() * 5000
      }
    }

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

    // 20G mode: piece instantly falls to lowest possible row
    if (this.mode === GAME_MODE.MASTER && this.level >= 20) {
      this.current.y = getGhostY(this.board, this.current)
    } else {
      this.gravityTimer += (dt / 1000) * this.getGravity() * (held.softDrop ? SOFT_DROP_MULTIPLIER : 1)
      while (this.gravityTimer >= 1) {
        if (!this.softDrop()) break
        this.gravityTimer -= 1
      }
    }

    // Reset lock delay cap when piece reaches a new lowest Y
    if (this.current.y > this.lowestY) {
      this.lowestY = this.current.y
      this.lockTimer = 0
      this.lockResets = 0
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

  pause()  { if (!this.gameOver) this.paused = true }
  resume() { this.paused = false }
  togglePause() { if (this.paused) this.resume(); else this.pause() }

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
      combo: this.combo,
      lastCombo: this.lastCombo,
      lockFlash: this.lockFlash,
      paused: this.paused,
      elapsedTime: this.elapsedTime,
      blitzTimer: this.blitzTimer,
      infectedCols: this.infectedCols,
      zoneFloor: this.zoneFloor,
      lastGarbage: this.lastGarbage,
      pendingGarbage: this.pendingGarbage,
      zoneMeter: this.zoneMeter,
      zoneActive: this.zoneActive,
      zoneTimer: this.zoneTimer,
      zoneLines: this.zoneLines,
      lastClear: this.lastClear,
      hardDropped: this.hardDropped,
      mode: this.mode,
      blocksPurified: this.blocksPurified,
      purifyTimer: this.purifyTimer,
      gameOverReason: this.gameOverReason,
    }
  }
}
