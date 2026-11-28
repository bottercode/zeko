'use server'

import { headers } from 'next/headers'
import { signOut, updateSession } from '@/auth'
import { googleAuthConfigured, USER_HEADER, workspaceId, WORKSPACE_HEADER } from '@/lib/auth-access'
import {
  acceptInvite, activeTeamFor, createTeam, deleteTeam, leaveTeam, listTeams, removeMember, renameTeam, resetInvite,
  setMemberRole, teamById, TeamError, teamMembersOf, teamRole, type TeamMember, type TeamRole, type TeamSummary,
} from '@/lib/server/teams'

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string }

async function person() {
  if (!googleAuthConfigured()) throw new TeamError('Teams need Zeko’s hosted sign-in.')
  const list = await headers()
  const user = list.get(USER_HEADER)
  if (!workspaceId(user)) throw new TeamError('Sign in to Zeko.')
  const team = list.get(WORKSPACE_HEADER)
  return { user, team: workspaceId(team) ? team : undefined }
}

async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof TeamError) return { ok: false, error: error.message }
    console.error('Zeko team action failed.', error)
    return { ok: false, error: 'Something went wrong. Try again.' }
  }
}

/** Open a team: the session's workspace becomes that team, and sign-in reopens it next time. */
async function open(user: string, team: string) {
  if (!await teamRole(user, team)) throw new TeamError('You’re not in that team.')
  await updateSession({ team } as Parameters<typeof updateSession>[0])
}

export interface TeamsState { teams: TeamSummary[]; current: string }

export async function teamsState(): Promise<Result<TeamsState>> {
  return attempt(async () => {
    const { user, team } = await person()
    const teams = await listTeams(user)
    return { teams, current: team && teams.some((item) => item.id === team) ? team : user }
  })
}

export async function switchTeam(team: string) {
  return attempt(async () => {
    const { user } = await person()
    await open(user, team)
    return null
  })
}

export async function createTeamAction(name: string) {
  return attempt(async () => {
    const { user } = await person()
    const team = await createTeam(user, name)
    await open(user, team)
    return team
  })
}

/** yours: the open team is your own personal team, which you can't leave or delete. */
export interface TeamDetails { id: string; name: string; personal: boolean; yours: boolean; role: TeamRole; members: TeamMember[] }

export async function teamDetails(team: string): Promise<Result<TeamDetails>> {
  return attempt(async () => {
    const { user } = await person()
    const role = await teamRole(user, team)
    const found = role ? await teamById(team) : undefined
    if (!role || !found) throw new TeamError('You’re not in that team.')
    return { ...found, yours: found.personal && found.id === user, role, members: await teamMembersOf(user, team) }
  })
}

export async function renameTeamAction(team: string, name: string) {
  return attempt(async () => {
    const { user } = await person()
    await renameTeam(user, team, name)
    return null
  })
}

/** After leaving or deleting the open team, open another one so the session never points at a team you're not in. */
async function reopenIfCurrent(user: string, current: string | undefined, gone: string) {
  if (current === gone) await open(user, await activeTeamFor(user))
}

export async function deleteTeamAction(team: string) {
  return attempt(async () => {
    const { user, team: current } = await person()
    await deleteTeam(user, team)
    await reopenIfCurrent(user, current, team)
    return null
  })
}

export async function leaveTeamAction(team: string) {
  return attempt(async () => {
    const { user, team: current } = await person()
    await leaveTeam(user, team)
    await reopenIfCurrent(user, current, team)
    return null
  })
}

export async function removeMemberAction(team: string, member: string) {
  return attempt(async () => {
    const { user } = await person()
    await removeMember(user, team, member)
    return null
  })
}

export async function setRoleAction(team: string, member: string, role: TeamRole) {
  return attempt(async () => {
    if (role !== 'owner' && role !== 'member') throw new TeamError('Choose owner or member.')
    const { user } = await person()
    await setMemberRole(user, team, member, role)
    return null
  })
}

/** A new invite link; the previous one stops working. */
export async function resetInviteAction(team: string) {
  return attempt(async () => {
    const { user } = await person()
    const token = await resetInvite(user, team)
    return `/join/${token}`
  })
}

export async function acceptInviteAction(token: string) {
  return attempt(async () => {
    const { user } = await person()
    const team = await acceptInvite(user, token)
    await open(user, team)
    return team
  })
}

/** End a session that can't open any team, so the person signs in afresh. */
export async function endStaleSession(): Promise<'/login'> {
  await signOut({ redirect: false })
  return '/login'
}

/**
 * When the open team is gone (removed or deleted by someone else), open the person's last or personal team, and
 * say where to go next. A session whose account no longer exists has no team to open: end it, so they sign in again.
 */
export async function recoverTeam(): Promise<'/' | '/login'> {
  try {
    const { user } = await person()
    await open(user, await activeTeamFor(user))
    return '/'
  } catch (error) {
    if (!(error instanceof TeamError)) {
      console.error('Zeko could not reopen a team.', error)
      return '/'
    }
    await signOut({ redirect: false })
    return '/login'
  }
}
