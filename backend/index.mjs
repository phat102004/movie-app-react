import { loadBackendEnv } from './env.mjs'
import { startBackend } from './runtime.mjs'

// Render/production receives injected environment, never a developer .env file.
if (process.env.NODE_ENV !== 'production' && process.env.RENDER !== 'true') loadBackendEnv()
try {
  const { binding } = await startBackend()
  console.info(`Cineverse proxy listening: ${binding.host}:${binding.port}`)
  process.send?.({ type: 'proxy-ready' })
} catch {
  console.error('Cineverse startup failed. Check configuration/build/port/database; credentials and internal details hidden.')
  process.exit(1)
}
