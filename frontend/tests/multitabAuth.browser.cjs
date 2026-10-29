// Native HTTP + React + real session/Argon2. Two tabs share a browser context/cookie.
// All users, writes and upstream data are fixtures in RAM; never reads .env.
// node frontend/tests/multitabAuth.browser.cjs <path-to-playwright>
const assert = require('node:assert/strict')
const { once } = require('node:events')
const path = require('node:path')
const { chromium } = require(process.argv[2] || 'playwright')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate) {
  const deadline = Date.now() + 10000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Fixture gate timed out')
    await pause(10)
  }
}
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']
const names = ['Fixture Alpha', 'Fixture Beta']
const password = 'Synthetic multitab account password!'
const movie = id => ({ id, title: `Fixture Movie ${id}`, original_title: `Fixture ${id}`, genre_ids: [], release_date: '2020-01-01', vote_average: 8 })
let checkpoint = 'setup'

function instrument({ noChannel = false, noStorage = false } = {}) {
  window.__dropAuthSignals = false
  window.__authSignals = []
  window.__ignoreAbort = new URLSearchParams(location.search).has('ignoreAbort')
  const nativeFetch = window.fetch
  window.fetch = (url, init) => nativeFetch(url, window.__ignoreAbort ? { ...init, signal: undefined } : init)
  // Drop events before the app's listeners to simulate sleeping tabs/missed messages.
  for (const type of ['focus', 'storage'])
    window.addEventListener(type, e => { if (window.__dropAuthSignals) e.stopImmediatePropagation() }, true)
  document.addEventListener('visibilitychange', e => { if (window.__dropAuthSignals) e.stopImmediatePropagation() }, true)
  const NativeChannel = window.BroadcastChannel
  if (noChannel) window.BroadcastChannel = undefined
  else window.BroadcastChannel = class {
    constructor(name) { this.inner = new NativeChannel(name) }
    set onmessage(listener) { this.inner.onmessage = e => { if (!window.__dropAuthSignals) listener(e) } }
    postMessage(data) { window.__authSignals.push(data); this.inner.postMessage(data) }
    close() { this.inner.close() }
  }
  const nativeSet = Storage.prototype.setItem
  Storage.prototype.setItem = function (key, value) {
    if (key === 'cineverse.auth-change') {
      window.__authSignals.push(JSON.parse(value))
      if (noStorage) throw new DOMException('Storage disabled', 'SecurityError')
    }
    return nativeSet.call(this, key, value)
  }
}

async function main() {
  const [{ createServer }, { createAppServer }, { readAuthConfig }, { memoryAccountDatabase }, { hashRegistrationPassword }, { createRegisterLimiter }, { createLoginLimiter }] = await Promise.all([
    import('../node_modules/vite/dist/node/index.js'), import('../../backend/server.mjs'),
    import('../../backend/auth/config.mjs'), import('../../backend/tests/helpers/account-database.mjs'),
    import('../../backend/auth/password.mjs'), import('../../backend/auth/rate-limit.mjs'),
    import('../../backend/auth/login-rate-limit.mjs'),
  ])
  const hash = await hashRegistrationPassword(password)
  const { client, favorites } = memoryAccountDatabase(ids.map((id, index) => ({
    id, name: names[index], email: `${index}@fixture.test`, passwordHash: hash,
    createdAt: new Date('2026-10-28T00:00:00.000Z'),
  })))
  const favoriteKey = (owner, id) => `${owner}:${id}`
  favorites.set(favoriteKey(ids[0], 550), { userId: ids[0], movieId: 550, createdAt: new Date() })
  client.user.update = async ({ where, data }) => {
    const account = client.users.find(user => user.id === where.id)
    const expected = where.sessions.some
    if (!account || ![...client.sessions.values()].some(s => s.userId === account.id && s.tokenHash === expected.tokenHash && s.expiresAt > expected.expiresAt.gt))
      throw Object.assign(new Error('synthetic unavailable session'), { code: 'P2025' })
    Object.assign(account, data)
    return client.user.findUnique({ where: { id: account.id } })
  }
  const config = readAuthConfig({})
  const server = createAppServer({
    auth: { config, getClient: async () => client, limiter: createLoginLimiter({
      ip: createRegisterLimiter({ limit: 1000 }), account: createRegisterLimiter({ limit: 1000 }),
    }) },
    tmdb: { token: 'fixture', fetchImpl: async url => url.pathname.includes('/genre/')
      ? Response.json({ genres: [] })
      : /\/movie\/\d+$/.test(url.pathname)
        ? Response.json({ ...movie(Number(url.pathname.split('/').pop())), genres: [], videos: { results: [] }, recommendations: { page: 1, results: [] } })
        : Response.json({ page: 1, results: [movie(42)] }),
    },
  })
  let browser, vite
  let passed = 0
  const pass = text => { passed++; console.log(`PASS ${text}`) }
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    vite = await createServer({ root: path.resolve('frontend'), configFile: path.resolve('frontend/vite.config.ts'), logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${server.address().port}` } },
    })
    await vite.listen()
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`
    config.allowedOrigins.add(base)
    browser = await chromium.launch(require('./browser-options.cjs'))
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(instrument)
    const pageA = await context.newPage(), pageB = await context.newPage()
    const errors = []
    for (const page of [pageA, pageB]) { page.setDefaultTimeout(10000); page.on('pageerror', () => errors.push('page error')) }
    let meRequests = 0
    pageA.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/me') meRequests++ })
    const header = (page, index) => page.getByRole('button', { name: `Tài khoản của ${names[index]}`, exact: true })
    const profileReady = (page, index) => page.getByRole('heading', { level: 1, name: names[index], exact: true }).waitFor()
    const heart = () => pageA.locator('.movie-card .favorite-button').first()
    const directLogin = async (targetContext, index) => {
      const response = await targetContext.request.post(base + '/api/auth/login', {
        headers: { Origin: base, 'X-Cineverse-CSRF': '1' }, data: { email: `${index}@fixture.test`, password },
      })
      assert.equal(response.status(), 200)
    }
    const establishA = async (route = '/profile') => {
      await directLogin(context, 0)
      await pageA.goto(base + route)
      await header(pageA, 0).waitFor()
      if (route === '/profile') await profileReady(pageA, 0)
      else await pageA.waitForFunction(() => !document.querySelector('.movie-card .favorite-button')?.disabled)
      await pageB.goto(base + '/profile')
      await profileReady(pageB, 0)
    }
    const logoutUI = async page => {
      await page.locator('.account-toggle').click()
      await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
      await page.locator('#header-login').waitFor()
    }
    const loginUI = async (page, index) => {
      await page.goto(base + '/login')
      await page.getByLabel('Email', { exact: true }).fill(`${index}@fixture.test`)
      await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
      await header(page, index).waitFor()
    }
    const staleA = async route => {
      await establishA(route)
      await pageA.evaluate(() => { window.__dropAuthSignals = true })
      await directLogin(context, 1) // No broadcast at all, A deliberately misses focus/visibility too.
      await header(pageA, 0).waitFor()
    }
    const responseFor = (method, endpoint) => pageA.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === method)
    const mismatch = async pending => {
      const response = await pending
      assert.equal(response.status(), 403)
      assert.equal((await response.json()).error.code, 'SESSION_CHANGED')
      assert.equal(response.request().headers()['x-cineverse-account'], ids[0])
      await header(pageA, 1).waitFor()
      await pageA.locator('.auth-session-notice').waitFor()
    }

    checkpoint = 'same-account'
    await establishA()
    await header(pageB, 0).waitFor()
    pass('two tabs share User A; profile/count belong to A')
    checkpoint = 'logout-broadcast'
    await logoutUI(pageB)
    await pageA.locator('#header-login').waitFor()
    assert.equal(await pageA.getByRole('heading', { name: names[0], exact: true }).count(), 0)
    pass('logout in B invalidates A, clears Profile and redirects guest safely')
    checkpoint = 'login-broadcast'
    await loginUI(pageB, 1)
    await profileReady(pageA, 1)
    assert.equal((await pageA.locator('body').textContent()).includes(names[0]), false)
    pass('login B propagates through Me; A renders only B profile, no A data')

    checkpoint = 'missed-post'
    await staleA('/')
    const post = responseFor('POST', '/api/favorites')
    await heart().click()
    await mismatch(post)
    assert.equal(favorites.has(favoriteKey(ids[1], 42)), false)
    pass('lost signals: stale A Favorite POST with cookie B rejected before B write; no success')

    checkpoint = 'missed-delete'
    for (const id of ids) favorites.set(favoriteKey(id, 42), { userId: id, movieId: 42, createdAt: new Date() })
    await staleA('/')
    assert.equal(await heart().getAttribute('aria-pressed'), 'true')
    const remove = responseFor('DELETE', '/api/favorites/42')
    await heart().click(); await mismatch(remove)
    assert.equal(favorites.has(favoriteKey(ids[1], 42)), true)
    for (const id of ids) favorites.delete(favoriteKey(id, 42))
    pass('lost signals: stale DELETE cannot remove B favorite even with same movieId')

    checkpoint = 'missed-profile-patch'
    await establishA()
    await pageA.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click()
    await pageA.getByLabel('Tên hiển thị', { exact: true }).fill('Wrong account update')
    await pageA.evaluate(() => { window.__dropAuthSignals = true })
    await directLogin(context, 1)
    const patch = responseFor('PATCH', '/api/profile')
    await pageA.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
    await mismatch(patch); await profileReady(pageA, 1)
    assert.deepEqual(client.users.map(user => user.name), names)
    assert.equal(await pageA.locator('.profile-success').count(), 0)
    pass('stale Profile PATCH fails closed; canonical B replaces A form without false save confirmation')

    checkpoint = 'missed-change-password'
    await establishA()
    await pageA.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click()
    await pageA.getByLabel('Mật khẩu hiện tại', { exact: true }).fill(password)
    await pageA.getByLabel('Mật khẩu mới', { exact: true }).fill('New synthetic multitab password!')
    await pageA.getByLabel('Xác nhận mật khẩu mới', { exact: true }).fill('New synthetic multitab password!')
    await pageA.evaluate(() => { window.__dropAuthSignals = true })
    await directLogin(context, 1)
    const change = responseFor('POST', '/api/profile/change-password')
    await pageA.getByRole('button', { name: 'Xác nhận đổi mật khẩu', exact: true }).click()
    await mismatch(change)
    assert.equal(client.users[1].passwordHash, hash)
    assert.equal((await context.request.get(base + '/api/auth/me')).status(), 200)
    assert.equal((await pageA.locator('body').textContent()).includes('Đổi mật khẩu thành công.'), false)
    pass('stale Change Password rejected despite both fixture users sharing current password; B hash/sessions intact')

    checkpoint = 'missed-logout'
    await staleA()
    const logout = responseFor('POST', '/api/auth/logout')
    await header(pageA, 0).click()
    await pageA.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await mismatch(logout)
    assert.equal((await context.request.get(base + '/api/auth/me')).status(), 200)
    pass('stale Logout does not revoke B or clear B cookie')

    checkpoint = 'focus'
    await staleA()
    const beforeFocus = meRequests
    await pageA.evaluate(() => { window.__dropAuthSignals = false; window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')) })
    await profileReady(pageA, 1)
    assert.ok(meRequests - beforeFocus >= 1 && meRequests - beforeFocus <= 2)
    pass('focus recovers missed broadcasts; duplicate focus events are coalesced')
    checkpoint = 'visibility'
    await staleA()
    await pageA.evaluate(() => {
      window.__dropAuthSignals = false
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await profileReady(pageA, 1)
    pass('visibility visible independently revalidates canonical session')

    checkpoint = 'cookie-race'
    await establishA('/')
    await pageA.evaluate(() => { window.__dropAuthSignals = true })
    let release, seen
    const requestSeen = new Promise(resolve => { seen = resolve })
    const gate = new Promise(resolve => { release = resolve })
    await pageA.route('**/api/favorites', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      seen(); await gate
      const cookie = (await context.cookies(base)).filter(c => c.name.includes('cineverse_session')).map(c => `${c.name}=${c.value}`).join('; ')
      // Model the worst timing: request is actually sent with B's newly selected cookie.
      await route.continue({ headers: { ...route.request().headers(), cookie } })
    })
    const raced = responseFor('POST', '/api/favorites')
    await heart().click(); await requestSeen
    await directLogin(context, 1); release()
    await mismatch(raced)
    await pageA.unroute('**/api/favorites')
    assert.equal(favorites.has(favoriteKey(ids[1], 42)), false)
    pass('cookie change between prior Me and actual POST still fails backend precondition atomically for request owner')

    checkpoint = 'late-me'
    await establishA()
    const oldMe = []
    let holdMe = true
    await pageA.route('**/api/auth/me', route => { if (holdMe) { oldMe.push(route); return }; return route.continue() })
    await pageA.goto(base + '/profile?ignoreAbort=1')
    await pageA.waitForFunction(() => document.querySelector('.profile-loading-panel') !== null)
    await until(() => oldMe.length > 0)
    holdMe = false
    await logoutUI(pageB); await loginUI(pageB, 1)
    await profileReady(pageA, 1)
    for (const route of oldMe) await route.fulfill({ json: { user: { id: ids[0], name: names[0], email: '0@fixture.test', createdAt: '2026-10-28T00:00:00.000Z' } } })
    await pause(100)
    await profileReady(pageA, 1)
    await pageA.unroute('**/api/auth/me')
    pass('late Me A ignored after cross-tab B login even when transport ignores abort')

    checkpoint = 'late-favorites'
    await establishA()
    const oldFavorites = []
    let holdFavorites = true
    await pageA.route('**/api/favorites', route => { if (holdFavorites) { oldFavorites.push(route); return }; return route.continue() })
    await pageA.goto(base + '/favorites?ignoreAbort=1')
    await until(() => oldFavorites.length > 0)
    holdFavorites = false
    await logoutUI(pageB); await loginUI(pageB, 1)
    await header(pageA, 1).waitFor()
    await pageA.getByRole('heading', { name: 'Câu chuyện tiếp theo đang chờ bạn.' }).waitFor()
    for (const route of oldFavorites) await route.fulfill({ json: { favorites: [{ movieId: 550, createdAt: '2026-10-28T00:00:00.000Z' }], nextCursor: null } })
    await pause(100)
    assert.equal(await pageA.locator('.movie-card').count(), 0)
    await pageA.unroute('**/api/favorites')
    pass('late Favorite rows A cannot repopulate B collection; old transport intentionally ignores abort')

    checkpoint = '401'
    await establishA('/')
    await pageA.evaluate(() => { window.__dropAuthSignals = true })
    const expired = await context.request.post(base + '/api/auth/logout', { headers: { Origin: base, 'X-Cineverse-CSRF': '1', 'X-Cineverse-Account': ids[0] }, data: {} })
    assert.equal(expired.status(), 204)
    const unauthorized = responseFor('POST', '/api/favorites')
    await heart().click(); assert.equal((await unauthorized).status(), 401)
    await pageA.locator('#header-login').waitFor()
    pass('401 clears private state and resolves to guest through canonical Me')

    checkpoint = 'ordinary-403'
    await establishA('/')
    const before403 = meRequests
    await pageA.route('**/api/favorites', route => route.request().method() === 'POST'
      ? route.fulfill({ status: 403, json: { error: { code: 'CSRF_REJECTED' } } }) : route.continue())
    await heart().click(); await pageA.locator('.favorites-notice').waitFor(); await pause(100)
    await header(pageA, 0).waitFor()
    assert.equal(meRequests, before403)
    await pageA.unroute('**/api/favorites')
    pass('ordinary CSRF 403 is an operation error, no auth refresh loop or replay')

    checkpoint = 'persistent-mismatch'
    await pageA.route('**/api/favorites', route => route.fulfill({ status: 403, json: { error: { code: 'SESSION_CHANGED' } } }))
    const beforeLoop = meRequests
    await pageA.goto(base + '/favorites')
    await pageA.getByRole('heading', { name: 'Chưa xác minh được phiên đăng nhập' }).waitFor()
    const settledMe = meRequests
    await pause(180)
    assert.equal(meRequests, settledMe)
    assert.ok(settledMe - beforeLoop <= 3)
    await pageA.unroute('**/api/favorites')
    pass('persistent SESSION_CHANGED fails closed after bounded recheck; no Me/private-data refresh loop')

    checkpoint = 'broadcast-not-proof'
    await establishA()
    const hinted = pageA.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/me')
    await pageA.evaluate(() => {
      const channel = new BroadcastChannel('cineverse-auth-v1')
      channel.postMessage({ type: 'session-change', nonce: crypto.randomUUID(), user: { id: '00000000-0000-4000-8000-000000000002' } })
      channel.close()
    })
    await hinted; await profileReady(pageA, 0)
    assert.equal(await header(pageA, 1).count(), 0)
    pass('broadcast payload cannot authenticate B: canonical Me keeps A; only a revalidation hint')

    checkpoint = 'me-unavailable'
    await staleA()
    await pageA.route('**/api/auth/me', route => route.fulfill({ status: 503, json: { error: { code: 'AUTH_UNAVAILABLE' } } }))
    await pageA.evaluate(() => { window.__dropAuthSignals = false; window.dispatchEvent(new Event('focus')) })
    await pageA.getByRole('heading', { name: 'Chưa xác minh được phiên đăng nhập' }).waitFor()
    assert.equal((await pageA.locator('body').textContent()).includes(names[0]), false)
    const afterFailure = meRequests
    await pause(120); assert.equal(meRequests, afterFailure)
    await pageA.unroute('**/api/auth/me')
    await pageA.locator('.auth-session-notice button').click()
    await profileReady(pageA, 1)
    pass('failed focus revalidation hides old private data, blocks account actions and retries manually without loop')

    checkpoint = 'late-login'
    const signOut = await context.request.post(base + '/api/auth/logout', { headers: { Origin: base, 'X-Cineverse-CSRF': '1', 'X-Cineverse-Account': ids[1] }, data: {} })
    assert.equal(signOut.status(), 204)
    await pageA.goto(base + '/login?ignoreAbort=1')
    await pageA.getByLabel('Email', { exact: true }).waitFor()
    let loginSeen, releaseLogin
    const loginGate = new Promise(resolve => { loginSeen = resolve })
    const loginWait = new Promise(resolve => { releaseLogin = resolve })
    await pageA.route('**/api/auth/login', async route => {
      const result = await context.request.post(base + '/api/auth/login', {
        headers: { Origin: base, 'X-Cineverse-CSRF': '1' }, data: { email: '0@fixture.test', password },
      })
      const payload = await result.json()
      loginSeen(); await loginWait
      // Cookie A was already applied before B changed it; deliver only the late JSON.
      await route.fulfill({ json: payload })
    })
    await pageA.getByLabel('Email', { exact: true }).fill('0@fixture.test')
    await pageA.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await pageA.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await loginGate
    await pageB.goto(base + '/profile'); await profileReady(pageB, 0)
    await logoutUI(pageB); await loginUI(pageB, 1)
    releaseLogin()
    await header(pageA, 1).waitFor()
    assert.equal(await header(pageA, 0).count(), 0)
    await pageA.unroute('**/api/auth/login')
    pass('late login A cannot overwrite B after external auth change; queued Me resumes after mutation settles')

    checkpoint = 'stale-callbacks'
    await establishA()
    await pageA.goto(base + '/tests/authProvider.browser.html')
    await pageA.waitForFunction(() => document.querySelector('#auth-user')?.textContent === 'Fixture Alpha')
    await pageA.getByRole('button', { name: 'Capture account actions', exact: true }).click()
    await logoutUI(pageB); await loginUI(pageB, 1)
    await pageA.waitForFunction(() => document.querySelector('#auth-user')?.textContent === 'Fixture Beta')
    let staleWrites = 0
    pageA.on('request', request => {
      if (['/api/auth/logout', '/api/profile/change-password'].includes(new URL(request.url()).pathname)) staleWrites++
    })
    await pageA.getByRole('button', { name: 'Run captured change', exact: true }).click()
    await pageA.waitForFunction(() => document.querySelector('#action-error')?.textContent === 'captured-change-error')
    await pageA.getByRole('button', { name: 'Run captured logout', exact: true }).click()
    await pageA.waitForFunction(() => document.querySelector('#action-error')?.textContent === 'captured-logout-error')
    assert.equal(staleWrites, 0)
    assert.equal(client.users[1].passwordHash, hash)
    assert.equal((await context.request.get(base + '/api/auth/me')).status(), 200)
    pass('captured A callbacks cannot retarget Change Password/Logout to latest B: rejected before HTTP')

    checkpoint = 'fallback'
    for (const noStorage of [false, true]) {
      const fallback = await browser.newContext()
      await fallback.addInitScript(instrument, { noChannel: true, noStorage })
      await directLogin(fallback, 0)
      const a = await fallback.newPage(), b = await fallback.newPage()
      a.setDefaultTimeout(10000); b.setDefaultTimeout(10000)
      await a.goto(base + '/profile'); await b.goto(base + '/profile')
      await profileReady(a, 0); await profileReady(b, 0)
      await logoutUI(b)
      if (!noStorage) await a.locator('#header-login').waitFor()
      await loginUI(b, 1)
      if (noStorage) await a.evaluate(() => window.dispatchEvent(new Event('focus')))
      await profileReady(a, 1)
      const signals = await b.evaluate(() => window.__authSignals)
      assert.ok(signals.length > 0)
      for (const signal of signals) assert.deepEqual(Object.keys(signal).sort(), ['nonce', 'type'])
      assert.deepEqual(await b.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] })
      await fallback.close()
      pass(noStorage ? 'BroadcastChannel and storage both unavailable: focus fallback works; no tokens persisted' : 'BroadcastChannel unavailable: storage-event fallback synchronizes logout/login; signals contain only type/nonce')
    }
    assert.deepEqual(errors, [])
    console.log(`PASS ${passed} multi-tab checkpoints; fixture-only database and credentials; no real account modified`)
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    server.closeAllConnections()
    if (server.listening) await new Promise(resolve => server.close(resolve))
  }
}
main().catch(() => { console.error(`Multi-tab verification failed at ${checkpoint}; credential/cookie details hidden.`); process.exitCode = 1 })
