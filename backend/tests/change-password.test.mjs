import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import test from 'node:test'
import { createAppServer } from '../server.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import { createLoginLimiter } from '../auth/login-rate-limit.mjs'
import {
  hashRegistrationPassword,
  verifyLoginPassword,
} from '../auth/password.mjs'
import { validatePasswordChange } from '../profile/change-password-service.mjs'
import { memoryAccountDatabase } from './helpers/account-database.mjs'
import { authRequest, cookieFrom } from './helpers/auth-fixture.mjs'

const oldPassword = 'Old synthetic account password 123!'
const newPassword = '  New synthetic account password 456!  '
const alternatePassword = 'Alternate synthetic account password 789!'
const initialHash = hashRegistrationPassword(oldPassword)
const idA = 'e71d28a1-b104-44db-a159-f6af12f314b0',
  idB = 'e71d28a1-b104-44db-a159-f6af12f314b1'
async function fixture(t, passwordChange = {}, config = readAuthConfig({})) {
  let clock = new Date('2026-10-28T10:00:00.000Z')
  const { client, favorites } = memoryAccountDatabase(
    [idA, idB].map((id, index) => ({
      id,
      name: index ? 'Fixture B' : 'Fixture A',
      email: `${index ? 'b' : 'a'}@fixture.test`,
      passwordHash: null,
      createdAt: new Date(clock),
    })),
  )
  for (const user of client.users) user.passwordHash = await initialHash
  const mails = []
  const server = createAppServer({
    auth: {
      config,
      getClient: async () => client,
      now: () => clock,
      dummyHash: async () => initialHash,
      limiter: createLoginLimiter({
        ip: createRegisterLimiter({ limit: 200 }),
        account: createRegisterLimiter({ limit: 200 }),
      }),
    },
    passwordChange: {
      ipLimiter: createRegisterLimiter({ limit: 200 }),
      userLimiter: createRegisterLimiter({ limit: 200 }),
      ...passwordChange,
    },
    passwordReset: {
      minimumDurationMs: 0,
      delivery: {
        ready: () => 'http://localhost:5173',
        send: async (mail) => {
          mails.push(mail)
        },
      },
    },
    tmdb: {
      token: 'fixture',
      fetchImpl: async () => Response.json({ results: [] }),
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
  const login = async (email = 'a@fixture.test', password = oldPassword) => {
    const result = await authRequest(base, 'login', {
      body: { email, password },
    })
    assert.equal(result.response.status, 200)
    return cookieFrom(result)
  }
  const request = async ({
    cookie,
    body = { currentPassword: oldPassword, newPassword },
    headers = {},
    method = 'POST',
    query = '',
  } = {}) => {
    const response = await fetch(
      base + '/api/profile/change-password' + query,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Cineverse-CSRF': '1',
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        ...(method === 'POST'
          ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
          : {}),
      },
    )
    return {
      response,
      body:
        response.status === 204 ? await response.text() : await response.json(),
    }
  }
  return {
    client,
    favorites,
    config,
    base,
    mails,
    login,
    request,
    advance: (ms) => {
      clock = new Date(clock.getTime() + ms)
    },
  }
}

test('Guest POST → 401, không đọc hash hoặc tạo transaction', async (t) => {
  const f = await fixture(t),
    result = await f.request()
  assert.equal(result.response.status, 401)
  assert.equal(result.body.error.code, 'UNAUTHENTICATED')
  assert.equal(f.client.calls.length, 0)
})

test('Đổi thành công: Argon2id/salt/không plaintext, all sessions + reset token bị thu hồi, cookie clear; login cũ thất bại/new thành công', async (t) => {
  const f = await fixture(t),
    cookie = await f.login(),
    otherCookie = await f.login(),
    bCookie = await f.login('b@fixture.test')
  f.client.resetTokens.set('fixture-a', {
    userId: idA,
    tokenHash: 'synthetic-reset-a',
  })
  f.client.resetTokens.set('fixture-b', {
    userId: idB,
    tokenHash: 'synthetic-reset-b',
  })
  const beforeHash = f.client.users[0].passwordHash
  const result = await f.request({ cookie })
  assert.equal(result.response.status, 204)
  assert.equal(result.body, '')
  assert.match(
    result.response.headers.get('set-cookie'),
    /HttpOnly; SameSite=Lax; Max-Age=0; Expires=/,
  )
  assert.equal(result.response.headers.get('cache-control'), 'no-store')
  const stored = f.client.users[0].passwordHash
  assert.ok(stored.startsWith('$argon2id$v=19$'))
  assert.deepEqual(stored.split('$')[3].split(',').sort(), [
    'm=19456',
    'p=1',
    't=2',
  ])
  assert.notEqual(stored, beforeHash)
  assert.equal(await verifyLoginPassword(stored, newPassword), true)
  assert.equal(await verifyLoginPassword(stored, newPassword.trim()), false)
  assert.equal(await verifyLoginPassword(stored, oldPassword), false)
  assert.equal(f.client.resetTokens.has('fixture-a'), false)
  assert.equal(f.client.resetTokens.has('fixture-b'), true)
  for (const oldCookie of [cookie, otherCookie]) {
    assert.equal(
      (await authRequest(f.base, 'me', { cookie: oldCookie })).response.status,
      401,
    )
    assert.equal(
      (
        await fetch(f.base + '/api/favorites', {
          headers: { Cookie: oldCookie },
        })
      ).status,
      401,
    )
    assert.equal(
      (await fetch(f.base + '/api/profile', { headers: { Cookie: oldCookie } }))
        .status,
      401,
    )
  }
  assert.equal(
    (await authRequest(f.base, 'me', { cookie: bCookie })).response.status,
    200,
  )
  assert.equal(
    (
      await authRequest(f.base, 'login', {
        body: { email: 'a@fixture.test', password: oldPassword },
      })
    ).response.status,
    401,
  )
  await f.login('a@fixture.test', newPassword)
  assert.equal(JSON.stringify(f.client.calls).includes(newPassword), false)
})

test('Mật khẩu hiện tại sai → 400 CURRENT_PASSWORD_INCORRECT, session vẫn hợp lệ', async (t) => {
  const f = await fixture(t),
    cookie = await f.login(),
    before = f.client.users[0].passwordHash
  const result = await f.request({
    cookie,
    body: { currentPassword: 'Wrong synthetic password', newPassword },
  })
  assert.equal(result.response.status, 400)
  assert.equal(result.body.error.code, 'CURRENT_PASSWORD_INCORRECT')
  assert.ok(result.body.error.fields.currentPassword)
  assert.equal(f.client.users[0].passwordHash, before)
  assert.equal(
    (await authRequest(f.base, 'me', { cookie })).response.status,
    200,
  )
  assert.equal(result.response.headers.get('set-cookie'), null)
})

test('Password reuse được kiểm tra bằng verify, không so sánh hash hoặc trim password', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const result = await f.request({
    cookie,
    body: { currentPassword: oldPassword, newPassword: oldPassword },
  })
  assert.equal(result.response.status, 400)
  assert.equal(result.body.error.code, 'PASSWORD_REUSED')
  assert.ok(result.body.error.fields.newPassword)
})

for (const [label, value] of [
  ['ngắn', 'a'.repeat(11)],
  ['dài', 'a'.repeat(129)],
  ['Unicode dài', '🎬'.repeat(129)],
  ['number', 42],
  ['null', null],
  ['array', []],
])
  test(`New password ${label} → 400 trước hash`, async (t) => {
    const f = await fixture(t),
      cookie = await f.login()
    const result = await f.request({
      cookie,
      body: { currentPassword: oldPassword, newPassword: value },
    })
    assert.equal(result.response.status, 400)
    assert.ok(result.body.error.fields.newPassword)
    assert.equal(
      f.client.calls.some(([name]) => name === 'user.updateMany'),
      false,
    )
  })

test('Strict body/field type/id injection rejected; password policy giữ nguyên Unicode và whitespace', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const body of [
    null,
    [],
    42,
    {},
    { currentPassword: '', newPassword },
    { currentPassword: 'x'.repeat(129), newPassword },
    { currentPassword: true, newPassword },
    { currentPassword: oldPassword, newPassword, userId: idB },
    { currentPassword: oldPassword, newPassword, confirmPassword: newPassword },
    { currentPassword: oldPassword, newPassword, role: 'admin' },
  ])
    assert.equal((await f.request({ cookie, body })).response.status, 400)
  assert.deepEqual(
    validatePasswordChange({
      currentPassword: ' x ',
      newPassword: '🎬'.repeat(12),
    }),
    { currentPassword: ' x ', newPassword: '🎬'.repeat(12) },
  )
  assert.equal(
    f.client.calls.some(([name]) => name === 'user.updateMany'),
    false,
  )
})

test('CSRF/Origin/fetch metadata không hợp lệ → 403, không verify hash', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  for (const headers of [
    { 'X-Cineverse-CSRF': '' },
    { 'X-Cineverse-CSRF': 'bad' },
    { Origin: 'https://evil.invalid' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-origin' },
  ])
    assert.equal((await f.request({ cookie, headers })).response.status, 403)
  assert.equal(
    f.client.calls.some(([name]) => name === 'user.updateMany'),
    false,
  )
})

test('Body cap/JSON/media/encoding/query/method checks', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  assert.equal(
    (await f.request({ cookie, body: 'x'.repeat(17000) })).response.status,
    413,
  )
  assert.equal((await f.request({ cookie, body: '{bad' })).response.status, 400)
  assert.equal(
    (await f.request({ cookie, headers: { 'Content-Type': 'text/plain' } }))
      .response.status,
    415,
  )
  assert.equal(
    (await f.request({ cookie, headers: { 'Content-Encoding': 'gzip' } }))
      .response.status,
    415,
  )
  assert.equal(
    (await f.request({ cookie, query: '?userId=' + idB })).response.status,
    400,
  )
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const result = await f.request({ cookie, method })
    assert.equal(result.response.status, 405)
    assert.equal(result.response.headers.get('allow'), 'POST')
  }
})

test('Session expired/revoked/malformed/unknown → 401; missing User không đổi hash', async (t) => {
  const f = await fixture(t),
    expired = await f.login()
  f.advance(7 * 86400_000)
  const revoked = await f.login()
  await authRequest(f.base, 'logout', { cookie: revoked })
  for (const cookie of [
    expired,
    revoked,
    'cineverse_session=bad',
    'cineverse_session=' + 'x'.repeat(43),
  ])
    assert.equal((await f.request({ cookie })).response.status, 401)
  const missingUser = await f.login('b@fixture.test')
  f.client.users.splice(1, 1)
  assert.equal((await f.request({ cookie: missingUser })).response.status, 401)
})

test('Logout/expiry trong lúc hash → transaction Session lock từ chối, không ghi', async (t) => {
  for (const mode of ['logout', 'expire']) {
    let f
    f = await fixture(t, {
      hashPassword: async (password) => {
        if (mode === 'logout') f.client.sessions.clear()
        else f.advance(7 * 86400_000)
        return hashRegistrationPassword(password)
      },
    })
    const cookie = await f.login(),
      before = f.client.users[0].passwordHash
    assert.equal((await f.request({ cookie })).response.status, 401)
    assert.equal(f.client.users[0].passwordHash, before)
  }
})

test('Slow body + Logout → 401 trước hash', { timeout: 5000 }, async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  let reached
  const authenticated = new Promise((resolve) => {
    reached = resolve
  })
  const lookup = f.client.session.findUnique
  f.client.session.findUnique = async (args) => {
    const result = await lookup(args)
    reached()
    return result
  }
  let pending
  const result = new Promise((resolve, reject) => {
    pending = httpRequest(
      f.base + '/api/profile/change-password',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-Cineverse-CSRF': '1',
        },
      },
      (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      },
    )
    pending.on('error', reject)
    pending.write('{"currentPassword":')
  })
  t.after(() => pending.destroy())
  await authenticated
  await authRequest(f.base, 'logout', { cookie })
  pending.end(
    JSON.stringify(oldPassword) +
      ',"newPassword":' +
      JSON.stringify(newPassword) +
      '}',
  )
  assert.equal(await result, 401)
  assert.equal(
    f.client.calls.some(([name]) => name === 'user.updateMany'),
    false,
  )
})

test(
  'Hai password changes cùng snapshot: chỉ một 204, request còn lại 401; không session sống sót',
  { timeout: 10000 },
  async (t) => {
    let arrived = 0,
      release
    const barrier = new Promise((resolve) => {
      release = resolve
    })
    const f = await fixture(t, {
      hashPassword: async (password) => {
        if (++arrived === 2) release()
        await barrier
        return hashRegistrationPassword(password)
      },
    })
    const a = await f.login(),
      b = await f.login()
    const results = await Promise.all([
      f.request({ cookie: a }),
      f.request({
        cookie: b,
        body: { currentPassword: oldPassword, newPassword: alternatePassword },
      }),
    ])
    assert.deepEqual(
      results.map((result) => result.response.status).sort(),
      [204, 401],
    )
    const hash = f.client.users[0].passwordHash
    assert.notEqual(
      await verifyLoginPassword(hash, newPassword),
      await verifyLoginPassword(hash, alternatePassword),
    )
    assert.equal(
      [...f.client.sessions.values()].some((session) => session.userId === idA),
      false,
    )
  },
)

test('CAS chặn snapshot hash đã thay đổi trước transaction', async (t) => {
  let f
  const replacement = await hashRegistrationPassword(alternatePassword)
  f = await fixture(t, {
    hashPassword: async (password) => {
      f.client.users[0].passwordHash = replacement
      return hashRegistrationPassword(password)
    },
  })
  const cookie = await f.login()
  assert.equal((await f.request({ cookie })).response.status, 401)
  assert.equal(f.client.users[0].passwordHash, replacement)
  assert.equal(f.client.sessions.size, 1)
})

test('Failure after UPDATE rolls back password + sessions + reset token, safe 503', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  f.client.resetTokens.set('fixture', {
    userId: idA,
    tokenHash: 'synthetic-reset-fixture',
  })
  const before = structuredClone({
    users: f.client.users,
    sessions: f.client.sessions,
    tokens: f.client.resetTokens,
  })
  f.client.passwordResetToken.deleteMany = async () => {
    throw Object.assign(new Error('PRIVATE rollback details'), {
      code: 'P1001',
    })
  }
  const result = await f.request({ cookie })
  assert.equal(result.response.status, 503)
  assert.equal(result.response.headers.get('set-cookie'), null)
  assert.equal(JSON.stringify(result.body).includes('PRIVATE'), false)
  assert.deepEqual(
    {
      users: f.client.users,
      sessions: f.client.sessions,
      tokens: f.client.resetTokens,
    },
    before,
  )
})

test('Rate limits IP và user có Retry-After, không tin XFF', async (t) => {
  const f = await fixture(t, {
      ipLimiter: createRegisterLimiter({ limit: 3 }),
      userLimiter: createRegisterLimiter({ limit: 1 }),
    }),
    cookie = await f.login()
  const wrong = { currentPassword: 'Wrong synthetic password', newPassword }
  assert.equal((await f.request({ cookie, body: wrong })).response.status, 400)
  const limited = await f.request({
    cookie,
    headers: { 'X-Forwarded-For': '1.2.3.4' },
  })
  assert.equal(limited.response.status, 429)
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0)
  assert.equal((await f.request()).response.status, 401)
  assert.equal((await f.request()).response.status, 429)
})

test(
  'Bounded concurrent hashing guard trả AUTH_BUSY, nhả slot khi hoàn tất',
  { timeout: 5000 },
  async (t) => {
    let release, reached
    const entered = new Promise((resolve) => {
      reached = resolve
    })
    const f = await fixture(t, {
        maxConcurrent: 1,
        service: async () => {
          reached()
          await new Promise((resolve) => {
            release = resolve
          })
        },
      }),
      cookie = await f.login()
    const first = f.request({ cookie })
    await entered
    const second = await f.request({ cookie })
    assert.equal(second.response.status, 429)
    assert.equal(second.body.error.code, 'AUTH_BUSY')
    release()
    assert.equal((await first).response.status, 204)
  },
)

test('DB/Argon errors không lộ secrets hoặc log credentials', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  const log = console.error,
    logs = []
  console.error = (...args) => logs.push(args)
  t.after(() => {
    console.error = log
  })
  f.client.user.findUnique = async () => {
    throw Object.assign(new Error('PRIVATE DB url/token/hash'), {
      code: 'P1001',
    })
  }
  const result = await f.request({ cookie })
  assert.equal(result.response.status, 503)
  assert.equal(JSON.stringify(result.body).includes('PRIVATE'), false)
  assert.deepEqual(logs, [])
  const broken = await fixture(t, {
      verifyPassword: async () => {
        throw new Error('PRIVATE Argon')
      },
    }),
    otherCookie = await broken.login()
  const other = await broken.request({ cookie: otherCookie })
  assert.equal(other.response.status, 500)
  assert.equal(JSON.stringify(other.body).includes('PRIVATE'), false)
})

test('Profile/Favorites/User B bảo toàn; old Reset link bị hủy, Forgot/Reset mới vẫn hoạt động', async (t) => {
  const f = await fixture(t),
    cookie = await f.login()
  f.favorites.set('fixture-a', {
    userId: idA,
    movieId: 550,
    createdAt: new Date(),
  })
  const before = structuredClone({
    name: f.client.users[0].name,
    email: f.client.users[0].email,
    createdAt: f.client.users[0].createdAt,
    other: f.client.users[1],
    favorites: f.favorites,
  })
  await authRequest(f.base, 'forgot-password', {
    body: { email: 'a@fixture.test' },
  })
  const oldToken = new URL(f.mails.at(-1).resetUrl).hash.slice(7)
  assert.equal((await f.request({ cookie })).response.status, 204)
  assert.deepEqual(
    {
      name: f.client.users[0].name,
      email: f.client.users[0].email,
      createdAt: f.client.users[0].createdAt,
      other: f.client.users[1],
      favorites: f.favorites,
    },
    before,
  )
  assert.equal(
    (
      await authRequest(f.base, 'reset-password', {
        body: { token: oldToken, password: alternatePassword },
      })
    ).response.status,
    400,
  )
  await authRequest(f.base, 'forgot-password', {
    body: { email: 'a@fixture.test' },
  })
  const newToken = new URL(f.mails.at(-1).resetUrl).hash.slice(7)
  assert.equal(
    (
      await authRequest(f.base, 'reset-password', {
        body: { token: newToken, password: alternatePassword },
      })
    ).response.status,
    200,
  )
  await f.login('a@fixture.test', alternatePassword)
})
