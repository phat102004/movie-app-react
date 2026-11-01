import { getPrisma } from './database/client.mjs'

// A constant, read-only probe; the factory checks production role/ACL on connect.
export async function checkRuntimeDatabase(getClient = getPrisma) {
  const client = await getClient()
  const rows = await client.$queryRaw`SELECT 1 AS ok`
  if (rows[0]?.ok !== 1) throw new Error('Database unavailable')
}

export function createReadinessProbe({
  check = checkRuntimeDatabase, timeoutMs = 2000, cacheMs = 30_000,
  now = Date.now,
} = {}) {
  let active = null, cached = false, until = 0, stopping = false
  return {
    stop() { stopping = true },
    ready() {
      if (stopping) return Promise.resolve(false)
      if (now() < until) return Promise.resolve(cached)
      if (active) return active.response
      let finish
      const operation = { response: new Promise(resolve => { finish = resolve }) }
      active = operation
      let settled = false
      const done = value => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cached = value
        until = now() + cacheMs
        finish(value && !stopping)
      }
      const timer = setTimeout(() => done(false), timeoutMs)
      // Keep the slot occupied even after timeout until the real DB work settles.
      // A hung driver cannot create one new query per incoming health request.
      Promise.resolve().then(check).then(() => done(true), () => done(false))
        .finally(() => { if (active === operation) active = null })
      return operation.response
    },
  }
}
