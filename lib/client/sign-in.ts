import { canvasReturnPath } from '../auth-access'

export async function returnToSignIn(response: Response) {
  if (response.status !== 401) return false
  const result = await response.clone().json().catch(() => null) as { code?: string } | null
  if (result?.code !== 'sign_in_required') return false

  const next = canvasReturnPath(window.location.pathname + window.location.search)
  window.location.assign(next === '/' ? '/login' : `/login?${new URLSearchParams({ next })}`)
  return true
}
