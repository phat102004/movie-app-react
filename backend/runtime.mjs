import { createAppServer } from './server.mjs'
import { disconnectDatabase } from './database/client.mjs'
import { validateRuntimeProductionConfig } from './production-readiness.mjs'
import { readAuthConfig } from './auth/config.mjs'
import { createResetEmailDelivery } from './auth/reset-email.mjs'
import { createClientIpResolver } from './client-ip.mjs'
import { readTmdbProxyConfig } from './upstream-scheduler.mjs'
import { createFrontendHandler } from './frontend.mjs'
import { createReadinessProbe, checkRuntimeDatabase } from './health.mjs'
import { withDeadline } from './deadline.mjs'
import { fileURLToPath } from 'node:url'

export function readServerBinding(env) {
  const mode = env.HOSTING_MODE ?? 'local'
  if (!['local', 'render'].includes(mode)) throw new Error('Invalid hosting mode')
  if (env.RENDER === 'true' && mode !== 'render') throw new Error('Explicit Render hosting mode required')
  const render = mode === 'render'
  if (render && (env.NODE_ENV !== 'production' || env.RENDER !== 'true'))
    throw new Error('Render mode requires explicit production and Render environment')
  const host = env.HOST ?? (render ? '0.0.0.0' : '127.0.0.1')
  if (render ? host !== '0.0.0.0' : !['127.0.0.1', '::1'].includes(host))
    throw new Error('Invalid host for hosting mode')
  const raw = env.PORT ?? (render ? '' : '3001')
  if (!/^[1-9]\d{0,4}$/.test(raw) || Number(raw) > 65535) throw new Error('Invalid server port')
  return { host, port: Number(raw), render }
}

// Dependency injection is used only by isolated tests, never request-controlled.
export async function startBackend({
  env = process.env, createServer = createAppServer,
  checkDatabase = checkRuntimeDatabase, disconnect = disconnectDatabase,
  loadFrontend = createFrontendHandler,
  signals = process, exit = code => process.exit(code), logger = console,
  startupMs = 15_000, shutdownMs = 10_000,
} = {}) {
  const binding = readServerBinding(env)
  const auth = readAuthConfig(env)
  createClientIpResolver(env.TRUSTED_PROXY_CIDRS ?? '')
  const scheduler = readTmdbProxyConfig(env)
  if (auth.production) validateRuntimeProductionConfig(env)
  const readiness = createReadinessProbe({ check: checkDatabase })
  let server, shutdownPromise, stopping = false, signalRequested = false
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise
    stopping = true
    readiness.stop()
    shutdownPromise = withDeadline(async () => {
      try {
        if (server?.listening) {
          await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve())
            server.closeIdleConnections?.()
          })
        }
        await disconnect()
        return 0
      } catch { return 1 }
    }, shutdownMs, () => {
      server?.closeAllConnections()
      exit(1)
    }).catch(() => 1).finally(() => {
      signals.off('SIGTERM', onSignal)
      signals.off('SIGINT', onSignal)
    })
    return shutdownPromise
  }
  function onSignal() {
    if (signalRequested) return
    signalRequested = true
    void shutdown().then(code => exit(code), () => exit(1))
  }
  signals.on('SIGTERM', onSignal)
  signals.on('SIGINT', onSignal)
  try {
    const started = performance.now()
    let frontend = null
    await withDeadline(async () => {
      if (binding.render) frontend = await loadFrontend(fileURLToPath(new URL('../frontend/dist/', import.meta.url)))
      if (auth.production) await checkDatabase()
    }, startupMs)
    if (stopping) throw new Error('Startup interrupted')
    server = createServer({
      tmdb: { token: env.TMDB_READ_ACCESS_TOKEN, ...scheduler },
      trustedProxyCidrs: env.TRUSTED_PROXY_CIDRS ?? '',
      auth: { config: auth },
      passwordReset: { delivery: createResetEmailDelivery({ config: auth, env }) },
      readiness, frontend,
    })
    await withDeadline(() => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(binding.port, binding.host, () => {
        server.off('error', reject)
        if (stopping) {
          server.closeAllConnections()
          server.close()
          reject(new Error('Startup interrupted'))
          return
        }
        resolve()
      })
    }), Math.max(1, startupMs - (performance.now() - started)))
    if (stopping) {
      server.closeAllConnections()
      server.close()
      throw new Error('Startup interrupted')
    }
    server.on('error', () => {
      logger.error('Cineverse HTTP server failed; internal details hidden.')
      void shutdown().then(() => exit(1), () => exit(1))
    })
    return { server, binding, readiness, shutdown }
  } catch {
    await shutdown()
    throw new Error('Cineverse startup failed; verify configuration, build and database securely.')
  }
}
