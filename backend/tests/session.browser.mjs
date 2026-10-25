// Optional: node backend/tests/session.browser.mjs <path-to-playwright>
// Chỉ dùng DB mock và credentials ngẫu nhiên trong memory; không đọc backend/.env.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createAppServer } from '../server.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import { hashRegistrationPassword } from '../auth/password.mjs'
import { memoryDatabase } from './helpers/auth-fixture.mjs'

const { chromium } = createRequire(import.meta.url)(
  process.argv[2] ?? 'playwright',
)
const password = randomBytes(24).toString('base64url')
const user = {
  id: randomUUID(),
  name: 'Browser fixture',
  email: 'fixture@example.com',
  passwordHash: await hashRegistrationPassword(password),
  createdAt: new Date(),
}
const database = memoryDatabase([user])
const config = readAuthConfig({})
const app = createAppServer({
  auth: { config, getClient: async () => database },
})
const statuses = []
const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Session security fixture</title>')
    return
  }
  response.once('finish', () => statuses.push(response.statusCode))
  app.emit('request', request, response)
})
const attacker = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' })
  response.end('<!doctype html><title>Untrusted origin</title>')
})
let browser
try {
  server.listen(0, '127.0.0.1')
  attacker.listen(0, '127.0.0.1')
  await Promise.all([once(server, 'listening'), once(attacker, 'listening')])
  const base = `http://127.0.0.1:${server.address().port}`
  config.allowedOrigins = new Set([base])
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  await page.goto(base)
  const result = await page.evaluate(
    async ({ email, password }) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cineverse-CSRF': '1',
        },
        body: JSON.stringify({ email, password }),
      })
      return { status: r.status, body: await r.json() }
    },
    { email: user.email, password },
  )
  assert.equal(result.status, 200)
  const cookie = (await context.cookies()).find(
    (cookie) => cookie.name === config.cookieName,
  )
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.sameSite, 'Lax')
  assert.equal(cookie.path, '/')
  assert.ok(
    !(await page.evaluate(() => document.cookie)).includes(config.cookieName),
  )
  const me = () =>
    page.evaluate(async () => (await fetch('/api/auth/me')).status)
  assert.equal(await me(), 200)
  const evil = await context.newPage()
  await evil.goto(`http://127.0.0.1:${attacker.address().port}`)
  const preflightBlocked = await evil.evaluate(async (base) => {
    try {
      await fetch(base + '/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Cineverse-CSRF': '1',
        },
        body: '{}',
      })
      return false
    } catch {
      return true
    }
  }, base)
  assert.equal(preflightBlocked, true)
  await evil.evaluate(async (base) => {
    await fetch(base + '/api/auth/logout', {
      method: 'POST',
      mode: 'no-cors',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    })
  }, base)
  assert.equal(await me(), 200)
  assert.equal(database.sessions.size, 1)
  assert.ok(statuses.includes(403) && statuses.includes(405))
  const logout = await page.evaluate(
    async () =>
      (
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cineverse-CSRF': '1',
          },
          body: '{}',
        })
      ).status,
  )
  assert.equal(logout, 204)
  assert.equal(await me(), 401)
  assert.equal(
    (await context.cookies()).some(
      (cookie) => cookie.name === config.cookieName,
    ),
    false,
  )
  assert.equal(database.sessions.size, 0)
  console.info(
    'PASS browser: HTTP-only cookie, same-origin Login/Me, cross-origin preflight + simple POST blocked, Logout deletes cookie and server session.',
  )
} finally {
  await browser?.close()
  for (const serverInstance of [server, attacker]) {
    serverInstance.closeAllConnections()
    if (serverInstance.listening)
      await new Promise((resolve) => serverInstance.close(resolve))
  }
}
