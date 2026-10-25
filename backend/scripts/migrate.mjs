import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { getPrisma, disconnectDatabase } from '../database/client.mjs'
import {
  DatabaseConfigError,
  databaseErrorMessage,
} from '../database/config.mjs'
import {
  knownMigrations,
  migrationState,
  inspectDatabase,
} from '../database/inspect.mjs'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const timeout = setTimeout(() => {
  console.error(
    'Migration quá 60 giây; đã dừng. Kiểm tra lịch sử migration trong pgAdmin trước khi chạy lại.',
  )
  process.exit(1)
}, 60_000)

try {
  // Chỉ áp dụng các migration trong allowlist đã review; không nhận SQL tùy ý.
  const migrationsPath = new URL('../prisma/migrations/', import.meta.url)
  const directories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (
    directories.length !== knownMigrations.length ||
    directories.some((name, index) => name !== knownMigrations[index])
  )
    throw new DatabaseConfigError(
      'Script chỉ hỗ trợ các migration đã review trong knownMigrations.',
    )

  const expected = await Promise.all(
    knownMigrations.map(async (name) => ({
      name,
      checksum: createHash('sha256')
        .update(
          await readFile(new URL(`${name}/migration.sql`, migrationsPath)),
        )
        .digest('hex'),
    })),
  )
  const client = await getPrisma()
  const before = await inspectDatabase(client)
  const applied = migrationState(before, expected)
  async function assertNoDrift(count) {
    if (!count) return
    const schema =
      count === 1
        ? 'backend/prisma/baselines/user.prisma'
        : count === 2
          ? 'backend/prisma/baselines/session.prisma'
          : 'backend/prisma/schema.prisma'
    try {
      await run(
        process.execPath,
        [
          'node_modules/prisma/build/index.js',
          'migrate',
          'diff',
          '--config',
          'backend/prisma.config.mjs',
          '--from-config-datasource',
          '--to-schema',
          schema,
          '--exit-code',
        ],
        { cwd: root, windowsHide: true, timeout: 15_000, maxBuffer: 512_000 },
      )
    } catch {
      throw new DatabaseConfigError(
        'Đã dừng: schema thực tế có drift hoặc chưa kiểm tra được kết nối. Không thay đổi database; cần review.',
      )
    }
  }
  await assertNoDrift(applied)
  if (applied === expected.length) {
    console.info(
      'Các migration đã được áp dụng và schema khớp; không thay đổi database.',
    )
  } else {
    const usersBefore = applied ? await client.user.count() : 0
    const sessionsBefore = applied >= 2 ? await client.session.count() : 0
    console.info(
      'Database, checksum và schema đã được xác minh. Áp dụng migration đã review…',
    )
    // SQL sinh offline + deploy không dùng shadow database hoặc yêu cầu reset.
    // Không in stdout/stderr thô của Prisma CLI để tránh lộ URL khi có lỗi.
    try {
      await run(
        process.execPath,
        [
          'node_modules/prisma/build/index.js',
          'migrate',
          'deploy',
          '--config',
          'backend/prisma.config.mjs',
        ],
        { cwd: root, windowsHide: true, timeout: 30_000, maxBuffer: 512_000 },
      )
    } catch {
      throw new DatabaseConfigError(
        'Prisma chưa xác nhận migration thành công. Kiểm tra kết nối/lịch sử _prisma_migrations trong pgAdmin; không reset hoặc chạy lại liên tục.',
      )
    }
    const after = await inspectDatabase(client)
    if (migrationState(after, expected) !== expected.length)
      throw new DatabaseConfigError(
        'Chưa xác nhận được các bảng và lịch sử migration sau khi áp dụng.',
      )
    await assertNoDrift(expected.length)
    const usersAfter = await client.user.count()
    const sessionsAfter = await client.session.count()
    console.info(
      `Migration hoàn thành; schema khớp. Số User không đổi: ${usersBefore === usersAfter}; số Session không đổi: ${sessionsBefore === sessionsAfter}.`,
    )
  }
} catch (error) {
  console.error(databaseErrorMessage(error))
  process.exitCode = 1
} finally {
  try {
    await disconnectDatabase()
  } catch {
    console.error(
      'Không thể đóng kết nối database bình thường; không hiển thị chi tiết nội bộ.',
    )
    process.exitCode = 1
  }
  clearTimeout(timeout)
}
