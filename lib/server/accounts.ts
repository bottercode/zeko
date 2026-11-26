import 'server-only'

import { createHash } from 'node:crypto'
import { workspaceDatabase } from '../db/connection'
import { oauthAccounts, users } from '../db/schema'

export async function saveGoogleAccount(
  providerAccountId: string,
  profile: { email: string; name?: string | null; picture?: string | null },
) {
  // Keep the workspace IDs already used by canvases and agent credentials.
  const userId = createHash('sha256').update(providerAccountId).digest('hex')
  const db = workspaceDatabase()
  const values = {
    email: profile.email,
    name: profile.name ?? null,
    image: profile.picture ?? null,
    lastSignInAt: new Date(),
  }

  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId, ...values }).onConflictDoUpdate({
      target: users.id,
      set: values,
    })
    await tx.insert(oauthAccounts).values({ provider: 'google', providerAccountId, userId }).onConflictDoNothing({
      target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
    })
  })

  return userId
}
