import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot as fsOnSnapshot } from 'firebase/firestore'
import { auth } from '../firebase/config'
import { db } from '../firebase/config'
import { getUserProfile } from '../firebase/db'
import { signUpWithEmail, signInWithEmail, signOut, sendPasswordReset } from '../firebase/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const profile = await getUserProfile(firebaseUser.uid)
        setUserProfile(profile)
      } else {
        setUserProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  // Live subscribe to user profile for reactive coins/inventory updates
  useEffect(() => {
    if (!user?.uid) return
    const ref = doc(db, 'users', user.uid)
    const unsub = fsOnSnapshot(ref, (snap) => {
      if (snap.exists()) setUserProfile(snap.data())
    })
    return unsub
  }, [user?.uid])

  const refreshProfile = useCallback(async () => {
    if (user) {
      const profile = await getUserProfile(user.uid)
      setUserProfile(profile)
    }
  }, [user])

  return (
    <AuthContext.Provider value={{
      user,
      userProfile,
      loading,
      refreshProfile,
      signUp: signUpWithEmail,
      signIn: signInWithEmail,
      resetPassword: sendPasswordReset,
      // Third-party and guest sign-in disabled
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
