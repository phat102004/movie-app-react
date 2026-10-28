import { loadBackendEnv } from '../env.mjs'
import { readMigrationDatabaseConfig } from './connection-config.mjs'
import { createDatabaseClient } from './client.mjs'

let pending
export function getMigrationPrisma() {
  if (!pending) pending = (async () => {
    loadBackendEnv()
    return createDatabaseClient(readMigrationDatabaseConfig())
  })().catch(error => { pending = undefined; throw error })
  return pending
}
export async function disconnectMigrationDatabase() {
  const current = pending
  pending = undefined
  if (current) await (await current).$disconnect()
}
