// Cùng quy tắc tên cho Register và Profile; đếm Unicode code points, không đếm UTF-16 units.
export function readDisplayName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  const characters = Array.from(name)
  return {
    name,
    valid:
      characters.length >= 1 &&
      characters.length <= 100 &&
      !characters.some((character) => {
        const code = character.codePointAt(0)
        return code < 32 || (code >= 127 && code <= 159)
      }),
  }
}
