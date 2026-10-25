import { HttpError, readJsonBody, sendJson } from '../http.mjs'
import { createLoginLimiter } from './login-rate-limit.mjs'
import { createRegisterLimiter } from './rate-limit.mjs'
import { validateForgot, validateReset } from './password-reset-service.mjs'

export function createPasswordResetHandlers({
  service,
  forgotLimiter = createLoginLimiter({
    ip: createRegisterLimiter({ limit: 10 }),
    account: createRegisterLimiter({ limit: 3 }),
  }),
  resetLimiter = createRegisterLimiter({ limit: 20 }),
  maxConcurrent = 2,
} = {}) {
  let active = 0
  function check(response, limit) {
    if (limit.allowed) return
    response.setHeader('Retry-After', String(limit.retryAfter))
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
    )
  }
  const handler = (mode) => async (request, response) => {
    check(
      response,
      mode === 'forgot'
        ? forgotLimiter.takeIp(request.socket.remoteAddress ?? 'unknown')
        : resetLimiter(request.socket.remoteAddress ?? 'unknown'),
    )
    const input = (mode === 'forgot' ? validateForgot : validateReset)(
      await readJsonBody(request),
    )
    if (mode === 'forgot')
      check(response, forgotLimiter.takeAccount(input.email))
    if (request.aborted || response.destroyed) return
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
      sendJson(response, 200, await service[mode](input))
    } finally {
      active--
    }
  }
  return { forgot: handler('forgot'), reset: handler('reset') }
}
