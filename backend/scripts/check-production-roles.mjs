import { loadBackendEnv } from '../env.mjs'
import { getPrisma, disconnectDatabase } from '../database/client.mjs'
import { getMigrationPrisma, disconnectMigrationDatabase } from '../database/migration-client.mjs'
import { DatabaseConfigError, databaseErrorMessage } from '../database/config.mjs'

const timeout = setTimeout(() => {
  console.error('Production role check quá 30 giây; đã dừng, không thay đổi quyền.')
  process.exit(1)
}, 30_000)
try {
  loadBackendEnv()
  const args = process.argv.slice(2)
  if (process.env.NODE_ENV !== 'production' || args.some(arg => arg !== '--migration') || args.length > 1)
    throw new DatabaseConfigError('Role check này cần NODE_ENV=production; tùy chọn duy nhất là --migration. Không áp dụng quyền vào local.')
  await (args.includes('--migration') ? getMigrationPrisma() : getPrisma())
  console.info('Production role check đạt: đúng identity, attributes, ownership và effective ACL. Chỉ đọc metadata; không GRANT/REVOKE/DML.')
} catch (error) {
  console.error(databaseErrorMessage(error))
  process.exitCode = 1
} finally {
  for (const close of [disconnectDatabase, disconnectMigrationDatabase]) {
    try { await close() } catch { process.exitCode = 1 }
  }
  clearTimeout(timeout)
}
