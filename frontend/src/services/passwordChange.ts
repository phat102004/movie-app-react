import { sessionRequestInit } from './sessionHttp.ts'
import type {
  PasswordChangeApi,
  PasswordChangeErrors,
} from '../types/passwordChange.ts'

export class PasswordChangeApiError extends Error {
  status: number | null
  code: string
  fields: PasswordChangeErrors
  retryAfter: number | null
  constructor(
    message: string,
    status: number | null = null,
    code = 'NETWORK_ERROR',
    fields: PasswordChangeErrors = {},
    retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'PasswordChangeApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
  }
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
export const passwordChangeService: PasswordChangeApi = {
  async change(input, signal, expectedAccount) {
    try {
      const response = await fetch(
        '/api/profile/change-password',
        sessionRequestInit(
          'POST', signal,
          { currentPassword: input.currentPassword, newPassword: input.newPassword },
          expectedAccount,
        ),
      )
      if (signal?.aborted) throw signal.reason
      if (response.status === 204) return
      const payload: unknown = await response.json().catch(() => null)
      if (signal?.aborted) throw signal.reason
      if (response.ok)
        throw new PasswordChangeApiError(
          'Phản hồi đổi mật khẩu chưa hợp lệ. Vui lòng kiểm tra lại phiên đăng nhập.',
          null,
          'INVALID_RESPONSE',
        )
      const error =
        isRecord(payload) && isRecord(payload.error) ? payload.error : null
      const code =
        typeof error?.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code)
          ? error.code
          : 'HTTP_ERROR'
      const messages: Record<number, string> = {
        400: 'Vui lòng kiểm tra thông tin mật khẩu.',
        401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        403: 'Yêu cầu chưa được chấp nhận. Hãy tải lại trang và thử lại.',
        429: 'Bạn đã thử quá nhiều lần. Vui lòng đợi rồi thử lại.',
        500: 'Chưa thể đổi mật khẩu. Vui lòng thử lại sau.',
        503: 'Dịch vụ tài khoản tạm thời chưa sẵn sàng. Vui lòng thử lại sau.',
      }
      const fields: PasswordChangeErrors = {}
      if (response.status === 400) {
        if (code === 'CURRENT_PASSWORD_INCORRECT')
          fields.currentPassword = 'Mật khẩu hiện tại không chính xác.'
        else if (code === 'PASSWORD_REUSED')
          fields.newPassword = 'Mật khẩu mới phải khác mật khẩu hiện tại.'
        else if (isRecord(error?.fields)) {
          if (typeof error.fields.currentPassword === 'string')
            fields.currentPassword = 'Vui lòng kiểm tra mật khẩu hiện tại.'
          if (typeof error.fields.newPassword === 'string')
            fields.newPassword = 'Mật khẩu mới phải có từ 12 đến 128 ký tự.'
        }
      }
      const retry = response.headers.get('retry-after') ?? ''
      throw new PasswordChangeApiError(
        messages[response.status] ?? 'Không thể hoàn tất yêu cầu đổi mật khẩu.',
        response.status,
        code,
        fields,
        /^\d+$/.test(retry) && Number(retry) <= 86400 ? Number(retry) : null,
      )
    } catch (cause) {
      if (signal?.aborted || cause instanceof PasswordChangeApiError)
        throw cause
      throw new PasswordChangeApiError(
        'Không thể kết nối máy chủ. Kết quả đổi mật khẩu chưa được xác nhận; hãy kiểm tra lại phiên đăng nhập.',
      )
    }
  },
}
export const asPasswordChangeError = (cause: unknown) =>
  cause instanceof PasswordChangeApiError
    ? cause
    : new PasswordChangeApiError(
        'Không thể hoàn tất yêu cầu đổi mật khẩu. Vui lòng thử lại.',
      )
