import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { auth } from './config'
import { createUserProfile } from './db'

export const signUpWithEmail = async (email, password, displayName) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  await updateProfile(cred.user, { displayName })
  await createUserProfile(cred.user.uid, { displayName, email })
  return cred.user
}

export const signInWithEmail = async (email, password) => {
  const cred = await signInWithEmailAndPassword(auth, email, password)
  return cred.user
}

// Google and guest sign-in disabled

export const signOut = () => fbSignOut(auth)

export const sendPasswordReset = async (email) => {
  if (!email) throw new Error('auth/missing-email')
  await sendPasswordResetEmail(auth, email)
}
