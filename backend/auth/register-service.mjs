import { getPrisma } from '../database/client.mjs'
import { DatabaseConfigError } from '../database/config.mjs'
import { HttpError } from '../http.mjs'
import { hashRegistrationPassword } from './password.mjs'
import { validateRegistration } from './validation.mjs'

export function createRegistrationService({
  getClient = getPrisma,
  hashPassword = hashRegistrationPassword,
} = {}) {
  return async function registerUser(input) {
    const { name, email, password } = validateRegistration(input)
    const passwordHash = await hashPassword(password)
    try {
      const client = await getClient()
      // Không findUnique rồi mới create: unique constraint xử lý cả request đồng thời.
      const user = await client.user.create({
        data: { name, email, passwordHash },
        select: { id: true, name: true, email: true, createdAt: true },
      })
      // DTO allowlist thêm một lớp bảo vệ; không spread user hoặc request body.
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
      }
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new HttpError(
          409,
          'EMAIL_ALREADY_EXISTS',
          'Email đã được sử dụng.',
        )
      }
      const kind = error?.meta?.driverAdapterError?.cause?.kind
      if (
        error instanceof DatabaseConfigError ||
        /^P10\d\d$/.test(error?.code ?? '') ||
        [
          'P2021',
          'P2022',
          'P2024',
          'P2037',
          'ECONNREFUSED',
          'ETIMEDOUT',
        ].includes(error?.code) ||
        [
          'DatabaseNotReachable',
          'DatabaseDoesNotExist',
          'AuthenticationFailed',
          'SocketTimeout',
          'DatabaseAccessDenied',
        ].includes(kind)
      ) {
        throw new HttpError(
          503,
          'REGISTRATION_UNAVAILABLE',
          'Chức năng đăng ký tạm thời chưa sẵn sàng. Vui lòng thử lại sau.',
        )
      }
      throw new HttpError(
        500,
        'INTERNAL_ERROR',
        'Không thể đăng ký lúc này. Vui lòng thử lại sau.',
      )
    }
  }
}
