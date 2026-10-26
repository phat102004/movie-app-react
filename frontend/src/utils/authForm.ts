import type {
  AuthFieldErrors,
  LoginInput,
  RegisterInput,
} from '../types/auth.ts'

const validEmail = (email: string) =>
  email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

export function validateEmailForm(email: string): AuthFieldErrors {
  return validEmail(email)
    ? {}
    : { email: 'Vui lòng nhập email hợp lệ, tối đa 254 ký tự.' }
}

export function validateNewPasswordForm(input: {
  password: string
  confirmPassword: string
}): AuthFieldErrors {
  const errors: AuthFieldErrors = {}
  if (
    Array.from(input.password).length < 12 ||
    Array.from(input.password).length > 128
  )
    errors.password = 'Mật khẩu cần có từ 12 đến 128 ký tự.'
  if (input.confirmPassword !== input.password)
    errors.confirmPassword = 'Mật khẩu xác nhận chưa khớp.'
  return errors
}

export function validateLoginForm(input: LoginInput): AuthFieldErrors {
  const errors = validateEmailForm(input.email)
  if (!input.password || Array.from(input.password).length > 128)
    errors.password = 'Vui lòng nhập mật khẩu, tối đa 128 ký tự.'
  return errors
}

export function validateRegisterForm(
  input: RegisterInput & { confirmPassword: string },
): AuthFieldErrors {
  const errors = {
    ...validateEmailForm(input.email),
    ...validateNewPasswordForm(input),
  }
  if (!input.name.trim() || Array.from(input.name.trim()).length > 100)
    errors.name = 'Họ và tên cần có từ 1 đến 100 ký tự.'
  return errors
}

export function authReturnPath(state: unknown): string {
  const path =
    state && typeof state === 'object' && 'from' in state ? state.from : null
  // Allowlist route nội bộ có thật; chặn external URL và auth redirect loop.
  if (path === '/') return '/'
  if (path === '/favorites') return '/favorites'
  return typeof path === 'string' &&
    /^\/movies\/[1-9]\d*$/.test(path) &&
    Number(path.slice(8)) <= 2_147_483_647
    ? path
    : '/'
}

export function registrationNotice(state: unknown): {
  registered: boolean
  email: string
} {
  if (!state || typeof state !== 'object')
    return { registered: false, email: '' }
  return {
    registered: 'registered' in state && state.registered === true,
    email:
      'email' in state &&
      typeof state.email === 'string' &&
      validEmail(state.email)
        ? state.email
        : '',
  }
}
