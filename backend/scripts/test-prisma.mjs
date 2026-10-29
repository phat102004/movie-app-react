import { getPrisma, disconnectDatabase } from '../database/client.mjs'
import { databaseErrorMessage } from '../database/config.mjs'

try {
  const prisma = await getPrisma()
  await prisma.$queryRaw`SELECT 1`
  console.info('PRISMA CLIENT / QUERY OK (read-only).')
} catch (error) {
  console.error(databaseErrorMessage(error))
  process.exitCode = 1
} finally {
  try { await disconnectDatabase() }
  catch {
    console.error('Không thể đóng Prisma Client; chi tiết nội bộ đã được ẩn.')
    process.exitCode = 1
  }
}
