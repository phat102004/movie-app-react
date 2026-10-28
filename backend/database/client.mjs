import { loadBackendEnv } from '../env.mjs'
import { readRuntimeDatabaseConfig } from './connection-config.mjs'
import { assertProductionRole } from './role-security.mjs'

let clientPromise

export async function createDatabaseClient(config) {
  const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
    import('@prisma/adapter-pg'),
    import('../generated/prisma/client.ts'),
  ])
  const client = new PrismaClient({
    adapter: new PrismaPg(config.driver, { schema: 'public' }),
    log: [],
  })
  try {
    await assertProductionRole(client, config)
    return client
  } catch (error) {
    await client.$disconnect().catch(() => {})
    throw error
  }
}

// Import module này chưa tạo pool, chưa tải generated client, chưa kết nối DB.
// Các route TMDB không import hoặc gọi getPrisma().
export function getPrisma() {
  if (!clientPromise) {
    clientPromise = (async () => {
      loadBackendEnv()
      return createDatabaseClient(readRuntimeDatabaseConfig())
    })().catch((error) => {
      clientPromise = undefined
      throw error
    })
  }
  return clientPromise
}

export async function disconnectDatabase() {
  const pending = clientPromise
  clientPromise = undefined
  if (pending) {
    const client = await pending
    await client.$disconnect()
  }
}
