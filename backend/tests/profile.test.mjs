import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import test from 'node:test'
import { createAppServer } from '../server.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import { hashRegistrationPassword } from '../auth/password.mjs'
import { hashSessionToken } from '../auth/session-service.mjs'
import { safeUserSelect } from '../auth/user-dto.mjs'
import { validateProfileInput } from '../profile/validation.mjs'
import { createRegistrationService } from '../auth/register-service.mjs'
import {
  memoryDatabase,
  authRequest,
  cookieFrom,
  accountBindingHeaders,
} from './helpers/auth-fixture.mjs'

const password = 'Synthetic profile password 123!'
const passwordHash = hashRegistrationPassword(password)
const userA = 'e71d28a1-b104-44db-a159-f6af12f314b0'
const userB = 'e71d28a1-b104-44db-a159-f6af12f314b1'
const expectedSelect = {
  ...safeUserSelect,
  _count: { select: { favorites: true } },
}

async function fixture(t, profile = {}) {
  let clock = new Date('2026-10-27T10:00:00.000Z')
  const client = memoryDatabase(
    [userA, userB].map((id, index) => ({
      id,
      email: `${index ? 'b' : 'a'}@fixture.test`,
      name: index ? 'Fixture B' : 'Fixture A',
      passwordHash: null,
      createdAt: new Date(clock),
      updatedAt: new Date(clock),
    })),
  )
  for (const user of client.users) user.passwordHash = await passwordHash
  const favorites = new Map()
  const key = (userId, movieId) => `${userId}:${movieId}`
  const decorate = (user) =>
    user
      ? {
          ...user,
          _count: {
            favorites: [...favorites.values()].filter(
              (row) => row.userId === user.id,
            ).length,
          },
          privateFixture: 'discard-this-field',
        }
      : null
  const findUser = client.user.findUnique
  client.user.findUnique = async (args) => decorate(await findUser(args))
  client.user.update = async (args) => {
    client.calls.push(['user.update', args])
    const user = client.users.find((row) => row.id === args.where.id)
    const session = args.where.sessions?.some
    if (
      !user ||
      !session ||
      ![...client.sessions.values()].some(
        (row) =>
          row.userId === user.id &&
          row.tokenHash === session.tokenHash &&
          row.expiresAt > session.expiresAt.gt,
      )
    )
      throw Object.assign(new Error('fixture no row matching write'), {
        code: 'P2025',
      })
    Object.assign(user, args.data, { updatedAt: new Date(clock) })
    return decorate(user)
  }
  client.user.create = async ({ data }) => {
    const user = {
      ...data,
      id: 'e71d28a1-b104-44db-a159-f6af12f314b2',
      createdAt: new Date(clock),
      updatedAt: new Date(clock),
    }
    client.users.push(user)
    return user
  }
  client.favorite = {
    findMany: async (args) => {
      client.calls.push(['favorite.findMany', args])
      return [...favorites.values()]
        .filter((row) => row.userId === args.where.userId)
        .sort((a, b) => b.createdAt - a.createdAt || b.movieId - a.movieId)
        .slice(0, args.take)
    },
    create: async ({ data }) => {
      if (favorites.has(key(data.userId, data.movieId)))
        throw Object.assign(new Error('fixture unique'), { code: 'P2002' })
      const row = { ...data, createdAt: new Date(clock) }
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
  const config = readAuthConfig({})
  let tmdbCalls = 0
  const server = createAppServer({
    auth: {
      config,
      getClient: async () => client,
      now: () => clock,
      dummyHash: async () => passwordHash,
    },
    registration: {
      registerUser: createRegistrationService({
        getClient: async () => client,
      }),
    },
    profile,
    tmdb: {
      token: 'fixture',
      fetchImpl: async () => {
        tmdbCalls++
        return Response.json({ results: [] })
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
    cookie,
    body,
    query = '',
    path = '/api/profile',
    headers = {},
  } = {}) => {
    const response = await fetch(base + path + query, {
      method,
      headers: {
        'X-Cineverse-CSRF': '1',
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...accountBindingHeaders(cookie),
        ...headers,
      },
      ...(body !== undefined
        ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
        : {}),
    })
    return { response, body: await response.json() }
  }
  return {
    base,
    config,
    client,
    favorites,
    key,
    login,
    request,
    advance: (ms) => {
      clock = new Date(clock.getTime() + ms)
    },
    tmdbCalls: () => tmdbCalls,
  }
}

test('L01: HTTP Register and authenticated PATCH reject C1 without creating or updating a user', async t => {
  const f = await fixture(t)
  const cookie = await f.login()
  const before = f.client.users.length
  const name = 'A\u009fB'
  const registration = await authRequest(f.base, 'register', {
    body: { name, email: 'new@fixture.test', password },
  })
  assert.equal(registration.response.status, 400)
  const patch = await f.request({ method: 'PATCH', cookie, body: { name } })
  assert.equal(patch.response.status, 400)
  assert.equal(f.client.users.length, before)
  assert.equal(f.client.users.find(row => row.id === userA).name, 'Fixture A')
  assert.equal(f.client.calls.some(([name]) => name === 'user.update'), false)
})

function assertProfile(
  result,
  { id = userA, name = 'Fixture A', favoriteCount = 0 } = {},
) {
  assert.equal(result.response.status, 200)
  assert.deepEqual(Object.keys(result.body), ['profile'])
  assert.deepEqual(
    Object.keys(result.body.profile).sort(),
    ['id', 'name', 'email', 'createdAt', 'favoriteCount'].sort(),
  )
  assert.equal(result.body.profile.id, id)
  assert.equal(result.body.profile.name, name)
  assert.equal(result.body.profile.favoriteCount, favoriteCount)
}

for (const method of ['GET', 'PATCH'])
  test(`${method} không session → 401, không query hồ sơ`, async (t) => {
    const f = await fixture(t)
    const result = await f.request({
      method,
      ...(method === 'PATCH' ? { body: { name: 'New name' } } : {}),
    })
    assert.equal(result.response.status, 401)
    assert.equal(result.body.error.code, 'UNAUTHENTICATED')
    assert.equal(f.client.calls.length, 0)
  })

test('GET profile an toàn, no-store/nosniff/no-referrer và không tạo cookie mới', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const result = await f.request({ cookie })
  assertProfile(result)
  assert.equal(result.body.profile.email, 'a@fixture.test')
  assert.equal(result.body.profile.createdAt, '2026-10-27T10:00:00.000Z')
  assert.equal(result.response.headers.get('cache-control'), 'no-store')
  assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(result.response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(result.response.headers.get('set-cookie'), null)
  const [, args] = f.client.calls.findLast(
    ([name]) => name === 'user.findUnique',
  )
  assert.deepEqual(args, { where: { id: userA }, select: expectedSelect })
})

test('GET _count đếm đúng owner, không tải danh sách Favorite hoặc đọc count của B', async (t) => {
  const f = await fixture(t),
    a = await f.login(),
    b = await f.login('b@fixture.test')
  for (const [id, total] of [
    [userA, 2],
    [userB, 4],
  ])
    for (let movieId = 1; movieId <= total; movieId++)
      f.favorites.set(f.key(id, movieId), {
        userId: id,
        movieId,
        createdAt: new Date(),
      })
  assertProfile(await f.request({ cookie: a }), { favoriteCount: 2 })
  assertProfile(await f.request({ cookie: b }), {
    id: userB,
    name: 'Fixture B',
    favoriteCount: 4,
  })
  assert.equal(
    f.client.calls.some(([name]) => name.startsWith('favorite.')),
    false,
  )
})

test('PATCH trim tên; update chỉ data.name/owner/session; Me phản ánh tên mới', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const original = structuredClone(f.client.users)
  const result = await f.request({
    method: 'PATCH',
    cookie,
    body: { name: '  Nguyễn Phát 🎬  ' },
  })
  assertProfile(result, { name: 'Nguyễn Phát 🎬' })
  const [, args] = f.client.calls.findLast(([name]) => name === 'user.update')
  assert.deepEqual(args.data, { name: 'Nguyễn Phát 🎬' })
  assert.equal(args.where.id, userA)
  assert.equal(
    args.where.sessions.some.tokenHash,
    hashSessionToken(cookie.split('=')[1]),
  )
  assert.equal(
    args.where.sessions.some.expiresAt.gt.toISOString(),
    '2026-10-27T10:00:00.000Z',
  )
  assert.deepEqual(args.select, expectedSelect)
  const me = await authRequest(f.base, 'me', { cookie })
  assert.equal(me.body.user.name, 'Nguyễn Phát 🎬')
  for (const field of ['id', 'email', 'passwordHash', 'createdAt'])
    assert.deepEqual(f.client.users[0][field], original[0][field])
  assert.deepEqual(f.client.users[1], original[1])
  assert.equal(result.response.headers.get('set-cookie'), null)
})

for (const [label, name] of [
  ['rỗng', ''],
  ['whitespace', ' \t\n '],
  ['dài 101', 'a'.repeat(101)],
  ['Unicode 101', '🎬'.repeat(101)],
  ['number', 42],
  ['null', null],
  ['array', []],
  ['object', {}],
  ['boolean', true],
  ['control', 'A\u0000B'],
  ['DEL', 'A\u007fB'],
])
  test(`PATCH tên ${label} → 400, không update`, async (t) => {
    const f = await fixture(t),
      cookie = await f.login()
    const result = await f.request({ method: 'PATCH', cookie, body: { name } })
    assert.equal(result.response.status, 400)
    assert.equal(result.body.error.code, 'VALIDATION_ERROR')
    assert.ok(result.body.error.fields.name)
    assert.equal(
      f.client.calls.some(([name]) => name === 'user.update'),
      false,
    )
  })

test('PATCH tên Unicode 100 và tối thiểu 1 code point hợp lệ; validation dùng chung Register', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const name of ['🎬'.repeat(100), 'A'])
    assertProfile(
      await f.request({ method: 'PATCH', cookie, body: { name } }),
      { name },
    )
  assert.deepEqual(validateProfileInput({ name: '  Tên  ' }), { name: 'Tên' })
})

test('PATCH strict keys chặn mass assignment/User B, thiếu name và body không là object', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const field of [
    'id',
    'userId',
    'email',
    'role',
    'password',
    'passwordHash',
    'createdAt',
    'updatedAt',
    'sessions',
    'favorites',
    '__proto__',
  ]) {
    const result = await f.request({
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ name: 'Attempt', [field]: userB }),
    })
    assert.equal(result.response.status, 400)
  }
  for (const body of [
    null,
    [],
    42,
    '"name"',
    {},
    { displayName: 'wrong field' },
  ])
    assert.equal(
      (await f.request({ method: 'PATCH', cookie, body })).response.status,
      400,
    )
  assert.equal(
    f.client.calls.some(([name]) => name === 'user.update'),
    false,
  )
  assert.equal(f.client.users[1].name, 'Fixture B')
})

test('GET/PATCH từ chối query userId/id hoặc query lạ; path User B không được hỗ trợ', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const method of ['GET', 'PATCH'])
    for (const query of [`?userId=${userB}`, `?id=${userB}`, '?x=1'])
      assert.equal(
        (
          await f.request({
            method,
            cookie,
            query,
            ...(method === 'PATCH' ? { body: { name: 'Attempt' } } : {}),
          })
        ).response.status,
        400,
      )
  assert.equal(
    (await f.request({ cookie, path: `/api/profile/${userB}` })).response
      .status,
    404,
  )
  assert.equal(f.tmdbCalls(), 0)
})

test('PATCH thiếu/sai CSRF, Origin hoặc fetch metadata sai bị 403; trusted origin hoạt động', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const headers of [
    { 'X-Cineverse-CSRF': '' },
    { 'X-Cineverse-CSRF': 'wrong' },
    { Origin: 'https://attacker.invalid' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-origin' },
  ]) {
    assert.equal(
      (
        await f.request({
          method: 'PATCH',
          cookie,
          body: { name: 'Denied' },
          headers,
        })
      ).response.status,
      403,
    )
  }
  const headers = {
    Origin: [...f.config.allowedOrigins][0],
    'Sec-Fetch-Site': 'same-origin',
  }
  const allowed = await f.request({
    method: 'PATCH',
    cookie,
    body: { name: 'Allowed' },
    headers,
  })
  assertProfile(allowed, { name: 'Allowed' })
  assert.equal(
    allowed.response.headers.get('access-control-allow-origin'),
    null,
  )
  assert.equal(
    (
      await f.request({
        cookie,
        headers: { Origin: 'https://attacker.invalid' },
      })
    ).response.status,
    403,
  )
})

test('Session hết hạn, revoked, malformed, unknown và User mất → 401 cho GET/PATCH', async (t) => {
  const f = await fixture(t),
    expired = await f.login()
  f.advance(7 * 86400_000)
  const revoked = await f.login()
  await authRequest(f.base, 'logout', { cookie: revoked })
  const deleted = await f.login('b@fixture.test')
  f.client.users.splice(1, 1)
  for (const cookie of [
    expired,
    revoked,
    deleted,
    'cineverse_session=bad',
    'cineverse_session=' + 'x'.repeat(43),
  ])
    for (const method of ['GET', 'PATCH']) {
      const result = await f.request({
        method,
        cookie,
        ...(method === 'PATCH' ? { body: { name: 'Denied' } } : {}),
      })
      assert.equal(result.response.status, 401)
      assert.equal(result.body.error.code, 'UNAUTHENTICATED')
    }
  assert.equal(
    f.client.calls.some(([name]) => name === 'user.update'),
    false,
  )
})

test(
  'PATCH body chậm: Logout hoặc hết hạn trước body hoàn tất → 401, không ghi',
  { timeout: 5000 },
  async (t) => {
    for (const action of ['logout', 'expire']) {
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
          f.base + '/api/profile',
          {
            method: 'PATCH',
            headers: {
              Cookie: cookie,
              ...accountBindingHeaders(cookie),
              'Content-Type': 'application/json',
              'X-Cineverse-CSRF': '1',
            },
          },
          (response) => {
            let data = ''
            response.on('data', (chunk) => {
              data += chunk
            })
            response.on('end', () =>
              resolve({ status: response.statusCode, data: JSON.parse(data) }),
            )
          },
        )
        pending.on('error', reject)
        pending.write('{"name":')
      })
      t.after(() => pending.destroy())
      await authenticated
      if (action === 'logout') await authRequest(f.base, 'logout', { cookie })
      else f.advance(7 * 86400_000)
      pending.end('"Too late"}')
      const response = await result
      assert.equal(response.status, 401)
      assert.equal(response.data.error.code, 'UNAUTHENTICATED')
      assert.equal(
        f.client.calls.some(([name]) => name === 'user.update'),
        false,
      )
    }
  },
)

test('Thu hồi session ngay trước write: điều kiện Prisma chặn update, P2025 → 401', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const update = f.client.user.update
  f.client.user.update = async (args) => {
    f.client.sessions.clear()
    return update(args)
  }
  const result = await f.request({
    method: 'PATCH',
    cookie,
    body: { name: 'Too late' },
  })
  assert.equal(result.response.status, 401)
  assert.equal(result.body.error.code, 'UNAUTHENTICATED')
  assert.equal(f.client.users[0].name, 'Fixture A')
})

test('Hết hạn ngay trước write: where.expiresAt.gt chặn phiên không còn hiệu lực', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const update = f.client.user.update
  f.client.user.update = async (args) => {
    for (const session of f.client.sessions.values())
      session.expiresAt = args.where.sessions.some.expiresAt.gt
    return update(args)
  }
  assert.equal(
    (await f.request({ method: 'PATCH', cookie, body: { name: 'Too late' } }))
      .response.status,
    401,
  )
  assert.equal(f.client.users[0].name, 'Fixture A')
})

test('User bị xóa sau verifier: GET null/PATCH P2025 đều trả 401 an toàn', async (t) => {
  for (const method of ['GET', 'PATCH']) {
    const f = await fixture(t),
      cookie = await f.login()
    const delegate = method === 'GET' ? 'findUnique' : 'update'
    const original = f.client.user[delegate]
    f.client.user[delegate] = async (args) => {
      f.client.users.length = 0
      return original(args)
    }
    const result = await f.request({
      method,
      cookie,
      ...(method === 'PATCH' ? { body: { name: 'Denied' } } : {}),
    })
    assert.equal(result.response.status, 401)
  }
})

test('Body limit/JSON/content type/encoding sai → 413/400/415, không ghi', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const [body, headers, status] of [
    ['{"name":"' + 'x'.repeat(16 * 1024) + '"}', {}, 413],
    ['{bad', {}, 400],
    ['{"name":"Good"}', { 'Content-Type': 'text/plain' }, 415],
    ['{"name":"Good"}', { 'Content-Encoding': 'gzip' }, 415],
  ])
    assert.equal(
      (await f.request({ method: 'PATCH', cookie, body, headers })).response
        .status,
      status,
    )
  assert.equal(
    f.client.calls.some(([name]) => name === 'user.update'),
    false,
  )
})

test('Unsupported methods 405 + Allow; GET body 400', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const result = await f.request({ method, cookie })
    assert.equal(result.response.status, 405)
    assert.equal(result.response.headers.get('allow'), 'GET, PATCH')
  }
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(
      f.base + '/api/profile',
      { method: 'GET', headers: { Cookie: cookie, ...accountBindingHeaders(cookie), 'Content-Length': '2' } },
      (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      },
    )
    request.on('error', reject)
    request.end('{}')
  })
  assert.equal(status, 400)
})

test('Rate limits IP/User có Retry-After, GET không tiêu hao quota PATCH', async (t) => {
  const f = await fixture(t, {
      ipLimiter: createRegisterLimiter({ limit: 4 }),
      userLimiter: createRegisterLimiter({ limit: 1 }),
    }),
    cookie = await f.login()
  assert.equal(
    (await f.request({ method: 'PATCH', cookie, body: { name: 'First' } }))
      .response.status,
    200,
  )
  assert.equal((await f.request({ cookie })).response.status, 200)
  const limited = await f.request({
    method: 'PATCH',
    cookie,
    body: { name: 'Second' },
  })
  assert.equal(limited.response.status, 429)
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0)
  assert.equal((await f.request()).response.status, 401)
  assert.equal((await f.request()).response.status, 429)
  assert.equal(f.client.users[0].name, 'First')
})

test('Lỗi database GET/PATCH/Session an toàn; không log hoặc lộ raw detail', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const logged = [],
    log = console.error
  console.error = (...args) => logged.push(args)
  t.after(() => {
    console.error = log
  })
  for (const [method, delegate] of [
    ['GET', 'findUnique'],
    ['PATCH', 'update'],
  ]) {
    const original = f.client.user[delegate]
    for (const [code, status] of [
      ['P1001', 503],
      ['P2021', 503],
      ['P2024', 503],
      ['UNKNOWN', 500],
    ]) {
      f.client.user[delegate] = async () => {
        throw Object.assign(new Error('PRIVATE connection, SQL, stack'), {
          code,
        })
      }
      const result = await f.request({
        method,
        cookie,
        ...(method === 'PATCH' ? { body: { name: 'Attempt' } } : {}),
      })
      assert.equal(result.response.status, status)
      assert.equal(JSON.stringify(result.body).includes('PRIVATE'), false)
    }
    f.client.user[delegate] = original
  }
  f.client.session.findUnique = async () => {
    throw Object.assign(new Error('PRIVATE session'), { code: 'P1001' })
  }
  assert.equal((await f.request({ cookie })).response.status, 503)
  assert.deepEqual(logged, [])
})

test('PATCH bảo toàn Session/ResetToken/Favorite; Favorites, Login, Me, Logout, Register và TMDB hồi quy', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  f.favorites.set(f.key(userA, 550), {
    userId: userA,
    movieId: 550,
    createdAt: new Date(),
  })
  f.favorites.set(f.key(userB, 42), {
    userId: userB,
    movieId: 42,
    createdAt: new Date(),
  })
  f.client.resetTokens.set('fixture-reset', {
    userId: userA,
    tokenHash: 'synthetic-reset-fixture',
  })
  const before = structuredClone({
    sessions: f.client.sessions,
    reset: f.client.resetTokens,
    favorites: f.favorites,
  })
  assertProfile(
    await f.request({ method: 'PATCH', cookie, body: { name: 'New Name' } }),
    { name: 'New Name', favoriteCount: 1 },
  )
  assert.deepEqual(
    {
      sessions: f.client.sessions,
      reset: f.client.resetTokens,
      favorites: f.favorites,
    },
    before,
  )
  const favorite = await fetch(f.base + '/api/favorites', {
    headers: { Cookie: cookie, ...accountBindingHeaders(cookie) },
  })
  assert.equal((await favorite.json()).favorites.length, 1)
  const post = await fetch(f.base + '/api/favorites', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      ...accountBindingHeaders(cookie),
      'Content-Type': 'application/json',
      'X-Cineverse-CSRF': '1',
    },
    body: '{"movieId":27205}',
  })
  assert.equal(post.status, 201)
  assertProfile(await f.request({ cookie }), {
    name: 'New Name',
    favoriteCount: 2,
  })
  const del = await fetch(f.base + '/api/favorites/27205', {
    method: 'DELETE',
    headers: { Cookie: cookie, ...accountBindingHeaders(cookie), 'X-Cineverse-CSRF': '1' },
  })
  assert.equal(del.status, 204)
  assert.equal(f.tmdbCalls(), 0)
  assert.equal((await fetch(f.base + '/api/movies/popular')).status, 200)
  assert.equal(
    (await authRequest(f.base, 'me', { cookie })).body.user.name,
    'New Name',
  )
  await authRequest(f.base, 'logout', { cookie })
  assert.equal((await f.request({ cookie })).response.status, 401)
  const nextCookie = await f.login()
  assertProfile(await f.request({ cookie: nextCookie }), {
    name: 'New Name',
    favoriteCount: 1,
  })
  const registered = await authRequest(f.base, 'register', {
    body: { name: '  New User  ', email: 'c@fixture.test', password },
  })
  assert.equal(registered.response.status, 201)
  assert.equal(registered.body.user.name, 'New User')
})
