import { HttpError } from './http.mjs'

export function tmdbRequestKey(input) {
  const url = new URL(input)
  if (
    url.origin !== 'https://api.themoviedb.org' ||
    url.username || url.password || url.hash ||
    ['api_key', 'access_token', 'request_token'].some((name) => url.searchParams.has(name))
  )
    throw new Error('Invalid internal TMDB resource URL')
  // Sort parameter names; preserve order of repeated values which may matter.
  url.searchParams.sort()
  return url.href
}

export async function fetchTmdbResource(
  url,
  { token, fetchImpl = fetch, signal, detailsId },
) {
  const upstream = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
    signal,
    // Do not forward the server credential to redirects or arbitrary origins.
    redirect: 'error',
  })
  if (!upstream.ok) {
    const status =
      [400, 401, 403, 429].includes(upstream.status) ||
      (url.pathname.startsWith('/3/movie/') && upstream.status === 404)
        ? upstream.status
        : 502
    const messages = {
      400: 'TMDB không chấp nhận yêu cầu dữ liệu phim này.',
      401: 'Thông tin kết nối TMDB chưa hợp lệ. Kiểm tra token trên server.',
      403: 'TMDB từ chối quyền truy cập dữ liệu.',
      404: 'Không tìm thấy phim trên TMDB.',
      429: 'TMDB đang giới hạn lượt truy cập. Vui lòng đợi một lát rồi thử lại.',
    }
    const error = new HttpError(
      status,
      `TMDB_HTTP_${upstream.status}`,
      messages[status] ?? 'TMDB tạm thời không thể cung cấp dữ liệu.',
    )
    const retryAfter = upstream.headers.get('retry-after')
    if (status === 429 && retryAfter && /^\d+$/.test(retryAfter))
      error.retryAfter = retryAfter
    // No error body is forwarded or retained, and the connection/body is released.
    try {
      await upstream.body?.cancel()
    } catch { /* Keep the safe HTTP error. */ }
    throw error
  }
  const data = await upstream.json()
  const field = url.pathname === '/3/genre/movie/list' ? 'genres' : 'results'
  const valid =
    data && typeof data === 'object' &&
    (detailsId !== undefined
      ? data.id === detailsId && Array.isArray(data.genres)
      : Array.isArray(data[field]))
  if (!valid)
    throw new HttpError(
      502, 'INVALID_UPSTREAM_DATA', 'TMDB trả về dữ liệu không hợp lệ.',
    )
  return data
}
