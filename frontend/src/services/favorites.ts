import type {
  Favorite,
  FavoritePage,
  FavoritesApi,
} from '../types/favorites.ts'
import { isValidMovieId } from '../utils/movieId.ts'
import { sessionRequestInit } from './sessionHttp.ts'

export class FavoritesApiError extends Error {
  status: number | null
  code: string
  retryAfter: number | null

  constructor(
    message: string,
    status: number | null = null,
    code = 'NETWORK_ERROR',
    retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'FavoritesApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = () =>
  new FavoritesApiError(
    'Dữ liệu yêu thích chưa hợp lệ. Vui lòng thử lại.',
    null,
    'INVALID_RESPONSE',
  )

export function parseFavorite(value: unknown): Favorite {
  if (
    !isRecord(value) ||
    typeof value.movieId !== 'number' ||
    !isValidMovieId(String(value.movieId)) ||
    typeof value.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  )
    throw invalid()
  return { movieId: value.movieId, createdAt: value.createdAt }
}

export function parseFavoritePage(value: unknown): FavoritePage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.favorites) ||
    value.favorites.length > 100 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === 'string' &&
        /^[A-Za-z0-9_-]{1,256}$/.test(value.nextCursor))
    )
  )
    throw invalid()
  const favorites = value.favorites.map(parseFavorite)
  if (value.nextCursor !== null && favorites.length === 0) throw invalid()
  return { favorites, nextCursor: value.nextCursor }
}

async function request(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  signal?: AbortSignal,
  body?: unknown,
): Promise<unknown> {
  try {
    const response = await fetch(path, sessionRequestInit(method, signal, body))
    if (method === 'DELETE' && response.status === 204) return null
    const payload: unknown = await response.json().catch(() => null)
    if (signal?.aborted) throw signal.reason
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: 'Yêu cầu yêu thích chưa hợp lệ. Hãy tải lại danh sách.',
        401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        403: 'Yêu cầu chưa được chấp nhận. Hãy tải lại trang.',
        409: 'Danh sách vừa thay đổi. Vui lòng thử lại.',
        429: 'Bạn thao tác quá nhanh. Vui lòng đợi rồi thử lại.',
        500: 'Chưa thể cập nhật danh sách yêu thích. Vui lòng thử lại sau.',
        503: 'Dịch vụ yêu thích tạm thời chưa sẵn sàng. Vui lòng thử lại sau.',
      }
      const error =
        isRecord(payload) && isRecord(payload.error) ? payload.error : null
      const code =
        typeof error?.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code)
          ? error.code
          : 'HTTP_ERROR'
      const retry = response.headers.get('retry-after') ?? ''
      throw new FavoritesApiError(
        messages[response.status] ?? 'Không thể hoàn tất yêu cầu yêu thích.',
        response.status,
        code,
        /^\d+$/.test(retry) && Number(retry) <= 86400 ? Number(retry) : null,
      )
    }
    if (
      method === 'DELETE' ||
      (method === 'GET'
        ? response.status !== 200
        : ![200, 201].includes(response.status))
    )
      throw invalid()
    return payload
  } catch (cause) {
    if (signal?.aborted || cause instanceof FavoritesApiError) throw cause
    throw new FavoritesApiError(
      'Không thể kết nối máy chủ yêu thích. Vui lòng thử lại.',
    )
  }
}

function validateId(id: number) {
  if (typeof id !== 'number' || !isValidMovieId(String(id)))
    throw new FavoritesApiError(
      'ID phim không hợp lệ.',
      400,
      'INVALID_MOVIE_ID',
    )
}

export const favoritesService: FavoritesApi = {
  async listAll(signal) {
    const rows = new Map<number, Favorite>()
    const seen = new Set<string>()
    let cursor: string | null = null
    // Tối đa 100 trang/10.000 mục. Nếu vượt giới hạn, báo lỗi thay vì trả danh sách thiếu.
    for (let page = 0; page < 100; page++) {
      signal?.throwIfAborted()
      const payload = parseFavoritePage(
        await request(
          `/api/favorites${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
          'GET',
          signal,
        ),
      )
      for (const row of payload.favorites) rows.set(row.movieId, row)
      if (payload.nextCursor === null) return [...rows.values()]
      if (seen.has(payload.nextCursor)) throw invalid()
      seen.add(payload.nextCursor)
      cursor = payload.nextCursor
    }
    throw new FavoritesApiError(
      'Danh sách vượt giới hạn tải an toàn (10.000 phim). Chưa thể xác định đầy đủ trạng thái yêu thích.',
      null,
      'PAGINATION_LIMIT',
    )
  },
  async add(movieId, signal) {
    validateId(movieId)
    const payload = await request('/api/favorites', 'POST', signal, { movieId })
    if (!isRecord(payload)) throw invalid()
    const favorite = parseFavorite(payload.favorite)
    if (favorite.movieId !== movieId) throw invalid()
    return favorite
  },
  async remove(movieId, signal) {
    validateId(movieId)
    await request(`/api/favorites/${movieId}`, 'DELETE', signal)
  },
}

export const asFavoritesError = (error: unknown) =>
  error instanceof FavoritesApiError
    ? error
    : new FavoritesApiError(
        'Không thể hoàn tất yêu cầu yêu thích. Vui lòng thử lại.',
      )
