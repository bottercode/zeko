import 'server-only'
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { allowedGoogleEmail } from '@/lib/auth-access'

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: [Google({ checks: ['pkce', 'state', 'nonce'], allowDangerousEmailAccountLinking: false })],
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  trustHost: true,
  useSecureCookies: true,
  callbacks: {
    signIn({ account, profile }) {
      return account?.provider === 'google' && profile?.email_verified === true && allowedGoogleEmail(profile.email)
    },
  },
}))
