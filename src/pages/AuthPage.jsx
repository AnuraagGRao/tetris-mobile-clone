import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'

const INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8, color: '#fff', padding: '10px 12px',
  fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none',
  transition: 'border-color 0.2s',
}

const BTN_PRIMARY = {
  width: '100%', padding: '11px', borderRadius: 8, border: 'none',
  background: 'linear-gradient(135deg, #00d4ff, #a855f7)',
  color: '#fff', fontWeight: 700, fontSize: '0.9rem',
  letterSpacing: '0.12em', cursor: 'pointer', fontFamily: 'inherit',
  textTransform: 'uppercase', transition: 'opacity 0.15s',
}

const BTN_SECONDARY = {
  width: '100%', padding: '10px', borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.04)',
  color: '#ccc', fontSize: '0.85rem', cursor: 'pointer',
  fontFamily: 'inherit', letterSpacing: '0.08em', transition: 'border-color 0.2s, background 0.2s',
}

function ErrorBox({ msg }) {
  if (!msg) return null
  return (
    <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid #f87171', borderRadius: 8, padding: '9px 12px', fontSize: '0.8rem', color: '#fca5a5', letterSpacing: '0.04em' }}>
      {msg}
    </div>
  )
}

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '8px', background: 'none',
        border: 'none', borderBottom: `2px solid ${active ? '#00d4ff' : 'transparent'}`,
        color: active ? '#00d4ff' : '#555', cursor: 'pointer',
        fontSize: '0.8rem', letterSpacing: '0.15em', fontFamily: 'inherit',
        textTransform: 'uppercase', transition: 'all 0.18s',
      }}
    >
      {label}
    </button>
  )
}

// ─── Login form ────────────────────────────────────────────────────────────────
function LoginForm({ onSuccess }) {
  const { signIn, resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try { await signIn(email, pass); onSuccess() }
    catch (ex) { setErr(friendlyError(ex?.code)) }
    finally { setBusy(false) }
  }

  const doReset = async () => {
    setErr(''); setInfo('')
    if (!email) { setErr('Enter your email above, then tap "Forgot password"'); return }
    setBusy(true)
    try { await resetPassword(email); setInfo('Password reset email sent. Check your inbox.') }
    catch (ex) { setErr(friendlyError(ex?.code)) }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ErrorBox msg={err} />
      {info && <div style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e', borderRadius: 8, padding: '8px 12px', fontSize: '0.78rem', color: '#86efac', letterSpacing: '0.04em' }}>{info}</div>}
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={INPUT_STYLE} />
      <input type="password" placeholder="Password" value={pass} onChange={e => setPass(e.target.value)} required style={INPUT_STYLE} />
      <button type="submit" disabled={busy} style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}>
        {busy ? '…' : 'LOG IN'}
      </button>
      <button type="button" onClick={doReset} disabled={busy} style={{ ...BTN_SECONDARY, opacity: busy ? 0.6 : 1 }}>
        FORGOT PASSWORD
      </button>
    </form>
  )
}

// ─── Sign-up form ──────────────────────────────────────────────────────────────
function SignUpForm({ onSuccess }) {
  const { signUp } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (pass.length < 6) { setErr('Password must be at least 6 characters.'); return }
    setErr(''); setBusy(true)
    try { await signUp(email, pass, name || 'Player'); onSuccess() }
    catch (ex) { setErr(friendlyError(ex?.code)) }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ErrorBox msg={err} />
      <input type="text" placeholder="Display name" value={name} onChange={e => setName(e.target.value)} style={INPUT_STYLE} />
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={INPUT_STYLE} />
      <input type="password" placeholder="Password (min. 6 chars)" value={pass} onChange={e => setPass(e.target.value)} required style={INPUT_STYLE} />
      <button type="submit" disabled={busy} style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}>
        {busy ? '…' : 'CREATE ACCOUNT'}
      </button>
    </form>
  )
}

function friendlyError(code) {
  const map = {
    // Legacy codes (Firebase < v9.6)
    'auth/user-not-found':          'No account with that email.',
    'auth/wrong-password':          'Incorrect password.',
    // Modern unified credential error (Firebase v9.6+)
    'auth/invalid-credential':      'Email or password is incorrect.',
    'auth/invalid-login-credentials':'Email or password is incorrect.',
    // Sign-up
    'auth/email-already-in-use':    'Email already registered.',
    'auth/invalid-email':           'Invalid email address.',
    'auth/weak-password':           'Password must be at least 6 characters.',
    'auth/missing-password':        'Please enter a password.',
    'auth/missing-email':           'Please enter your email.',
    // Provider not enabled in Firebase Console
    'auth/configuration-not-found': 'This sign-in method is not enabled. Contact support.',
    'auth/operation-not-allowed':   'This sign-in method is not enabled. Contact support.',
    // Other
    'auth/user-disabled':           'This account has been disabled.',
    'auth/too-many-requests':       'Too many attempts. Try again later.',
    'auth/network-request-failed':  'Network error. Check your connection.',
    'auth/popup-closed-by-user':    'Sign-in window closed.',
    'auth/popup-blocked':           'Popup was blocked. Please allow popups for this site.',
    'auth/cancelled-popup-request': 'Sign-in cancelled.',
  }
  return map[code] || `Something went wrong (${code ?? 'unknown'}). Please try again.`
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AuthPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('login')

  const onSuccess = () => navigate('/')

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a14', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Courier New", monospace', padding: '1rem' }}>
      {/* Back button */}
      <button onClick={() => navigate('/')} style={{ position: 'absolute', top: 16, left: 16, background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '0.75rem', letterSpacing: '0.12em', fontFamily: 'inherit' }}>
        ← BACK
      </button>

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        style={{ background: '#10101c', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 900, letterSpacing: '0.1em', background: 'linear-gradient(135deg,#00d4ff,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            TETRA OVERFLOW
          </div>
          <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.3em', marginTop: 2 }}>ULTRA</div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <TabButton label="LOG IN" active={tab === 'login'} onClick={() => setTab('login')} />
          <TabButton label="SIGN UP" active={tab === 'signup'} onClick={() => setTab('signup')} />
        </div>

        {/* Form */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: tab === 'login' ? -12 : 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: tab === 'login' ? 12 : -12 }}
            transition={{ duration: 0.2 }}
          >
            {tab === 'login'
              ? <LoginForm onSuccess={onSuccess} />
              : <SignUpForm onSuccess={onSuccess} />
            }
          </motion.div>
        </AnimatePresence>

        {/* Third-party and guest sign-in temporarily disabled */}
        <div style={{ fontSize: '0.62rem', color: '#444', textAlign: 'center' }}>
          Third-party and guest sign-in are currently unavailable.
        </div>
      </motion.div>
    </div>
  )
}
