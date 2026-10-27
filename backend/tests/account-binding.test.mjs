import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { createAppServer } from '../server.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { hashRegistrationPassword } from '../auth/password.mjs'
import { memoryAccountDatabase } from './helpers/account-database.mjs'
import { authRequest, cookieFrom } from './helpers/auth-fixture.mjs'

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']
const password = 'Synthetic account binding password!'
const hash = hashRegistrationPassword(password)
async function fixture(t) {
  const { client, favorites } = memoryAccountDatabase(ids.map((id, index) => ({
    id, name: `Fixture ${index}`, email: `${index}@fixture.test`,
    createdAt: new Date(), passwordHash: null,
  })))
  for (const user of client.users) user.passwordHash = await hash
  let protectedCalls = 0
  const failIfCalled = async () => { protectedCalls++; throw new Error('Private service must not run') }
  const server = createAppServer({
    auth: { config: readAuthConfig({}), getClient: async () => client },
    favorites: { service: { list: failIfCalled, add: failIfCalled, remove: failIfCalled } },
    profile: { service: { get: failIfCalled, update: failIfCalled } },
    passwordChange: { service: failIfCalled },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const login = async (index) => {
    const result = await authRequest(base, 'login', { body: { email: `${index}@fixture.test`, password } })
    assert.equal(result.response.status, 200)
    return cookieFrom(result)
  }
  return { base, login, client, favorites, calls: () => protectedCalls }
}

const endpoints = [
  ['GET', '/api/favorites'],
  ['POST', '/api/favorites', { movieId: 550 }],
  ['DELETE', '/api/favorites/550'],
  ['GET', '/api/profile'],
  ['PATCH', '/api/profile', { name: 'Wrong account name' }],
  ['POST', '/api/profile/change-password', { currentPassword: password, newPassword: 'New synthetic binding password!' }],
  ['POST', '/api/auth/logout', {}],
]
for (const [method, path, body] of endpoints) {
  test(`${method} ${path}: cookie B + UI A → 403 before private work, no cookie clear`, async (t) => {
    const f = await fixture(t)
    const cookie = await f.login(1)
    const before = structuredClone(f.client.users)
    const response = await fetch(f.base + path, {
      method, headers: {
        Cookie: cookie, 'X-Cineverse-Account': ids[0],
        'Content-Type': 'application/json', 'X-Cineverse-CSRF': '1',
      }, ...(body ? { body: JSON.stringify(body) } : {}),
    })
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { error: {
      code: 'SESSION_CHANGED', message: 'Phiên tài khoản đã thay đổi. Vui lòng kiểm tra lại phiên và thử lại.',
    } })
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(f.calls(), 0)
    assert.equal(f.favorites.size, 0)
    assert.deepEqual(f.client.users, before)
    assert.equal((await authRequest(f.base, 'me', { cookie })).response.status, 200)
  })
}

test('Missing/malformed account assertion fails closed; binding alone cannot authenticate', async (t) => {
  const f = await fixture(t)
  const cookie = await f.login(0)
  for (const owner of [undefined, '', 'invalid', ids[1]]) {
    const response = await fetch(f.base + '/api/profile', { headers: {
      Cookie: cookie, ...(owner !== undefined ? { 'X-Cineverse-Account': owner } : {}),
    } })
    assert.equal(response.status, 403)
  }
  const guest = await fetch(f.base + '/api/profile', { headers: { 'X-Cineverse-Account': ids[0] } })
  assert.equal(guest.status, 401)
  assert.equal(f.calls(), 0)
})

test('Precondition is not authorization: cookie A cannot select owner B; matching B reaches only B', async (t) => {
  const { client, favorites } = memoryAccountDatabase(ids.map((id, index) => ({
    id, name: 'Fixture', email: `${index}@fixture.test`, passwordHash: null, createdAt: new Date(),
  })))
  for (const user of client.users) user.passwordHash = await hash
  const server = createAppServer({ auth: { config: readAuthConfig({}), getClient: async () => client } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  for (const index of [0, 1]) {
    const cookie = cookieFrom(await authRequest(base, 'login', { body: { email: `${index}@fixture.test`, password } }))
    const response = await fetch(base + '/api/favorites', { method: 'POST', headers: {
      Cookie: cookie, 'X-Cineverse-Account': ids[1], 'X-Cineverse-CSRF': '1', 'Content-Type': 'application/json',
    }, body: JSON.stringify({ movieId: 550 }) })
    assert.equal(response.status, index ? 201 : 403)
  }
  assert.equal(favorites.size, 1)
  assert.equal([...favorites.values()][0].userId, ids[1])
})

test('CSRF/Origin remain mandatory even with correct account assertion', async (t) => {
  const f = await fixture(t)
  const cookie = await f.login(0)
  for (const extra of [{}, { 'X-Cineverse-CSRF': '1', Origin: 'https://attacker.invalid' }]) {
    const response = await fetch(f.base + '/api/favorites', { method: 'POST', headers: {
      Cookie: cookie, 'X-Cineverse-Account': ids[0], 'Content-Type': 'application/json', ...extra,
    }, body: JSON.stringify({ movieId: 550 }) })
    assert.equal(response.status, 403)
    assert.notEqual((await response.json()).error.code, 'SESSION_CHANGED')
  }
  assert.equal(f.calls(), 0)
})
