import assert from 'node:assert/strict'
import test from 'node:test'
import { once, EventEmitter } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, sep } from 'node:path'
import { createAppServer } from '../server.mjs'
import { createFrontendHandler } from '../frontend.mjs'
import { createReadinessProbe, checkRuntimeDatabase } from '../health.mjs'
import { startBackend, readServerBinding } from '../runtime.mjs'
import { validateRuntimeProductionConfig, validateProductionConfig } from '../production-readiness.mjs'
import { buildEnvironment, renderBuildSteps } from '../../scripts/build-render.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { spawnSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'

const fixture = () => ({ NODE_ENV: 'production', HOSTING_MODE: 'render', RENDER: 'true', PORT: '10000',
  DATABASE_URL: 'postgresql://cineverse_app:synthetic-runtime-password@ep-fixture.ap-southeast-1.aws.neon.tech:5432/cineverse_prod?schema=public&sslmode=require&sslaccept=strict',
  PRODUCTION_DATABASE_HOST: 'ep-fixture.ap-southeast-1.aws.neon.tech',
  AUTH_ALLOWED_ORIGINS: 'https://cineverse-fixture.onrender.com', PUBLIC_APP_ORIGIN: 'https://cineverse-fixture.onrender.com',
  TMDB_READ_ACCESS_TOKEN: 'synthetic-tmdb-token-not-used', PASSWORD_RESET_EMAIL_MODE: 'resend',
  SMTP_FROM: 'cinema@fixture.test', RESEND_API_KEY: 're_synthetic_email_api_key_fixture_only' })
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

async function serve(t, options) {
  const server = createAppServer({ auth: { config: { production: false, allowedOrigins: new Set() } }, ...options })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)) })
  return `http://127.0.0.1:${server.address().port}`
}

test('health: live is independent; ready shares/cache probes, masks DB errors and does not expose internals', async t => {
  let calls = 0, time = 0
  const pending = gate()
  const probe = createReadinessProbe({ check: () => { calls++; return pending.promise }, now: () => time })
  const base = await serve(t, { readiness: probe })
  const live = await fetch(base + '/health/live')
  assert.deepEqual(await live.json(), { status: 'ok' })
  assert.equal(calls, 0)
  const a = probe.ready(), b = probe.ready()
  assert.equal(a, b)
  pending.resolve()
  assert.equal(await a, true)
  assert.equal(await probe.ready(), true)
  assert.equal(calls, 1)
  time = 30_001
  const response = await fetch(base + '/health/ready')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(calls, 2)
  probe.stop()
  assert.equal((await fetch(base + '/health/ready')).status, 503)
  assert.equal((await fetch(base + '/health/live', { method: 'POST' })).status, 405)
})

test('readiness deadline retains one underlying slot, ignores late success, caches failures and can recover', async t => {
  let calls = 0, time = 0
  const held = gate()
  const probe = createReadinessProbe({ timeoutMs: 15, cacheMs: 30, now: () => time,
    check: () => { calls++; return calls === 1 ? held.promise : Promise.resolve() } })
  assert.equal(await probe.ready(), false)
  time = 100
  for (let n = 0; n < 100; n++) assert.equal(await probe.ready(), false)
  assert.equal(calls, 1)
  held.resolve()
  await new Promise(setImmediate)
  assert.equal(await probe.ready(), true)
  assert.equal(calls, 2)
  const bad = createReadinessProbe({ check: async () => { throw Error('synthetic-private-database-url') } })
  const base = await serve(t, { readiness: bad })
  const response = await fetch(base + '/health/ready')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { status: 'unavailable' })
})

test('database health query is constant read-only SQL through existing client factory', async () => {
  let sql
  await checkRuntimeDatabase(async () => ({ $queryRaw: async strings => { sql = strings.join(''); return [{ ok: 1 }] } }))
  assert.equal(sql, 'SELECT 1 AS ok')
  await assert.rejects(checkRuntimeDatabase(async () => ({ $queryRaw: async () => [] })))
})

test('single-origin frontend: deep links, HEAD, MIME/cache, missing chunks, private files, traversal and API precedence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cineverse-static-fixture-'))
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'cineverse-static-fixture-'))
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<!doctype html><div id="root">fixture SPA</div>')
  await writeFile(join(root, 'assets', 'index-abcdefgh.js'), 'export const fixture = true')
  await writeFile(join(root, 'assets', 'index-abcdefgh.css'), 'body { color: black }')
  await writeFile(join(root, '.env'), 'synthetic-private-file')
  await writeFile(join(root, 'assets', 'source.map'), 'synthetic-private-map')
  const frontend = await createFrontendHandler(root)
  const base = await serve(t, { frontend })
  for (const route of ['/', '/movies/27205', '/movies/invalid', '/profile', '/favorites', '/login', '/register', '/reset-password', '/unknown-route']) {
    const response = await fetch(base + route)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(await response.text(), /fixture SPA/)
  }
  for (const [file, type] of [['index-abcdefgh.js', 'text/javascript'], ['index-abcdefgh.css', 'text/css']]) {
    const response = await fetch(base + '/assets/' + file)
    assert.equal(response.headers.get('content-type'), type)
    assert.match(response.headers.get('cache-control'), /immutable/)
  }
  assert.equal(await (await fetch(base + '/profile', { method: 'HEAD' })).text(), '')
  for (const [accept, encoding] of [['br', 'br'], ['gzip', 'gzip'], ['br;q=0,gzip;q=0', null]]) {
    const compressed = await fetch(base + '/assets/index-abcdefgh.js', { headers: { 'Accept-Encoding': accept } })
    assert.equal(compressed.headers.get('content-encoding'), encoding)
    assert.equal(compressed.headers.get('vary'), 'Accept-Encoding')
    assert.equal(await compressed.text(), 'export const fixture = true')
  }
  for (const route of ['/api', '/api/unknown', '/assets/missing.js', '/assets/source.map', '/.env', '/backend/index.mjs', '/node_modules/', '/assets/%252e%252e/.env']) {
    const response = await fetch(base + route)
    assert.equal(response.status, 404, route)
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.equal((await response.text()).includes('synthetic-private'), false)
  }
  // Test raw encoded traversal before URL normalization by native fetch.
  for (const path of ['/assets/%2e%2e/private', '/assets/%5c..%5c.env', '/%00', '/%ZZ'])
    assert.throws(() => frontend({ url: path, method: 'GET' }, {}))
  const response = await fetch(base + '/api/auth/me')
  assert.equal(response.status, 401)
  assert.match(response.headers.get('content-type'), /application\/json/)
})

test('binding: public only in explicitly selected Render production; local remains loopback', () => {
  assert.deepEqual(readServerBinding({}), { host: '127.0.0.1', port: 3001, render: false })
  assert.equal(readServerBinding(fixture()).host, '0.0.0.0')
  for (const env of [{ HOST: '0.0.0.0' }, { NODE_ENV: 'production', HOST: '0.0.0.0' },
    { ...fixture(), RENDER: '' }, { ...fixture(), NODE_ENV: 'test' }, { ...fixture(), PORT: undefined },
    { ...fixture(), HOSTING_MODE: undefined }, { ...fixture(), HOST: '127.0.0.1' },
    ...['0', '-1', '65536', '5e3', '3001x', ''].map(PORT => ({ PORT }))])
    assert.throws(() => readServerBinding(env))
})

test('runtime preflight: Neon direct strict TLS and separate roles preserved; no migrator in HTTP', () => {
  assert.equal(validateRuntimeProductionConfig(fixture()).recoveryEnabled, true)
  for (const patch of [{ DATABASE_URL: '' }, { AUTH_ALLOWED_ORIGINS: '' }, { TMDB_READ_ACCESS_TOKEN: '' },
    { PASSWORD_RESET_EMAIL_MODE: 'disabled' }, { RESEND_API_KEY: '' }, { TRUSTED_PROXY_CIDRS: '0.0.0.0/0' },
    { MIGRATION_DATABASE_URL: 'synthetic-migration-must-not-enter-runtime' },
    { DATABASE_URL: fixture().DATABASE_URL.replace('cineverse_app', 'neondb_owner') },
    { DATABASE_URL: fixture().DATABASE_URL.replace('sslaccept=strict', 'sslaccept=accept_invalid_certs') }])
    assert.throws(() => validateRuntimeProductionConfig({ ...fixture(), ...patch }))
  const release = { ...fixture(), MIGRATION_DATABASE_URL: fixture().DATABASE_URL.replace('cineverse_app:synthetic-runtime-password', 'cineverse_migrator:synthetic-migration-password') }
  assert.equal(validateProductionConfig(release).recoveryEnabled, true)
})

function dependencies(overrides = {}) {
  return { env: fixture(), signals: new EventEmitter(), exit: () => {},
    loadFrontend: async () => () => {}, checkDatabase: async () => {}, disconnect: async () => {},
    // Exercise a real HTTP server on a test-only ephemeral loopback port.
    createServer: options => {
      const server = createAppServer(options)
      const listen = server.listen
      server.listen = (_port, _host, callback) => listen.call(server, 0, '127.0.0.1', callback)
      return server
    }, ...overrides }
}

test('startup never listens before DB preflight succeeds; graceful shutdown stops accepting and closes DB once', async () => {
  const held = gate()
  let created = 0, disconnected = 0
  const options = dependencies({ checkDatabase: () => held.promise, disconnect: async () => { disconnected++ } })
  const factory = options.createServer
  options.createServer = config => { created++; return factory(config) }
  const starting = startBackend(options)
  await new Promise(setImmediate)
  assert.equal(created, 0)
  held.resolve()
  const runtime = await starting
  assert.equal(runtime.server.listening, true)
  const a = runtime.shutdown(), b = runtime.shutdown()
  assert.equal(a, b)
  assert.equal(await a, 0)
  assert.equal(runtime.server.listening, false)
  assert.equal(disconnected, 1)
  assert.equal(await runtime.readiness.ready(), false)
})

test('missing secrets/build, failed role check or startup deadline cannot open HTTP traffic', async () => {
  let created = 0
  for (const patch of [
    { env: { ...fixture(), DATABASE_URL: '' } },
    { loadFrontend: async () => { throw Error('synthetic-private-path') } },
    { checkDatabase: async () => { throw Error('synthetic-private-role') } },
    { checkDatabase: () => new Promise(() => {}), startupMs: 15 },
  ]) await assert.rejects(startBackend(dependencies({ ...patch, createServer: () => { created++ } })))
  assert.equal(created, 0)
})

test('SIGTERM/SIGINT coalesce; shutdown deadline forces finite termination even if DB disconnect hangs', async () => {
  const exits = []
  const signals = new EventEmitter()
  const runtime = await startBackend(dependencies({ signals, exit: code => exits.push(code) }))
  signals.emit('SIGTERM'); signals.emit('SIGINT')
  assert.equal(await runtime.shutdown(), 0)
  await new Promise(setImmediate)
  assert.deepEqual(exits, [0])
  assert.equal(signals.listenerCount('SIGTERM'), 0)
  const forced = []
  const stuck = await startBackend(dependencies({ shutdownMs: 15, exit: code => forced.push(code), disconnect: () => new Promise(() => {}) }))
  assert.equal(await stuck.shutdown(), 1)
  assert.deepEqual(forced, [1])
  assert.equal(stuck.server.listening, false)
})

test('Render build subprocesses receive no service secrets, VITE credentials or migration configuration', () => {
  const safe = buildEnvironment({ PATH: 'fixture-path', HOME: 'fixture-home', NODE_ENV: 'production',
    DATABASE_URL: 'synthetic-private', MIGRATION_DATABASE_URL: 'synthetic-private',
    TMDB_READ_ACCESS_TOKEN: 'synthetic-private', RESEND_API_KEY: 'synthetic-private',
    VITE_TMDB_TOKEN: 'synthetic-private', SMTP_PASSWORD: 'synthetic-private' })
  assert.deepEqual(safe, { PATH: 'fixture-path', HOME: 'fixture-home' })
  assert.deepEqual(renderBuildSteps, [['ci', '--include=dev'], ['--prefix', 'frontend', 'ci', '--include=dev'], ['run', 'db:generate'], ['run', 'build']])
})

test('HTTPS edge does not weaken host-only cookies, CSRF, Origin or account binding', async t => {
  const config = readAuthConfig(fixture())
  const base = await serve(t, {
    auth: { config, login: async () => ({ token: 'synthetic-session-cookie'.padEnd(43, 'x'), user: { id: '00000000-0000-4000-8000-000000000001' } }),
      sessions: { currentUser: async () => ({ id: '00000000-0000-4000-8000-000000000001' }), revoke: async () => {} } },
  })
  const url = base + '/api/auth/login'
  const headers = { Origin: fixture().PUBLIC_APP_ORIGIN, 'Content-Type': 'application/json',
    'X-Cineverse-CSRF': '1', 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-Proto': 'https' }
  const body = JSON.stringify({ email: 'a@fixture.test', password: 'synthetic-fixture-password' })
  const login = await fetch(url, { method: 'POST', headers, body })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')
  for (const flag of ['__Host-cineverse_session=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag))
  assert.equal(/Domain=/i.test(cookie), false)
  assert.equal(login.headers.get('cache-control'), 'no-store')
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.fixture.test' }, body })).status, 403)
  const noCsrf = { ...headers }; delete noCsrf['X-Cineverse-CSRF']
  assert.equal((await fetch(url, { method: 'POST', headers: noCsrf, body })).status, 403)
  const wrong = await fetch(base + '/api/auth/logout', { method: 'POST', headers: {
    ...headers, Cookie: cookie.split(';')[0], 'X-Cineverse-Account': '00000000-0000-4000-8000-000000000002',
  }, body: '{}' })
  assert.equal(wrong.status, 403)
  assert.equal((await wrong.json()).error.code, 'SESSION_CHANGED')
  const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: {
    ...headers, Cookie: cookie.split(';')[0], 'X-Cineverse-Account': '00000000-0000-4000-8000-000000000001',
  }, body: '{}' })
  assert.equal(logout.status, 204)
  assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'))
})

test('production entrypoint fails nonzero without local env fallback or sensitive diagnostics', () => {
  const result = spawnSync(process.execPath, ['backend/index.mjs'], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...fixture(),
      DATABASE_URL: '', TMDB_READ_ACCESS_TOKEN: 'synthetic-private-entrypoint-value' },
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  })
  assert.equal(result.status, 1)
  assert.equal((result.stdout + result.stderr).includes('synthetic-private-entrypoint-value'), false)
  assert.equal((result.stdout + result.stderr).includes('postgresql://'), false)
})

test('graceful termination drains an active HTTP request before disconnecting its database', async t => {
  const held = gate(), seen = gate(), closeStarted = gate()
  let disconnected = false
  const runtime = await startBackend(dependencies({ disconnect: async () => { disconnected = true },
    createServer: () => {
      const server = createHttpServer(async (_request, response) => {
        seen.resolve(); await held.promise; response.end('fixture')
      })
      const listen = server.listen
      server.listen = (_port, _host, callback) => listen.call(server, 0, '127.0.0.1', callback)
      const close = server.close
      server.close = callback => { const result = close.call(server, callback); closeStarted.resolve(); return result }
      return server
    } }))
  t.after(async () => { held.resolve(); await runtime.shutdown() })
  const request = fetch(`http://127.0.0.1:${runtime.server.address().port}/fixture`)
  await seen.promise
  const closed = runtime.shutdown()
  await closeStarted.promise
  assert.equal(runtime.server.listening, false)
  assert.equal(disconnected, false)
  held.resolve()
  assert.equal(await (await request).text(), 'fixture')
  assert.equal(await closed, 0)
  assert.equal(disconnected, true)
})

test('termination during preflight cannot later start a listener', async () => {
  const held = gate(), signals = new EventEmitter()
  let created = 0
  const starting = startBackend(dependencies({ signals, checkDatabase: () => held.promise,
    createServer: () => { created++ } }))
  const rejected = assert.rejects(starting)
  signals.emit('SIGTERM')
  held.resolve()
  await rejected
  assert.equal(created, 0)
})
