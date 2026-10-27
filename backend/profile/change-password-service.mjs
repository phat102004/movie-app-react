import { getPrisma } from '../database/client.mjs'
import { HttpError } from '../http.mjs'
import { publicAuthError } from '../auth/errors.mjs'
import { isValidPassword } from '../auth/password-policy.mjs'
import {
  hashRegistrationPassword,
  verifyLoginPassword,
} from '../auth/password.mjs'
import { hashSessionToken } from '../auth/session-service.mjs'

export function validatePasswordChange(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !['currentPassword', 'newPassword'].includes(key),
    )
  )
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Chỉ nhận currentPassword và newPassword.',
    )
  const fields = {}
  if (!isValidPassword(input.currentPassword, 1))
    fields.currentPassword = 'Mật khẩu hiện tại phải có từ 1 đến 128 ký tự.'
  if (!isValidPassword(input.newPassword))
    fields.newPassword = 'Mật khẩu mới phải có từ 12 đến 128 ký tự.'
  if (Object.keys(fields).length)
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Vui lòng kiểm tra thông tin mật khẩu.',
      fields,
    )
  return {
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
  }
}
const unauthenticated = () =>
  new HttpError(
    401,
    'UNAUTHENTICATED',
    'Bạn chưa đăng nhập hoặc phiên đã hết hạn.',
  )

export function createChangePasswordService({
  getClient = getPrisma,
  now = () => new Date(),
  verifyPassword = verifyLoginPassword,
  hashPassword = hashRegistrationPassword,
} = {}) {
  return async (userId, token, input) => {
    if (!token) throw unauthenticated()
    const { currentPassword, newPassword } = validatePasswordChange(input)
    try {
      const client = await getClient()
      const candidate = await client.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      })
      if (!candidate) throw unauthenticated()
      const verifiedHash = candidate.passwordHash
      if (!(await verifyPassword(verifiedHash, currentPassword)))
        throw new HttpError(
          400,
          'CURRENT_PASSWORD_INCORRECT',
          'Mật khẩu hiện tại không chính xác.',
          { currentPassword: 'Mật khẩu hiện tại không chính xác.' },
        )
      // Hash có salt: phải verify, không so sánh hai hash để phát hiện reuse.
      if (await verifyPassword(verifiedHash, newPassword))
        throw new HttpError(
          400,
          'PASSWORD_REUSED',
          'Mật khẩu mới phải khác mật khẩu hiện tại.',
          { newPassword: 'Mật khẩu mới phải khác mật khẩu hiện tại.' },
        )
      const passwordHash = await hashPassword(newPassword)
      const tokenHash = hashSessionToken(token)
      await client.$transaction(
        async (tx) => {
          // Cùng thứ tự User -> Session với Login/Reset; không chạy Argon2 trong transaction.
          const locked =
            await tx.$queryRaw`SELECT id FROM public."User" WHERE id = ${userId}::uuid FOR UPDATE`
          if (!locked.length) throw unauthenticated()
          // Khóa session để Logout đồng thời được tuần tự hóa với đổi mật khẩu.
          const valid =
            await tx.$queryRaw`SELECT id FROM public."Session" WHERE "userId" = ${userId}::uuid AND "tokenHash" = ${tokenHash} AND "expiresAt" > ${now()} FOR UPDATE`
          if (!valid.length) throw unauthenticated()
          const updated = await tx.user.updateMany({
            where: { id: userId, passwordHash: verifiedHash },
            data: { passwordHash },
          })
          if (updated.count !== 1) throw unauthenticated()
          await tx.session.deleteMany({ where: { userId } })
          // Recovery link phát hành trước thay đổi này không được dùng để đổi password lần nữa.
          await tx.passwordResetToken.deleteMany({ where: { userId } })
        },
        { maxWait: 5000, timeout: 10_000 },
      )
    } catch (error) {
      throw publicAuthError(error)
    }
  }
}
