import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { asPasswordChangeError } from '../services/passwordChange'
import type {
  PasswordChangeErrors,
  PasswordChangeValues,
} from '../types/passwordChange'
import { validatePasswordChangeForm } from '../utils/passwordChangeForm'

const emptyValues: PasswordChangeValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}
const labels = {
  currentPassword: 'Mật khẩu hiện tại',
  newPassword: 'Mật khẩu mới',
  confirmPassword: 'Xác nhận mật khẩu mới',
}
const fields = ['currentPassword', 'newPassword', 'confirmPassword'] as const

export function ChangePasswordSection({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const { changePassword, isChangingPassword } = useAuth()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<PasswordChangeValues>(emptyValues)
  const [errors, setErrors] = useState<PasswordChangeErrors>({})
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState<
    Record<keyof PasswordChangeValues, boolean>
  >({ currentPassword: false, newPassword: false, confirmPassword: false })
  const form = useRef<HTMLFormElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const busy = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const locked = disabled || isChangingPassword
  function focusError(next: PasswordChangeErrors) {
    const field = fields.find((field) => next[field])
    if (field)
      form.current
        ?.querySelector<HTMLInputElement>(`#security-${field}`)
        ?.focus()
  }
  function close() {
    if (locked) return
    setValues(emptyValues)
    setErrors({})
    setMessage('')
    setVisible({
      currentPassword: false,
      newPassword: false,
      confirmPassword: false,
    })
    setOpen(false)
    requestAnimationFrame(() => toggle.current?.focus())
  }
  return (
    <section
      className="profile-account profile-security"
      aria-labelledby="security-title"
    >
      <div className="profile-account-heading">
        <div>
          <p className="profile-eyebrow">AN TOÀN / TÀI KHOẢN</p>
          <h2 id="security-title">Bảo mật tài khoản</h2>
          <p>
            Đổi mật khẩu sẽ đăng xuất tất cả phiên đăng nhập. Bạn cần đăng nhập
            lại bằng mật khẩu mới.
          </p>
        </div>
        {!open && (
          <button
            ref={toggle}
            className="profile-secondary-button"
            type="button"
            disabled={locked}
            aria-expanded={open}
            aria-controls="change-password-form"
            onClick={() => {
              setOpen(true)
              requestAnimationFrame(() =>
                document.getElementById('security-currentPassword')?.focus(),
              )
            }}
          >
            Đổi mật khẩu
          </button>
        )}
      </div>
      {open && (
        <form
          id="change-password-form"
          className="profile-edit-form"
          ref={form}
          noValidate
          aria-busy={isChangingPassword}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !locked) {
              event.preventDefault()
              close()
            }
          }}
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy.current || locked) return
            const next = validatePasswordChangeForm(values)
            setErrors(next)
            setMessage('')
            if (Object.keys(next).length) {
              focusError(next)
              return
            }
            busy.current = true
            try {
              await changePassword({
                currentPassword: values.currentPassword,
                newPassword: values.newPassword,
              })
              if (mounted.current) {
                setValues(emptyValues)
                setVisible({
                  currentPassword: false,
                  newPassword: false,
                  confirmPassword: false,
                })
              }
            } catch (cause) {
              if (mounted.current) {
                const error = asPasswordChangeError(cause)
                setErrors(error.fields)
                setMessage(
                  Object.keys(error.fields).length
                    ? ''
                    : error.message +
                        (error.retryAfter !== null
                          ? ` Thử lại sau ${error.retryAfter} giây.`
                          : ''),
                )
                requestAnimationFrame(() => focusError(error.fields))
              }
            } finally {
              busy.current = false
            }
          }}
        >
          {fields.map((field) => (
            <div key={field} className="profile-field">
              <label htmlFor={`security-${field}`}>{labels[field]}</label>
              <div className="profile-password-input">
                <input
                  id={`security-${field}`}
                  name={field}
                  type={visible[field] ? 'text' : 'password'}
                  autoComplete={
                    field === 'currentPassword'
                      ? 'current-password'
                      : 'new-password'
                  }
                  autoCapitalize="none"
                  spellCheck={false}
                  value={values[field]}
                  disabled={locked}
                  aria-invalid={!!errors[field]}
                  aria-describedby={
                    errors[field]
                      ? `security-${field}-error`
                      : field === 'newPassword'
                        ? 'security-password-hint'
                        : undefined
                  }
                  onChange={(event) => {
                    setValues((previous) => ({
                      ...previous,
                      [field]: event.target.value,
                    }))
                    setErrors((previous) => ({
                      ...previous,
                      [field]: undefined,
                    }))
                    setMessage('')
                  }}
                />
                <button
                  type="button"
                  disabled={locked}
                  aria-label={`${visible[field] ? 'Ẩn' : 'Hiện'} ${labels[field].toLocaleLowerCase('vi')}`}
                  aria-pressed={visible[field]}
                  aria-controls={`security-${field}`}
                  onClick={() =>
                    setVisible((previous) => ({
                      ...previous,
                      [field]: !previous[field],
                    }))
                  }
                >
                  {visible[field] ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
              {field === 'newPassword' && !errors[field] && (
                <p className="profile-field-hint" id="security-password-hint">
                  Từ 12 đến 128 ký tự. Giữ nguyên khoảng trắng trong mật khẩu.
                </p>
              )}
              {errors[field] && (
                <p
                  id={`security-${field}-error`}
                  className="profile-field-error"
                  role="alert"
                >
                  {errors[field]}
                </p>
              )}
            </div>
          ))}
          {message && (
            <p className="profile-field-error" role="alert">
              {message}
            </p>
          )}
          <div className="profile-form-actions">
            <button
              className="button button-primary"
              type="submit"
              disabled={locked}
            >
              {isChangingPassword
                ? 'Đang đổi mật khẩu…'
                : 'Xác nhận đổi mật khẩu'}
            </button>
            <button
              className="profile-secondary-button"
              type="button"
              disabled={locked}
              onClick={close}
            >
              Hủy đổi mật khẩu
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
