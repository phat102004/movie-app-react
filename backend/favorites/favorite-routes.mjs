import { HttpError, readJsonBody, sendJson } from '../http.mjs'
import { readSessionToken } from '../auth/cookies.mjs'
import { assertAuthRequest } from '../auth/security.mjs'
import { assertAccountBinding } from '../auth/account-binding.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import {
  parseFavoriteMovieId,
  parseFavoriteQuery,
  validateFavoriteInput,
} from './validation.mjs'

export function createFavoriteHandler({
  config,
  sessions,
  service,
  ipLimiter = createRegisterLimiter({ limit: 300 }),
  userLimiter = createRegisterLimiter({ limit: 120 }),
} = {}) {
  const checkLimit = (response, result) => {
    if (result.allowed) return
    response.setHeader('Retry-After', String(result.retryAfter))
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Quá nhiều yêu cầu Favorites. Vui lòng thử lại sau.',
    )
  }
  return async (request, response, url) => {
    const collection = url.pathname === '/api/favorites'
    const item = /^\/api\/favorites\/([^/]+)$/.exec(url.pathname)
    if (!collection && !item)
      throw new HttpError(404, 'NOT_FOUND', 'Endpoint không được hỗ trợ.')
    const methods = collection ? ['GET', 'POST'] : ['DELETE']
    if (!methods.includes(request.method)) {
      response.setHeader('Allow', methods.join(', '))
      throw new HttpError(
        405,
        'METHOD_NOT_ALLOWED',
        `Chỉ hỗ trợ ${methods.join(', ')}.`,
      )
    }
    assertAuthRequest(request, config)
    checkLimit(response, ipLimiter(request.socket.remoteAddress ?? 'unknown'))
    const token = readSessionToken(request.headers.cookie, config)
    const user = await sessions.currentUser(token)
    assertAccountBinding(request, user)
    if (request.method !== 'GET') checkLimit(response, userLimiter(user.id))
    if (request.method !== 'GET' && url.search)
      throw new HttpError(
        400,
        'INVALID_QUERY',
        'Không nhận query parameters cho thao tác thay đổi Favorites.',
      )
    if (
      request.method !== 'POST' &&
      (request.headers['transfer-encoding'] !== undefined ||
        Number(request.headers['content-length'] ?? 0) !== 0)
    )
      throw new HttpError(
        400,
        'BODY_NOT_ALLOWED',
        'GET và DELETE Favorites không nhận request body.',
      )
    if (request.method === 'GET') {
      sendJson(
        response,
        200,
        await service.list(user.id, parseFavoriteQuery(url.searchParams)),
      )
    } else if (request.method === 'POST') {
      const movieId = validateFavoriteInput(await readJsonBody(request))
      if (request.aborted || response.destroyed) return
      // Đọc body có thể mất nhiều giây: không dùng session đã logout/hết hạn trong lúc chờ.
      await sessions.currentUser(token)
      const result = await service.add(user.id, movieId)
      sendJson(response, result.status, { favorite: result.favorite })
    } else {
      const movieId = parseFavoriteMovieId(item[1])
      await service.remove(user.id, movieId)
      response.writeHead(204, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end()
    }
  }
}
