import { getPrisma } from '../database/client.mjs'
import { HttpError } from '../http.mjs'
import { publicAuthError } from '../auth/errors.mjs'
import { safeUserSelect, toUserDto } from '../auth/user-dto.mjs'
import { hashSessionToken } from '../auth/session-service.mjs'

const profileSelect = {
  ...safeUserSelect,
  _count: { select: { favorites: true } },
}
const unauthenticated = () =>
  new HttpError(
    401,
    'UNAUTHENTICATED',
    'Bạn chưa đăng nhập hoặc phiên đã hết hạn.',
  )
const toProfileDto = (user) => ({
  ...toUserDto(user),
  favoriteCount: user._count.favorites,
})

export function createProfileService({
  getClient = getPrisma,
  now = () => new Date(),
} = {}) {
  return {
    async get(userId) {
      try {
        const client = await getClient()
        const user = await client.user.findUnique({
          where: { id: userId },
          select: profileSelect,
        })
        if (!user) throw unauthenticated()
        // _count tổng hợp trong database theo quan hệ của User; không lấy danh sách phim.
        return toProfileDto(user)
      } catch (error) {
        throw publicAuthError(error)
      }
    },
    async update(userId, token, name) {
      if (!token) throw unauthenticated()
      try {
        const client = await getClient()
        const user = await client.user.update({
          where: {
            id: userId,
            // Kiểm tra lại ngay trong write, không chỉ check-then-update theo User ID.
            sessions: {
              some: {
                tokenHash: hashSessionToken(token),
                expiresAt: { gt: now() },
              },
            },
          },
          data: { name },
          select: profileSelect,
        })
        return toProfileDto(user)
      } catch (error) {
        // User biến mất hoặc không còn session thỏa điều kiện write đều là 401.
        if (error?.code === 'P2025') throw unauthenticated()
        throw publicAuthError(error)
      }
    },
  }
}
