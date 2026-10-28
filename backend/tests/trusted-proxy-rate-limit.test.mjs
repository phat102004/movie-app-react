import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest, createServer } from 'node:http'
import test from 'node:test'
import { createAppServer } from '../server.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import { HttpError } from '../http.mjs'

// Only RAM/service fixtures and loopback HTTP. Never loads .env or real accounts.
const user = { id: '00000000-0000-4000-8000-000000000001', name: 'Fixture', email: 'fixture@example.test' }
const sessionToken = 's'.repeat(43)
const cookie = `cineverse_session=${sessionToken}`
const refuse = () => { throw new HttpError(400, 'FIXTURE_REJECTED', 'Fixture rejected') }
const targets = [
  { path: '/api/auth/register', limit: 5, status: 201, body: n => ({ name: 'Fixture', email: `user${n}@example.test`, password: 'Synthetic register password!' }) },
  { path: '/api/auth/login', limit: 20, status: 401, body: n => ({ email: `user${n}@example.test`, password: 'Synthetic login password!' }) },
  { path: '/api/auth/forgot-password', limit: 10, status: 200, body: n => ({ email: `user${n}@example.test` }) },
  { path: '/api/auth/reset-password', limit: 20, status: 400, body: () => ({ token: 'r'.repeat(43), password: 'Synthetic reset password!' }) },
  { path: '/api/profile/change-password', limit: 10, status: 400, body: () => ({ currentPassword: 'Synthetic old password!', newPassword: 'Synthetic new password!' }) },
  // Small injected IP quotas exercise wiring on private reads/writes without a load test.
  { path: '/api/profile', method: 'GET', limit: 2, status: 200 },
  { path: '/api/favorites', method: 'GET', limit: 2, status: 200 },
]

async function listen(t, server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return `http://127.0.0.1:${server.address().port}`
}

async function fixture(t, trustedProxyCidrs = '', overrides = {}) {
  const calls = []
  const server = createAppServer({
    trustedProxyCidrs,
    registration: { registerUser: async () => { calls.push('register'); return user } },
    auth: {
      config: readAuthConfig({}),
      sessions: {
        currentUser: async token => {
          if (token !== sessionToken) throw new HttpError(401, 'UNAUTHENTICATED', 'Fixture guest')
          return user
        },
        revoke: async () => { calls.push('logout') },
      },
      login: async () => { calls.push('login'); throw new HttpError(401, 'INVALID_CREDENTIALS', 'Fixture login') },
    },
    passwordReset: { service: { forgot: async () => { calls.push('forgot'); return { message: 'Fixture generic response' } }, reset: refuse } },
    passwordChange: { service: refuse, userLimiter: createRegisterLimiter({ limit: 200 }) },
    profile: {
      ipLimiter: createRegisterLimiter({ limit: 2 }),
      service: { get: async () => ({ ...user, favoriteCount: 0 }), update: async () => { calls.push('profile'); return user } },
    },
    favorites: {
      ipLimiter: createRegisterLimiter({ limit: 2 }),
      service: { list: async () => ({ items: [], nextCursor: null }), add: async () => { calls.push('favorite'); return { status: 201, favorite: { movieId: 550 } } }, remove: async () => { calls.push('remove') } },
    },
    ...overrides,
  })
  return { base: await listen(t, server), calls }
}

async function send(base, target, n = 0, forwarded = '192.0.2.1', extraHeaders = {}) {
  const method = target.method ?? 'POST'
  const response = await fetch(base + target.path, {
    method,
    headers: {
      'Content-Type': 'application/json', 'X-Cineverse-CSRF': '1',
      Cookie: cookie, 'X-Cineverse-Account': user.id,
      ...(forwarded === undefined ? {} : { 'X-Forwarded-For': forwarded }),
      ...extraHeaders,
    },
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(target.body?.(n) ?? {}) }),
  })
  const body = response.status === 204 ? null : await response.json()
  return { response, body }
}

function assertLimited({ response, body }) {
  assert.equal(response.status, 429)
  assert.equal(body.error.code, 'RATE_LIMITED')
  assert.match(response.headers.get('retry-after'), /^[1-9]\d*$/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('set-cookie'), null)
}

for (const target of targets) {
  test(`${target.path}: direct clients cannot rotate forged XFF to bypass IP quota`, async t => {
    const { base } = await fixture(t)
    for (let i = 0; i < target.limit; i++)
      assert.equal((await send(base, target, i, `198.51.100.${i + 1}`)).response.status, target.status)
    assertLimited(await send(base, target, 90, '203.0.113.99'))
  })

  test(`${target.path}: trusted proxy separates A/B; injected left prefix cannot renew A quota`, async t => {
    const { base } = await fixture(t, '127.0.0.1/32')
    for (let i = 0; i < target.limit; i++)
      assert.equal((await send(base, target, i)).response.status, target.status)
    assertLimited(await send(base, target, 90, '203.0.113.99, 192.0.2.1'))
    assert.equal((await send(base, target, 91, '192.0.2.2')).response.status, target.status)
    assertLimited(await send(base, target, 92, '::ffff:c000:201'))
  })
}

test('H02 regression: 21 legitimate forwarded clients no longer share the 20-login IP budget', async t => {
  const { base, calls } = await fixture(t, '127.0.0.1')
  for (let i = 1; i <= 21; i++)
    assert.equal((await send(base, targets[1], i, `192.0.2.${i}`)).response.status, 401)
  assert.equal(calls.filter(call => call === 'login').length, 21)
})

test('Trusted multi-hop chain stops at untrusted intermediary and malformed XFF shares socket quota', async t => {
  const { base } = await fixture(t, '127.0.0.1,10.0.0.0/24')
  const target = targets[5]
  for (const prefix of ['203.0.113.1', '203.0.113.2'])
    assert.equal((await send(base, target, 0, `${prefix}, 192.0.2.1, 10.0.0.2`)).response.status, 200)
  assertLimited(await send(base, target, 0, '203.0.113.3, 192.0.2.1, 10.0.0.2'))
  for (const invalid of ['unknown', '192.0.2.4:123'])
    assert.equal((await send(base, target, 0, invalid)).response.status, 200)
  assertLimited(await send(base, target, 0, '192.0.2.5,'))
})

test('Trusted proxy cannot bypass per-account Login/Forgot quotas by changing IP', async t => {
  for (const [target, limit] of [[targets[1], 10], [targets[2], 3]]) {
    const { base } = await fixture(t, '127.0.0.1')
    for (let i = 0; i < limit; i++)
      assert.equal((await send(base, target, 0, `192.0.2.${i + 1}`)).response.status, target.status)
    assertLimited(await send(base, target, 0, '192.0.2.99'))
  }
})

test('Trusted proxy cannot bypass per-user change-password quota by changing IP', async t => {
  const { base } = await fixture(t, '127.0.0.1', { passwordChange: { service: refuse } })
  const target = targets[4]
  for (let i = 0; i < 5; i++)
    assert.equal((await send(base, target, 0, `192.0.2.${i + 1}`)).response.status, 400)
  assertLimited(await send(base, target, 0, '192.0.2.99'))
})

test('Private Favorites/Profile mutations all use same IP policy', async t => {
  for (const target of [
    { path: '/api/favorites', body: () => ({ movieId: 550 }), status: 201 },
    { path: '/api/favorites/550', method: 'DELETE', status: 204 },
    { path: '/api/profile', method: 'PATCH', body: () => ({ name: 'Fixture Name' }), status: 200 },
  ]) {
    const { base } = await fixture(t, '127.0.0.1')
    assert.equal((await send(base, target, 0)).response.status, target.status)
    assert.equal((await send(base, target, 0, '203.0.113.1,192.0.2.1')).response.status, target.status)
    assertLimited(await send(base, target, 0, '203.0.113.2,192.0.2.1'))
    assert.equal((await send(base, target, 0, '192.0.2.2')).response.status, target.status)
  }
})

test('Trusted forwarding preserves Origin/CSRF/session/account-binding checks and never trusts Forwarded', async t => {
  const { base, calls } = await fixture(t, '127.0.0.1', {
    profile: { service: { get: async () => user, update: async () => { calls.push('profile'); return user } } },
  })
  const target = { path: '/api/profile', method: 'PATCH', body: () => ({ name: 'Fixture Name' }) }
  for (const [headers, code, status] of [
    [{ Origin: 'https://untrusted.example' }, 'ORIGIN_FORBIDDEN', 403],
    [{ 'X-Cineverse-CSRF': '' }, 'CSRF_REJECTED', 403],
    [{ 'Sec-Fetch-Site': 'cross-site' }, 'ORIGIN_FORBIDDEN', 403],
    [{ Cookie: '' }, 'UNAUTHENTICATED', 401],
    [{ 'X-Cineverse-Account': 'another-ui-account' }, 'SESSION_CHANGED', 403],
  ]) {
    const result = await send(base, target, 0, '192.0.2.1', headers)
    assert.equal(result.response.status, status)
    assert.equal(result.body.error.code, code)
    assert.equal(result.response.headers.get('set-cookie'), null)
  }
  assert.equal(calls.length, 0)
  assert.equal((await send(base, target, 0, '192.0.2.1', { Origin: 'http://localhost:5173' })).response.status, 200)
  assert.deepEqual(calls, ['profile'])
  const fresh = await fixture(t, '127.0.0.1')
  for (let i = 0; i < 2; i++)
    assert.equal((await send(fresh.base, targets[5], 0, '', {
      Forwarded: `for=198.51.100.${i}`, 'X-Real-IP': `198.51.100.${i}`,
    })).response.status, 200)
  assertLimited(await send(fresh.base, targets[5], 0, '', { Forwarded: 'for=198.51.100.99' }))
})

test('Duplicate raw XFF header fields fall back to a shared socket quota', async t => {
  const { base } = await fixture(t, '127.0.0.1')
  const raw = n => new Promise((resolve, reject) => {
    const req = httpRequest(base + '/api/profile', {
      headers: { Cookie: cookie, 'X-Cineverse-Account': user.id,
        'X-Forwarded-For': [`192.0.2.${n}`, `198.51.100.${n}`] },
    }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(await raw(1), 200)
  assert.equal(await raw(2), 200)
  assert.equal(await raw(3), 429)
})

test('Real loopback ingress overwrites incoming XFF; client spoofing cannot create fresh quotas', async t => {
  const { base } = await fixture(t, '127.0.0.1')
  const proxy = createServer((request, response) => {
    const upstream = httpRequest(base + request.url, {
      method: request.method,
      headers: { ...request.headers, 'x-forwarded-for': request.socket.remoteAddress },
    }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers)
      incoming.pipe(response)
    })
    upstream.on('error', () => { response.writeHead(502); response.end() })
    request.pipe(upstream)
  })
  const ingress = await listen(t, proxy)
  assert.equal((await send(ingress, targets[5], 0, '192.0.2.1')).response.status, 200)
  assert.equal((await send(ingress, targets[5], 0, '192.0.2.2')).response.status, 200)
  assertLimited(await send(ingress, targets[5], 0, '192.0.2.3'))
})
