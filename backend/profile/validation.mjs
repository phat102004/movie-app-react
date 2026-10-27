import { HttpError } from '../http.mjs'
import { readDisplayName } from '../auth/name-validation.mjs'

export function validateProfileInput(input) {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== 'name')
  )
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Hồ sơ chỉ nhận JSON object có trường name; không nhận các trường khác.',
    )
  const { name, valid } = readDisplayName(input.name)
  if (!valid)
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Vui lòng kiểm tra tên hiển thị.',
      { name: 'Tên phải có từ 1 đến 100 ký tự, không chứa ký tự điều khiển.' },
    )
  return { name }
}
