import { PIECE_SEQUENCE } from './tetrominoes'

export const createBag = (random = Math.random) => {
  const bag = [...PIECE_SEQUENCE]
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}
