export const BOARD_WIDTH = 10
export const BOARD_HEIGHT = 20

export const PIECES = {
  I: {
    color: '#00f5ff',
    matrix: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  },
  O: {
    color: '#f9ff4a',
    matrix: [
      [1, 1],
      [1, 1],
    ],
  },
  T: {
    color: '#ba7dff',
    matrix: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
  S: {
    color: '#72ff66',
    matrix: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
  },
  Z: {
    color: '#ff5f6d',
    matrix: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
  },
  J: {
    color: '#5f8bff',
    matrix: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
  L: {
    color: '#ffad5f',
    matrix: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
  // Special non-spawnable infected block (used only on the board, not in the bag)
  INF: {
    color: '#8b5cf6',
    matrix: [[1]],
  },
  // Zone captured row (rendered as electric cyan floor during Zone)
  ZONE: {
    color: '#00e5ff',
    matrix: [[1]],
  },
  // Garbage row sent from opponent in Versus mode
  GBG: {
    color: '#888888',
    matrix: [[1]],
  },
}

// Explicit sequence — does NOT include INF so it never enters the 7-bag
export const PIECE_SEQUENCE = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']
