import type { Profile, ProfileApi } from '../types/profile.ts'
import { parseAuthUser } from './auth.ts'
import { sessionRequestInit } from './sessionHttp.ts'
import { validateProfileName } from '../utils/profileForm.ts'

export class ProfileApiError extends Error {
  status: number | null
  code: string
  retryAfter: number | null
  fields: { name?: string }
  constructor(
    message: string,
    status: number | null = null,
    code = 'NETWORK_ERROR',
    fields: { name?: string } = {},
    retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'ProfileApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
  }
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = () =>
  new ProfileApiError(
    'Phản hồi hồ sơ chưa hợp lệ. Vui lòng thử lại.',
    null,
    'INVALID_RESPONSE',
  )

export function parseProfile(payload: unknown): Profile {
  const profile = isRecord(payload) ? payload.profile : null
  if (
    !isRecord(profile) ||
    !Number.isSafeInteger(profile.favoriteCount) ||
    (profile.favoriteCount as number) < 0 ||
    validateProfileName(profile.name).error
  )
    throw invalid()
  try {
    const user = parseAuthUser({ user: profile })
    if (new Date(user.createdAt).toISOString() !== user.createdAt)
      throw invalid()
    return { ...user, favoriteCount: profile.favoriteCount as number }
  } catch {
    throw invalid()
  }
}

async function request(
  method: 'GET' | 'PATCH',
  signal?: AbortSignal,
  body?: { name: string },
) {
  try {
    const response = await fetch(
      '/api/profile',
      sessionRequestInit(method, signal, body),
    )
    const payload: unknown = await response.json().catch(() => null)
    if (signal?.aborted) throw signal.reason
    if (!response.ok) {
      const error =
        isRecord(payload) && isRecord(payload.error) ? payload.error : null
      const code =
        typeof error?.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code)
          ? error.code
          : 'HTTP_ERROR'
      const messages: Record<number, string> = {
        400: 'Vui lòng kiểm tra tên hiển thị.',
        401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        403: 'Yêu cầu chưa được chấp nhận. Hãy tải lại trang và thử lại.',
        429: 'Bạn cập nhật quá nhanh. Vui lòng đợi rồi thử lại.',
        500: 'Chưa thể xử lý hồ sơ. Vui lòng thử lại sau.',
        503: 'Dịch vụ hồ sơ tạm thời chưa sẵn sàng. Vui lòng thử lại sau.',
      }
      const fields =
        response.status === 400 &&
        isRecord(error?.fields) &&
        typeof error.fields.name === 'string'
          ? {
              name: 'Tên phải có từ 1 đến 100 ký tự, không chứa ký tự điều khiển.',
            }
          : {}
      const retry = response.headers.get('retry-after') ?? ''
      throw new ProfileApiError(
        messages[response.status] ?? 'Không thể hoàn tất yêu cầu hồ sơ.',
        response.status,
        code,
        fields,
        /^\d+$/.test(retry) && Number(retry) <= 86400 ? Number(retry) : null,
      )
    }
    if (response.status !== 200) throw invalid()
    return parseProfile(payload)
  } catch (cause) {
    if (signal?.aborted || cause instanceof ProfileApiError) throw cause
    throw new ProfileApiError(
      'Không thể kết nối máy chủ hồ sơ. Vui lòng kiểm tra mạng và thử lại.',
    )
  }
}

export const profileService: ProfileApi = {
  get: (signal) => request('GET', signal),
  async update(value, signal) {
    const { name, error } = validateProfileName(value)
    if (error)
      throw new ProfileApiError(error, 400, 'VALIDATION_ERROR', { name: error })
    const profile = await request('PATCH', signal, { name })
    if (profile.name !== name) throw invalid()
    return profile
  },
}
export const asProfileError = (cause: unknown) =>
  cause instanceof ProfileApiError
    ? cause
    : new ProfileApiError('Không thể hoàn tất yêu cầu hồ sơ. Vui lòng thử lại.')
