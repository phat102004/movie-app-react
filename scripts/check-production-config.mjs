import { validateProductionConfig } from '../backend/production-readiness.mjs'
try {
  const result = validateProductionConfig(process.env)
  console.info('Offline production configuration accepted. Runtime role/ACL, network/TLS, upstream and SMTP delivery still need staging verification.')
  if (!result.recoveryEnabled) console.info('Password recovery is explicitly disabled (503); this is not mail delivery verification.')
} catch {
  console.error('Production configuration rejected. Check explicit NODE_ENV, HTTPS origins, strict TLS/distinct DB roles, TMDB, SMTP and trusted proxy settings. Values hidden.')
  process.exitCode = 1
}
