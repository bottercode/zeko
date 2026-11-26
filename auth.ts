import 'server-only'
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { saveGoogleAccount } from '@/lib/server/accounts'

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: [Google({ checks: ['pkce', 'state', 'nonce'], allowDangerousEmailAccountLinking: false })],
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  trustHost: true,
  useSecureCookies: true,
  callbacks: {
    signIn({ account, profile, user }) {
      return account?.provider === 'google' && !!account.providerAccountId && profile?.email_verified === true && !!user.email
    },
    async jwt({ token, account }) {
      if (account?.provider === 'google' && token.email) {
        try {
          const workspace = await saveGoogleAccount(account.providerAccountId, {
            email: token.email,
            name: token.name,
            picture: token.picture,
          })
          token.workspace = workspace
          token.sub = workspace
        } catch {
          throw new Error('Could not save the Google account. Check PostgreSQL and the Zeko database migrations.')
        }
      }
      return token
    },
  },
}))
