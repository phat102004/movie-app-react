import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import {
  memoryDatabase,
  startAuthServer,
  authRequest,
  cookieFrom,
} from './helpers/auth-fixture.mjs'
import {
  hashRegistrationPassword,
  verifyLoginPassword,
} from '../auth/password.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import {
  hashSessionToken,
  createSessionService,
} from '../auth/session-service.mjs'
import { createLoginLimiter } from '../auth/login-rate-limit.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'

const password = '  Fixture password 123!  '
const hash = await hashRegistrationPassword(password)
const dummy = await hashRegistrationPassword(
  randomBytes(32).toString('base64url'),
)
const user = {
  id: 'e71d28a1-b104-44db-a159-f6af12f314b0',
  email: 'demo@example.com',
  name: 'Demo',
  passwordHash: hash,
  createdAt: new Date('2026-10-26T00:00:00Z'),
}
const other = {
  ...user,
  id: '9c7b3c21-1913-48db-9b12-640ff502955b',
  email: 'other@example.com',
}
const loginBody = { email: ' Demo@Example.COM ', password }
const dto = {
  id: user.id,
  name: user.name,
  email: user.email,
  createdAt: user.createdAt.toISOString(),
}
const make = async (t, options = {}) => {
  const client = options.client ?? memoryDatabase([user, other])
  return {
    client,
    ...(await startAuthServer(t, {
      client,
      dummyHash: async () => dummy,
      ...options,
    })),
  }
}
const login = (base, extra = {}) =>
  authRequest(base, 'login', { body: loginBody, ...extra })

test('Login thật Argon2 → 200, chuẩn hóa email, DTO an toàn và cookie development', async (t) => {
  const { base, client } = await make(t)
  const result = await login(base)
  assert.equal(result.response.status, 200)
  assert.deepEqual(result.body, { user: dto })
  const cookie = result.response.headers.get('set-cookie')
  assert.match(cookie, /^cineverse_session=[A-Za-z0-9_-]{43};/)
  for (const flag of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=604800'])
    assert.ok(cookie.includes(flag))
  assert.doesNotMatch(cookie, /Domain=|Secure/)
  const raw = cookieFrom(result).split('=')[1]
  const [session] = client.sessions.values()
  assert.equal(session.tokenHash, hashSessionToken(raw))
  assert.equal(session.tokenHash.length, 64)
  assert.equal(session.expiresAt - session.createdAt, 7 * 86400_000)
  assert.ok(!JSON.stringify(session).includes(raw))
  assert.doesNotMatch(
    JSON.stringify(result.body),
    /passwordHash|tokenHash|token|password/,
  )
  assert.equal(
    client.calls.find(([name]) => name === 'user.findUnique')[1].where.email,
    'demo@example.com',
  )
})

test('Sai password và email không tồn tại trả cùng 401; có dummy verify', async (t) => {
  const verifies = []
  const { base, client } = await make(t, {
    verifyPassword: async (hash, value) => {
      verifies.push(hash)
      return verifyLoginPassword(hash, value)
    },
  })
  const wrong = await login(base, { body: { ...loginBody, password: 'wrong' } })
  const missing = await login(base, {
    body: { email: 'absent@example.com', password },
  })
  assert.equal(wrong.response.status, 401)
  assert.equal(missing.response.status, 401)
  assert.deepEqual(wrong.body, missing.body)
  assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS')
  assert.deepEqual(verifies, [hash, dummy])
  assert.equal(client.sessions.size, 0)
  assert.equal(wrong.response.headers.get('set-cookie'), null)
})

test('Login tạo token mới, không chấp nhận token client để fixation', async (t) => {
  const { base, client } = await make(t)
  const first = await login(base)
  const second = await login(base, {
    cookie: cookieFrom(first),
    body: { ...loginBody, token: 'client-picked', sessionId: 'fake' },
  })
  assert.notEqual(cookieFrom(first), cookieFrom(second))
  assert.equal(client.sessions.size, 2)
  assert.equal(
    (await authRequest(base, 'me', { cookie: cookieFrom(first) })).response
      .status,
    200,
  )
})

test('Me hợp lệ chỉ đọc, không refresh expiry, chỉ trả DTO', async (t) => {
  const { base, client } = await make(t)
  const signedIn = await login(base)
  const before = JSON.stringify([...client.sessions.values()])
  client.calls.length = 0
  const result = await authRequest(base, 'me', { cookie: cookieFrom(signedIn) })
  assert.equal(result.response.status, 200)
  assert.deepEqual(result.body, { user: dto })
  assert.deepEqual(
    client.calls.map(([name]) => name),
    ['session.findUnique'],
  )
  assert.equal(JSON.stringify([...client.sessions.values()]), before)
  assert.equal(result.response.headers.get('set-cookie'), null)
  const select = client.calls[0][1].select
  assert.ok(!select.tokenHash && !select.user.select.passwordHash)
})

test('Me thiếu cookie, sai định dạng/duplicate/giả → 401; không tạo session', async (t) => {
  const { base, client } = await make(t)
  for (const cookie of [
    undefined,
    'cineverse_session=abc',
    'cineverse_session=%invalid',
    `cineverse_session=${'a'.repeat(43)}`,
    `cineverse_session=${'b'.repeat(43)}; cineverse_session=${'b'.repeat(43)}`,
  ]) {
    const result = await authRequest(base, 'me', { cookie })
    assert.equal(result.response.status, 401)
    assert.equal(result.body.error.code, 'UNAUTHENTICATED')
  }
  assert.equal(client.sessions.size, 0)
  assert.ok(client.calls.every(([name]) => name === 'session.findUnique'))
})

test('Me session hết hạn đúng boundary → 401 và không xóa DB qua GET', async (t) => {
  let time = new Date('2026-10-26T00:00:00Z')
  const { base, client } = await make(t, { now: () => time })
  const signedIn = await login(base)
  time = new Date(time.getTime() + 7 * 86400_000)
  const result = await authRequest(base, 'me', { cookie: cookieFrom(signedIn) })
  assert.equal(result.response.status, 401)
  assert.equal(client.sessions.size, 1)
})

test('Me User đã không còn → 401', async (t) => {
  const client = memoryDatabase([{ ...user }])
  const { base } = await make(t, { client })
  const signedIn = await login(base)
  client.users.length = 0
  assert.equal(
    (await authRequest(base, 'me', { cookie: cookieFrom(signedIn) })).response
      .status,
    401,
  )
})

test('Logout 204 thu hồi đúng session, cookie cũ bị từ chối; session khác vẫn dùng được', async (t) => {
  const { base, client } = await make(t)
  const a = await login(base)
  const sameUser = await login(base)
  const b = await login(base, { body: { email: other.email, password } })
  const result = await authRequest(base, 'logout', { cookie: cookieFrom(a) })
  assert.equal(result.response.status, 204)
  assert.equal(result.body, null)
  assert.match(result.response.headers.get('set-cookie'), /Max-Age=0/)
  assert.match(
    result.response.headers.get('set-cookie'),
    /HttpOnly; SameSite=Lax/,
  )
  assert.equal(client.sessions.size, 2)
  assert.equal(
    (await authRequest(base, 'me', { cookie: cookieFrom(a) })).response.status,
    401,
  )
  assert.equal(
    (await authRequest(base, 'me', { cookie: cookieFrom(b) })).response.status,
    200,
  )
  assert.equal(
    (await authRequest(base, 'me', { cookie: cookieFrom(sameUser) })).response
      .status,
    200,
  )
  assert.equal(
    (await authRequest(base, 'logout', { cookie: cookieFrom(a) })).response
      .status,
    204,
  )
  assert.equal((await authRequest(base, 'logout')).response.status, 204)
})

test('Session tồn tại qua việc đóng/mở app server mới cùng database store', async (t) => {
  const first = await make(t)
  const signedIn = await login(first.base)
  await first.close()
  const second = await make(t, { client: first.client })
  const me = await authRequest(second.base, 'me', {
    cookie: cookieFrom(signedIn),
  })
  assert.equal(me.response.status, 200)
})

test('Cookie production dùng __Host-, Secure; Logout cùng flags; không nhận cookie dev', async (t) => {
  const config = readAuthConfig({
    NODE_ENV: 'production',
    AUTH_ALLOWED_ORIGINS: 'https://cineverse.example',
  })
  const { base } = await make(t, { config })
  const result = await login(base, {
    headers: { Origin: 'https://cineverse.example' },
  })
  assert.match(
    result.response.headers.get('set-cookie'),
    /^__Host-cineverse_session=/,
  )
  assert.match(result.response.headers.get('set-cookie'), /; Secure$/)
  assert.doesNotMatch(result.response.headers.get('set-cookie'), /Domain=/)
  const logout = await authRequest(base, 'logout', {
    cookie: cookieFrom(result),
  })
  assert.match(
    logout.response.headers.get('set-cookie'),
    /^__Host-cineverse_session=;/,
  )
  assert.match(logout.response.headers.get('set-cookie'), /; Secure$/)
  const devCookie = cookieFrom(result).replace('__Host-', '')
  assert.equal(
    (await authRequest(base, 'me', { cookie: devCookie })).response.status,
    401,
  )
})

test('Auth config production fail closed cho missing/*/null/HTTP/path origin', () => {
  for (const origin of [
    undefined,
    '*',
    'null',
    'http://cineverse.example',
    'https://cineverse.example/path',
    'https://example.com,',
  ]) {
    assert.throws(() =>
      readAuthConfig({ NODE_ENV: 'production', AUTH_ALLOWED_ORIGINS: origin }),
    )
  }
  assert.equal(
    readAuthConfig({
      NODE_ENV: 'production',
      AUTH_ALLOWED_ORIGINS: 'https://cineverse.example',
      COOKIE_SECURE: 'false',
    }).production,
    true,
  )
  assert.throws(() => readAuthConfig({ NODE_ENV: 'prod' }))
})

test('CSRF/Origin: hợp lệ và CLI không Origin; chặn null/evil/subdomain/cross-site/thiếu custom header', async (t) => {
  const { base, client } = await make(t)
  for (const headers of [
    { Origin: 'null' },
    { Origin: 'https://evil.example' },
    { Origin: 'http://localhost:5173.evil.example' },
    { Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'cross-site' },
    { 'X-Cineverse-CSRF': '' },
    { 'Sec-Fetch-Site': 'same-site' },
  ]) {
    for (const endpoint of ['register', 'login', 'logout']) {
      const result = await authRequest(base, endpoint, {
        body: loginBody,
        headers,
      })
      assert.equal(result.response.status, 403)
    }
  }
  assert.equal(client.calls.length, 0)
  const browser = await login(base, {
    headers: {
      Origin: 'http://localhost:5173',
      'Sec-Fetch-Site': 'same-origin',
    },
  })
  assert.equal(browser.response.status, 200)
  assert.equal((await login(base)).response.status, 200)
  const preflight = await fetch(base + '/api/auth/login', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Headers': 'x-cineverse-csrf',
    },
  })
  assert.equal(preflight.status, 405)
  assert.equal(preflight.headers.get('access-control-allow-origin'), null)
  assert.equal(
    browser.response.headers.get('access-control-allow-credentials'),
    null,
  )
})

test('Login validation/JSON/body limit và phương thức sai đều không ghi session', async (t) => {
  const { base, client } = await make(t)
  for (const body of [
    {},
    null,
    [],
    { email: user.email, password: '' },
    { email: 'bad', password },
    { email: user.email, password: 'x'.repeat(129) },
    '{oops',
  ])
    assert.equal((await login(base, { body })).response.status, 400)
  assert.equal(
    (
      await login(base, {
        body: JSON.stringify({ password: 'x'.repeat(17000) }),
      })
    ).response.status,
    413,
  )
  assert.equal(
    (await login(base, { headers: { 'Content-Type': 'text/plain' } })).response
      .status,
    415,
  )
  for (const endpoint of ['login', 'logout'])
    assert.equal(
      (await authRequest(base, endpoint, { method: 'GET' })).response.status,
      405,
    )
  assert.equal(
    (await authRequest(base, 'me', { method: 'POST' })).response.status,
    405,
  )
  assert.equal(client.sessions.size, 0)
})

test('Login limit IP và account HMAC; không tin X-Forwarded-For, hết hạn tự mở lại', async (t) => {
  let time = 0
  const limiter = createLoginLimiter({
    ip: createRegisterLimiter({ limit: 100 }),
    account: createRegisterLimiter({
      limit: 2,
      windowMs: 1000,
      now: () => time,
    }),
  })
  const { base } = await make(t, { limiter })
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await login(base, { body: { ...loginBody, password: 'wrong' } }))
        .response.status,
      401,
    )
  const blocked = await login(base, {
    body: { ...loginBody, email: 'demo@example.com' },
    headers: { 'X-Forwarded-For': '203.0.113.2' },
  })
  assert.equal(blocked.response.status, 429)
  assert.ok(blocked.response.headers.get('retry-after'))
  time = 1001
  assert.equal((await login(base)).response.status, 200)
  const seen = []
  const privateLimiter = createLoginLimiter({
    account: (key) => {
      seen.push(key)
      return { allowed: true }
    },
  })
  privateLimiter.takeAccount(user.email)
  assert.match(seen[0], /^[a-f0-9]{64}$/)
  assert.notEqual(seen[0], user.email)
  const ipLimiter = createLoginLimiter({
    ip: createRegisterLimiter({ limit: 1 }),
  })
  assert.equal(ipLimiter.takeIp('ip').allowed, true)
  assert.equal(ipLimiter.takeIp('ip').allowed, false)
})

test('DB lỗi Login/Me/Logout an toàn; Logout lỗi DB không giả vờ thành công/xóa cookie', async (t) => {
  const { base } = await make(t, {
    getClient: async () => {
      throw Object.assign(
        new Error('private postgresql://secret passwordHash'),
        { code: 'P1001' },
      )
    },
  })
  for (const path of ['login', 'me', 'logout']) {
    const result = await authRequest(base, path, {
      body: loginBody,
      cookie: `cineverse_session=${'a'.repeat(43)}`,
    })
    assert.equal(result.response.status, 503)
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /secret|passwordHash|postgresql|stack/,
    )
    assert.equal(result.response.headers.get('set-cookie'), null)
  }
  assert.equal((await fetch(base + '/api/movies/popular')).status, 200)
})

test('Tối đa 5 session/user; login dọn session cũ/expired của chính user, giữ user khác', async (t) => {
  let milliseconds = 0
  const { base, client } = await make(t, {
    now: () => new Date(Date.UTC(2026, 9, 26) + milliseconds++),
  })
  const otherLogin = await login(base, {
    body: { email: other.email, password },
  })
  const logins = []
  for (let i = 0; i < 6; i++) logins.push(await login(base))
  assert.equal(client.sessions.size, 6)
  assert.equal(
    (await authRequest(base, 'me', { cookie: cookieFrom(logins[0]) })).response
      .status,
    401,
  )
  assert.equal(
    (await authRequest(base, 'me', { cookie: cookieFrom(logins[5]) })).response
      .status,
    200,
  )
  assert.equal(
    (await authRequest(base, 'me', { cookie: cookieFrom(otherLogin) })).response
      .status,
    200,
  )
  assert.ok(client.calls.some(([name]) => name === 'user.lock'))
})

test('Cleanup chỉ xóa expired theo batch 1000, không chạy trên GET hoặc xóa User', async () => {
  const client = memoryDatabase([user])
  const now = new Date()
  for (let i = 0; i < 1002; i++)
    client.sessions.set(String(i), {
      id: String(i),
      userId: user.id,
      tokenHash: `fixture-${i}`,
      createdAt: new Date(0),
      expiresAt: new Date(now.getTime() - 1),
    })
  client.sessions.set('active', {
    id: 'active',
    userId: user.id,
    expiresAt: new Date(now.getTime() + 1000),
  })
  const service = createSessionService({
    getClient: async () => client,
    now: () => now,
  })
  assert.equal(await service.cleanupExpired(), 1000)
  assert.equal(client.sessions.size, 3)
  assert.equal(client.users.length, 1)
  assert.equal(client.sessions.has('active'), true)
})

test('Login đồng thời không vượt 5 session; transaction lỗi khôi phục các phiên cũ', async () => {
  const client = memoryDatabase([user])
  const service = createSessionService({ getClient: async () => client })
  await Promise.all(Array.from({ length: 8 }, () => service.create(user.id)))
  assert.equal(client.sessions.size, 5)
  const before = JSON.stringify([...client.sessions.values()])
  client.session.create = async () => {
    throw new Error('fixture insert failed')
  }
  await assert.rejects(service.create(user.id), (error) => error.status === 500)
  assert.equal(JSON.stringify([...client.sessions.values()]), before)
})

test('Login busy/failure luôn giải phóng slot và không set cookie khi lỗi', async (t) => {
  let release
  let entered
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  const { base } = await make(t, {
    maxConcurrent: 1,
    login: async () => {
      entered()
      await waiting
      throw new Error('fixture failed')
    },
  })
  const first = login(base)
  await started
  const busy = await login(base)
  assert.equal(busy.response.status, 429)
  assert.equal(busy.body.error.code, 'AUTH_BUSY')
  release()
  assert.equal((await first).response.status, 500)
  const retry = await login(base)
  assert.equal(retry.response.status, 500)
  assert.equal(retry.response.headers.get('set-cookie'), null)
})

test('Login rate limit IP chặn password spraying qua nhiều email trước query DB', async (t) => {
  const { base, client } = await make(t, {
    limiter: createLoginLimiter({ ip: createRegisterLimiter({ limit: 1 }) }),
  })
  assert.equal(
    (await login(base, { body: { email: 'missing-a@example.com', password } }))
      .response.status,
    401,
  )
  const result = await login(base, {
    body: { email: 'missing-b@example.com', password },
    headers: { 'X-Forwarded-For': '203.0.113.3' },
  })
  assert.equal(result.response.status, 429)
  assert.equal(
    client.calls.filter(([name]) => name === 'user.findUnique').length,
    1,
  )
})
