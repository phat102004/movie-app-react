import { Client } from 'pg'
import { loadBackendEnv } from '../env.mjs'
import { readDatabaseConfig } from '../database/config.mjs'

loadBackendEnv()

const { driver } = readDatabaseConfig()
const client = new Client(driver)

try {
  await client.connect()

  const result = await client.query(
    'SELECT current_database() AS database, current_user AS username'
  )

  console.log('POSTGRESQL CONNECTED')
  console.log(result.rows[0])
} catch (error) {
  console.error('ERROR NAME:', error.name)
  console.error('ERROR CODE:', error.code ?? error.cause?.code ?? 'unknown')
} finally {
  await client.end().catch(() => {})
}