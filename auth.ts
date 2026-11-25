import 'server-only'
import { createHash } from 'node:crypto'
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: [Google({ checks: ['pkce', 'state', 'nonce'], allowDangerousEmailAccountLinking: false })],
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  trustHost: true,
  useSecureCookies: true,
  callbacks: {
    signIn({ account, profile }) {
      return account?.provider === 'google' && !!account.providerAccountId && profile?.email_verified === true
    },
    jwt({ token, account }) {
      if (account?.provider === 'google') {
        token.workspace = createHash('sha256').update(account.providerAccountId).digest('hex')
      }
      return token
    },
  },
}))
