import { createServer } from 'node:http'
import { sendJson } from './http.mjs'

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
} = {}) {
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
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    timer.unref()
    const cancel = () => {
      if (!response.writableEnded) controller.abort()
    }
    request.once('aborted', cancel)
    response.once('close', cancel)

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
      const upstream = await fetchImpl(upstreamUrl, {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      })
      if (!upstream.ok) {
        const status =
          [400, 401, 403, 429].includes(upstream.status) ||
          (movieRoute && upstream.status === 404)
            ? upstream.status
            : 502
        const messages = {
          400: 'TMDB không chấp nhận yêu cầu dữ liệu phim này.',
          401: 'Thông tin kết nối TMDB chưa hợp lệ. Kiểm tra token trên server.',
          403: 'TMDB từ chối quyền truy cập dữ liệu.',
          404: 'Không tìm thấy phim trên TMDB.',
          429: 'TMDB đang giới hạn lượt truy cập. Vui lòng đợi một lát rồi thử lại.',
        }
        const retryAfter = upstream.headers.get('retry-after')
        const headers =
          status === 429 && retryAfter && /^\d+$/.test(retryAfter)
            ? { 'Retry-After': retryAfter }
            : {}
        sendJson(
          response,
          status,
          {
            error: {
              code: `TMDB_HTTP_${upstream.status}`,
              message:
                messages[status] ?? 'TMDB tạm thời không thể cung cấp dữ liệu.',
            },
          },
          headers,
        )
        return
      }
      const data = await upstream.json()
      const field =
        upstreamPath === '/3/genre/movie/list' ? 'genres' : 'results'
      const valid =
        data &&
        typeof data === 'object' &&
        (isDetails
          ? data.id === Number(movieRoute[1]) &&
            Array.isArray(data.genres) &&
            Array.isArray(data.videos?.results) &&
            Array.isArray(data.recommendations?.results)
          : Array.isArray(data[field]))
      if (!valid) {
        sendJson(response, 502, {
          error: {
            code: 'INVALID_UPSTREAM_DATA',
            message: 'TMDB trả về dữ liệu không hợp lệ.',
          },
        })
        return
      }
      sendJson(response, 200, data)
    } catch {
      if (response.destroyed) return
      const code = timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE'
      const message = timedOut
        ? 'TMDB phản hồi quá lâu. Vui lòng thử lại.'
        : 'Không thể kết nối hoặc đọc dữ liệu TMDB. Vui lòng thử lại.'
      // Không trả lỗi thô, headers hoặc token về trình duyệt hay log.
      sendJson(response, timedOut ? 504 : 502, { error: { code, message } })
    } finally {
      clearTimeout(timer)
      request.off('aborted', cancel)
      response.off('close', cancel)
    }
  }
}

// Giữ factory hiện có cho các test TMDB; app server ghép cùng Register handler.
export function createProxyServer(options) {
  return createServer(createProxyHandler(options))
}
