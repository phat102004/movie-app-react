import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { loadBackendEnv } from '../env.mjs'
import { DatabaseConfigError, databaseErrorMessage } from '../database/config.mjs'
import { getMigrationPrisma, disconnectMigrationDatabase } from '../database/migration-client.mjs'
import { reviewedProductionMigrations, inspectProductionMigration, productionMigrationState } from '../database/production-migration-plan.mjs'
import { migrationSchemaPath } from '../database/inspect.mjs'

const run = promisify(execFile)
const timeout = setTimeout(() => {
  console.error('Production deployment quá 180 giây. Dừng để review history; không tự retry/reset.')
  process.exit(1)
}, 180_000)
async function prisma(args) {
  try {
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', ...args,
      '--config', 'backend/prisma.config.mjs'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true,
      timeout: 60_000, maxBuffer: 512_000,
    })
  } catch {
    throw new DatabaseConfigError('Prisma production command chưa xác nhận thành công hoặc phát hiện drift. Kiểm tra history/backup với DBA; không reset hay tự chạy lại. Output nội bộ đã được ẩn.')
  }
}
try {
  loadBackendEnv()
  if (process.env.NODE_ENV !== 'production' || process.argv.length !== 2)
    throw new DatabaseConfigError('Production deploy cần NODE_ENV=production và không nhận tham số tùy ý. Local tiếp tục dùng db:migrate.')
  const expected = await reviewedProductionMigrations()
  // Factory validates actual logged-in role/ACL before returning the client.
  const client = await getMigrationPrisma()
  const applied = productionMigrationState(await inspectProductionMigration(client), expected)
  if (applied) await prisma(['diff', '--from-config-datasource', '--to-schema', migrationSchemaPath(applied), '--exit-code'])
  if (applied < expected.length) await prisma(['deploy'])
  if (productionMigrationState(await inspectProductionMigration(client), expected) !== expected.length)
    throw new DatabaseConfigError('Chưa xác nhận đủ production migrations. Dừng để DBA review.')
  await prisma(['diff', '--from-config-datasource', '--to-schema', 'backend/prisma/schema.prisma', '--exit-code'])
  console.info('Production migrations/history/drift đã được xác nhận. DBA review script runtime grants rồi chạy db:roles:check trước khi mở backend. Không tự GRANT hoặc đổi owner.')
} catch (error) {
  console.error(databaseErrorMessage(error))
  process.exitCode = 1
} finally {
  try { await disconnectMigrationDatabase() } catch { process.exitCode = 1 }
  clearTimeout(timeout)
}
