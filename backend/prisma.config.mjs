import { defineConfig } from 'prisma/config'
import { loadBackendEnv } from './env.mjs'
import { prismaDatasourceUrl } from './database/connection-config.mjs'

loadBackendEnv()

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: { path: './prisma/migrations' },
  // Local offline validate/generate/diff --from-empty không cần credentials/DB.
  // Production luôn yêu cầu migration config riêng; không fallback runtime/local.
  datasource: {
    url: prismaDatasourceUrl(),
  },
})
