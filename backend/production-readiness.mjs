import { readAuthConfig } from './auth/config.mjs'
import { readResetEmailConfig } from './auth/reset-email.mjs'
import { readRuntimeDatabaseConfig, readMigrationDatabaseConfig } from './database/connection-config.mjs'
import { createClientIpResolver } from './client-ip.mjs'
import { readTmdbProxyConfig } from './upstream-scheduler.mjs'

// Offline configuration gate. It does not load .env, connect, migrate or deploy.
function runtimeSettings(env) {
  if (env.NODE_ENV !== 'production') throw new Error('Explicit production environment required')
  const auth = readAuthConfig(env)
  readRuntimeDatabaseConfig(env)
  const token = env.TMDB_READ_ACCESS_TOKEN?.trim()
  if (!token || token.length < 20 || /\s|[<>]/.test(token) || /^(your_|replace_me|placeholder)/i.test(token))
    throw new Error('TMDB server credential required')
  const mail = readResetEmailConfig(env, auth)
  createClientIpResolver(env.TRUSTED_PROXY_CIDRS ?? '')
  const scheduler = readTmdbProxyConfig(env)
  return { recoveryEnabled: mail !== null, proxyTrustConfigured: Boolean(env.TRUSTED_PROXY_CIDRS?.trim()), ...scheduler }
}

export function validateRuntimeProductionConfig(env) {
  if (env.MIGRATION_DATABASE_URL?.trim()) throw new Error('Migrator credentials do not belong in HTTP runtime')
  const settings = runtimeSettings(env)
  if (env.HOSTING_MODE === 'render' && env.PASSWORD_RESET_EMAIL_MODE !== 'resend')
    throw new Error('Render Free recovery requires the HTTPS email transport')
  return settings
}

// Separate release-only preflight keeps the original two-role contract.
export function validateProductionConfig(env) {
  const settings = runtimeSettings(env)
  const runtime = readRuntimeDatabaseConfig(env)
  const migration = readMigrationDatabaseConfig(env)
  if (runtime.driver.host !== migration.driver.host || runtime.driver.password === migration.driver.password)
    throw new Error('Runtime and migrator must share the target and have distinct secrets')
  return settings
}
