import { HttpError, readJsonBody } from '../http.mjs'
import { readSessionToken, sessionCookie } from '../auth/cookies.mjs'
import { assertAuthRequest } from '../auth/security.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import { validatePasswordChange } from './change-password-service.mjs'

export function createChangePasswordHandler({
  config,
  sessions,
  service,
  ipLimiter = createRegisterLimiter({ limit: 10 }),
  userLimiter = createRegisterLimiter({ limit: 5 }),
  maxConcurrent = 2,
} = {}) {
  let active = 0
  function limit(response, result) {
    if (result.allowed) return
    response.setHeader('Retry-After', String(result.retryAfter))
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Quá nhiều yêu cầu đổi mật khẩu. Vui lòng thử lại sau.',
    )
  }
  return async (request, response, url) => {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ POST.')
    }
    assertAuthRequest(request, config)
    limit(response, ipLimiter(request.socket.remoteAddress ?? 'unknown'))
    const token = readSessionToken(request.headers.cookie, config)
    const user = await sessions.currentUser(token)
    if (url.search)
      throw new HttpError(
        400,
        'INVALID_QUERY',
        'Đổi mật khẩu không nhận query parameters.',
      )
    limit(response, userLimiter(user.id))
    const input = validatePasswordChange(await readJsonBody(request))
    if (request.aborted || response.destroyed) return
    await sessions.currentUser(token)
    if (active >= maxConcurrent) {
      response.setHeader('Retry-After', '1')
      throw new HttpError(
        429,
        'AUTH_BUSY',
        'Hệ thống đang bận. Vui lòng thử lại.',
      )
    }
    active++
    try {
      await service(user.id, token, input)
      if (response.destroyed || response.writableEnded) return
      response.writeHead(204, {
        'Set-Cookie': sessionCookie('', config, true),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end()
    } finally {
      active--
    }
  }
}
