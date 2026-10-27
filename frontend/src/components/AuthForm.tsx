import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { authService, asAuthError } from '../services/auth'
import type { AuthApiError } from '../services/auth'
import type { AuthField, AuthFieldErrors } from '../types/auth'
import {
  authReturnPath,
  registrationNotice,
  validateLoginForm,
  validateRegisterForm,
} from '../utils/authForm'
import './Auth.css'
import { hasPasswordChangedNotice } from '../utils/passwordChangeForm'

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register'
  const { state } = useLocation()
  const navigate = useNavigate()
  const { status, login } = useAuth()
  const notice = registrationNotice(state)
  const from = authReturnPath(state)
  const [values, setValues] = useState({
    name: '',
    email: isRegister ? '' : notice.email,
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [submitError, setSubmitError] = useState<AuthApiError | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const busy = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const form = useRef<HTMLFormElement>(null)

  useEffect(
    () => () => {
      controller.current?.abort()
    },
    [],
  )

  function update(field: AuthField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
    setSubmitError(null)
  }

  function focusFirstError(next: AuthFieldErrors) {
    const field = (
      ['name', 'email', 'password', 'confirmPassword'] as const
    ).find((field) => next[field])
    if (field)
      form.current?.querySelector<HTMLInputElement>(`#auth-${field}`)?.focus()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    const next = isRegister
      ? validateRegisterForm(values)
      : validateLoginForm(values)
    setErrors(next)
    setSubmitError(null)
    if (Object.keys(next).length) {
      focusFirstError(next)
      return
    }
    busy.current = true
    setIsSubmitting(true)
    const pending = new AbortController()
    controller.current = pending
    try {
      if (isRegister) {
        const user = await authService.register(
          {
            name: values.name.trim(),
            email: values.email.trim().toLowerCase(),
            password: values.password,
          },
          pending.signal,
        )
        if (!pending.signal.aborted)
          void navigate('/login', {
            replace: true,
            state: { registered: true, email: user.email, from },
          })
      } else {
        await login({
          email: values.email.trim().toLowerCase(),
          password: values.password,
        })
        if (!pending.signal.aborted) void navigate(from, { replace: true })
      }
    } catch (error) {
      if (!pending.signal.aborted) {
        const safe = asAuthError(error)
        setSubmitError(safe)
        setErrors(safe.fields)
        requestAnimationFrame(() => focusFirstError(safe.fields))
      }
    } finally {
      busy.current = false
      if (!pending.signal.aborted) setIsSubmitting(false)
    }
  }

  if (status === 'authenticated') return <Navigate to={from} replace />
  return (
    <section
      className="auth-page page-container auth-page--welcome"
      aria-labelledby="auth-title"
    >
      <div className="auth-intro">
        <Link className="auth-back" to={from}>
          ← Trở về Cineverse
        </Link>
        <p className="auth-eyebrow">
          {isRegister
            ? 'CINEVERSE / BẮT ĐẦU HÀNH TRÌNH'
            : 'CINEVERSE / KHÔNG GIAN CỦA BẠN'}
        </p>
        <h1 id="auth-title">
          {isRegister ? (
            <>
              Mỗi câu chuyện
              <br />
              <em>{' bắt đầu từ đây.'}</em>
            </>
          ) : (
            <>
              Chào mừng
              <br />
              <em>{' bạn trở lại.'}</em>
            </>
          )}
        </h1>
        <p>
          {isRegister
            ? 'Tạo tài khoản Cineverse để lưu giữ những bộ phim và câu chuyện điện ảnh bạn yêu thích.'
            : 'Đăng nhập để tiếp tục hành trình điện ảnh cùng Cineverse.'}
        </p>
        <span className="auth-editorial-note">MỖI BỘ PHIM, MỘT THẾ GIỚI.</span>
      </div>
      <div className="auth-card">
        <p className="auth-card-index">
          {isRegister ? '01 / TẠO TÀI KHOẢN' : '02 / ĐĂNG NHẬP'}
        </p>
        <h2>{isRegister ? 'Đăng ký' : 'Đăng nhập'}</h2>
        {status === 'loading' ? (
          <p className="auth-checking" role="status">
            Đang kiểm tra phiên đăng nhập…
          </p>
        ) : (
          <>
            {!isRegister && hasPasswordChangedNotice(state) && (
              <p className="auth-success" role="status">
                Đổi mật khẩu thành công. Vui lòng đăng nhập lại.
              </p>
            )}
            {!isRegister && notice.registered && (
              <p className="auth-success" role="status">
                Tài khoản đã được tạo. Hãy đăng nhập để tiếp tục.
              </p>
            )}
            <form
              ref={form}
              onSubmit={handleSubmit}
              noValidate
              aria-busy={isSubmitting}
            >
              {submitError && (
                <div className="auth-form-error" role="alert">
                  <p>{submitError.message}</p>
                  {submitError.retryAfter !== null && (
                    <p>
                      Vui lòng thử lại sau khoảng {submitError.retryAfter} giây.
                    </p>
                  )}
                </div>
              )}
              {isRegister && (
                <div className="auth-field">
                  <label htmlFor="auth-name">Họ và tên</label>
                  <input
                    id="auth-name"
                    name="name"
                    autoComplete="name"
                    required
                    value={values.name}
                    onChange={(event) => update('name', event.target.value)}
                    aria-invalid={!!errors.name}
                    aria-describedby={
                      errors.name ? 'auth-name-error' : undefined
                    }
                    disabled={isSubmitting}
                  />
                  {errors.name && (
                    <p className="auth-field-error" id="auth-name-error">
                      {errors.name}
                    </p>
                  )}
                </div>
              )}
              <div className="auth-field">
                <label htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={values.email}
                  onChange={(event) => update('email', event.target.value)}
                  aria-invalid={!!errors.email}
                  aria-describedby={
                    errors.email ? 'auth-email-error' : undefined
                  }
                  disabled={isSubmitting}
                />
                {errors.email && (
                  <p className="auth-field-error" id="auth-email-error">
                    {errors.email}
                  </p>
                )}
              </div>
              <div className="auth-field">
                <div className="auth-label-row">
                  <label htmlFor="auth-password">Mật khẩu</label>
                  {!isRegister && (
                    <Link to="/forgot-password">Quên mật khẩu?</Link>
                  )}
                </div>
                <div className="auth-password-input">
                  <input
                    id="auth-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={
                      isRegister ? 'new-password' : 'current-password'
                    }
                    required
                    value={values.password}
                    onChange={(event) => update('password', event.target.value)}
                    aria-invalid={!!errors.password}
                    aria-describedby={
                      errors.password
                        ? 'auth-password-error'
                        : isRegister
                          ? 'auth-password-hint'
                          : undefined
                    }
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    aria-pressed={showPassword}
                    aria-controls="auth-password"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
                {isRegister && !errors.password && (
                  <p className="auth-field-hint" id="auth-password-hint">
                    Từ 12 đến 128 ký tự. Có thể sử dụng khoảng trắng.
                  </p>
                )}
                {errors.password && (
                  <p className="auth-field-error" id="auth-password-error">
                    {errors.password}
                  </p>
                )}
              </div>
              {isRegister && (
                <div className="auth-field">
                  <label htmlFor="auth-confirmPassword">
                    Xác nhận mật khẩu
                  </label>
                  <div className="auth-password-input">
                    <input
                      id="auth-confirmPassword"
                      name="confirmPassword"
                      type={showConfirm ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      value={values.confirmPassword}
                      onChange={(event) =>
                        update('confirmPassword', event.target.value)
                      }
                      aria-invalid={!!errors.confirmPassword}
                      aria-describedby={
                        errors.confirmPassword
                          ? 'auth-confirmPassword-error'
                          : undefined
                      }
                      disabled={isSubmitting}
                    />
                    <button
                      type="button"
                      aria-label={
                        showConfirm
                          ? 'Ẩn mật khẩu xác nhận'
                          : 'Hiện mật khẩu xác nhận'
                      }
                      aria-pressed={showConfirm}
                      aria-controls="auth-confirmPassword"
                      onClick={() => setShowConfirm(!showConfirm)}
                    >
                      {showConfirm ? 'Ẩn' : 'Hiện'}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <p
                      className="auth-field-error"
                      id="auth-confirmPassword-error"
                    >
                      {errors.confirmPassword}
                    </p>
                  )}
                </div>
              )}
              <button
                className="auth-submit"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? 'Đang xử lý…'
                  : isRegister
                    ? 'Tạo tài khoản'
                    : 'Đăng nhập'}
                <span aria-hidden="true">↗</span>
              </button>
            </form>
            <p className="auth-switch">
              {isRegister ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? '}
              <Link to={isRegister ? '/login' : '/register'} state={{ from }}>
                {isRegister ? 'Đăng nhập' : 'Đăng ký'}
              </Link>
            </p>
          </>
        )}
      </div>
    </section>
  )
}
