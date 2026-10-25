import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { PasswordRecoveryLayout } from '../components/PasswordRecoveryLayout'
import { authService, asAuthError } from '../services/auth'
import type { AuthApiError } from '../services/auth'
import type { AuthFieldErrors } from '../types/auth'
import { captureResetToken, clearResetToken } from '../utils/resetToken'
import { validateNewPasswordForm } from '../utils/authForm'
import { useAuth } from '../hooks/useAuth'

export function ResetPasswordPage() {
  const [token, setToken] = useState(captureResetToken)
  const [values, setValues] = useState({ password: '', confirmPassword: '' })
  const [visible, setVisible] = useState({
    password: false,
    confirmPassword: false,
  })
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [error, setError] = useState<AuthApiError | null>(null)
  const [complete, setComplete] = useState(false)
  const [pending, setPending] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const busy = useRef(false)
  const { refreshUser } = useAuth()
  useEffect(() => () => controller.current?.abort(), [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || !token) return
    const next = validateNewPasswordForm(values)
    setErrors(next)
    setError(null)
    const field = (['password', 'confirmPassword'] as const).find(
      (key) => next[key],
    )
    if (field) {
      form.current?.querySelector<HTMLInputElement>(`#reset-${field}`)?.focus()
      return
    }
    const request = new AbortController()
    controller.current = request
    busy.current = true
    setPending(true)
    try {
      await authService.resetPassword(token, values.password, request.signal)
      // Server đã thu hồi session; cập nhật Provider, không tự đăng nhập.
      clearResetToken()
      if (!request.signal.aborted) {
        setToken(null)
        setValues({ password: '', confirmPassword: '' })
        setComplete(true)
      }
      await refreshUser()
    } catch (failure) {
      if (!request.signal.aborted) {
        const safe = asAuthError(failure)
        setError(safe)
        setErrors(safe.fields)
        if (safe.code === 'INVALID_RESET_TOKEN') {
          clearResetToken()
          setToken(null)
        }
        if (safe.fields.password)
          form.current
            ?.querySelector<HTMLInputElement>('#reset-password')
            ?.focus()
      }
    } finally {
      busy.current = false
      if (!request.signal.aborted) setPending(false)
    }
  }

  return (
    <PasswordRecoveryLayout title="Đặt lại mật khẩu">
      <p className="auth-card-index">04 / MẬT KHẨU MỚI</p>
      <h2>Một khởi đầu an toàn</h2>
      {complete ? (
        <p className="auth-success" role="status">
          Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.
        </p>
      ) : !token ? (
        <div className="auth-form-error" role="alert">
          <p>
            Liên kết không hợp lệ, đã dùng hoặc hết hạn. Vui lòng yêu cầu liên
            kết mới.
          </p>
          <Link to="/forgot-password">Yêu cầu liên kết mới</Link>
        </div>
      ) : (
        <>
          <p className="auth-card-description" id="reset-hint">
            Sử dụng từ 12 đến 128 ký tự. Liên kết chỉ dùng một lần và có hiệu
            lực 20 phút.
          </p>
          {error && (
            <p className="auth-form-error" role="alert">
              {error.message}
              {error.retryAfter !== null &&
                ` Thử lại sau khoảng ${error.retryAfter} giây.`}
            </p>
          )}
          <form ref={form} noValidate onSubmit={submit} aria-busy={pending}>
            {(['password', 'confirmPassword'] as const).map((field) => (
              <div className="auth-field" key={field}>
                <label htmlFor={`reset-${field}`}>
                  {field === 'password'
                    ? 'Mật khẩu mới'
                    : 'Xác nhận mật khẩu mới'}
                </label>
                <div className="auth-password-input">
                  <input
                    id={`reset-${field}`}
                    name={field}
                    autoComplete="new-password"
                    required
                    disabled={pending}
                    type={visible[field] ? 'text' : 'password'}
                    value={values[field]}
                    onChange={(event) => {
                      setValues({ ...values, [field]: event.target.value })
                      setErrors({ ...errors, [field]: undefined })
                      setError(null)
                    }}
                    aria-invalid={!!errors[field]}
                    aria-describedby={
                      errors[field] ? `reset-${field}-error` : 'reset-hint'
                    }
                  />
                  <button
                    type="button"
                    aria-controls={`reset-${field}`}
                    aria-pressed={visible[field]}
                    aria-label={`${visible[field] ? 'Ẩn' : 'Hiện'} ${field === 'password' ? 'mật khẩu mới' : 'mật khẩu xác nhận'}`}
                    onClick={() =>
                      setVisible({ ...visible, [field]: !visible[field] })
                    }
                  >
                    {visible[field] ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
                {errors[field] && (
                  <p className="auth-field-error" id={`reset-${field}-error`}>
                    {errors[field]}
                  </p>
                )}
              </div>
            ))}
            <button className="auth-submit" type="submit" disabled={pending}>
              {pending ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
        </>
      )}
      <p className="auth-switch">
        <Link to="/login">Quay lại đăng nhập</Link>
      </p>
    </PasswordRecoveryLayout>
  )
}
