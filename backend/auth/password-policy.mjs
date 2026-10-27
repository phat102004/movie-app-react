// Giữ nguyên policy Register/Reset hiện có. Không trim hoặc normalize password.
export function isValidPassword(value, min = 12) {
  return (
    typeof value === 'string' &&
    Array.from(value).length >= min &&
    Array.from(value).length <= 128
  )
}
