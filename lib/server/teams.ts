import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { and, asc, count, eq, gt, inArray, lt, ne } from 'drizzle-orm'
import { workspaceDatabase } from '../db/connection'
import { teamInvites, teamMembers, teams, users } from '../db/schema'
import { USER_HEADER, workspaceId, WORKSPACE_HEADER } from '../auth-access'

export type TeamRole = 'owner' | 'member'
export interface TeamSummary { id: string; name: string; personal: boolean; role: TeamRole; members: number }
export interface TeamMember { id: string; name: string | null; email: string | null; image: string | null; role: TeamRole; you: boolean }

export class TeamError extends Error {}

export const TEAM_NAME_LIMIT = 60
const INVITE_MS = 7 * 24 * 60 * 60 * 1000
const MEMBERSHIP_MS = 15_000

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const db = () => workspaceDatabase()

export function teamName(value: unknown) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!name) throw new TeamError('Give the team a name.')
  if (name.length > TEAM_NAME_LIMIT) throw new TeamError(`Keep the name under ${TEAM_NAME_LIMIT} characters.`)
  return name
}

/** A first team for someone new: "Ada's team", from their name or else their email. */
export function personalTeamName(profile: { name?: string | null; email?: string | null }) {
  const first = profile.name?.trim().split(/\s+/)[0] || profile.email?.split('@')[0]
  return first ? `${first.slice(0, TEAM_NAME_LIMIT - 7)}'s team` : 'Personal team'
}

/* Membership is checked on every request; keep answers briefly so a busy canvas doesn't query for each one. */
const runtime = globalThis as typeof globalThis & { __zekoMemberships?: Map<string, { role: TeamRole | null; at: number }> }
const memberships = runtime.__zekoMemberships ??= new Map()
const membershipKey = (userId: string, teamId: string) => `${userId}:${teamId}`

function forgetTeam(teamId: string) {
  for (const key of memberships.keys()) if (key.endsWith(`:${teamId}`)) memberships.delete(key)
}

export async function teamRole(userId: string, teamId: string): Promise<TeamRole | null> {
  if (!workspaceId(userId) || !workspaceId(teamId)) return null
  const key = membershipKey(userId, teamId)
  const cached = memberships.get(key)
  if (cached && Date.now() - cached.at < MEMBERSHIP_MS) return cached.role
  const [row] = await db().select({ role: teamMembers.role }).from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))).limit(1)
  const role = row?.role ?? null
  if (memberships.size > 5000) memberships.clear()
  memberships.set(key, { role, at: Date.now() })
  return role
}

async function requireOwner(userId: string, teamId: string) {
  memberships.delete(membershipKey(userId, teamId))
  if (await teamRole(userId, teamId) !== 'owner') throw new TeamError('Only the team’s owners can do that.')
}

/** Run inside the sign-in transaction: everyone has a personal team, whose ID is their user ID. */
export async function ensurePersonalTeam(
  tx: Parameters<Parameters<ReturnType<typeof workspaceDatabase>['transaction']>[0]>[0],
  userId: string,
  profile: { name?: string | null; email?: string | null },
) {
  await tx.insert(teams).values({ id: userId, name: personalTeamName(profile), personal: true, createdBy: userId })
    .onConflictDoNothing({ target: teams.id })
  await tx.insert(teamMembers).values({ teamId: userId, userId, role: 'owner' })
    .onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.userId] })
}

/** The team to open: the last one while they are still in it, else their personal team. */
export async function activeTeamFor(userId: string) {
  const [row] = await db().select({ last: users.lastTeamId }).from(users).where(eq(users.id, userId)).limit(1)
  if (row?.last && await teamRole(userId, row.last)) return row.last
  return userId
}

export async function rememberTeam(userId: string, teamId: string) {
  await db().update(users).set({ lastTeamId: teamId }).where(eq(users.id, userId))
}

export async function listTeams(userId: string): Promise<TeamSummary[]> {
  const mine = await db().select({ id: teams.id, name: teams.name, personal: teams.personal, role: teamMembers.role })
    .from(teamMembers).innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
  if (!mine.length) return []
  const sizes = await db().select({ teamId: teamMembers.teamId, members: count() }).from(teamMembers)
    .where(inArray(teamMembers.teamId, mine.map((team) => team.id))).groupBy(teamMembers.teamId)
  const size = new Map(sizes.map((row) => [row.teamId, Number(row.members)]))
  return mine
    .map((team) => ({ ...team, members: size.get(team.id) ?? 1 }))
    .sort((a, b) => Number(b.personal) - Number(a.personal) || a.name.localeCompare(b.name))
}

export async function teamMembersOf(userId: string, teamId: string): Promise<TeamMember[]> {
  if (!await teamRole(userId, teamId)) throw new TeamError('You’re not in this team.')
  const rows = await db().select({ id: users.id, name: users.name, email: users.email, image: users.image, role: teamMembers.role, joinedAt: teamMembers.joinedAt })
    .from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId)).orderBy(asc(teamMembers.joinedAt))
  return rows.map(({ joinedAt: _, ...row }) => ({ ...row, you: row.id === userId }))
}

export async function createTeam(userId: string, name: unknown) {
  const id = randomBytes(32).toString('hex')
  const value = teamName(name)
  await db().transaction(async (tx) => {
    await tx.insert(teams).values({ id, name: value, createdBy: userId })
    await tx.insert(teamMembers).values({ teamId: id, userId, role: 'owner' })
  })
  memberships.set(membershipKey(userId, id), { role: 'owner', at: Date.now() })
  return id
}

export async function renameTeam(userId: string, teamId: string, name: unknown) {
  await requireOwner(userId, teamId)
  await db().update(teams).set({ name: teamName(name) }).where(eq(teams.id, teamId))
}

export async function deleteTeam(userId: string, teamId: string) {
  await requireOwner(userId, teamId)
  const [team] = await db().select({ personal: teams.personal }).from(teams).where(eq(teams.id, teamId)).limit(1)
  if (!team) throw new TeamError('This team no longer exists.')
  if (team.personal) throw new TeamError('Your personal team can’t be deleted.')
  // Cascades to the team's canvases, members, invites and agent grants.
  await db().delete(teams).where(eq(teams.id, teamId))
  forgetTeam(teamId)
}

async function ownerCount(teamId: string, except?: string) {
  const [row] = await db().select({ owners: count() }).from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'owner'), except ? ne(teamMembers.userId, except) : undefined))
  return Number(row?.owners ?? 0)
}

export async function leaveTeam(userId: string, teamId: string) {
  const role = await teamRole(userId, teamId)
  if (!role) return
  const [team] = await db().select({ personal: teams.personal, createdBy: teams.createdBy }).from(teams).where(eq(teams.id, teamId)).limit(1)
  if (team?.personal && team.createdBy === userId) throw new TeamError('You can’t leave your personal team.')
  const [others] = await db().select({ members: count() }).from(teamMembers).where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.userId, userId)))
  if (role === 'owner' && Number(others?.members ?? 0) > 0 && await ownerCount(teamId, userId) === 0) {
    throw new TeamError('Make someone else an owner before you leave.')
  }
  if (Number(others?.members ?? 0) === 0 && !team?.personal) {
    await db().delete(teams).where(eq(teams.id, teamId))
    forgetTeam(teamId)
    return
  }
  await db().delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
  memberships.delete(membershipKey(userId, teamId))
}

export async function removeMember(userId: string, teamId: string, memberId: string) {
  if (memberId === userId) return leaveTeam(userId, teamId)
  await requireOwner(userId, teamId)
  const [team] = await db().select({ createdBy: teams.createdBy, personal: teams.personal }).from(teams).where(eq(teams.id, teamId)).limit(1)
  if (team?.personal && team.createdBy === memberId) throw new TeamError('The person whose personal team this is can’t be removed.')
  await db().delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, memberId)))
  memberships.delete(membershipKey(memberId, teamId))
}

export async function setMemberRole(userId: string, teamId: string, memberId: string, role: TeamRole) {
  await requireOwner(userId, teamId)
  if (role === 'member' && await ownerCount(teamId, memberId) === 0) throw new TeamError('A team needs at least one owner.')
  const [team] = await db().select({ createdBy: teams.createdBy, personal: teams.personal }).from(teams).where(eq(teams.id, teamId)).limit(1)
  if (role === 'member' && team?.personal && team.createdBy === memberId) throw new TeamError('The person whose personal team this is stays an owner.')
  await db().update(teamMembers).set({ role }).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, memberId)))
  memberships.delete(membershipKey(memberId, teamId))
}

/** A fresh invite link for the team; earlier links stop working. Returns the secret for the URL. */
export async function resetInvite(userId: string, teamId: string) {
  await requireOwner(userId, teamId)
  const token = randomBytes(24).toString('base64url')
  await db().transaction(async (tx) => {
    await tx.delete(teamInvites).where(eq(teamInvites.teamId, teamId))
    await tx.insert(teamInvites).values({ tokenHash: hash(token), teamId, createdBy: userId, expiresAt: new Date(Date.now() + INVITE_MS) })
  })
  return token
}

export const inviteToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value)

export async function inviteDetails(token: string) {
  if (!inviteToken(token)) return
  const [row] = await db().select({ teamId: teams.id, name: teams.name, expiresAt: teamInvites.expiresAt })
    .from(teamInvites).innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .where(and(eq(teamInvites.tokenHash, hash(token)), gt(teamInvites.expiresAt, new Date()))).limit(1)
  return row
}

export async function acceptInvite(userId: string, token: string) {
  const invite = await inviteDetails(token)
  if (!invite) throw new TeamError('This invite link has expired or was reset. Ask for a new one.')
  await db().insert(teamMembers).values({ teamId: invite.teamId, userId, role: 'member' })
    .onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.userId] })
  await db().delete(teamInvites).where(lt(teamInvites.expiresAt, new Date()))
  memberships.delete(membershipKey(userId, invite.teamId))
  return invite.teamId
}

export async function teamById(teamId: string) {
  const [row] = await db().select({ id: teams.id, name: teams.name, personal: teams.personal }).from(teams).where(eq(teams.id, teamId)).limit(1)
  return row
}


/** The team a request works in and the person making it, when that person is still a member. */
export async function requestMember(headers: Headers) {
  const team = headers.get(WORKSPACE_HEADER)
  if (!workspaceId(team)) return null
  const user = headers.get(USER_HEADER) ?? team
  const role = await teamRole(user, team)
  return role ? { team, user, role } : null
}
