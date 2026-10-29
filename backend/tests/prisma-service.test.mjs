// Real Prisma/adapter and SQL in RAM; does not model native PostgreSQL concurrency.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { Pool, types } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'
import { knownMigrations } from '../database/inspect.mjs'
import { hashSessionToken } from '../auth/session-service.mjs'
import { createChangePasswordService } from '../profile/change-password-service.mjs'
import { hashRegistrationPassword, verifyLoginPassword } from '../auth/password.mjs'

test('M04: Prisma service update, revocation and transaction rollback through pg adapter + PGlite RAM', async () => {
  const db = new PGlite()
  const pool = new Pool()
  // No Pool socket is opened: every query is delegated to the isolated RAM DB.
  pool.query = async query => {
    const text = typeof query === 'string' ? query : query.text
    const getParser = query.types?.getTypeParser ?? types.getTypeParser
    const parsers = Object.fromEntries([16, 20, 21, 23, 25, 114, 700, 701, 1043, 1082, 1114, 1184, 1700, 2950, 3802].map(oid => [oid, getParser(oid, 'text')]))
    const result = await db.query(text, query.values ?? [], { rowMode: query.rowMode, parsers })
    return { ...result, rowCount: result.affectedRows ?? result.rows.length }
  }
  pool.connect = async () => Object.assign(new EventEmitter(), { query: pool.query, release() {} })
  const client = new PrismaClient({ adapter: new PrismaPg(pool), log: [] })
  const id = '00000000-0000-4000-8000-000000000001'
  const other = '00000000-0000-4000-8000-000000000002'
  const oldPassword = 'Old synthetic SQL probe password!'
  const newPassword = ' New synthetic SQL probe password! '
  const hash = await hashRegistrationPassword(oldPassword)
  const now = new Date('2026-10-28T10:00:00.000Z')
  const token = 'synthetic-sql-probe-session'.padEnd(43, 'x')
  try {
    for (const migration of knownMigrations)
      await db.exec(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8'))
    for (const [userId, email, name] of [[id, 'a@fixture.test', 'A'], [other, 'b@fixture.test', 'B']]) {
      await client.user.create({ data: { id: userId, email, name, passwordHash: hash } })
      await client.session.create({ data: { userId, tokenHash: hashSessionToken(token + userId.slice(-1)), expiresAt: new Date('2026-11-01T00:00:00.000Z') } })
      await client.passwordResetToken.create({ data: { userId, tokenHash: ('synthetic-reset-' + userId.slice(-1)).padEnd(64, 'x'), expiresAt: new Date('2026-11-01T00:00:00.000Z') } })
      await client.favorite.create({ data: { userId, movieId: 550 } })
    }
    const service = createChangePasswordService({ getClient: async () => client, now: () => now })
    await service(id, token + '1', { currentPassword: oldPassword, newPassword })
    const changed = await client.user.findUnique({ where: { id } })
    assert.equal(await verifyLoginPassword(changed.passwordHash, newPassword), true)
    assert.equal(await verifyLoginPassword(changed.passwordHash, oldPassword), false)
    assert.equal(await client.session.count({ where: { userId: id } }), 0)
    assert.equal(await client.passwordResetToken.count({ where: { userId: id } }), 0)
    assert.equal(await client.favorite.count({ where: { userId: id } }), 1)
    const broken = createChangePasswordService({ now: () => now, getClient: async () => ({
      user: client.user,
      $transaction: (work, options) => client.$transaction(tx => work({
        $queryRaw: tx.$queryRaw.bind(tx), user: tx.user, session: tx.session,
        passwordResetToken: { deleteMany: async () => { throw new Error('synthetic rollback') } },
      }), options),
    }) })
    await assert.rejects(broken(other, token + '2', { currentPassword: oldPassword, newPassword }), { status: 500 })
    assert.equal((await client.user.findUnique({ where: { id: other } })).passwordHash, hash)
    assert.equal(await client.session.count({ where: { userId: other } }), 1)
    assert.equal(await client.passwordResetToken.count({ where: { userId: other } }), 1)
    assert.equal(await client.favorite.count(), 2)
  } finally {
    await client.$disconnect()
    await pool.end()
    await db.close()
  }
})
