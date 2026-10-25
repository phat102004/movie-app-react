import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { once } from 'node:events'
import test from 'node:test'
import {
  DatabaseConfigError,
  databaseErrorMessage,
  readDatabaseConfig,
} from '../database/config.mjs'
import {
  initialMigration,
  initialMigrationState,
} from '../database/inspect.mjs'

const fixtureUrl =
  'postgresql://postgres:fixture%40pass%23@localhost:5432/cineverse_dev?schema=public'
const object = (name, schema = 'public', kind = 'r') => ({ name, schema, kind })

test('URL database local giải mã mật khẩu cho driver nhưng giữ encoded URL cho CLI', () => {
  const config = readDatabaseConfig(fixtureUrl)
  assert.equal(config.driver.password, 'fixture@pass#')
  assert.equal(config.driver.database, 'cineverse_dev')
  assert.equal(config.driver.connectionTimeoutMillis, 5000)
  assert.equal(new URL(config.connectionString).password, 'fixture%40pass%23')
  assert.equal(
    new URL(config.connectionString).searchParams.get('connect_timeout'),
    '5',
  )
  assert.equal(
    readDatabaseConfig(fixtureUrl.replace('fixture%40pass%23', 'actual%3Cpass%3E'))
      .driver.password,
    'actual<pass>',
  )
})

test('chặn URL thiếu/placeholder, database khác, host/cổng khác và query đổi upstream', () => {
  for (const value of [
    '',
    'not a url',
    fixtureUrl.replace('fixture%40pass%23', '<PASSWORD>'),
    fixtureUrl.replace('fixture%40pass%23', ''),
    fixtureUrl.replace('fixture%40pass%23', '%ZZ'),
    fixtureUrl.replace('cineverse_dev', 'postgres'),
    fixtureUrl.replace('localhost', 'example.com'),
    fixtureUrl.replace('5432', '5433'),
    fixtureUrl.replace('postgresql:', 'https:'),
    fixtureUrl.replace('schema=public', 'schema=private'),
    `${fixtureUrl}&schema=private`,
    `${fixtureUrl}&host=example.com`,
  ]) {
    assert.throws(() => readDatabaseConfig(value), DatabaseConfigError)
  }
})

test('thông báo lỗi không lộ URL, mật khẩu hoặc lỗi nội bộ từ driver', () => {
  for (const code of [
    '28P01',
    '3D000',
    'ECONNREFUSED',
    'P1001',
    'P2021',
    'UNKNOWN',
  ]) {
    const message = databaseErrorMessage({
      code,
      message: `secret: ${fixtureUrl}`,
    })
    assert.ok(message.length > 10)
    assert.ok(!message.includes('fixture'))
    assert.ok(!message.includes('postgresql://'))
  }
  assert.match(
    databaseErrorMessage({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { kind: 'AuthenticationFailed' } } },
    }),
    /từ chối xác thực/,
  )
})

test('initial migration chỉ cho database rỗng hoặc nhận diện bản đã áp dụng đúng checksum', () => {
  const empty = { database: 'cineverse_dev', objects: [], migrations: [] }
  assert.equal(initialMigrationState(empty, 'checksum'), 'empty')
  const applied = {
    ...empty,
    objects: [object('User'), object('_prisma_migrations')],
    migrations: [
      {
        name: initialMigration,
        checksum: 'checksum',
        finished: new Date(),
        rolled_back: null,
      },
    ],
  }
  assert.equal(initialMigrationState(applied, 'checksum'), 'applied')
  assert.throws(
    () => initialMigrationState(applied, 'changed-checksum'),
    DatabaseConfigError,
  )
  for (const snapshot of [
    { ...empty, database: 'postgres' },
    { ...empty, objects: [object('ExistingData')] },
    { ...empty, objects: [object('ExistingData', 'another_schema')] },
    { ...empty, objects: [object('ExistingView', 'public', 'v')] },
    { ...empty, objects: [object('User')] },
    { ...applied, migrations: [{ ...applied.migrations[0], finished: null }] },
    {
      ...applied,
      migrations: [{ ...applied.migrations[0], rolled_back: new Date() }],
    },
  ])
    assert.throws(
      () => initialMigrationState(snapshot, 'checksum'),
      DatabaseConfigError,
    )
})

test('import module database không cần URL, generated client hoặc kết nối PostgreSQL', () => {
  const moduleUrl = new URL('../database/client.mjs', import.meta.url).href
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(moduleUrl)}); console.log('lazy-ok')`,
    ],
    {
      env: { ...process.env, DATABASE_URL: '' },
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    },
  )
  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim(), 'lazy-ok')
  assert.equal(result.stderr, '')
})

test('migration SQL chỉ tạo User và index; không seed, DROP, DELETE hoặc ALTER', () => {
  const sql = readFileSync(
    new URL(
      `../prisma/migrations/${initialMigration}/migration.sql`,
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(sql, /CREATE TABLE "User"/)
  assert.match(sql, /"id" UUID NOT NULL/)
  assert.match(sql, /CREATE UNIQUE INDEX "User_email_key"/)
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE)\b/i)
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/)
})

test(
  'generated Prisma Client chạy được trên Node hiện tại và xử lý DB không khả dụng',
  {
    skip: !existsSync(
      new URL('../generated/prisma/client.ts', import.meta.url),
    ),
    timeout: 8000,
  },
  async () => {
    // Chọn cổng test rồi đóng; không thử mật khẩu với PostgreSQL thật ở 5432.
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = server.address().port
    await new Promise((resolve) => server.close(resolve))
    const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
      import('../generated/prisma/client.ts'),
      import('@prisma/adapter-pg'),
    ])
    const client = new PrismaClient({
      adapter: new PrismaPg({
        host: '127.0.0.1',
        port,
        database: 'fixture',
        user: 'fixture',
        password: 'fixture',
        connectionTimeoutMillis: 500,
      }),
      log: [],
    })
    try {
      await assert.rejects(client.$queryRaw`SELECT 1`, (error) => {
        assert.match(
          databaseErrorMessage(error),
          /Không kết nối được PostgreSQL/,
        )
        return true
      })
    } finally {
      await client.$disconnect()
    }
  },
)
