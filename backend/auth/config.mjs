export function readAuthConfig(env = process.env) {
  if (
    env.NODE_ENV !== undefined &&
    !['development', 'test', 'production'].includes(env.NODE_ENV)
  )
    throw new Error(
      'NODE_ENV phải là development, test hoặc production; không tự suy đoán môi trường.',
    )
  const production = env.NODE_ENV === 'production'
  const raw =
    env.AUTH_ALLOWED_ORIGINS ??
    (production ? '' : 'http://localhost:5173,http://127.0.0.1:5173')
  const origins = raw.split(',').map((value) => value.trim())
  if (
    !raw ||
    origins.length > 20 ||
    origins.some((origin) => {
      try {
        const url = new URL(origin)
        return (
          url.origin !== origin ||
          !['http:', 'https:'].includes(url.protocol) ||
          (production && url.protocol !== 'https:') ||
          url.username ||
          url.password
        )
      } catch {
        return true
      }
    })
  )
    throw new Error(
      'AUTH_ALLOWED_ORIGINS phải là danh sách origin cụ thể; production bắt buộc HTTPS. Không chấp nhận wildcard/null/path.',
    )
  return {
    production,
    allowedOrigins: new Set(origins),
    cookieName: production ? '__Host-cineverse_session' : 'cineverse_session',
    ttlSeconds: 7 * 24 * 60 * 60,
    maxSessions: 5,
  }
}
