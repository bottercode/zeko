import 'server-only'
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { saveGoogleAccount } from '@/lib/server/accounts'
import { activeTeamFor, rememberTeam, teamRole } from '@/lib/server/teams'
import { workspaceId } from '@/lib/auth-access'

export const { handlers, auth, signIn, signOut, unstable_update: updateSession } = NextAuth(() => ({
  providers: [Google({ checks: ['pkce', 'state', 'nonce'], allowDangerousEmailAccountLinking: false })],
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  trustHost: true,
  useSecureCookies: true,
  callbacks: {
    signIn({ account, profile, user }) {
      return account?.provider === 'google' && !!account.providerAccountId && profile?.email_verified === true && !!user.email
    },
    // token.sub is the person; token.workspace is the team they are working in.
    async jwt({ token, account, trigger, session }) {
      if (account?.provider === 'google' && token.email) {
        try {
          const userId = await saveGoogleAccount(account.providerAccountId, {
            email: token.email,
            name: token.name,
            picture: token.picture,
          })
          token.sub = userId
          token.workspace = await activeTeamFor(userId)
        } catch {
          throw new Error('Could not save the Google account. Check PostgreSQL and the Zeko database migrations.')
        }
      }
      // Switching teams: only to a team the person is in.
      const team = (session as { team?: unknown } | undefined)?.team
      if (trigger === 'update' && workspaceId(token.sub) && workspaceId(team) && await teamRole(token.sub, team)) {
        token.workspace = team
        await rememberTeam(token.sub, team)
      }
      return token
    },
  },
}))
