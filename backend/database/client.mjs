import { loadBackendEnv } from '../env.mjs'
import { readDatabaseConfig } from './config.mjs'

let clientPromise

// Import module này chưa tạo pool, chưa tải generated client, chưa kết nối DB.
// Các route TMDB không import hoặc gọi getPrisma().
export function getPrisma() {
  if (!clientPromise) {
    clientPromise = (async () => {
      loadBackendEnv()
      const { driver } = readDatabaseConfig()
      const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
        import('@prisma/adapter-pg'),
        import('../generated/prisma/client.ts'),
      ])
      return new PrismaClient({
        adapter: new PrismaPg(driver, { schema: 'public' }),
        log: [],
      })
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
