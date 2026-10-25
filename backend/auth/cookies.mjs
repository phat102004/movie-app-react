export function readSessionToken(cookieHeader, config) {
  if (typeof cookieHeader !== 'string') return null
  const matches = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf('=')) === config.cookieName)
  if (matches.length !== 1) return null
  const token = matches[0].slice(config.cookieName.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}

export function sessionCookie(token, config, clear = false) {
  return [
    `${config.cookieName}=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : config.ttlSeconds}`,
    ...(clear ? ['Expires=Thu, 01 Jan 1970 00:00:00 GMT'] : []),
    ...(config.production ? ['Secure'] : []),
  ].join('; ')
}
