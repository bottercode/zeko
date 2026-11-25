'use server'

import { redirect } from 'next/navigation'
import { signIn, signOut } from '@/auth'
import { canvasReturnPath, googleAuthConfigured } from '@/lib/auth-access'

export async function startGoogleSignIn(formData: FormData) {
  if (!googleAuthConfigured()) redirect('/')
  await signIn('google', { redirectTo: canvasReturnPath(formData.get('next')) })
}

export async function endSession() {
  if (!googleAuthConfigured()) redirect('/')
  await signOut({ redirectTo: '/login' })
}
