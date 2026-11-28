/**
 * Team rules against a real PostgreSQL. Point ZEKO_TEST_DATABASE_URL at a disposable, migrated database
 * (npm run db:migrate with DATABASE_URL set to it); the tests are skipped without one. Never use a shared database.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'

const url = process.env.ZEKO_TEST_DATABASE_URL
const skip = url ? false : 'set ZEKO_TEST_DATABASE_URL to a disposable migrated database'
if (url) process.env.DATABASE_URL = url

const id = () => randomBytes(32).toString('hex')
type Teams = typeof import('../lib/server/teams')
let teams: Teams
let db: ReturnType<typeof import('../lib/db/connection')['workspaceDatabase']>
let schema: typeof import('../lib/db/schema')

async function person(name: string) {
  const userId = id()
  await db.transaction(async (tx) => {
    await tx.insert(schema.users).values({ id: userId, name, email: `${name.toLowerCase()}@example.com` })
    await teams.ensurePersonalTeam(tx, userId, { name, email: `${name.toLowerCase()}@example.com` })
  })
  return userId
}

before(async () => {
  if (skip) return
  teams = await import('../lib/server/teams')
  schema = await import('../lib/db/schema')
  db = (await import('../lib/db/connection')).workspaceDatabase()
})

after(async () => {
  if (!skip) await (db as unknown as { $client: { end(): Promise<void> } }).$client.end()
})

test('everyone starts in a personal team they own, with their user ID', { skip }, async () => {
  const ada = await person('Ada Lovelace')
  assert.equal(await teams.teamRole(ada, ada), 'owner')
  const list = await teams.listTeams(ada)
  assert.deepEqual(list.map(({ id: team, name, personal, role, members }) => ({ team, name, personal, role, members })),
    [{ team: ada, name: 'Ada\'s team', personal: true, role: 'owner', members: 1 }])
  assert.equal(await teams.activeTeamFor(ada), ada)
  // Signing in again doesn't duplicate or rename it.
  await db.transaction((tx) => teams.ensurePersonalTeam(tx, ada, { name: 'Someone Else' }))
  assert.equal((await teams.listTeams(ada)).length, 1)
})

test('the personal team can be neither left nor deleted', { skip }, async () => {
  const ada = await person('Ada')
  await assert.rejects(teams.leaveTeam(ada, ada), /can’t leave your personal team/)
  await assert.rejects(teams.deleteTeam(ada, ada), /can’t be deleted/)
  assert.equal(await teams.teamRole(ada, ada), 'owner')
})

test('create a team, invite by link, join, and share it', { skip }, async () => {
  const ada = await person('Ada')
  const bo = await person('Bo')
  const team = await teams.createTeam(ada, '  Design   studio ')
  assert.equal((await teams.teamById(team))?.name, 'Design studio')
  assert.equal(await teams.teamRole(bo, team), null)

  const token = await teams.resetInvite(ada, team)
  assert.ok(teams.inviteToken(token))
  assert.equal((await teams.inviteDetails(token))?.name, 'Design studio')
  assert.equal(await teams.acceptInvite(bo, token), team)
  assert.equal(await teams.teamRole(bo, team), 'member')
  // Joining twice is harmless.
  await teams.acceptInvite(bo, token)
  assert.deepEqual((await teams.teamMembersOf(bo, team)).map((m) => [m.role, m.you]), [['owner', false], ['member', true]])

  // A new link turns the old one off.
  const fresh = await teams.resetInvite(ada, team)
  assert.equal(await teams.inviteDetails(token), undefined)
  assert.ok(await teams.inviteDetails(fresh))
  await assert.rejects(teams.acceptInvite(await person('Cy'), token), /expired or was reset/)
})

test('only owners manage the team', { skip }, async () => {
  const ada = await person('Ada')
  const bo = await person('Bo')
  const team = await teams.createTeam(ada, 'Studio')
  await teams.acceptInvite(bo, await teams.resetInvite(ada, team))
  await assert.rejects(teams.renameTeam(bo, team, 'Mine now'), /Only the team’s owners/)
  await assert.rejects(teams.resetInvite(bo, team), /Only the team’s owners/)
  await assert.rejects(teams.removeMember(bo, team, ada), /Only the team’s owners/)
  await assert.rejects(teams.deleteTeam(bo, team), /Only the team’s owners/)
  await assert.rejects(teams.renameTeam(ada, team, '   '), /Give the team a name/)
  await assert.rejects(teams.renameTeam(ada, team, 'x'.repeat(61)), /under 60/)
})

test('a team always keeps an owner', { skip }, async () => {
  const ada = await person('Ada')
  const bo = await person('Bo')
  const team = await teams.createTeam(ada, 'Studio')
  await teams.acceptInvite(bo, await teams.resetInvite(ada, team))
  await assert.rejects(teams.setMemberRole(ada, team, ada, 'member'), /at least one owner/)
  await assert.rejects(teams.leaveTeam(ada, team), /someone else an owner/)
  await teams.setMemberRole(ada, team, bo, 'owner')
  assert.equal(await teams.teamRole(bo, team), 'owner')
  await teams.leaveTeam(ada, team)
  assert.equal(await teams.teamRole(ada, team), null)
  assert.equal(await teams.teamRole(bo, team), 'owner')
})

test('removing someone ends their access at once, and they fall back to their personal team', { skip }, async () => {
  const ada = await person('Ada')
  const bo = await person('Bo')
  const team = await teams.createTeam(ada, 'Studio')
  await teams.acceptInvite(bo, await teams.resetInvite(ada, team))
  await teams.rememberTeam(bo, team)
  assert.equal(await teams.activeTeamFor(bo), team)
  const headers = new Headers({ 'x-zeko-workspace': team, 'x-zeko-user': bo })
  assert.equal((await teams.requestMember(headers))?.role, 'member')

  await teams.removeMember(ada, team, bo)
  assert.equal(await teams.requestMember(headers), null)
  assert.equal(await teams.activeTeamFor(bo), bo)
})

test('requests without a user act for the workspace itself, as tokens from before teams did', { skip }, async () => {
  const ada = await person('Ada')
  assert.equal((await teams.requestMember(new Headers({ 'x-zeko-workspace': ada })))?.user, ada)
  const team = await teams.createTeam(ada, 'Studio')
  // A team ID alone is not a person, so it gets no access.
  assert.equal(await teams.requestMember(new Headers({ 'x-zeko-workspace': team })), null)
})

test('the last person leaving a team deletes it; deleting a team removes its canvases', { skip }, async () => {
  const ada = await person('Ada')
  const solo = await teams.createTeam(ada, 'Solo')
  await teams.leaveTeam(ada, solo)
  assert.equal(await teams.teamById(solo), undefined)

  const team = await teams.createTeam(ada, 'Studio')
  await db.insert(schema.accountCanvases).values({ ownerId: team, id: 'c1', snapshot: { name: 'x' } as never, revision: '00000000-0000-0000-0000-000000000009' })
  await teams.deleteTeam(ada, team)
  const { eq } = await import('drizzle-orm')
  assert.equal((await db.select().from(schema.accountCanvases).where(eq(schema.accountCanvases.ownerId, team))).length, 0)
})
