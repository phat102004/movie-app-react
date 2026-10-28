import { socketClientIp } from '../client-ip.mjs'
import { createRegistrationService } from './register-service.mjs'
import { createRegisterLimiter } from './rate-limit.mjs'
import { readJsonBody, sendHttpError, sendJson } from '../http.mjs'

export function createRegisterHandler({
  registerUser = createRegistrationService(),
  getClientIp = socketClientIp,
  limiter = createRegisterLimiter(),
  maxConcurrent = 2,
  bodyTimeoutMs = 10_000,
} = {}) {
  let active = 0
  return async function handleRegister(request, response) {
    if (request.method !== 'POST') {
      request.resume()
      sendJson(
        response,
        405,
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'Chỉ hỗ trợ POST.' } },
        { Allow: 'POST', Connection: 'close' },
      )
      return
    }
    const rate = limiter(getClientIp(request))
    if (!rate.allowed) {
      request.resume()
      sendJson(
        response,
        429,
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau.',
          },
        },
        { 'Retry-After': String(rate.retryAfter), Connection: 'close' },
      )
      return
    }

    let acquired = false
    try {
      const input = await readJsonBody(request, { timeoutMs: bodyTimeoutMs })
      if (response.destroyed || request.aborted) return
      // Không tạo hàng đợi hash vô hạn; tối đa hai thao tác đăng ký cùng lúc.
      if (active >= maxConcurrent) {
        sendJson(
          response,
          429,
          {
            error: {
              code: 'REGISTRATION_BUSY',
              message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
            },
          },
          { 'Retry-After': '1' },
        )
        return
      }
      active++
      acquired = true
      const user = await registerUser(input)
      sendJson(response, 201, { user })
    } catch (error) {
      request.resume()
      sendHttpError(response, error)
    } finally {
      if (acquired) active--
    }
  }
}
