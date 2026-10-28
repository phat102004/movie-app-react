import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { isIP } from 'node:net'
import { X509Certificate } from 'node:crypto'
import { DatabaseConfigError, readDatabaseConfig } from './config.mjs'

const fail = () => new DatabaseConfigError(
  'Cấu hình database production chưa an toàn: cần đúng host đã xác nhận, cineverse_prod/public, role riêng và TLS strict. Không dùng cấu hình local làm dự phòng.',
)

export function readProductionDatabaseConfig(env, purpose) {
  if (!['runtime', 'migration'].includes(purpose)) throw fail()
  const name = purpose === 'runtime' ? 'DATABASE_URL' : 'MIGRATION_DATABASE_URL'
  const role = purpose === 'runtime' ? 'cineverse_app' : 'cineverse_migrator'
  let url
  try { url = new URL(env[name]) } catch { throw fail() }
  const host = env.PRODUCTION_DATABASE_HOST
  const allowed = ['schema', 'connect_timeout', 'sslmode', 'sslaccept']
  if (
    !host || host !== host.toLowerCase() || host !== url.hostname ||
    isIP(host) || host.length > 253 || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !host.includes('.') || host.endsWith('.localhost') || host.endsWith('.') ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname !== '/cineverse_prod' || (url.port && url.port !== '5432') || url.hash ||
    [...url.searchParams.keys()].some(key => !allowed.includes(key)) ||
    allowed.some(key => url.searchParams.getAll(key).length > 1) ||
    url.searchParams.get('schema') !== 'public' ||
    url.searchParams.get('sslmode') !== 'require' ||
    url.searchParams.get('sslaccept') !== 'strict'
  ) throw fail()
  let user, password
  try {
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
  } catch { throw fail() }
  if (user !== role || !password || /^(<[^>]+>|PASSWORD|your_password|replace_me)$/i.test(password)) throw fail()
  const ssl = { rejectUnauthorized: true, servername: host }
  if (env.DATABASE_SSL_CA_FILE) {
    const path = env.DATABASE_SSL_CA_FILE
    if (!isAbsolute(path)) throw fail()
    let ca
    try { ca = readFileSync(path, 'utf8') } catch { throw fail() }
    if (ca.length > 1024 * 1024 ||
      !/^(?:\s*-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*)+$/.test(ca)) throw fail()
    try {
      for (const cert of ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g))
        new X509Certificate(cert)
    } catch { throw fail() }
    ssl.ca = ca
    // Prisma CLI and node-pg receive the same public CA, never a private key.
    url.searchParams.set('sslcert', path)
  }
  url.searchParams.set('connect_timeout', '5')
  return {
    production: true,
    purpose,
    connectionString: url.toString(),
    driver: {
      host, port: 5432, database: 'cineverse_prod', user, password, ssl,
      options: '-c search_path=pg_catalog,public',
      max: purpose === 'runtime' ? 3 : 1,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000,
      statement_timeout: purpose === 'runtime' ? 5000 : 30_000,
      query_timeout: purpose === 'runtime' ? 6000 : 35_000,
    },
  }
}

function production(env) {
  if (env.NODE_ENV !== undefined && !['development', 'test', 'production'].includes(env.NODE_ENV))
    throw new DatabaseConfigError('NODE_ENV không hợp lệ; không tự suy đoán môi trường database.')
  return env.NODE_ENV === 'production'
}

export function readRuntimeDatabaseConfig(env = process.env) {
  return production(env)
    ? readProductionDatabaseConfig(env, 'runtime')
    : readDatabaseConfig(env.DATABASE_URL)
}

export function readMigrationDatabaseConfig(env = process.env) {
  return production(env)
    ? readProductionDatabaseConfig(env, 'migration')
    : readDatabaseConfig(env.MIGRATION_DATABASE_URL?.trim() || env.DATABASE_URL)
}

// Used by Prisma CLI config. Local offline validate/generate remains supported.
export function prismaDatasourceUrl(env = process.env) {
  if (production(env)) return readMigrationDatabaseConfig(env).connectionString
  return env.MIGRATION_DATABASE_URL?.trim() || env.DATABASE_URL?.trim()
    ? readMigrationDatabaseConfig(env).connectionString : undefined
}
