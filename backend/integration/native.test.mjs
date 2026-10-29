import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { nativeFixture } from './fixture.mjs'
import { createSessionService } from '../auth/session-service.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { hashRegistrationPassword, verifyLoginPassword } from '../auth/password.mjs'
import { createChangePasswordService } from '../profile/change-password-service.mjs'
import { createPasswordResetService, hashResetToken } from '../auth/password-reset-service.mjs'
import { createProfileService } from '../profile/profile-service.mjs'
import { createFavoriteService } from '../favorites/favorite-service.mjs'
import { inspectRoleSecurity, validateProductionRole } from '../database/role-security.mjs'
import { createAppServer } from '../server.mjs'

const password = 'Synthetic native old password 123!'
const nextPassword = 'Synthetic native new password 456!'
const authConfig = readAuthConfig({})
function gate() {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}
const status = expected => error => error?.status === expected

test('PostgreSQL native: disposable migrations, runtime permissions and multi-connection transactions', { timeout: 150_000 }, async t => {
  const f = await nativeFixture()
  t.after(f.close)
  const hash = await hashRegistrationPassword(password)
  const nextHash = await hashRegistrationPassword(nextPassword)
  const sessionsA = createSessionService({ getClient: async () => f.a, config: authConfig })
  const sessionsB = createSessionService({ getClient: async () => f.b, config: authConfig })
  const favoritesA = createFavoriteService({ getClient: async () => f.a })
  const favoritesB = createFavoriteService({ getClient: async () => f.b })
  const profileA = createProfileService({ getClient: async () => f.a })
  const profileB = createProfileService({ getClient: async () => f.b })
  async function seed() {
    const [a, b] = await Promise.all([f.a.user.create({ data: {
      name: 'Native A', email: randomBytes(8).toString('hex') + '@fixture.test', passwordHash: hash,
    } }), f.b.user.create({ data: {
      name: 'Native B', email: randomBytes(8).toString('hex') + '@fixture.test', passwordHash: hash,
    } })])
    const [tokenA, tokenB] = await Promise.all([sessionsA.create(a.id, hash), sessionsB.create(b.id, hash)])
    const resetToken = randomBytes(32).toString('base64url')
    await f.a.passwordResetToken.create({ data: { userId: a.id, tokenHash: hashResetToken(resetToken), expiresAt: new Date(Date.now() + 1_200_000) } })
    return { a, b, tokenA, tokenB, resetToken }
  }

  await t.test('four migrations/history/checksum + drift verified; independent runtime connections and real login roles', async () => {
    const [[a], [b], [m]] = await Promise.all([
      f.a.$queryRaw`SELECT pg_backend_pid() AS pid, current_user AS role`,
      f.b.$queryRaw`SELECT pg_backend_pid() AS pid, current_user AS role`,
      f.migrator.$queryRaw`SELECT pg_backend_pid() AS pid, current_user AS role`,
    ])
    assert.equal(a.role, 'cineverse_app')
    assert.equal(b.role, 'cineverse_app')
    assert.equal(m.role, 'cineverse_migrator')
    assert.equal(new Set([a.pid, b.pid, m.pid]).size, 3)
    const runtime = await inspectRoleSecurity(f.a)
    const migration = await inspectRoleSecurity(f.migrator)
    assert.equal(runtime.identity.database, 'cineverse_ci')
    assert.equal(migration.identity.database, 'cineverse_ci')
    // The actual production identity guard MUST still reject this test DB.
    assert.throws(() => validateProductionRole(runtime, 'runtime'))
    for (const snapshot of [runtime, migration]) {
      assert.equal(snapshot.identity.canLogin, true)
      for (const key of ['superuser', 'createDb', 'createRole', 'replication', 'bypassRls', 'inherit', 'dbOwner', 'dbTemp', 'otherDatabaseConnect'])
        assert.equal(snapshot.identity[key], false, key)
      assert.equal(snapshot.identity.memberships, 0)
    }
    assert.equal(runtime.identity.ownsObjects, false)
    assert.equal(runtime.identity.dbCreate, false)
    assert.equal(runtime.schemas.find(row => row.name === 'public').create, false)
    assert.equal(migration.identity.dbCreate, true)
    assert.equal(migration.schemas.find(row => row.name === 'public').create, true)
    for (const table of runtime.tables.filter(row => row.name !== '_prisma_migrations')) {
      for (const key of ['select', 'insert', 'update', 'delete']) assert.equal(table[key], true)
      for (const key of ['truncate', 'references', 'trigger', 'grantOption', 'columnGrantOption', 'owner']) assert.equal(table[key], false)
    }
    assert.ok(migration.tables.every(row => row.owner))
  })

  await t.test('runtime cannot DDL, TRUNCATE, read migration history, create DB or SET ROLE migrator', async () => {
    const connection = await f.connection()
    for (const sql of ['CREATE SCHEMA native_forbidden', 'ALTER TABLE public."User" ADD COLUMN native_forbidden integer',
      'TRUNCATE public."Favorite"', 'SELECT * FROM public._prisma_migrations',
      'CREATE DATABASE native_forbidden', 'SET ROLE cineverse_migrator'])
      await assert.rejects(connection.query(sql), error => error.code === '42501')
  })

  await t.test('concurrent session creation serializes with User row lock and keeps maximum five sessions', async () => {
    const { a } = await seed()
    await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? sessionsA : sessionsB).create(a.id, hash)))
    assert.equal(await f.a.session.count({ where: { userId: a.id } }), authConfig.maxSessions)
  })

  await t.test('concurrent duplicate Favorite creates are idempotent; same movie on B remains isolated', async () => {
    const { a, b } = await seed()
    const result = await Promise.all([favoritesA.add(a.id, 27205), favoritesB.add(a.id, 27205)])
    assert.deepEqual(result.map(row => row.status).sort(), [200, 201])
    assert.equal(await f.a.favorite.count({ where: { userId: a.id, movieId: 27205 } }), 1)
    await favoritesB.add(b.id, 27205)
    await favoritesA.remove(a.id, 27205)
    assert.equal((await favoritesB.list(b.id)).favorites.length, 1)
  })

  await t.test('concurrent Profile updates keep owners; revoked-session SQL predicate rejects a new update', async () => {
    const { a, b, tokenA, tokenB } = await seed()
    const [one, two] = await Promise.all([profileA.update(a.id, tokenA, 'Tên A'), profileB.update(b.id, tokenB, 'Tên B')])
    assert.equal(one.id, a.id)
    assert.equal(two.id, b.id)
    await sessionsB.revoke(tokenA)
    await assert.rejects(profileA.update(a.id, tokenA, 'Must not save'), status(401))
    assert.equal((await profileA.get(a.id)).name, 'Tên A')
    assert.equal((await sessionsB.currentUser(tokenB)).name, 'Tên B')
  })

  await t.test('Logout DELETE waits for a real Session row lock, then revokes on the second connection', async st => {
    const { a, tokenA } = await seed()
    const lock = await f.connection()
    st.after(() => lock.query('ROLLBACK').catch(() => {}))
    const { rows: [{ pid }] } = await lock.query('SELECT pg_backend_pid() AS pid')
    await lock.query('BEGIN')
    await lock.query('SELECT id FROM public."Session" WHERE "userId"=$1 FOR UPDATE', [a.id])
    const revocation = sessionsB.revoke(tokenA)
    // Observe pg_blocking_pids, rather than hoping a sleep produced concurrency.
    await f.blockedBy(pid)
    await lock.query('COMMIT')
    await revocation
    await assert.rejects(sessionsA.currentUser(tokenA), status(401))
  })

  await t.test('Logout during password hash denies change when transaction rechecks revoked Session', async st => {
    const { a, tokenA } = await seed()
    const entered = gate(), release = gate()
    st.after(release.release)
    const change = createChangePasswordService({ getClient: async () => f.a,
      hashPassword: async () => { entered.release(); await release.promise; return nextHash } })
    const pending = change(a.id, tokenA, { currentPassword: password, newPassword: nextPassword })
    const rejected = assert.rejects(pending, status(401))
    await entered.promise
    await sessionsB.revoke(tokenA)
    release.release()
    await rejected
    assert.equal((await f.a.user.findUnique({ where: { id: a.id } })).passwordHash, hash)
    assert.equal(await f.a.passwordResetToken.count({ where: { userId: a.id } }), 1)
  })

  await t.test('two password changes with old credentials: only one commits, sessions/reset tokens revoked, B intact', async st => {
    const { a, b, tokenA, tokenB } = await seed()
    const ready = gate(), release = gate()
    st.after(release.release)
    let count = 0
    const settings = client => ({ getClient: async () => client,
      hashPassword: async () => { if (++count === 2) ready.release(); await release.promise; return nextHash } })
    const one = createChangePasswordService(settings(f.a))(a.id, tokenA, { currentPassword: password, newPassword: nextPassword })
    const two = createChangePasswordService(settings(f.b))(a.id, tokenA, { currentPassword: password, newPassword: nextPassword })
    const settled = Promise.allSettled([one, two])
    await ready.promise
    release.release()
    const result = await settled
    assert.equal(result.filter(row => row.status === 'fulfilled').length, 1)
    assert.equal(result.find(row => row.status === 'rejected').reason.status, 401)
    assert.equal(await verifyLoginPassword((await f.a.user.findUnique({ where: { id: a.id } })).passwordHash, nextPassword), true)
    assert.equal(await f.a.session.count({ where: { userId: a.id } }), 0)
    assert.equal(await f.a.passwordResetToken.count({ where: { userId: a.id } }), 0)
    assert.equal((await sessionsB.currentUser(tokenB)).id, b.id)
  })

  await t.test('native transaction rollback restores old password, Session and reset token after injected write error', async () => {
    const { a, tokenA } = await seed()
    await favoritesA.add(a.id, 550)
    const client = { user: f.a.user, $transaction: (work, options) => f.a.$transaction(tx => work({
      $queryRaw: tx.$queryRaw.bind(tx), user: tx.user, session: tx.session,
      passwordResetToken: { deleteMany: async () => { throw new Error('synthetic native rollback') } },
    }), options) }
    const change = createChangePasswordService({ getClient: async () => client, hashPassword: async () => nextHash })
    await assert.rejects(change(a.id, tokenA, { currentPassword: password, newPassword: nextPassword }), status(500))
    assert.equal((await f.b.user.findUnique({ where: { id: a.id } })).passwordHash, hash)
    assert.equal((await sessionsB.currentUser(tokenA)).id, a.id)
    assert.equal(await f.b.passwordResetToken.count({ where: { userId: a.id } }), 1)
    assert.equal((await favoritesB.list(a.id)).favorites.length, 1)
  })

  await t.test('concurrent one-time password reset consumes token once and revokes sessions', async st => {
    const { a, tokenA, resetToken } = await seed()
    const ready = gate(), release = gate()
    st.after(release.release)
    let count = 0
    const options = client => ({ getClient: async () => client, hashPassword: async () => {
      if (++count === 2) ready.release()
      await release.promise
      return nextHash
    } })
    const input = { token: resetToken, password: nextPassword }
    const pending = Promise.allSettled([
      createPasswordResetService(options(f.a)).reset(input), createPasswordResetService(options(f.b)).reset(input),
    ])
    await ready.promise
    release.release()
    const result = await pending
    assert.equal(result.filter(row => row.status === 'fulfilled').length, 1)
    assert.equal(result.find(row => row.status === 'rejected').reason.code, 'INVALID_RESET_TOKEN')
    await assert.rejects(sessionsA.currentUser(tokenA), status(401))
    assert.equal(await f.a.passwordResetToken.count({ where: { userId: a.id } }), 0)
  })

  for (const method of ['POST', 'DELETE']) await t.test(`accepted in-flight Favorite ${method} after Logout only affects A, never same movie on B`, async st => {
    const { a, b, tokenA } = await seed()
    if (method === 'DELETE') await favoritesA.add(a.id, 42)
    await favoritesB.add(b.id, 42)
    const entered = gate(), release = gate()
    st.after(release.release)
    const service = { ...favoritesA, [method === 'POST' ? 'add' : 'remove']: async (...args) => {
      entered.release(); await release.promise
      return favoritesA[method === 'POST' ? 'add' : 'remove'](...args)
    } }
    const server = createAppServer({ auth: { config: authConfig, getClient: async () => f.b },
      favorites: { service }, tmdb: { token: '' } })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    st.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
    const base = `http://127.0.0.1:${server.address().port}`
    const headers = { Cookie: `${authConfig.cookieName}=${tokenA}`, 'X-Cineverse-Account': a.id,
      'X-Cineverse-CSRF': '1', 'Content-Type': 'application/json' }
    const request = () => fetch(base + '/api/favorites' + (method === 'DELETE' ? '/42' : ''), {
      method, headers, ...(method === 'POST' ? { body: JSON.stringify({ movieId: 42 }) } : {}),
    })
    const pending = request()
    await entered.promise
    assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers, body: '{}' })).status, 204)
    assert.equal((await request()).status, 401)
    release.release()
    assert.equal((await pending).status, method === 'POST' ? 201 : 204)
    assert.equal(await f.a.favorite.count({ where: { userId: a.id, movieId: 42 } }), method === 'POST' ? 1 : 0)
    assert.equal(await f.a.favorite.count({ where: { userId: b.id, movieId: 42 } }), 1)
  })

  await t.test('a second bootstrap refuses a nonempty cluster before DDL and preserves existing test records', async () => {
    const count = await f.a.user.count()
    await assert.rejects(nativeFixture(), /Refuse nonempty database/)
    assert.equal(await f.a.user.count(), count)
    assert.equal((await f.b.$queryRaw`SELECT current_user AS role`)[0].role, 'cineverse_app')
  })
})
