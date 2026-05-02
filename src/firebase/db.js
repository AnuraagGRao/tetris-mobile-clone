import {
  doc, getDoc, setDoc, updateDoc, collection,
  query, where, orderBy, limit, getDocs, increment,
  serverTimestamp, addDoc, onSnapshot, runTransaction,
} from 'firebase/firestore'
import { db } from './config'

// ─── User profile ─────────────────────────────────────────────────────────────
export const createUserProfile = async (uid, data) => {
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      ...data,
      coins: 200,
      inventory: ['theme_classic'],
      createdAt: serverTimestamp(),
    })
  }
}

export const getUserProfile = async (uid) => {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? snap.data() : null
}

export const updateUserProfile = async (uid, data) => {
  await updateDoc(doc(db, 'users', uid), data)
}

// ─── Coins: ledger ──────────────────────────────────────────────────────────
/** Append a coin ledger entry under users/{uid}/coin_ledger. */
export const appendCoinLedger = async (uid, entry) => {
  const ref = collection(db, 'users', uid, 'coin_ledger')
  await addDoc(ref, { ...entry, createdAt: serverTimestamp() })
}

/** Atomic coin update with ledger; delta can be positive (earn) or negative (spend). */
export const addCoinsWithLedger = async (uid, delta, context = {}) => {
  if (!delta) return { balanceAfter: null }
  const userRef = doc(db, 'users', uid)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef)
    if (!snap.exists()) throw new Error('User not found')
    const prev = snap.data().coins || 0
    const next = prev + delta
    tx.update(userRef, { coins: next })
    const ledgerRef = doc(collection(db, 'users', uid, 'coin_ledger'))
    tx.set(ledgerRef, {
      type: delta >= 0 ? 'earn' : 'spend',
      amount: Math.abs(delta),
      balanceAfter: next,
      ...context,
      createdAt: serverTimestamp(),
    })
  })
}

// ─── Stats + scores ───────────────────────────────────────────────────────────
export const saveGameResult = async (uid, mode, score, extra = {}) => {
  const statsRef = doc(db, 'stats', uid)
  const statsSnap = await getDoc(statsRef)
  const existing = statsSnap.exists() ? statsSnap.data() : {}
  const bestKey = `best_${mode}`
  const isBest = score > (existing[bestKey] || 0)

  await setDoc(statsRef, {
    totalGames: increment(1),
    totalLines: increment(extra.lines || 0),
    totalScore: increment(score),
    ...(isBest ? { [bestKey]: score } : {}),
    lastPlayed: serverTimestamp(),
  }, { merge: true })

  // Earn coins: 1 coin per 1000 score; Ultimate bonus 2×
  const rate = mode === 'ultimate' ? 2 : 1
  const earned = Math.floor(score / 1000) * rate
  if (earned > 0) await addCoinsWithLedger(uid, earned, { mode, score, lines: extra.lines || 0 })

  await addDoc(collection(db, 'scores'), {
    uid,
    mode,
    score,
    lines: extra.lines || 0,
    level: extra.level || 1,
    timestamp: serverTimestamp(),
  })

  return { isBest, coinsEarned: earned }
}

export const getUserStats = async (uid) => {
  const snap = await getDoc(doc(db, 'stats', uid))
  return snap.exists() ? snap.data() : {}
}

export const getLeaderboard = async (mode, lim = 10) => {
  const q = query(
    collection(db, 'scores'),
    where('mode', '==', mode),
    orderBy('score', 'desc'),
    limit(lim)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ─── Store ────────────────────────────────────────────────────────────────────
export const purchaseItem = async (uid, itemId, cost) => {
  const userRef = doc(db, 'users', uid)
  // Use a transaction to prevent TOCTOU race condition on coin deduction
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef)
    if (!snap.exists()) throw new Error('User not found')
    const profile = snap.data()
    if ((profile.coins || 0) < cost) throw new Error('Not enough coins')
    if ((profile.inventory || []).includes(itemId)) throw new Error('Already owned')
    const next = (profile.coins || 0) - cost
    tx.update(userRef, { coins: next, inventory: [...(profile.inventory || []), itemId] })
    // Append spend entry in the same transaction
    const ledgerRef = doc(collection(db, 'users', uid, 'coin_ledger'))
    tx.set(ledgerRef, { type: 'spend', amount: cost, itemId, balanceAfter: next, createdAt: serverTimestamp() })
  })
}

/** Get latest N coin ledger entries (desc). */
export const getCoinHistory = async (uid, lim = 20) => {
  const q = query(collection(db, 'users', uid, 'coin_ledger'), orderBy('createdAt', 'desc'), limit(lim))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

/** Admin/test: refund the last spend entry and record a refund entry. */
// Admin refund API removed for production safety.

// ─── Story progress ───────────────────────────────────────────────────────────
export const saveStoryProgress = async (uid, chapterId, levelId, score, lines = 0) => {
  const ref = doc(db, 'story', uid)
  await setDoc(ref, {
    [`${chapterId}_${levelId}_score`]: score,
    [`${chapterId}_${levelId}_lines`]: lines,
    [`${chapterId}_${levelId}_completed`]: true,
    lastUpdated: serverTimestamp(),
  }, { merge: true })
}

export const unlockItem = async (uid, itemId) => {
  const userRef = doc(db, 'users', uid)
  const snap = await getDoc(userRef)
  if (!snap.exists()) return
  const profile = snap.data()
  if ((profile.inventory || []).includes(itemId)) return
  await updateDoc(userRef, { inventory: [...(profile.inventory || []), itemId] })
}

export const getStoryProgress = async (uid) => {
  const snap = await getDoc(doc(db, 'story', uid))
  return snap.exists() ? snap.data() : {}
}

// ─── Multiplayer lobbies ──────────────────────────────────────────────────────
const genCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase().replace(/[0O]/g, 'X')

const MAX_LOBBY_PLAYERS = 8

export const createLobby = async (uid, displayName, { bestOf = 3 } = {}) => {
  const code = genCode()
  await setDoc(doc(db, 'lobbies', code), {
    code,
    hostUid: uid,
    status: 'waiting',
    bestOf,
    currentRound: 1,
    roundWins: {},
    matchWinner: null,
    players: [{ uid, displayName: displayName || 'Player 1', ready: false, score: 0, gameOver: false, boardSnapshot: null, garbageSentTo: {} }],
    createdAt: serverTimestamp(),
  })
  return code
}

export const joinLobby = async (code, uid, displayName) => {
  const ref = doc(db, 'lobbies', code)
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Lobby not found')
    const lobby = snap.data()
    if (lobby.status !== 'waiting') throw new Error('Game already started')
    const players = Array.isArray(lobby.players) ? lobby.players.slice() : []
    if (players.length >= MAX_LOBBY_PLAYERS) throw new Error('Lobby is full')
    if (players.some(p => p.uid === uid)) return lobby
    const name = displayName || `Player ${players.length + 1}`
    players.push({ uid, displayName: name, ready: false, score: 0, gameOver: false, boardSnapshot: null, garbageSentTo: {} })
    tx.update(ref, { players })
    return { ...lobby, players }
  })
}

export const updateLobbyPlayer = async (code, uid, update) => {
  const ref = doc(db, 'lobbies', code)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const lobby = snap.data()
  const players = lobby.players.map(p => p.uid === uid ? { ...p, ...update } : p)
  await updateDoc(ref, { players })
}

export const updateLobby = async (code, update) =>
  updateDoc(doc(db, 'lobbies', code), update)

export const setLobbyBestOf = async (code, bestOf) =>
  updateDoc(doc(db, 'lobbies', code), { bestOf })

export const setLobbyStatus = async (code, status) =>
  updateDoc(doc(db, 'lobbies', code), { status })

export const subscribeLobby = (code, callback) =>
  onSnapshot(
    doc(db, 'lobbies', code),
    (snap) => { if (snap.exists()) callback(snap.data()) },
    (err) => {
      // Non-fatal: extensions/ad-blockers can interfere with the listen channel.
      // Fall back to a one-shot fetch so the UI still has data.
      console.warn('Lobby subscribe error (non-fatal):', err?.code || err?.message)
      getDoc(doc(db, 'lobbies', code)).then(s => { if (s.exists()) callback(s.data()) }).catch(() => {})
    }
  )

// ─── Lobby archival / cleanup ────────────────────────────────────────────────
export const archiveLobby = async (code, extra = {}) => {
  const ref = doc(db, 'lobbies', code)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const data = snap.data()
  const archived = {
    ...data,
    archivedAt: serverTimestamp(),
    expireAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days TTL (configure TTL on this field)
    ...extra,
  }
  await setDoc(doc(db, 'lobbies_archive', code), archived)
  await updateDoc(ref, { status: 'archived' }).catch(() => {})
  // Best-effort delete; you may tighten rules to host-only
  try { await (await import('firebase/firestore')).deleteDoc(ref) } catch {}
}

// ─── Artwork voting ───────────────────────────────────────────────────────────
const DISLIKE_ALERT_THRESHOLD = 0.75  // 75% dislikes
const DISLIKE_MIN_VOTES       = 5     // minimum total votes before alert triggers

export const getArtworkVotes = async (trackId) => {
  const snap = await getDoc(doc(db, 'artwork_votes', trackId))
  return snap.exists() ? snap.data() : { up: 0, down: 0, userVotes: {} }
}

export const getAllArtworkVotes = async () => {
  const snap = await getDocs(collection(db, 'artwork_votes'))
  const result = {}
  snap.docs.forEach(d => { result[d.id] = d.data() })
  return result
}

export const voteArtwork = async (uid, trackId, vote) => {
  if (!['up', 'down'].includes(vote)) throw new Error('Invalid vote')
  const ref = doc(db, 'artwork_votes', trackId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists() ? snap.data() : { up: 0, down: 0, userVotes: {} }
    const prev = data.userVotes?.[uid]
    const userVotes = { ...(data.userVotes || {}), [uid]: vote }
    let up   = data.up   || 0
    let down = data.down || 0
    // Remove old vote
    if (prev === 'up')   up   = Math.max(0, up   - 1)
    if (prev === 'down') down = Math.max(0, down - 1)
    // Add new vote
    if (vote === 'up')   up   += 1
    if (vote === 'down') down += 1
    tx.set(ref, { up, down, userVotes, trackId, updatedAt: serverTimestamp() })

    // Check if dislike alert should fire
    const total = up + down
    if (total >= DISLIKE_MIN_VOTES && down / total >= DISLIKE_ALERT_THRESHOLD) {
      const alertRef = doc(collection(db, 'admin_alerts'))
      tx.set(alertRef, {
        type: 'artwork_dislike',
        trackId,
        up, down, total,
        dislikeRatio: Math.round((down / total) * 100),
        triggeredBy: uid,
        createdAt: serverTimestamp(),
        resolved: false,
      })
    }
  })
}
