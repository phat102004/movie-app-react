import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createAppServer } from '../../server.mjs'
import { readAuthConfig } from '../../auth/config.mjs'
import { createLoginLimiter } from '../../auth/login-rate-limit.mjs'
import { createRegisterLimiter } from '../../auth/rate-limit.mjs'

export function memoryDatabase(users) {
  const sessions = new Map()
  const resetTokens = new Map()
  const calls = []
  const match = (row, where = {}) =>
    (!where.tokenHash || row.tokenHash === where.tokenHash) &&
    (!where.userId || row.userId === where.userId) &&
    (!where.id || where.id.in.includes(row.id)) &&
    (!where.expiresAt ||
      (where.expiresAt.gt
        ? row.expiresAt > where.expiresAt.gt
        : row.expiresAt <= where.expiresAt.lte))
  let tail = Promise.resolve()
  const client = {
    users,
    sessions,
    resetTokens,
    calls,
    user: {
      findUnique: async (args) => {
        calls.push(['user.findUnique', args])
        return (
          users.find((user) =>
            args.where.id
              ? user.id === args.where.id
              : user.email === args.where.email,
          ) ?? null
        )
      },
      update: async (args) => {
        calls.push(['user.update', args])
        const user = users.find((row) => row.id === args.where.id)
        Object.assign(user, args.data)
        return user
      },
    },
    $queryRaw: async (_query, userId) => {
      calls.push(['user.lock', userId])
      return users
        .filter((user) => user.id === userId)
        .map(({ id }) => ({ id }))
    },
    $transaction: async (callback) => {
      const previous = tail
      let release
      tail = new Promise((resolve) => {
        release = resolve
      })
      await previous
      const backup = new Map(sessions)
      const tokenBackup = new Map(resetTokens)
      const userBackup = structuredClone(users)
      try {
        return await callback(client)
      } catch (error) {
        sessions.clear()
        for (const [id, session] of backup) sessions.set(id, session)
        resetTokens.clear()
        for (const [id, row] of tokenBackup) resetTokens.set(id, row)
        users.splice(0, users.length, ...userBackup)
        throw error
      } finally {
        release()
      }
    },
    passwordResetToken: {
      create: async ({ data }) => {
        calls.push(['passwordResetToken.create', { data }])
        if (
          [...resetTokens.values()].some(
            (row) =>
              row.userId === data.userId || row.tokenHash === data.tokenHash,
          )
        )
          throw new Error('fixture unique constraint')
        const row = { ...data, id: randomUUID() }
        resetTokens.set(row.id, row)
        return row
      },
      findUnique: async ({ where }) =>
        [...resetTokens.values()].find(
          (row) => row.tokenHash === where.tokenHash,
        ) ?? null,
      deleteMany: async ({ where }) => {
        let count = 0
        for (const [id, row] of resetTokens)
          if (match(row, where)) {
            resetTokens.delete(id)
            count++
          }
        return { count }
      },
    },
    session: {
      create: async (args) => {
        calls.push(['session.create', args])
        const row = { ...args.data, id: randomUUID() }
        sessions.set(row.id, row)
        return { id: row.id }
      },
      findUnique: async (args) => {
        calls.push(['session.findUnique', args])
        const row = [...sessions.values()].find(
          (session) => session.tokenHash === args.where.tokenHash,
        )
        return row
          ? {
              ...row,
              user: users.find((user) => user.id === row.userId) ?? null,
            }
          : null
      },
      findMany: async (args) => {
        calls.push(['session.findMany', args])
        const rows = [...sessions.values()].filter((row) =>
          match(row, args.where),
        )
        rows.sort((a, b) =>
          args.orderBy?.expiresAt === 'asc'
            ? a.expiresAt - b.expiresAt
            : b.createdAt - a.createdAt || b.id.localeCompare(a.id),
        )
        return rows
          .slice(
            args.skip ?? 0,
            args.take ? (args.skip ?? 0) + args.take : undefined,
          )
          .map(({ id }) => ({ id }))
      },
      deleteMany: async (args) => {
        calls.push(['session.deleteMany', args])
        let count = 0
        for (const [id, row] of sessions)
          if (match(row, args.where)) {
            sessions.delete(id)
            count++
          }
        return { count }
      },
    },
  }
  return client
}

export async function startAuthServer(
  t,
  { client, config = readAuthConfig({}), passwordReset = {}, ...auth } = {},
) {
  const server = createAppServer({
    passwordReset,
    auth: {
      config,
      getClient: async () => client,
      limiter: createLoginLimiter({
        ip: createRegisterLimiter({ limit: 200 }),
        account: createRegisterLimiter({ limit: 200 }),
      }),
      ...auth,
    },
    tmdb: {
      token: 'fixture',
      fetchImpl: async () => Response.json({ results: [{ id: 27205 }] }),
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const close = () =>
    new Promise((resolve) => {
      if (!server.listening) return resolve()
      server.closeAllConnections()
      server.close(resolve)
    })
  t.after(close)
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    server,
    config,
    close,
  }
}

export async function authRequest(
  base,
  path,
  {
    method = path === 'me' ? 'GET' : 'POST',
    body = {},
    cookie,
    headers = {},
  } = {},
) {
  const response = await fetch(`${base}/api/auth/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Cineverse-CSRF': '1',
      ...(cookie ? { Cookie: cookie } : {}),
      ...accountBindingHeaders(cookie),
      ...headers,
    },
    ...(method === 'POST'
      ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  })
  return {
    response,
    body: response.status === 204 ? null : await response.json(),
  }
}

const fixtureAccounts = new Map()
export function accountBindingHeaders(cookie) {
  const owner = fixtureAccounts.get(cookie)
  return owner ? { 'X-Cineverse-Account': owner } : {}
}
export function cookieFrom(result) {
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0]
  if (cookie && result.body?.user?.id) fixtureAccounts.set(cookie, result.body.user.id)
  return cookie
}
