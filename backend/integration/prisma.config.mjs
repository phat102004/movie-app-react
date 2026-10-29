import { defineConfig } from 'prisma/config'
import { readNativeTestConfig } from './config.mjs'

// Test CLI only: guarded dedicated target, no dotenv, no production/local fallback.
export default defineConfig({
  schema: '../prisma/schema.prisma',
  migrations: { path: '../prisma/migrations' },
  datasource: { url: readNativeTestConfig().migration.connectionString },
})
