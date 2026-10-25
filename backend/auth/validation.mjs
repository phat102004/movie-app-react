import { HttpError } from '../http.mjs'

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isValidEmail(email) {
  const parts = email.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (
    !local ||
    local.length > 64 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  )
    return false
  const labels = domain.split('.')
  return (
    labels.length >= 2 &&
    labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    ) &&
    !/^\d+$/.test(labels.at(-1))
  )
}

export function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Dữ liệu đăng ký phải là một JSON object.',
    )
  }
  const fields = {}
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const nameCharacters = Array.from(name)
  const email = normalizeEmail(input.email)
  // Không trim, normalize hoặc tự ý thay đổi mật khẩu.
  const password = input.password
  if (
    !name ||
    nameCharacters.length > 100 ||
    nameCharacters.some(
      (character) =>
        character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  )
    fields.name = 'Tên phải có từ 1 đến 100 ký tự, không chứa ký tự điều khiển.'
  if (!email || email.length > 254 || !isValidEmail(email))
    fields.email = 'Email không hợp lệ hoặc dài quá 254 ký tự.'
  if (
    typeof password !== 'string' ||
    Array.from(password).length < 12 ||
    Array.from(password).length > 128
  )
    fields.password = 'Mật khẩu phải có từ 12 đến 128 ký tự.'
  if (Object.keys(fields).length) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Vui lòng kiểm tra thông tin đăng ký.',
      fields,
    )
  }
  // Chỉ chuyển tiếp ba trường đã kiểm tra; bỏ qua id/role/passwordHash do client gửi.
  return { name, email, password }
}

export function validateLogin(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Dữ liệu đăng nhập phải là một JSON object.',
    )
  const email = normalizeEmail(input.email)
  const password = input.password
  if (
    email.length > 254 ||
    !isValidEmail(email) ||
    typeof password !== 'string' ||
    Array.from(password).length < 1 ||
    Array.from(password).length > 128
  )
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Email hoặc định dạng mật khẩu không hợp lệ.',
    )
  return { email, password }
}
