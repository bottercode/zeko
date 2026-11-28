'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Copy, LogOut, Plus, RefreshCw, Settings, Trash2, Users } from 'lucide-react'
import {
  createTeamAction, deleteTeamAction, leaveTeamAction, removeMemberAction, renameTeamAction, resetInviteAction,
  setRoleAction, switchTeam, teamDetails, teamsState, type TeamDetails, type TeamsState,
} from '@/app/teams/actions'
import type { TeamRole } from '@/lib/server/teams'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Field, FieldGroup, FieldLabel } from './ui/field'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { useToast } from './kit'

const initials = (value: string) => value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?'

/** Reload on the home page after the open team changes: the session and every list must start fresh for the new team. */
// eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point here
const reopen = () => window.location.assign('/')

function TeamMark({ name, size = 'size-6' }: { name: string; size?: string }) {
  return <span aria-hidden className={`grid ${size} shrink-0 place-items-center rounded-md bg-ink text-2xs font-semibold text-lightbox`}>{initials(name).slice(0, 1)}</span>
}

/** The team switcher at the top of the sidebar: every team you're in, a new team, and the open team's settings. */
export function TeamMenu() {
  const toast = useToast()
  const [state, setState] = useState<TeamsState | null>(null)
  const [creating, setCreating] = useState(false)
  const [settings, setSettings] = useState(false)

  useEffect(() => {
    let alive = true
    void teamsState().then((result) => {
      if (alive && result.ok) setState(result.value)
    })
    return () => { alive = false }
  }, [])

  if (!state) return <div className="mx-2 h-9 animate-pulse rounded-md bg-wash" aria-hidden />
  const current = state.teams.find((team) => team.id === state.current) ?? state.teams[0]
  if (!current) return null

  const open = async (id: string) => {
    if (id === state.current) return
    const result = await switchTeam(id)
    if (result.ok) reopen()
    else toast(result.error)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <button className="mx-2 flex h-9 w-[calc(100%-16px)] items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`Team: ${current.name}. Switch team`} />
        }>
          <TeamMark name={current.name} />
          <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
          <ChevronsUpDown size={14} className="shrink-0 text-mist" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Teams</DropdownMenuLabel>
            {state.teams.map((team) => (
              <DropdownMenuItem key={team.id} onClick={() => void open(team.id)}>
                <TeamMark name={team.name} size="size-5" />
                <span className="min-w-0 flex-1 truncate">{team.name}</span>
                {team.id === current.id && <Check aria-label="Open" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setSettings(true)}><Settings aria-hidden /> Team settings</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCreating(true)}><Plus aria-hidden /> Create team</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateTeamDialog open={creating} onOpenChange={setCreating} />
      {settings && <TeamSettingsDialog teamId={current.id} onClose={() => setSettings(false)} />}
    </>
  )
}

function CreateTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { setError(''); onOpenChange(next) } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a team</DialogTitle>
          <DialogDescription>A team shares its canvases and agents. You can invite people once it exists.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          const result = await createTeamAction(String(new FormData(event.currentTarget).get('name') ?? ''))
          if (result.ok) return reopen()
          setBusy(false)
          setError(result.error)
        }}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="team-name">Team name</FieldLabel>
              <Input id="team-name" name="name" placeholder="Design studio" maxLength={60} required autoFocus disabled={busy}
                aria-invalid={!!error} aria-describedby={error ? 'team-name-error' : undefined} />
              {error && <p id="team-name-error" className="text-sm text-destructive">{error}</p>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create team'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TeamSettingsDialog({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const toast = useToast()
  const [team, setTeam] = useState<TeamDetails | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'leave' | 'delete' | null>(null)

  const load = async () => {
    const result = await teamDetails(teamId)
    if (result.ok) setTeam(result.value)
    else setError(result.error)
  }
  useEffect(() => {
    let alive = true
    void teamDetails(teamId).then((result) => {
      if (!alive) return
      if (result.ok) setTeam(result.value)
      else setError(result.error)
    })
    return () => { alive = false }
  }, [teamId])

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>, after: () => unknown = load) => {
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (!result.ok) return toast(result.error)
    await after()
  }

  const owner = team?.role === 'owner'
  const inviteUrl = invite ? new URL(invite, window.location.origin).href : null
  const owners = team?.members.filter((member) => member.role === 'owner').length ?? 0

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Team settings</DialogTitle>
          <DialogDescription>
            {team?.yours ? 'Your personal team. You can’t leave or delete it; invite people to share its canvases.' : 'Everyone in the team can open and edit its canvases and connect agents to them.'}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!team && !error && <p role="status" className="text-sm text-muted-foreground">Loading the team…</p>}
        {team && (
          <div className="flex flex-col gap-6">
            <form className="flex items-end gap-2" onSubmit={(event) => {
              event.preventDefault()
              const name = String(new FormData(event.currentTarget).get('name') ?? '')
              void run(() => renameTeamAction(team.id, name), async () => { toast('Team renamed'); await load() })
            }}>
              <Field className="flex-1">
                <FieldLabel htmlFor="team-settings-name">Team name</FieldLabel>
                <Input id="team-settings-name" name="name" defaultValue={team.name} maxLength={60} required disabled={!owner || busy} />
              </Field>
              {owner && <Button type="submit" variant="outline" disabled={busy}>Save</Button>}
            </form>

            <section className="flex flex-col gap-2" aria-labelledby="team-members-heading">
              <h3 id="team-members-heading" className="flex items-center gap-2 text-sm font-medium"><Users size={14} aria-hidden /> Members <span className="text-muted-foreground">{team.members.length}</span></h3>
              <ul className="flex max-h-64 flex-col overflow-auto rounded-md border border-border">
                {team.members.map((member) => {
                  const label = member.name || member.email || 'Member'
                  const lastOwner = member.role === 'owner' && owners === 1
                  return (
                    <li key={member.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                      <Avatar size="sm">
                        {member.image && <AvatarImage src={member.image} alt="" />}
                        <AvatarFallback>{initials(label)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{label}{member.you && <span className="text-muted-foreground"> (you)</span>}</p>
                        {member.name && member.email && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
                      </div>
                      {owner && !member.you ? (
                        <select aria-label={`Role for ${label}`} value={member.role} disabled={busy}
                          className="h-8 rounded-md border border-border bg-transparent px-2 text-sm"
                          onChange={(event) => void run(() => setRoleAction(team.id, member.id, event.target.value as TeamRole))}>
                          <option value="owner">Owner</option>
                          <option value="member">Member</option>
                        </select>
                      ) : <span className="text-xs text-muted-foreground">{member.role === 'owner' ? 'Owner' : 'Member'}</span>}
                      {owner && !member.you && !lastOwner && !(team.personal && member.id === team.id) && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label} from the team`} disabled={busy}
                          onClick={() => void run(() => removeMemberAction(team.id, member.id))}>
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>

            {owner && (
              <section className="flex flex-col gap-2" aria-labelledby="team-invite-heading">
                <h3 id="team-invite-heading" className="text-sm font-medium">Invite people</h3>
                <p className="text-sm text-muted-foreground">Anyone who opens the link and signs in joins as a member. Links last 7 days; making a new one turns off the old one.</p>
                {inviteUrl ? (
                  <div className="flex gap-2">
                    <Input readOnly value={inviteUrl} aria-label="Invite link" onFocus={(event) => event.currentTarget.select()} />
                    <Button variant="outline" onClick={async () => {
                      try { await navigator.clipboard.writeText(inviteUrl); toast('Invite link copied') } catch { toast('Copy the link from the field.') }
                    }}><Copy data-icon="inline-start" aria-hidden /> Copy</Button>
                  </div>
                ) : null}
                <div>
                  <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
                    const result = await resetInviteAction(team.id)
                    if (result.ok) setInvite(result.value)
                    return result
                  }, () => undefined)}>
                    <RefreshCw data-icon="inline-start" aria-hidden /> {inviteUrl ? 'Make a new link' : 'Create invite link'}
                  </Button>
                </div>
              </section>
            )}

            {!team.yours && (
              <section className="flex flex-col gap-2 border-t border-border pt-4" aria-labelledby="team-danger-heading">
                <h3 id="team-danger-heading" className="text-sm font-medium">Leave or delete</h3>
                {confirming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 text-sm text-muted-foreground">
                      {confirming === 'delete' ? 'Delete this team and all of its canvases for everyone? This can’t be undone.' : 'Leave this team? You’ll lose access to its canvases.'}
                    </p>
                    <Button variant="outline" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
                    <Button variant="destructive" disabled={busy} onClick={() => void run(
                      () => confirming === 'delete' ? deleteTeamAction(team.id) : leaveTeamAction(team.id), reopen)}>
                      {confirming === 'delete' ? 'Delete team' : 'Leave team'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => setConfirming('leave')}><LogOut data-icon="inline-start" aria-hidden /> Leave team</Button>
                    {owner && !team.personal && <Button variant="outline" disabled={busy} className="text-destructive" onClick={() => setConfirming('delete')}><Trash2 data-icon="inline-start" aria-hidden /> Delete team</Button>}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
