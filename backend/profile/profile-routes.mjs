import { HttpError, readJsonBody, sendJson } from '../http.mjs'
import { readSessionToken } from '../auth/cookies.mjs'
import { assertAuthRequest } from '../auth/security.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import { validateProfileInput } from './validation.mjs'

export function createProfileHandler({
  config,
  sessions,
  service,
  ipLimiter = createRegisterLimiter({ limit: 300 }),
  userLimiter = createRegisterLimiter({ limit: 30 }),
} = {}) {
  function checkLimit(response, result) {
    if (result.allowed) return
    response.setHeader('Retry-After', String(result.retryAfter))
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Quá nhiều yêu cầu hồ sơ. Vui lòng thử lại sau.',
    )
  }
  return async (request, response, url) => {
    if (url.pathname !== '/api/profile')
      throw new HttpError(404, 'NOT_FOUND', 'Endpoint không được hỗ trợ.')
    if (!['GET', 'PATCH'].includes(request.method)) {
      response.setHeader('Allow', 'GET, PATCH')
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ GET, PATCH.')
    }
    assertAuthRequest(request, config)
    checkLimit(response, ipLimiter(request.socket.remoteAddress ?? 'unknown'))
    const token = readSessionToken(request.headers.cookie, config)
    const user = await sessions.currentUser(token)
    if (url.search)
      throw new HttpError(
        400,
        'INVALID_QUERY',
        'Profile không nhận query parameters hoặc User ID từ client.',
      )
    if (request.method === 'GET') {
      if (
        request.headers['transfer-encoding'] !== undefined ||
        Number(request.headers['content-length'] ?? 0) !== 0
      )
        throw new HttpError(
          400,
          'BODY_NOT_ALLOWED',
          'GET Profile không nhận request body.',
        )
      sendJson(response, 200, { profile: await service.get(user.id) })
      return
    }
    checkLimit(response, userLimiter(user.id))
    const { name } = validateProfileInput(await readJsonBody(request))
    if (request.aborted || response.destroyed) return
    // Body có thể gửi chậm; dùng lại verifier trước khi bắt đầu mutation.
    await sessions.currentUser(token)
    sendJson(response, 200, {
      profile: await service.update(user.id, token, name),
    })
  }
}
