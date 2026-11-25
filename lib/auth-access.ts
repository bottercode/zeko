export function googleAuthConfigured() {
  return Boolean(
    process.env.ZEKO_HOSTED === '1' &&
    process.env.AUTH_URL &&
    process.env.AUTH_SECRET &&
    process.env.AUTH_GOOGLE_ID &&
    process.env.AUTH_GOOGLE_SECRET &&
    process.env.ZEKO_ALLOWED_GOOGLE_EMAILS?.trim()
  )
}

export function allowedGoogleEmail(email: unknown) {
  if (typeof email !== 'string' || !email) return false
  const allowed = process.env.ZEKO_ALLOWED_GOOGLE_EMAILS?.split(',').map((value) => value.trim().toLowerCase())
  return allowed?.includes(email.toLowerCase()) ?? false
}

export function canvasReturnPath(value: unknown) {
  const base = 'https://zeko.invalid'
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\s]/.test(value) || value.length > 2048) return '/'
  try {
    const url = new URL(value, base)
    return url.origin === base && /^\/(?:c\/[\w-]+)?$/.test(url.pathname) ? url.pathname + url.search : '/'
  } catch {
    return '/'
  }
}
