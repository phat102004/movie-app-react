import { getPrisma } from '../database/client.mjs'
import { publicAuthError } from '../auth/errors.mjs'
import { HttpError } from '../http.mjs'
import { encodeFavoriteCursor } from './validation.mjs'

export const favoritePageSize = 100
const favoriteSelect = { movieId: true, createdAt: true }
const toDto = (row) => ({
  movieId: row.movieId,
  createdAt: row.createdAt.toISOString(),
})

export function createFavoriteService({ getClient = getPrisma } = {}) {
  return {
    async list(userId, cursor = null) {
      try {
        const client = await getClient()
        const rows = await client.favorite.findMany({
          where: {
            userId,
            ...(cursor
              ? {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    {
                      createdAt: cursor.createdAt,
                      movieId: { lt: cursor.movieId },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { movieId: 'desc' }],
          select: favoriteSelect,
          take: favoritePageSize + 1,
        })
        const favorites = rows.slice(0, favoritePageSize).map(toDto)
        return {
          favorites,
          nextCursor:
            rows.length > favoritePageSize
              ? encodeFavoriteCursor(favorites.at(-1))
              : null,
        }
      } catch (error) {
        throw publicAuthError(error)
      }
    },
    async add(userId, movieId) {
      try {
        const client = await getClient()
        // Create trước; PostgreSQL unique là lớp bảo vệ cuối cùng khi request đồng thời.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const row = await client.favorite.create({
              data: { userId, movieId },
              select: favoriteSelect,
            })
            return { status: 201, favorite: toDto(row) }
          } catch (error) {
            if (error?.code !== 'P2002') throw error
            const existing = await client.favorite.findUnique({
              where: { userId_movieId: { userId, movieId } },
              select: favoriteSelect,
            })
            if (existing) return { status: 200, favorite: toDto(existing) }
            // Favorite có thể vừa bị DELETE sau unique conflict: retry có giới hạn.
          }
        }
        throw new HttpError(
          409,
          'FAVORITE_RETRY',
          'Danh sách vừa thay đổi. Vui lòng gửi lại yêu cầu.',
        )
      } catch (error) {
        if (error?.code === 'P2003')
          throw new HttpError(
            401,
            'UNAUTHENTICATED',
            'Tài khoản của phiên đăng nhập không còn khả dụng.',
          )
        throw publicAuthError(error)
      }
    },
    async remove(userId, movieId) {
      try {
        const client = await getClient()
        await client.favorite.deleteMany({ where: { userId, movieId } })
      } catch (error) {
        throw publicAuthError(error)
      }
    },
  }
}
