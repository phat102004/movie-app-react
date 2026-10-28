import { createServer } from 'node:http'
import { HttpError, sendJson } from './http.mjs'
import { createUpstreamScheduler } from './upstream-scheduler.mjs'
import { fetchTmdbResource, tmdbRequestKey } from './tmdb-client.mjs'

const routes = new Map([
  ['/api/movies/popular', '/3/movie/popular'],
  ['/api/movies/now_playing', '/3/movie/now_playing'],
  ['/api/movies/top_rated', '/3/movie/top_rated'],
  ['/api/genres', '/3/genre/movie/list'],
])

export function createProxyHandler({
  token = '',
  fetchImpl = fetch,
  timeoutMs = 8000,
  queueTimeoutMs = 2000,
  maxConcurrent = 6,
  maxQueue = 32,
  maxWaiters = 256,
} = {}) {
  const scheduler = createUpstreamScheduler({
    timeoutMs,
    queueTimeoutMs,
    maxConcurrent,
    maxQueue,
    maxWaiters,
  })
  return async (request, response) => {
    let url
    try {
      url = new URL(request.url ?? '/', 'http://localhost')
    } catch {
      sendJson(response, 400, {
        error: { code: 'BAD_REQUEST', message: 'Đường dẫn không hợp lệ.' },
      })
      return
    }
    const movieRoute =
      /^\/api\/movies\/([^/]+)(?:\/(videos|recommendations))?$/.exec(
        url.pathname,
      )
    let upstreamPath = routes.get(url.pathname)
    if (!upstreamPath && movieRoute && !url.search) {
      const id = movieRoute[1]
      if (!/^[1-9]\d*$/.test(id) || Number(id) > 2_147_483_647) {
        sendJson(response, 400, {
          error: {
            code: 'INVALID_MOVIE_ID',
            message: 'ID phim phải là số nguyên dương hợp lệ.',
          },
        })
        return
      }
      upstreamPath = `/3/movie/${id}${movieRoute[2] ? `/${movieRoute[2]}` : ''}`
    }
    if (!upstreamPath || url.search) {
      sendJson(response, 404, {
        error: { code: 'NOT_FOUND', message: 'Endpoint không được hỗ trợ.' },
      })
      return
    }
    if (request.method !== 'GET') {
      sendJson(
        response,
        405,
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'Chỉ hỗ trợ GET.' } },
        { Allow: 'GET' },
      )
      return
    }
    const isDetails = Boolean(
      movieRoute && !routes.has(url.pathname) && !movieRoute[2],
    )
    if (!token.trim() || token === 'your_tmdb_api_read_access_token_here') {
      sendJson(response, 503, {
        error: {
          code: 'TMDB_NOT_CONFIGURED',
          message:
            'Chưa cấu hình kết nối TMDB. Vui lòng thiết lập token trong backend/.env rồi khởi động lại proxy.',
        },
      })
      return
    }

    const controller = new AbortController()
    const cancel = () => {
      if (!response.writableEnded) controller.abort()
    }
    request.once('aborted', cancel)
    response.once('close', cancel)
    if (request.aborted || response.destroyed) controller.abort()

    try {
      const upstreamUrl = new URL(upstreamPath, 'https://api.themoviedb.org')
      upstreamUrl.searchParams.set('language', 'vi-VN')
      if (
        (routes.has(url.pathname) && upstreamPath.startsWith('/3/movie/')) ||
        movieRoute?.[2] === 'recommendations'
      )
        upstreamUrl.searchParams.set('page', '1')
      if (isDetails) {
        upstreamUrl.searchParams.set(
          'append_to_response',
          'videos,recommendations,credits',
        )
        upstreamUrl.searchParams.set('include_video_language', 'vi,en,null')
      }
      if (movieRoute?.[2] === 'videos')
        upstreamUrl.searchParams.set('include_video_language', 'vi,en,null')
      const data = await scheduler.run(
        tmdbRequestKey(upstreamUrl),
        (signal) => fetchTmdbResource(upstreamUrl, {
          token,
          fetchImpl,
          signal,
          detailsId: isDetails ? Number(movieRoute[1]) : undefined,
        }),
        { signal: controller.signal },
      )
      if (!controller.signal.aborted) sendJson(response, 200, data)
    } catch (error) {
      if (response.destroyed || controller.signal.aborted) return
      const known = error instanceof HttpError
      const status = known ? error.status : 502
      const headers = error?.retryAfter
        ? { 'Retry-After': error.retryAfter }
        : status === 503 ? { 'Retry-After': '1' } : {}
      sendJson(response, status, {
        error: {
          code: known ? error.code : 'UPSTREAM_UNAVAILABLE',
          message: known
            ? error.message
            : 'Không thể kết nối hoặc đọc dữ liệu TMDB. Vui lòng thử lại.',
        },
      }, headers)
    } finally {
      request.off('aborted', cancel)
      response.off('close', cancel)
    }
  }
}

// Giữ factory hiện có cho các test TMDB; app server ghép cùng Register handler.
export function createProxyServer(options) {
  return createServer(createProxyHandler(options))
}
