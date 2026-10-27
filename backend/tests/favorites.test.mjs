import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import test from 'node:test'
import { createAppServer } from '../server.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { hashRegistrationPassword } from '../auth/password.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import {
  memoryDatabase,
  authRequest,
  cookieFrom,
  accountBindingHeaders,
} from './helpers/auth-fixture.mjs'
import { createFavoriteService } from '../favorites/favorite-service.mjs'
import {
  validateFavoriteInput,
  encodeFavoriteCursor,
} from '../favorites/validation.mjs'

const password = 'Synthetic favorite password 123!'
const passwordHash = hashRegistrationPassword(password)
const idA = 'e71d28a1-b104-44db-a159-f6af12f314b0'
const idB = 'e71d28a1-b104-44db-a159-f6af12f314b1'

async function fixture(t, options = {}) {
  let clock = new Date('2026-10-26T10:00:00.000Z')
  const client = memoryDatabase([
    {
      id: idA,
      email: 'a@fixture.test',
      name: 'Fixture A',
      passwordHash: await passwordHash,
      createdAt: clock,
    },
    {
      id: idB,
      email: 'b@fixture.test',
      name: 'Fixture B',
      passwordHash: await passwordHash,
      createdAt: clock,
    },
  ])
  const rows = new Map()
  const key = (userId, movieId) => `${userId}:${movieId}`
  const calls = client.calls
  client.favorite = {
    async create(args) {
      calls.push(['favorite.create', args])
      const { userId, movieId } = args.data
      if (rows.has(key(userId, movieId)))
        throw Object.assign(new Error('fixture unique'), { code: 'P2002' })
      const row = {
        ...args.data,
        id: randomUUID(),
        createdAt: new Date(clock),
        privateFixture: 'must-not-return',
      }
      rows.set(key(userId, movieId), row)
      return row
    },
    async findUnique(args) {
      calls.push(['favorite.findUnique', args])
      const { userId, movieId } = args.where.userId_movieId
      return rows.get(key(userId, movieId)) ?? null
    },
    async findMany(args) {
      calls.push(['favorite.findMany', args])
      return [...rows.values()]
        .filter(
          (row) =>
            (!args.where.userId || row.userId === args.where.userId) &&
            (!args.where.OR ||
              args.where.OR.some((condition) =>
                condition.createdAt?.lt
                  ? row.createdAt < condition.createdAt.lt
                  : row.createdAt.getTime() === condition.createdAt.getTime() &&
                    row.movieId < condition.movieId.lt,
              )),
        )
        .sort((a, b) => b.createdAt - a.createdAt || b.movieId - a.movieId)
        .slice(0, args.take)
    },
    async deleteMany(args) {
      calls.push(['favorite.deleteMany', args])
      let count = 0
      for (const [entry, row] of rows)
        if (
          (!args.where.userId || row.userId === args.where.userId) &&
          (args.where.movieId === undefined ||
            row.movieId === args.where.movieId)
        ) {
          rows.delete(entry)
          count++
        }
      return { count }
    },
  }
  let tmdbCalls = 0
  const config = readAuthConfig({})
  const server = createAppServer({
    auth: {
      config,
      getClient: async () => client,
      now: () => clock,
      dummyHash: async () => passwordHash,
    },
    favorites: { ...options, getClient: async () => client },
    tmdb: {
      token: 'fixture',
      fetchImpl: async () => {
        tmdbCalls++
        return Response.json({ results: [{ id: 27205 }] })
      },
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(resolve)
      }),
  )
  const base = `http://127.0.0.1:${server.address().port}`
  const login = async (email = 'a@fixture.test') => {
    const result = await authRequest(base, 'login', {
      body: { email, password },
    })
    assert.equal(result.response.status, 200)
    return cookieFrom(result)
  }
  const request = async ({
    method = 'GET',
    movieId,
    query = '',
    cookie,
    body,
    headers = {},
  } = {}) => {
    const response = await fetch(
      `${base}/api/favorites${movieId === undefined ? '' : '/' + movieId}${query}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Cineverse-CSRF': '1',
          ...(cookie ? { Cookie: cookie } : {}),
          ...accountBindingHeaders(cookie),
          ...headers,
        },
        ...(body !== undefined
          ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
          : {}),
      },
    )
    return {
      response,
      body: response.status === 204 ? null : await response.json(),
    }
  }
  return {
    base,
    config,
    client,
    rows,
    calls,
    key,
    login,
    request,
    advance: (ms) => {
      clock = new Date(clock.getTime() + ms)
    },
    tmdbCalls: () => tmdbCalls,
  }
}

for (const method of ['GET', 'POST', 'DELETE']) {
  test(`${method} Favorites không session → 401, không gọi Prisma Favorite`, async (t) => {
    const f = await fixture(t)
    const result = await f.request({
      method,
      ...(method === 'DELETE' ? { movieId: 550 } : {}),
      ...(method === 'POST' ? { body: { movieId: 550 } } : {}),
    })
    assert.equal(result.response.status, 401)
    assert.equal(result.body.error.code, 'UNAUTHENTICATED')
    assert.equal(
      f.calls.filter(([name]) => name.startsWith('favorite.')).length,
      0,
    )
  })
}

test('GET chưa có Favorite → favorites rỗng/nextCursor null; no-store và không Set-Cookie', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const result = await f.request({ cookie })
  assert.equal(result.response.status, 200)
  assert.deepEqual(result.body, { favorites: [], nextCursor: null })
  assert.equal(result.response.headers.get('cache-control'), 'no-store')
  assert.equal(result.response.headers.get('set-cookie'), null)
})

test('POST hợp lệ → 201, Prisma nhận đúng owner từ session, DTO chỉ có movieId/createdAt', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const result = await f.request({
    method: 'POST',
    cookie,
    body: { movieId: 550 },
  })
  assert.equal(result.response.status, 201)
  assert.deepEqual(result.body, {
    favorite: { movieId: 550, createdAt: '2026-10-26T10:00:00.000Z' },
  })
  assert.deepEqual(f.calls.find(([name]) => name === 'favorite.create')[1], {
    data: { userId: idA, movieId: 550 },
    select: { movieId: true, createdAt: true },
  })
  assert.ok(f.rows.has(f.key(idA, 550)))
})

test('POST trùng → 200 idempotent, không đổi createdAt hoặc tạo thêm record', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const first = await f.request({
    method: 'POST',
    cookie,
    body: { movieId: 550 },
  })
  f.advance(1000)
  const duplicate = await f.request({
    method: 'POST',
    cookie,
    body: { movieId: 550 },
  })
  assert.equal(duplicate.response.status, 200)
  assert.deepEqual(duplicate.body, first.body)
  assert.equal(f.rows.size, 1)
  assert.deepEqual(
    f.calls.find(([name]) => name === 'favorite.findUnique')[1].where,
    { userId_movieId: { userId: idA, movieId: 550 } },
  )
})

test('POST hai request đồng thời → 201/200, một record', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const create = f.client.favorite.create
  let entered = 0,
    release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  f.client.favorite.create = async (args) => {
    if (++entered === 2) release()
    await gate
    return create(args)
  }
  const results = await Promise.all(
    [1, 2].map(() =>
      f.request({ method: 'POST', cookie, body: { movieId: 550 } }),
    ),
  )
  assert.deepEqual(
    results.map((result) => result.response.status).sort(),
    [200, 201],
  )
  assert.equal(f.rows.size, 1)
})

for (const [label, value] of [
  ['zero', 0],
  ['negative', -1],
  ['fraction', 1.5],
  ['string', '550'],
  ['overflow', 2_147_483_648],
  ['null', null],
  ['boolean', true],
  ['array', []],
  ['object', {}],
]) {
  test(`POST movieId ${label} → 400 không ghi Favorite`, async (t) => {
    const f = await fixture(t),
      cookie = await f.login()
    const result = await f.request({
      method: 'POST',
      cookie,
      body: { movieId: value },
    })
    assert.equal(result.response.status, 400)
    assert.equal(result.body.error.code, 'INVALID_MOVIE_ID')
    assert.equal(f.rows.size, 0)
  })
}

test('validation service boundary không nhận NaN/Infinity; JSON sai/NaN literal → 400', async (t) => {
  for (const movieId of [NaN, Infinity, -Infinity])
    assert.throws(() => validateFavoriteInput({ movieId }), {
      code: 'INVALID_MOVIE_ID',
    })
  const f = await fixture(t),
    cookie = await f.login()
  for (const body of [
    '{"movieId":NaN}',
    '{',
    '[]',
    'null',
    '{}',
    '{"movieId":1e999}',
  ])
    assert.equal(
      (await f.request({ method: 'POST', cookie, body })).response.status,
      400,
    )
})

test('POST chỉ nhận movieId, chặn client khai userId/favoriteId/createdAt', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const injected of [
    { userId: idB },
    { id: 'client-id' },
    { createdAt: '2026-01-01T00:00:00Z' },
  ]) {
    const result = await f.request({
      method: 'POST',
      cookie,
      body: { movieId: 550, ...injected },
    })
    assert.equal(result.response.status, 400)
  }
  assert.equal(f.rows.size, 0)
})

test('GET owner scope trực tiếp trong Prisma; User B không thấy Favorites của A', async (t) => {
  const f = await fixture(t),
    a = await f.login(),
    b = await f.login('b@fixture.test')
  await f.request({ method: 'POST', cookie: a, body: { movieId: 550 } })
  assert.deepEqual((await f.request({ cookie: b })).body, {
    favorites: [],
    nextCursor: null,
  })
  const result = await f.request({ cookie: a })
  assert.equal(result.body.favorites.length, 1)
  const reads = f.calls
    .filter(([name]) => name === 'favorite.findMany')
    .map(([, args]) => args)
  assert.ok(reads.every((args) => [idA, idB].includes(args.where.userId)))
  assert.ok(
    reads.every(
      (args) =>
        args.take === 101 &&
        JSON.stringify(args.select) ===
          JSON.stringify({ movieId: true, createdAt: true }),
    ),
  )
  assert.doesNotMatch(
    JSON.stringify(result.body),
    /userId|privateFixture|passwordHash|tokenHash/,
  )
})

test('DELETE cùng movieId chỉ xóa của A; của B giữ nguyên; xóa lại/missing → 204', async (t) => {
  const f = await fixture(t),
    a = await f.login(),
    b = await f.login('b@fixture.test')
  for (const cookie of [a, b])
    await f.request({ method: 'POST', cookie, body: { movieId: 550 } })
  for (const movieId of [550, 550, 27205]) {
    const result = await f.request({ method: 'DELETE', cookie: a, movieId })
    assert.equal(result.response.status, 204)
    assert.equal(result.body, null)
    assert.equal(result.response.headers.get('set-cookie'), null)
  }
  assert.ok(!f.rows.has(f.key(idA, 550)) && f.rows.has(f.key(idB, 550)))
  assert.ok(
    f.calls
      .filter(([name]) => name === 'favorite.deleteMany')
      .every(
        ([, args]) =>
          args.where.userId === idA && Number.isInteger(args.where.movieId),
      ),
  )
})

test('DELETE từ chối ID URL sai, UUID bản ghi, overflow hoặc encoded injection', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const movieId of [
    '0',
    '-1',
    '1.5',
    '01',
    '1e2',
    '2147483648',
    'invalid',
    idA,
    '550%20',
    '550%2Fother',
  ])
    assert.equal(
      (await f.request({ method: 'DELETE', cookie, movieId })).response.status,
      400,
    )
  assert.equal(
    f.calls.filter(([name]) => name === 'favorite.deleteMany').length,
    0,
  )
})

test('movieId tối đa Int32 được chấp nhận', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  assert.equal(
    (
      await f.request({
        method: 'POST',
        cookie,
        body: { movieId: 2_147_483_647 },
      })
    ).response.status,
    201,
  )
  assert.equal(
    (await f.request({ method: 'DELETE', cookie, movieId: '2147483647' }))
      .response.status,
    204,
  )
})

test('cookie sai, session hết hạn hoặc đã logout đều không đọc/ghi Favorites', async (t) => {
  const f = await fixture(t)
  const expired = await f.login()
  f.advance(7 * 86400_000)
  const revoked = await f.login()
  await authRequest(f.base, 'logout', { cookie: revoked })
  for (const cookie of [
    expired,
    revoked,
    'cineverse_session=invalid',
    'cineverse_session=' + 'x'.repeat(43),
  ]) {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const result = await f.request({
        method,
        cookie,
        ...(method === 'POST' ? { body: { movieId: 550 } } : {}),
        ...(method === 'DELETE' ? { movieId: 550 } : {}),
      })
      assert.equal(result.response.status, 401)
      assert.equal(result.body.error.code, 'UNAUTHENTICATED')
    }
  }
  assert.equal(
    f.calls.filter(([name]) => name.startsWith('favorite.')).length,
    0,
  )
})

test(
  'POST gửi body chậm: session logout/hết hạn trong lúc đọc body → 401, không ghi Favorite',
  { timeout: 5000 },
  async (t) => {
    for (const mode of ['logout', 'expire']) {
      const f = await fixture(t),
        cookie = await f.login()
      const lookup = f.client.session.findUnique
      let reached
      const authenticated = new Promise((resolve) => {
        reached = resolve
      })
      f.client.session.findUnique = async (args) => {
        const result = await lookup(args)
        reached()
        return result
      }
      let pending
      const result = new Promise((resolve, reject) => {
        pending = httpRequest(
          f.base + '/api/favorites',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Cineverse-CSRF': '1',
              Cookie: cookie,
              ...accountBindingHeaders(cookie),
            },
          },
          (response) => {
            let body = ''
            response.setEncoding('utf8')
            response.on('data', (chunk) => {
              body += chunk
            })
            response.on('end', () =>
              resolve({ status: response.statusCode, body: JSON.parse(body) }),
            )
            response.on('error', reject)
          },
        )
        pending.on('error', reject)
        pending.write('{"movieId":')
      })
      t.after(() => pending.destroy())
      await authenticated
      if (mode === 'logout') await authRequest(f.base, 'logout', { cookie })
      else f.advance(7 * 86400_000)
      pending.end('550}')
      const response = await result
      assert.equal(response.status, 401)
      assert.equal(response.body.error.code, 'UNAUTHENTICATED')
      assert.equal(f.rows.size, 0)
      assert.equal(
        f.calls.filter(([name]) => name === 'favorite.create').length,
        0,
      )
    }
  },
)

test('POST/DELETE thiếu/sai CSRF bị 403; DELETE cũng giữ fetch-metadata/Origin policy', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const method of ['POST', 'DELETE']) {
    for (const headers of [
      { 'X-Cineverse-CSRF': '' },
      { 'X-Cineverse-CSRF': 'wrong' },
      { Origin: 'https://attacker.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-origin' },
    ]) {
      const result = await f.request({
        method,
        cookie,
        headers,
        ...(method === 'POST' ? { body: { movieId: 550 } } : { movieId: 550 }),
      })
      assert.equal(result.response.status, 403)
    }
  }
  assert.equal(
    (
      await f.request({
        cookie,
        headers: { Origin: 'https://attacker.example' },
      })
    ).response.status,
    403,
  )
  assert.equal(f.rows.size, 0)
})

test('trusted Origin với fetch metadata được chấp nhận, không bật CORS', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const result = await f.request({
    method: 'POST',
    cookie,
    body: { movieId: 550 },
    headers: {
      Origin: 'http://localhost:5173',
      'Sec-Fetch-Site': 'same-origin',
    },
  })
  assert.equal(result.response.status, 201)
  assert.equal(result.response.headers.get('access-control-allow-origin'), null)
})

test('query userId/unknown params bị từ chối, DELETE không nhận body', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const method of ['GET', 'POST', 'DELETE']) {
    const result = await f.request({
      method,
      cookie,
      query: '?userId=' + idB,
      ...(method === 'POST' ? { body: { movieId: 550 } } : {}),
      ...(method === 'DELETE' ? { movieId: 550 } : {}),
    })
    assert.equal(result.response.status, 400)
  }
  assert.equal(
    (
      await f.request({
        method: 'DELETE',
        cookie,
        movieId: 550,
        body: { userId: idB },
      })
    ).response.status,
    400,
  )
  assert.equal(f.rows.size, 0)
})

test('method không hỗ trợ trả 405/Allow; path không hỗ trợ trả 404', async (t) => {
  const f = await fixture(t)
  for (const method of ['PUT', 'PATCH', 'OPTIONS', 'DELETE']) {
    const result = await f.request({ method })
    assert.equal(result.response.status, 405)
    assert.equal(result.response.headers.get('allow'), 'GET, POST')
  }
  assert.equal(
    (await f.request({ movieId: 550 })).response.headers.get('allow'),
    'DELETE',
  )
  assert.equal(
    (await f.request({ movieId: '550/extra', method: 'DELETE' })).response
      .status,
    404,
  )
})

test('POST body cap/Content-Type/Content-Encoding tái sử dụng HTTP utility', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  assert.equal(
    (
      await f.request({
        method: 'POST',
        cookie,
        body: { movieId: 'x'.repeat(17000) },
      })
    ).response.status,
    413,
  )
  assert.equal(
    (
      await f.request({
        method: 'POST',
        cookie,
        body: { movieId: 550 },
        headers: { 'Content-Type': 'text/plain' },
      })
    ).response.status,
    415,
  )
  assert.equal(
    (
      await f.request({
        method: 'POST',
        cookie,
        body: { movieId: 550 },
        headers: { 'Content-Encoding': 'gzip' },
      })
    ).response.status,
    415,
  )
})

test('database errors safe trên GET/POST/DELETE; session lookup lỗi cũng không bị coi là guest', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const fail = (code) => async () => {
    throw Object.assign(new Error('private-fixture-detail'), { code })
  }
  for (const code of ['P1001', 'P2021', 'P2024', 'UNKNOWN']) {
    f.client.favorite.findMany = fail(code)
    f.client.favorite.create = fail(code)
    f.client.favorite.deleteMany = fail(code)
    for (const method of ['GET', 'POST', 'DELETE']) {
      const result = await f.request({
        method,
        cookie,
        ...(method === 'POST' ? { body: { movieId: 550 } } : {}),
        ...(method === 'DELETE' ? { movieId: 550 } : {}),
      })
      assert.equal(result.response.status, code === 'UNKNOWN' ? 500 : 503)
      assert.ok(!JSON.stringify(result.body).includes('private-fixture-detail'))
    }
  }
  f.client.session.findUnique = fail('P1001')
  assert.equal((await f.request({ cookie })).response.status, 503)
})

test('ordering createdAt desc + movieId desc; phân trang 100 không trùng và không lẫn User', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (let id = 1; id <= 205; id++) {
    f.rows.set(f.key(idA, id), {
      id: randomUUID(),
      userId: idA,
      movieId: id,
      createdAt: new Date(
        id <= 102 ? '2026-10-26T09:00:00Z' : '2026-10-26T10:00:00Z',
      ),
    })
    f.rows.set(f.key(idB, 1000 + id), {
      id: randomUUID(),
      userId: idB,
      movieId: 1000 + id,
      createdAt: new Date('2026-10-26T11:00:00Z'),
    })
  }
  const all = []
  let cursor = null,
    pages = 0
  do {
    const result = await f.request({
      cookie,
      query: cursor ? '?cursor=' + encodeURIComponent(cursor) : '',
    })
    assert.equal(result.response.status, 200)
    assert.ok(result.body.favorites.length <= 100)
    all.push(...result.body.favorites.map((row) => row.movieId))
    cursor = result.body.nextCursor
    pages++
  } while (cursor && pages < 5)
  assert.equal(pages, 3)
  assert.equal(all.length, 205)
  assert.equal(new Set(all).size, 205)
  assert.deepEqual(
    all,
    Array.from({ length: 205 }, (_, index) => 205 - index),
  )
})

test('cursor không chứa owner; cursor của B không làm GET của A lộ dữ liệu B', async (t) => {
  const f = await fixture(t),
    a = await f.login(),
    b = await f.login('b@fixture.test')
  for (let id = 1; id <= 101; id++)
    f.rows.set(f.key(idB, id), {
      userId: idB,
      movieId: id,
      createdAt: new Date('2026-10-26T10:00:00Z'),
    })
  const cursor = (await f.request({ cookie: b })).body.nextCursor
  assert.ok(typeof cursor === 'string')
  assert.deepEqual(
    (await f.request({ cookie: a, query: '?cursor=' + cursor })).body,
    { favorites: [], nextCursor: null },
  )
})

test('cursor/query sai định dạng được 400, không echo input', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const values = [
    '',
    'invalid',
    'x'.repeat(257),
    encodeFavoriteCursor({ movieId: 0, createdAt: '2026-10-26T10:00:00.000Z' }),
    encodeFavoriteCursor({ movieId: 1, createdAt: 'invalid' }),
    encodeFavoriteCursor({ movieId: 1, createdAt: '0000-01-01T00:00:00.000Z' }),
  ]
  for (const value of values)
    assert.equal(
      (await f.request({ cookie, query: '?cursor=' + value })).response.status,
      400,
    )
  assert.equal(
    (await f.request({ cookie, query: '?cursor=x&cursor=y' })).body.error.code,
    'INVALID_QUERY',
  )
  assert.equal(
    (await f.request({ cookie, query: '?limit=100000' })).response.status,
    400,
  )
})

test('rate limits IP và mutations/User có Retry-After; không ghi Favorite khi bị chặn', async (t) => {
  const f = await fixture(t, {
    userLimiter: createRegisterLimiter({ limit: 1 }),
    ipLimiter: createRegisterLimiter({ limit: 3 }),
  })
  const cookie = await f.login()
  assert.equal(
    (await f.request({ method: 'POST', cookie, body: { movieId: 550 } }))
      .response.status,
    201,
  )
  const limited = await f.request({ method: 'DELETE', cookie, movieId: 550 })
  assert.equal(limited.response.status, 429)
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0)
  assert.ok(f.rows.has(f.key(idA, 550)))
  await f.request({ cookie })
  assert.equal((await f.request({ cookie })).response.status, 429)
})

test('POST unique conflict rồi concurrent DELETE: retry bounded và không trả favorite null', async () => {
  let attempts = 0
  const row = { movieId: 550, createdAt: new Date('2026-10-26T10:00:00Z') }
  const service = createFavoriteService({
    getClient: async () => ({
      favorite: {
        create: async () => {
          if (++attempts === 1)
            throw Object.assign(new Error('fixture'), { code: 'P2002' })
          return row
        },
        findUnique: async () => null,
      },
    }),
  })
  assert.equal((await service.add(idA, 550)).status, 201)
  assert.equal(attempts, 2)
  const unstable = createFavoriteService({
    getClient: async () => ({
      favorite: {
        create: async () => {
          throw Object.assign(new Error('fixture'), { code: 'P2002' })
        },
        findUnique: async () => null,
      },
    }),
  })
  await assert.rejects(unstable.add(idA, 550), {
    code: 'FAVORITE_RETRY',
    status: 409,
  })
})

test('User bị xóa giữa session validation và create: safe 401', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  f.client.favorite.create = async () => {
    throw Object.assign(new Error('private fixture foreign key'), {
      code: 'P2003',
    })
  }
  const result = await f.request({
    method: 'POST',
    cookie,
    body: { movieId: 550 },
  })
  assert.equal(result.response.status, 401)
  assert.equal(result.body.error.code, 'UNAUTHENTICATED')
})

test('Favorites không gọi TMDB; Me/Logout và TMDB routes vẫn hoạt động', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  await f.request({ method: 'POST', cookie, body: { movieId: 550 } })
  await f.request({ cookie })
  await f.request({ method: 'DELETE', cookie, movieId: 550 })
  assert.equal(f.tmdbCalls(), 0)
  assert.equal(
    (await authRequest(f.base, 'me', { cookie })).response.status,
    200,
  )
  assert.equal(
    (await authRequest(f.base, 'logout', { cookie })).response.status,
    204,
  )
  const movie = await fetch(f.base + '/api/movies/popular')
  assert.equal(movie.status, 200)
  assert.equal(f.tmdbCalls(), 1)
})

test('responses/logs không có cookie, password/hash hoặc trường nội bộ Favorite', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const logs = [],
    methods = ['log', 'info', 'warn', 'error', 'debug']
  const previous = methods.map((method) => console[method])
  const results = []
  try {
    methods.forEach((method) => {
      console[method] = (...args) => logs.push(args.join(' '))
    })
    results.push(
      (await f.request({ method: 'POST', cookie, body: { movieId: 550 } }))
        .body,
    )
    results.push((await f.request({ cookie })).body)
    await f.request({ method: 'DELETE', cookie, movieId: 550 })
  } finally {
    methods.forEach((method, index) => {
      console[method] = previous[index]
    })
  }
  const output = JSON.stringify(results) + logs.join('\n')
  for (const secret of [
    cookie,
    password,
    await passwordHash,
    'passwordHash',
    'tokenHash',
    'privateFixture',
    'userId',
  ])
    assert.ok(!output.includes(secret))
})
