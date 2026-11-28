import { canvasReturnPath } from '../auth-access'
import { endStaleSession, recoverTeam } from '@/app/teams/actions'

const RECOVERED = 'zeko.team-recovered-at'

/**
 * Handle a response that means the session can't be used here: send the person to sign in, or, when they are
 * no longer in the team they had open, open another of their teams and go to its canvases.
 */
export async function returnToSignIn(response: Response) {
  if (response.status !== 401 && response.status !== 403) return false
  const result = await response.clone().json().catch(() => null) as { code?: string } | null
  if (response.status === 403) {
    if (result?.code !== 'team_access') return false
    // Recovering twice within a short while means it didn't take; end the session rather than reload forever.
    const last = Number(sessionStorage.getItem(RECOVERED) ?? 0)
    const repeat = Date.now() - last < 15_000
    sessionStorage.setItem(RECOVERED, String(Date.now()))
    const next = repeat ? await endStaleSession() : await recoverTeam().catch(() => '/' as const)
    // A full load: the session now names another team (or none), and every list must start fresh.
    window.location.assign(next)
    return true
  }
  if (result?.code !== 'sign_in_required') return false

  const next = canvasReturnPath(window.location.pathname + window.location.search)
  window.location.assign(next === '/' ? '/login' : `/login?${new URLSearchParams({ next })}`)
  return true
}
