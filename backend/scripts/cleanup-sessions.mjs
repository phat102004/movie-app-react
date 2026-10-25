import { loadBackendEnv } from '../env.mjs'
import { disconnectDatabase } from '../database/client.mjs'
import { createSessionService } from '../auth/session-service.mjs'

loadBackendEnv()
const timeout = setTimeout(() => {
  console.error('Dọn session quá 15 giây; đã dừng.')
  process.exit(1)
}, 15_000)
try {
  const count = await createSessionService().cleanupExpired()
  console.info(
    `Đã xóa ${count} session hết hạn (tối đa 1000/lần). Không thay đổi User hoặc session còn hạn.`,
  )
} catch {
  console.error(
    'Chưa dọn được session. Kiểm tra cấu hình database và migration; chi tiết nội bộ đã được ẩn.',
  )
  process.exitCode = 1
} finally {
  try {
    await disconnectDatabase()
  } catch {
    process.exitCode = 1
  }
  clearTimeout(timeout)
}
