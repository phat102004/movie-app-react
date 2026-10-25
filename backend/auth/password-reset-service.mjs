import { createHash, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { getPrisma } from '../database/client.mjs'
import { HttpError } from '../http.mjs'
import { publicAuthError } from './errors.mjs'
import { hashRegistrationPassword } from './password.mjs'
import { normalizeEmail, isValidEmail } from './validation.mjs'

export const forgotMessage =
  'Nếu email này có tài khoản Cineverse, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.'
export const resetMessage =
  'Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.'
export const resetTokenPattern = /^[A-Za-z0-9_-]{43}$/
export const hashResetToken = (token) =>
  createHash('sha256').update(token).digest('hex')
export const invalidReset = () =>
  new HttpError(
    400,
    'INVALID_RESET_TOKEN',
    'Liên kết không hợp lệ, đã dùng hoặc hết hạn. Vui lòng yêu cầu liên kết mới.',
  )

export function validateForgot(input) {
  const email = normalizeEmail(input?.email)
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    email.length > 254 ||
    !isValidEmail(email)
  )
    throw new HttpError(400, 'VALIDATION_ERROR', 'Email không hợp lệ.', {
      email: 'Email không hợp lệ.',
    })
  return { email }
}

export function validateReset(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    typeof input.token !== 'string' ||
    !resetTokenPattern.test(input.token)
  )
    throw invalidReset()
  if (
    typeof input.password !== 'string' ||
    Array.from(input.password).length < 12 ||
    Array.from(input.password).length > 128
  )
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Mật khẩu phải có từ 12 đến 128 ký tự.',
      { password: 'Mật khẩu phải có từ 12 đến 128 ký tự.' },
    )
  return { token: input.token, password: input.password }
}

export function createPasswordResetService({
  delivery,
  getClient = getPrisma,
  now = () => new Date(),
  hashPassword = hashRegistrationPassword,
  minimumDurationMs = 500,
} = {}) {
  const transaction = (client, work) =>
    client.$transaction(work, { maxWait: 5000, timeout: 10_000 })
  return {
    async forgot(input) {
      const { email } = validateForgot(input)
      const started = Date.now()
      let client, tokenHash
      try {
        const origin = delivery.ready() // Thiếu SMTP: 503 cho mọi email, không tra cứu User.
        client = await getClient()
        const user = await client.user.findUnique({
          where: { email },
          select: { id: true },
        })
        const token = randomBytes(32).toString('base64url')
        tokenHash = hashResetToken(token)
        if (user) {
          await transaction(client, async (tx) => {
            const locked =
              await tx.$queryRaw`SELECT id FROM public."User" WHERE id = ${user.id}::uuid FOR UPDATE`
            if (!locked.length)
              throw new HttpError(
                503,
                'AUTH_UNAVAILABLE',
                'Dịch vụ tạm thời không khả dụng.',
              )
            await tx.passwordResetToken.deleteMany({
              where: { userId: user.id },
            })
            const createdAt = now()
            await tx.passwordResetToken.create({
              data: {
                userId: user.id,
                tokenHash,
                createdAt,
                expiresAt: new Date(createdAt.getTime() + 20 * 60 * 1000),
              },
            })
          })
        }
        await delivery.send({
          email,
          resetUrl: user ? `${origin}/reset-password#token=${token}` : null,
        })
        return { message: forgotMessage }
      } catch (error) {
        // Không giữ token của email gửi lỗi, không xóa token mới hơn từ request khác.
        if (client && tokenHash) {
          try {
            await client.passwordResetToken.deleteMany({ where: { tokenHash } })
          } catch {
            /* Hết hạn vẫn bảo vệ token; không log thông tin nhạy cảm. */
          }
        }
        throw publicAuthError(error)
      } finally {
        await delay(Math.max(0, minimumDurationMs - (Date.now() - started)))
      }
    },
    async reset(input) {
      const { token, password } = validateReset(input)
      const tokenHash = hashResetToken(token)
      try {
        const client = await getClient()
        const candidate = await client.passwordResetToken.findUnique({
          where: { tokenHash },
          select: { userId: true, expiresAt: true },
        })
        if (!candidate || candidate.expiresAt <= now()) throw invalidReset()
        const passwordHash = await hashPassword(password)
        await transaction(client, async (tx) => {
          // Cùng khóa với phát hành token và tạo session: đổi password + thu hồi nguyên tử.
          const locked =
            await tx.$queryRaw`SELECT id FROM public."User" WHERE id = ${candidate.userId}::uuid FOR UPDATE`
          if (!locked.length) throw invalidReset()
          const consumed = await tx.passwordResetToken.deleteMany({
            where: {
              userId: candidate.userId,
              tokenHash,
              expiresAt: { gt: now() },
            },
          })
          if (consumed.count !== 1) throw invalidReset()
          await tx.user.update({
            where: { id: candidate.userId },
            data: { passwordHash },
          })
          await tx.session.deleteMany({ where: { userId: candidate.userId } })
          await tx.passwordResetToken.deleteMany({
            where: { userId: candidate.userId },
          })
        })
        return { message: resetMessage }
      } catch (error) {
        throw publicAuthError(error)
      }
    },
  }
}
