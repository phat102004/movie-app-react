import { defineConfig } from 'prisma/config'
import { readNativeTestConfig } from './config.mjs'

// Only the already marker/port-verified disposable native fixture calls this.
// Same loopback cluster/fixture login; never environment production/local DSNs.
const url = new URL(readNativeTestConfig().migration.connectionString)
url.pathname = '/cineverse_prod'
export default defineConfig({ schema: '../prisma/schema.prisma',
  migrations: { path: '../prisma/migrations' }, datasource: { url: url.href } })
