import { canvasReturnPath } from '../auth-access'
import { recoverTeam } from '@/app/teams/actions'

/**
 * Handle a response that means the session can't be used here: send the person to sign in, or, when they are
 * no longer in the team they had open, open another of their teams and go to its canvases.
 */
export async function returnToSignIn(response: Response) {
  if (response.status !== 401 && response.status !== 403) return false
  const result = await response.clone().json().catch(() => null) as { code?: string } | null
  if (response.status === 403) {
    if (result?.code !== 'team_access') return false
    await recoverTeam().catch(() => undefined)
    // A full load: the session now names another team, and every list must start fresh.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/')
    return true
  }
  if (result?.code !== 'sign_in_required') return false

  const next = canvasReturnPath(window.location.pathname + window.location.search)
  window.location.assign(next === '/' ? '/login' : `/login?${new URLSearchParams({ next })}`)
  return true
}
