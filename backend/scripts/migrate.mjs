import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  getMigrationPrisma as getPrisma,
  disconnectMigrationDatabase as disconnectDatabase,
} from '../database/migration-client.mjs'
import { loadBackendEnv } from '../env.mjs'
import {
  DatabaseConfigError,
  databaseErrorMessage,
} from '../database/config.mjs'
import {
  knownMigrations,
  migrationState,
  inspectDatabase,
  migrationSchemaPath,
  countExistingRecords,
} from '../database/inspect.mjs'
import { assertFavoriteSchema } from '../database/favorite.mjs'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const timeout = setTimeout(() => {
  console.error(
    'Migration quá 180 giây; đã dừng. Kiểm tra lịch sử migration trong pgAdmin trước khi chạy lại.',
  )
  process.exit(1)
}, 180_000)

try {
  loadBackendEnv()
  if (process.env.NODE_ENV === 'production')
    throw new DatabaseConfigError('db:migrate chỉ dành cho local. Production dùng db:deploy:production sau khi DBA provision và review.')
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
    const schema = migrationSchemaPath(count)
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
        { cwd: root, windowsHide: true, timeout: 45_000, maxBuffer: 512_000 },
      )
    } catch {
      throw new DatabaseConfigError(
        'Đã dừng: schema thực tế có drift hoặc chưa kiểm tra được kết nối. Không thay đổi database; cần review.',
      )
    }
  }
  await assertNoDrift(applied)
  if (applied === expected.length) {
    await assertFavoriteSchema(client)
    console.info(
      'Các migration đã được áp dụng và schema khớp; không thay đổi database.',
    )
  } else {
    const countsBefore = await countExistingRecords(client, applied)
    console.info(`Số bản ghi trước migration: ${JSON.stringify(countsBefore)}`)
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
        { cwd: root, windowsHide: true, timeout: 45_000, maxBuffer: 512_000 },
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
    await assertFavoriteSchema(client)
    const countsAfter = await countExistingRecords(client, expected.length)
    console.info(`Số bản ghi sau migration: ${JSON.stringify(countsAfter)}`)
    if (
      Object.keys(countsBefore).some(
        (model) => countsBefore[model] !== countsAfter[model],
      )
    )
      throw new DatabaseConfigError(
        'Số bản ghi thay đổi trong lúc migration; cần kiểm tra hoạt động đồng thời. Không tự sửa/xóa dữ liệu hoặc rollback.',
      )
    console.info(
      'Migration hoàn thành; schema khớp. User/Session/PasswordResetToken/Favorite được giữ nguyên số bản ghi.',
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
