import { validateNewPasswordForm } from './authForm.ts'
import type {
  PasswordChangeValues,
  PasswordChangeErrors,
} from '../types/passwordChange.ts'

export function validatePasswordChangeForm(
  input: PasswordChangeValues,
): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {}
  if (!input.currentPassword || Array.from(input.currentPassword).length > 128)
    errors.currentPassword =
      'Vui lòng nhập mật khẩu hiện tại, tối đa 128 ký tự.'
  const policy = validateNewPasswordForm({
    password: input.newPassword,
    confirmPassword: input.confirmPassword,
  })
  if (policy.password) errors.newPassword = policy.password
  if (policy.confirmPassword) errors.confirmPassword = policy.confirmPassword
  return errors
}

export function hasPasswordChangedNotice(state: unknown) {
  return (
    !!state &&
    typeof state === 'object' &&
    'passwordChanged' in state &&
    state.passwordChanged === true
  )
}
