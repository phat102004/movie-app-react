import { useRef, useState } from 'react'
import type { Profile } from '../types/profile'
import type { ProfileApiError } from '../services/profile'
import { validateProfileName } from '../utils/profileForm'

export function ProfileEditForm({
  profile,
  isSaving,
  error,
  onSave,
  onCancel,
  onChange,
}: {
  profile: Profile
  isSaving: boolean
  error: ProfileApiError | null
  onSave(name: string): Promise<void>
  onCancel(): void
  onChange(): void
}) {
  const [name, setName] = useState(profile.name)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const message = fieldError ?? error?.fields.name
  return (
    <form
      className="profile-edit-form"
      noValidate
      aria-busy={isSaving}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isSaving) {
          event.preventDefault()
          onCancel()
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (isSaving) return
        const validated = validateProfileName(name)
        setFieldError(validated.error)
        if (validated.error) {
          input.current?.focus()
          return
        }
        void onSave(validated.name)
      }}
    >
      <div className="profile-field">
        <label htmlFor="profile-name">Tên hiển thị</label>
        <input
          ref={input}
          id="profile-name"
          name="name"
          autoComplete="name"
          value={name}
          disabled={isSaving}
          aria-invalid={!!message}
          aria-describedby={`profile-name-hint${message ? ' profile-name-error' : ''}`}
          onChange={(event) => {
            setName(event.target.value)
            setFieldError(null)
            onChange()
          }}
        />
        <p className="profile-field-hint" id="profile-name-hint">
          Từ 1 đến 100 ký tự · {Array.from(name.trim()).length}/100
        </p>
        {message && (
          <p
            className="profile-field-error"
            id="profile-name-error"
            role="alert"
          >
            {message}
          </p>
        )}
      </div>
      <div className="profile-field">
        <label htmlFor="profile-email">
          Email <span>Chỉ đọc</span>
        </label>
        <input
          id="profile-email"
          type="email"
          autoComplete="email"
          value={profile.email}
          readOnly
          aria-describedby="profile-email-hint"
        />
        <p className="profile-field-hint" id="profile-email-hint">
          Email được giữ nguyên khi chỉnh sửa hồ sơ.
        </p>
      </div>
      {error && !error.fields.name && (
        <p className="profile-field-error" role="alert">
          {error.message}
          {error.retryAfter !== null
            ? ` Thử lại sau ${error.retryAfter} giây.`
            : ''}
        </p>
      )}
      <div className="profile-form-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={isSaving}
        >
          {isSaving ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
        <button
          type="button"
          className="profile-secondary-button"
          disabled={isSaving}
          onClick={onCancel}
        >
          Hủy
        </button>
      </div>
    </form>
  )
}
