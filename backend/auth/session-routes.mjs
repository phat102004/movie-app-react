import { readJsonBody, sendJson, HttpError } from '../http.mjs'
import { readSessionToken, sessionCookie } from './cookies.mjs'
import { createLoginLimiter } from './login-rate-limit.mjs'
import { validateLogin } from './validation.mjs'
import { assertAccountBinding } from './account-binding.mjs'

function rateError(response, result) {
  if (result.allowed) return false
  sendJson(
    response,
    429,
    {
      error: {
        code: 'RATE_LIMITED',
        message: 'Quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau.',
      },
    },
    { 'Retry-After': String(result.retryAfter), Connection: 'close' },
  )
  return true
}

export function createSessionHandlers({
  config,
  sessions,
  login,
  limiter = createLoginLimiter(),
  maxConcurrent = 2,
} = {}) {
  let active = 0
  return {
    async login(request, response) {
      if (
        rateError(
          response,
          limiter.takeIp(request.socket.remoteAddress ?? 'unknown'),
        )
      ) {
        request.resume()
        return
      }
      const input = validateLogin(await readJsonBody(request))
      if (rateError(response, limiter.takeAccount(input.email))) return
      if (request.aborted || response.destroyed) return
      if (active >= maxConcurrent) {
        sendJson(
          response,
          429,
          {
            error: {
              code: 'AUTH_BUSY',
              message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
            },
          },
          { 'Retry-After': '1' },
        )
        return
      }
      active++
      try {
        const result = await login(input)
        sendJson(
          response,
          200,
          { user: result.user },
          { 'Set-Cookie': sessionCookie(result.token, config) },
        )
      } finally {
        active--
      }
    },
    async me(request, response) {
      const user = await sessions.currentUser(
        readSessionToken(request.headers.cookie, config),
      )
      sendJson(response, 200, { user })
    },
    async logout(request, response) {
      const input = await readJsonBody(request)
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'Logout yêu cầu JSON object, ví dụ {}.',
        )
      const token = readSessionToken(request.headers.cookie, config)
      if (token) {
        try {
          assertAccountBinding(request, await sessions.currentUser(token))
        } catch (error) {
          // Revoking a missing/expired session remains idempotent. A valid session
          // belonging to a different account MUST NOT be revoked or clear its cookie.
          if (!(error instanceof HttpError && error.status === 401)) throw error
        }
      }
      await sessions.revoke(token)
      response.writeHead(204, {
        'Set-Cookie': sessionCookie('', config, true),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end()
    },
  }
}
