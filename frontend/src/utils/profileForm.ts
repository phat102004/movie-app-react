// Khớp backend/auth/name-validation.mjs: trim, Unicode code points, C0/DEL.
export function validateProfileName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  const characters = Array.from(name)
  const valid =
    characters.length >= 1 &&
    characters.length <= 100 &&
    !characters.some((character) => {
      const code = character.codePointAt(0)!
      return code < 32 || code === 127
    })
  return {
    name,
    error: valid
      ? null
      : 'Tên phải có từ 1 đến 100 ký tự, không chứa ký tự điều khiển.',
  }
}
