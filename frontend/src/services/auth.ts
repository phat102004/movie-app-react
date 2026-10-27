import type {
  AuthFieldErrors,
  AuthUser,
  LoginInput,
  RegisterInput,
} from '../types/auth.ts'
import { sessionRequestInit } from './sessionHttp.ts'

export class AuthApiError extends Error {
  status: number | null
  code: string
  fields: AuthFieldErrors
  retryAfter: number | null

  constructor(
    message: string,
    status: number | null = null,
    code = 'NETWORK_ERROR',
    fields: AuthFieldErrors = {},
    retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const invalidResponse = () =>
  new AuthApiError(
    'Phản hồi chưa hợp lệ. Vui lòng thử lại.',
    null,
    'INVALID_RESPONSE',
  )

export function parseAuthUser(payload: unknown): AuthUser {
  const user = isRecord(payload) ? payload.user : null
  if (
    !isRecord(user) ||
    typeof user.id !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(user.id) ||
    typeof user.name !== 'string' ||
    !user.name.trim() ||
    Array.from(user.name).length > 100 ||
    typeof user.email !== 'string' ||
    !user.email.includes('@') ||
    user.email.length > 254 ||
    typeof user.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(user.createdAt))
  )
    throw invalidResponse()
  // Chỉ lấy DTO được phép, không giữ các trường dư từ response trong React state.
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  }
}

function responseError(response: Response, payload: unknown, path: string) {
  const error =
    isRecord(payload) && isRecord(payload.error) ? payload.error : null
  const code =
    typeof error?.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code)
      ? error.code
      : 'HTTP_ERROR'
  const messages: Record<number, string> = {
    400: 'Vui lòng kiểm tra thông tin bạn đã nhập.',
    401: 'Email hoặc mật khẩu không chính xác.',
    403: 'Yêu cầu chưa được chấp nhận. Hãy tải lại trang và thử lại.',
    409: 'Email đã được sử dụng. Bạn có thể đăng nhập với email này.',
    413: 'Thông tin gửi lên quá dài. Vui lòng kiểm tra lại.',
    429: 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.',
  }
  const fields: AuthFieldErrors = {}
  if (response.status === 409) fields.email = 'Email này đã được sử dụng.'
  if (response.status === 400 && isRecord(error?.fields)) {
    const hints = {
      name: 'Tên cần có từ 1 đến 100 ký tự hợp lệ.',
      email: 'Vui lòng nhập email hợp lệ, tối đa 254 ký tự.',
      password: 'Vui lòng kiểm tra độ dài mật khẩu.',
    }
    for (const field of ['name', 'email', 'password'] as const)
      if (typeof error.fields[field] === 'string') fields[field] = hints[field]
  }
  const rawRetry = response.headers.get('retry-after') ?? ''
  const retryAfter =
    /^\d+$/.test(rawRetry) && Number(rawRetry) <= 86400
      ? Number(rawRetry)
      : null
  // Forgot phân biệt lỗi gửi thư, kho tài khoản và lỗi HTTP thiếu JSON/mã lỗi.
  // Chỉ dùng thông báo do client định nghĩa; không hiển thị lỗi provider thô.
  const forgotMessages: Record<number, string> = {
    400: 'Vui lòng nhập email hợp lệ, tối đa 254 ký tự.',
    429: 'Bạn đã gửi quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng đợi rồi thử lại.',
    500: 'Hệ thống chưa thể xử lý yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau.',
    503: 'Dịch vụ gửi thư chưa sẵn sàng. Vui lòng thử lại sau.',
  }
  const forgotMessage =
    path === 'forgot-password'
      ? code === 'EMAIL_UNAVAILABLE'
        ? 'Chưa thể gửi email đặt lại mật khẩu. Dịch vụ gửi thư chưa sẵn sàng; vui lòng thử lại sau.'
        : code === 'AUTH_UNAVAILABLE'
          ? 'Dịch vụ khôi phục tài khoản tạm thời chưa sẵn sàng. Vui lòng thử lại sau.'
          : forgotMessages[response.status]
      : undefined
  // Không hiển thị message/stack thô từ server.
  return new AuthApiError(
    forgotMessage ??
      (code === 'INVALID_RESET_TOKEN'
        ? 'Liên kết không hợp lệ, đã dùng hoặc hết hạn. Vui lòng yêu cầu liên kết mới.'
        : code === 'EMAIL_UNAVAILABLE'
          ? 'Chưa thể gửi email đặt lại mật khẩu. Vui lòng thử lại sau hoặc liên hệ quản trị viên.'
          : messages[response.status]) ??
      'Dịch vụ tài khoản tạm thời không khả dụng. Vui lòng thử lại sau.',
    response.status,
    code,
    fields,
    retryAfter,
  )
}

async function request(
  path:
    | 'register'
    | 'login'
    | 'me'
    | 'logout'
    | 'forgot-password'
    | 'reset-password',
  body:
    | RegisterInput
    | LoginInput
    | { email: string }
    | { token: string; password: string }
    | Record<string, never>
    | undefined,
  signal?: AbortSignal,
  expectedAccount?: string,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(
      `/api/auth/${path}`,
      sessionRequestInit(body === undefined ? 'GET' : 'POST', signal, body, expectedAccount),
    )
  } catch (error) {
    if (signal?.aborted) throw error
    throw new AuthApiError(
      path === 'forgot-password'
        ? 'Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.'
        : 'Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.',
    )
  }
  // Logout chỉ được xác nhận bằng 204, không parse JSON trên body rỗng.
  if (path === 'logout' && response.status === 204) return null
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
  }
  if (!response.ok) throw responseError(response, payload, path)
  const expected = path === 'register' ? 201 : 200
  if (path === 'logout' || response.status !== expected || payload === null)
    throw invalidResponse()
  return payload
}

export const authService = {
  async forgotPassword(email: string, signal?: AbortSignal): Promise<void> {
    const payload = await request('forgot-password', { email }, signal)
    if (
      !isRecord(payload) ||
      payload.message !==
        'Nếu email này có tài khoản Cineverse, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.'
    )
      throw invalidResponse()
  },
  async resetPassword(
    token: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const payload = await request('reset-password', { token, password }, signal)
    if (
      !isRecord(payload) ||
      payload.message !==
        'Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.'
    )
      throw invalidResponse()
  },
  async register(input: RegisterInput, signal?: AbortSignal) {
    return parseAuthUser(await request('register', input, signal))
  },
  async login(input: LoginInput, signal?: AbortSignal) {
    return parseAuthUser(await request('login', input, signal))
  },
  async me(signal?: AbortSignal): Promise<AuthUser | null> {
    try {
      return parseAuthUser(await request('me', undefined, signal))
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) return null
      throw error
    }
  },
  async logout(signal?: AbortSignal, expectedAccount?: string): Promise<void> {
    await request('logout', {}, signal, expectedAccount)
  },
}

export function asAuthError(error: unknown): AuthApiError {
  return error instanceof AuthApiError
    ? error
    : new AuthApiError('Không thể hoàn tất yêu cầu. Vui lòng thử lại.')
}
