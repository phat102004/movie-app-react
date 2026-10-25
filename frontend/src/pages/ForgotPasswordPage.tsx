import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { PasswordRecoveryLayout } from '../components/PasswordRecoveryLayout'
import { authService, asAuthError } from '../services/auth'
import type { AuthApiError } from '../services/auth'
import { validateEmailForm } from '../utils/authForm'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [error, setError] = useState<AuthApiError | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  useEffect(() => () => controller.current?.abort(), [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    const invalid = validateEmailForm(email).email
    setEmailError(invalid ?? '')
    setError(null)
    setSent(false)
    if (invalid) {
      input.current?.focus()
      return
    }
    const request = new AbortController()
    controller.current = request
    busy.current = true
    setPending(true)
    try {
      await authService.forgotPassword(
        email.trim().toLowerCase(),
        request.signal,
      )
      if (!request.signal.aborted) setSent(true)
    } catch (failure) {
      if (!request.signal.aborted) {
        const safe = asAuthError(failure)
        setError(safe)
        setEmailError(safe.fields.email ?? '')
        if (safe.fields.email) input.current?.focus()
      }
    } finally {
      busy.current = false
      if (!request.signal.aborted) setPending(false)
    }
  }

  return (
    <PasswordRecoveryLayout title="Quên mật khẩu?">
      <p className="auth-card-index">03 / KHÔI PHỤC</p>
      <h2>Nhận liên kết mới</h2>
      <p className="auth-card-description">
        Nhập email đăng ký để nhận hướng dẫn đặt lại mật khẩu.
      </p>
      {sent && (
        <p className="auth-success" role="status">
          Nếu email này có tài khoản Cineverse, chúng tôi sẽ gửi hướng dẫn đặt
          lại mật khẩu.
        </p>
      )}
      {error && (
        <p className="auth-form-error" role="alert">
          {error.message}
          {error.retryAfter !== null &&
            ` Thử lại sau khoảng ${error.retryAfter} giây.`}
        </p>
      )}
      <form noValidate onSubmit={submit} aria-busy={pending}>
        <div className="auth-field">
          <label htmlFor="recovery-email">Email</label>
          <input
            ref={input}
            id="recovery-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={pending}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setEmailError('')
              setError(null)
              setSent(false)
            }}
            aria-invalid={!!emailError}
            aria-describedby={emailError ? 'recovery-email-error' : undefined}
          />
          {emailError && (
            <p className="auth-field-error" id="recovery-email-error">
              {emailError}
            </p>
          )}
        </div>
        <button className="auth-submit" type="submit" disabled={pending}>
          {pending ? 'Đang gửi…' : 'Gửi liên kết đặt lại'}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
      <p className="auth-switch">
        <Link to="/login">Quay lại đăng nhập</Link>
      </p>
    </PasswordRecoveryLayout>
  )
}
