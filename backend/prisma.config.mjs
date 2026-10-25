import { defineConfig } from 'prisma/config'
import { loadBackendEnv } from './env.mjs'
import { readDatabaseConfig } from './database/config.mjs'

loadBackendEnv()

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: { path: './prisma/migrations' },
  // validate/generate/diff --from-empty không cần credentials hoặc DB đang chạy.
  // Các lệnh có kết nối sẽ bị chặn nếu URL thiếu/sai; không dùng URL giả dự phòng.
  datasource: {
    url: process.env.DATABASE_URL?.trim()
      ? readDatabaseConfig().connectionString
      : undefined,
  },
})
