import { memoryDatabase } from './auth-fixture.mjs'

// Chỉ dành cho tests: transaction/rollback từ fixture auth, thêm Session row lock/CAS/Profile.
export function memoryAccountDatabase(users) {
  const client = memoryDatabase(users)
  const favorites = new Map()
  const findUser = client.user.findUnique
  client.user.findUnique = async (args) => {
    const user = await findUser(args)
    return user
      ? {
          ...user,
          _count: {
            favorites: [...favorites.values()].filter(
              (row) => row.userId === user.id,
            ).length,
          },
        }
      : null
  }
  client.user.updateMany = async (args) => {
    client.calls.push(['user.updateMany', args])
    const user = client.users.find(
      (user) =>
        user.id === args.where.id &&
        user.passwordHash === args.where.passwordHash,
    )
    if (!user) return { count: 0 }
    Object.assign(user, args.data)
    return { count: 1 }
  }
  const queryRaw = client.$queryRaw
  client.$queryRaw = async (sql, ...values) => {
    if (!sql.join('').includes('FROM public."Session"'))
      return queryRaw(sql, ...values)
    client.calls.push([
      'session.lock',
      { userId: values[0], tokenHash: values[1], expiresAt: values[2] },
    ])
    return [...client.sessions.values()]
      .filter(
        (row) =>
          row.userId === values[0] &&
          row.tokenHash === values[1] &&
          row.expiresAt > values[2],
      )
      .map(({ id }) => ({ id }))
  }
  const key = (userId, movieId) => `${userId}:${movieId}`
  client.favorite = {
    findMany: async ({ where, take }) =>
      [...favorites.values()]
        .filter((row) => row.userId === where.userId)
        .slice(0, take),
    create: async ({ data }) => {
      if (favorites.has(key(data.userId, data.movieId)))
        throw Object.assign(new Error('fixture unique'), { code: 'P2002' })
      const row = { ...data, createdAt: new Date() }
      favorites.set(key(data.userId, data.movieId), row)
      return row
    },
    findUnique: async ({
      where: {
        userId_movieId: { userId, movieId },
      },
    }) => favorites.get(key(userId, movieId)),
    deleteMany: async ({ where }) => ({
      count: Number(favorites.delete(key(where.userId, where.movieId))),
    }),
  }
  return { client, favorites }
}
