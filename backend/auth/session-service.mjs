import { createHash, randomBytes } from 'node:crypto'
import { getPrisma } from '../database/client.mjs'
import { HttpError } from '../http.mjs'
import { readAuthConfig } from './config.mjs'
import { publicAuthError } from './errors.mjs'
import { safeUserSelect, toUserDto } from './user-dto.mjs'

export const hashSessionToken = (token) =>
  createHash('sha256').update(token).digest('hex')
const unauthenticated = () =>
  new HttpError(
    401,
    'UNAUTHENTICATED',
    'Bạn chưa đăng nhập hoặc phiên đã hết hạn.',
  )

export function createSessionService({
  getClient = getPrisma,
  config = readAuthConfig(),
  now = () => new Date(),
} = {}) {
  return {
    async create(userId, verifiedPasswordHash) {
      const token = randomBytes(32).toString('base64url')
      const tokenHash = hashSessionToken(token)
      const createdAt = now()
      const expiresAt = new Date(createdAt.getTime() + config.ttlSeconds * 1000)
      try {
        const client = await getClient()
        await client.$transaction(
          async (tx) => {
            // Khóa cùng User giữa các process để giữ tối đa 5 session nhất quán.
            const locked =
              await tx.$queryRaw`SELECT id FROM public."User" WHERE id = ${userId}::uuid FOR UPDATE`
            if (!locked.length) throw unauthenticated()
            if (verifiedPasswordHash) {
              const current = await tx.user.findUnique({
                where: { id: userId },
                select: { passwordHash: true },
              })
              if (current?.passwordHash !== verifiedPasswordHash)
                throw new HttpError(
                  401,
                  'INVALID_CREDENTIALS',
                  'Email hoặc mật khẩu không chính xác.',
                )
            }
            await tx.session.deleteMany({
              where: { userId, expiresAt: { lte: createdAt } },
            })
            const excess = await tx.session.findMany({
              where: { userId },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: config.maxSessions - 1,
              select: { id: true },
            })
            if (excess.length)
              await tx.session.deleteMany({
                where: {
                  userId,
                  id: { in: excess.map((session) => session.id) },
                },
              })
            await tx.session.create({
              data: { userId, tokenHash, createdAt, expiresAt },
              select: { id: true },
            })
          },
          { maxWait: 5000, timeout: 10_000 },
        )
        return token
      } catch (error) {
        throw publicAuthError(error)
      }
    },
    async currentUser(token) {
      if (!token) throw unauthenticated()
      try {
        const client = await getClient()
        const session = await client.session.findUnique({
          where: { tokenHash: hashSessionToken(token) },
          select: { expiresAt: true, user: { select: safeUserSelect } },
        })
        if (!session?.user || session.expiresAt.getTime() <= now().getTime())
          throw unauthenticated()
        return toUserDto(session.user)
      } catch (error) {
        throw publicAuthError(error)
      }
    },
    async revoke(token) {
      if (!token) return
      try {
        const client = await getClient()
        await client.session.deleteMany({
          where: { tokenHash: hashSessionToken(token) },
        })
      } catch (error) {
        throw publicAuthError(error)
      }
    },
    async cleanupExpired() {
      try {
        const client = await getClient()
        const expiresAt = now()
        const expired = await client.session.findMany({
          where: { expiresAt: { lte: expiresAt } },
          orderBy: { expiresAt: 'asc' },
          take: 1000,
          select: { id: true },
        })
        if (!expired.length) return 0
        const result = await client.session.deleteMany({
          where: {
            id: { in: expired.map((row) => row.id) },
            expiresAt: { lte: expiresAt },
          },
        })
        return result.count
      } catch (error) {
        throw publicAuthError(error)
      }
    },
  }
}
