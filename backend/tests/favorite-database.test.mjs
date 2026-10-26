import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { assertFavoriteSchema } from '../database/favorite.mjs'
import { DatabaseConfigError } from '../database/config.mjs'
import { knownMigrations, favoriteMigration } from '../database/inspect.mjs'

const userA = '00000000-0000-4000-8000-000000000001'
const userB = '00000000-0000-4000-8000-000000000002'
const absentUser = '00000000-0000-4000-8000-000000000003'
const migrationSql = (name) =>
  readFile(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    'utf8',
  )

test(
  'Favorite SQL integration trong PostgreSQL WASM RAM riêng, không dùng .env hoặc database thật',
  { timeout: 30_000 },
  async (t) => {
    // Không dataDir, không socket/credentials: mọi DDL/DML bên dưới chỉ tác động RAM.
    const db = new PGlite()
    const client = {
      $queryRaw: async (strings, ...values) => {
        const sql = strings.reduce(
          (text, part, index) => text + (index ? `$${index}` : '') + part,
          '',
        )
        return (await db.query(sql, values)).rows
      },
    }
    let serial = 100
    const insert = (userId, movieId) =>
      db.query(
        'INSERT INTO "Favorite" (id,"userId","movieId") VALUES ($1,$2,$3) RETURNING id,"movieId","createdAt"',
        [
          `00000000-0000-4000-8000-${String(serial++).padStart(12, '0')}`,
          userId,
          movieId,
        ],
      )
    try {
      for (const name of knownMigrations.slice(0, -1))
        await db.exec(await migrationSql(name))
      await db.query(
        'INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ($1,$2,$3,$4,NOW()), ($5,$6,$7,$8,NOW())',
        [
          userA,
          'a@fixture.test',
          'Fixture A',
          'synthetic-not-an-auth-hash',
          userB,
          'b@fixture.test',
          'Fixture B',
          'synthetic-not-an-auth-hash',
        ],
      )
      await db.query(
        'INSERT INTO "Session" (id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,NOW()+INTERVAL \'1 day\')',
        [
          '00000000-0000-4000-8000-000000000010',
          userA,
          'synthetic-session-fixture'.padEnd(64, 'x'),
        ],
      )
      await db.query(
        'INSERT INTO "PasswordResetToken" (id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,NOW()+INTERVAL \'20 minutes\')',
        [
          '00000000-0000-4000-8000-000000000011',
          userA,
          'synthetic-reset-fixture'.padEnd(64, 'x'),
        ],
      )
      const authSnapshot = async () => ({
        users: (
          await db.query(
            'SELECT id,email,name,"createdAt","updatedAt" FROM "User" ORDER BY id',
          )
        ).rows,
        sessions: (
          await db.query(
            'SELECT id,"userId","createdAt","expiresAt" FROM "Session" ORDER BY id',
          )
        ).rows,
        resets: (
          await db.query(
            'SELECT id,"userId","createdAt","expiresAt" FROM "PasswordResetToken" ORDER BY id',
          )
        ).rows,
      })
      const before = await authSnapshot()
      const sql = await migrationSql(favoriteMigration)

      await t.test(
        'áp dụng migration thêm Favorite, bảo toàn bản ghi User/Session/Reset có sẵn',
        async () => {
          await db.exec(sql)
          assert.deepEqual(await authSnapshot(), before)
          assert.deepEqual(
            (await db.query('SELECT COUNT(*)::int AS count FROM "Favorite"'))
              .rows,
            [{ count: 0 }],
          )
        },
      )
      await t.test(
        'catalog xác nhận UUID/FK/unique/index/Timestamptz và không có metadata TMDB',
        async () => {
          const metadata = await assertFavoriteSchema(client)
          assert.deepEqual(
            metadata.columns.map((column) => column.name),
            ['id', 'userId', 'movieId', 'createdAt'],
          )
          assert.ok(
            metadata.indexes.some(
              (index) => index.name === 'Favorite_userId_createdAt_idx',
            ),
          )
        },
      )
      await t.test(
        'createdAt có default; cùng phim khác User được phép; cùng User khác phim được phép',
        async () => {
          const first = await insert(userA, 27205)
          assert.equal(first.rows[0].movieId, 27205)
          assert.ok(
            Number.isFinite(new Date(first.rows[0].createdAt).getTime()),
          )
          await insert(userB, 27205)
          await insert(userA, 42)
          assert.equal(
            (await db.query('SELECT COUNT(*)::int AS count FROM "Favorite"'))
              .rows[0].count,
            3,
          )
        },
      )
      await t.test(
        'unique(userId,movieId) chặn cùng User lưu trùng một phim',
        async () => {
          await assert.rejects(insert(userA, 27205), { code: '23505' })
        },
      )
      await t.test(
        'FK chặn userId không tồn tại, null và UUID sai định dạng',
        async () => {
          await assert.rejects(insert(absentUser, 27205), { code: '23503' })
          await assert.rejects(insert(null, 27205), { code: '23502' })
          await assert.rejects(insert('invalid-user-id', 27205), {
            code: '22P02',
          })
        },
      )
      await t.test(
        'movieId yêu cầu INTEGER NOT NULL: từ chối text/fractional parameter/overflow/null',
        async () => {
          for (const value of ['invalid', 1.5, null, 2_147_483_648])
            await assert.rejects(insert(userA, value), (error) =>
              ['22P02', '23502', '22003'].includes(error.code),
            )
        },
      )
      await t.test(
        'SQL không thể apply trùng; rollback DDL thất bại không làm mất dữ liệu',
        async () => {
          await assert.rejects(db.exec(sql), { code: '42P07' })
          await db.exec('ROLLBACK')
          assert.deepEqual(await authSnapshot(), before)
          assert.equal(
            (await db.query('SELECT COUNT(*)::int AS count FROM "Favorite"'))
              .rows[0].count,
            3,
          )
        },
      )
      await t.test(
        'Cascade chỉ xóa Favorite của User bị xóa trong database RAM',
        async () => {
          await db.query('DELETE FROM "User" WHERE id=$1', [userB])
          assert.equal(
            (
              await db.query(
                'SELECT COUNT(*)::int AS count FROM "Favorite" WHERE "userId"=$1',
                [userB],
              )
            ).rows[0].count,
            0,
          )
          assert.equal(
            (
              await db.query(
                'SELECT COUNT(*)::int AS count FROM "Favorite" WHERE "userId"=$1',
                [userA],
              )
            ).rows[0].count,
            2,
          )
        },
      )
      await t.test(
        'metadata guard phát hiện drift thiếu unique index',
        async () => {
          await db.exec('DROP INDEX "Favorite_userId_movieId_key"')
          await assert.rejects(
            assertFavoriteSchema(client),
            DatabaseConfigError,
          )
        },
      )
    } finally {
      await db.close()
    }
  },
)
