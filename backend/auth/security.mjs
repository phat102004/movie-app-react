import { HttpError } from '../http.mjs'

// JSON + custom header yêu cầu CORS preflight nếu browser gọi cross-origin.
// Backend không cấp CORS: frontend dùng /api qua Vite/reverse proxy cùng origin.
export function assertAuthRequest(request, config) {
  const origin = request.headers.origin
  const fetchSite = request.headers['sec-fetch-site']
  if (
    (origin !== undefined && !config.allowedOrigins.has(origin)) ||
    fetchSite === 'cross-site'
  ) {
    throw new HttpError(
      403,
      'ORIGIN_FORBIDDEN',
      'Nguồn yêu cầu không được cho phép.',
    )
  }
  if (
    ['POST', 'DELETE'].includes(request.method) &&
    (request.headers['x-cineverse-csrf'] !== '1' ||
      (origin === undefined && fetchSite && fetchSite !== 'none'))
  )
    throw new HttpError(
      403,
      'CSRF_REJECTED',
      'Yêu cầu thiếu thông tin bảo vệ CSRF hợp lệ.',
    )
}
