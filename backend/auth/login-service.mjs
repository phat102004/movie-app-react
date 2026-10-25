import { getPrisma } from '../database/client.mjs'
import { HttpError } from '../http.mjs'
import { getDummyPasswordHash, verifyLoginPassword } from './password.mjs'
import { validateLogin } from './validation.mjs'
import { publicAuthError } from './errors.mjs'
import { safeUserSelect, toUserDto } from './user-dto.mjs'

export function createLoginService({
  sessions,
  getClient = getPrisma,
  verifyPassword = verifyLoginPassword,
  dummyHash = getDummyPasswordHash,
} = {}) {
  return async (input) => {
    const { email, password } = validateLogin(input)
    try {
      const client = await getClient()
      const user = await client.user.findUnique({
        where: { email },
        select: { ...safeUserSelect, passwordHash: true },
      })
      // Chuẩn bị dummy cho mọi lần login đầu tiên, sau đó cache trong process.
      const fallback = await dummyHash()
      const matches = await verifyPassword(
        user?.passwordHash ?? fallback,
        password,
      )
      if (!matches || !user)
        throw new HttpError(
          401,
          'INVALID_CREDENTIALS',
          'Email hoặc mật khẩu không chính xác.',
        )
      const token = await sessions.create(user.id, user.passwordHash)
      return { user: toUserDto(user), token }
    } catch (error) {
      throw publicAuthError(error)
    }
  }
}
