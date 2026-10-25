import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  initialMigration,
  sessionMigration,
  passwordResetMigration,
  migrationState,
} from '../database/inspect.mjs'
import { DatabaseConfigError } from '../database/config.mjs'

const expected = [
  { name: initialMigration, checksum: 'a' },
  { name: sessionMigration, checksum: 'b' },
  { name: passwordResetMigration, checksum: 'c' },
]
const history = expected.map((migration) => ({
  ...migration,
  finished: new Date(),
  rolled_back: null,
}))
const object = (name) => ({ name, schema: 'public', kind: 'r' })
const snapshot = (count) => ({
  database: 'cineverse_dev',
  migrations: history.slice(0, count),
  objects: count
    ? [
        object('User'),
        object('_prisma_migrations'),
        ...(count >= 2 ? [object('Session')] : []),
        ...(count >= 3 ? [object('PasswordResetToken')] : []),
      ]
    : [],
})

test('migration plan chỉ chấp nhận empty/User/User+Session và prefix history đúng checksum', () => {
  for (const count of [0, 1, 2, 3])
    assert.equal(migrationState(snapshot(count), expected), count)
})

test('migration plan chặn database khác, history lạ/đổi thứ tự/checksum/failure và bảng lạ', () => {
  for (const input of [
    { ...snapshot(1), database: 'postgres' },
    { ...snapshot(1), migrations: [{ ...history[0], checksum: 'changed' }] },
    { ...snapshot(1), migrations: [{ ...history[0], finished: null }] },
    {
      ...snapshot(1),
      migrations: [{ ...history[0], rolled_back: new Date() }],
    },
    { ...snapshot(1), migrations: [history[1]] },
    {
      ...snapshot(2),
      migrations: [...history, { ...history[1], name: 'unknown' }],
    },
    {
      ...snapshot(1),
      objects: [...snapshot(1).objects, object('ImportantData')],
    },
    { ...snapshot(1), objects: [...snapshot(1).objects, object('Session')] },
    { ...snapshot(2), objects: snapshot(1).objects },
  ])
    assert.throws(() => migrationState(input, expected), DatabaseConfigError)
})

test('Session SQL chỉ tạo bảng/index/FK mới, không sửa dữ liệu hoặc migration ban đầu', () => {
  const sql = readFileSync(
    new URL(
      `../prisma/migrations/${sessionMigration}/migration.sql`,
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(sql, /CREATE TABLE "Session"/)
  assert.match(sql, /REFERENCES "User"\("id"\)/)
  assert.match(sql, /"tokenHash" CHAR\(64\)/)
  assert.doesNotMatch(
    sql,
    /\b(DROP|TRUNCATE|INSERT|DELETE FROM|UPDATE "User"|ALTER TABLE "User")\b/i,
  )
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/)
})

test('PasswordResetToken SQL chỉ thêm bảng/hash/TTL/index/FK, không sửa User/Session', () => {
  const sql = readFileSync(
    new URL(
      `../prisma/migrations/${passwordResetMigration}/migration.sql`,
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(sql, /CREATE TABLE "PasswordResetToken"/)
  assert.match(sql, /"tokenHash" CHAR\(64\)/)
  assert.match(sql, /"expiresAt" TIMESTAMPTZ\(3\)/)
  assert.match(sql, /REFERENCES "User"\("id"\)/)
  assert.doesNotMatch(
    sql,
    /\b(DROP|TRUNCATE|INSERT|DELETE FROM|UPDATE "User"|ALTER TABLE "User"|ALTER TABLE "Session")\b/i,
  )
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/)
})
