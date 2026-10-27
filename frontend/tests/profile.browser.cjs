// Native Node/Vite/real session + Argon2, database only in RAM; never reads .env.
// node frontend/tests/profile.browser.cjs <path-to-playwright>
const assert = require('node:assert/strict')
const { once } = require('node:events')
const path = require('node:path')
const fs = require('node:fs/promises')
const { chromium } = require(process.argv[2] || 'playwright')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const password = 'Synthetic profile UI password 123!'
const ids = [
  'e71d28a1-b104-44db-a159-f6af12f314b0',
  'e71d28a1-b104-44db-a159-f6af12f314b1',
]
async function gate(promise) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Fixture gate timeout')),
          10000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const [
    { createServer: createVite },
    { createAppServer },
    { readAuthConfig },
    { memoryDatabase },
    { hashRegistrationPassword },
    { createLoginLimiter },
    { createRegisterLimiter },
  ] = await Promise.all([
    import('../node_modules/vite/dist/node/index.js'),
    import('../../backend/server.mjs'),
    import('../../backend/auth/config.mjs'),
    import('../../backend/tests/helpers/auth-fixture.mjs'),
    import('../../backend/auth/password.mjs'),
    import('../../backend/auth/login-rate-limit.mjs'),
    import('../../backend/auth/rate-limit.mjs'),
  ])
  const hash = await hashRegistrationPassword(password)
  const database = memoryDatabase(
    ids.map((id, index) => ({
      id,
      name: index ? 'Fixture B' : 'Fixture A',
      email: `${index ? 'b' : 'a'}@fixture.test`,
      passwordHash: hash,
      createdAt: new Date('2026-10-27T10:00:00.000Z'),
    })),
  )
  const findUser = database.user.findUnique
  const decorated = (user) =>
    user ? { ...user, _count: { favorites: user.id === ids[0] ? 3 : 0 } } : null
  database.user.findUnique = async (args) => decorated(await findUser(args))
  let failPatch = false,
    patchDelay = 0
  database.user.update = async ({ where, data }) => {
    if (patchDelay) await pause(patchDelay)
    if (failPatch)
      throw Object.assign(new Error('fixture unavailable'), { code: 'P1001' })
    const user = database.users.find((user) => user.id === where.id)
    const condition = where.sessions.some
    if (
      !user ||
      ![...database.sessions.values()].some(
        (session) =>
          session.userId === user.id &&
          session.tokenHash === condition.tokenHash &&
          session.expiresAt > condition.expiresAt.gt,
      )
    )
      throw Object.assign(new Error('fixture no matching session'), {
        code: 'P2025',
      })
    Object.assign(user, data)
    return decorated(user)
  }
  database.favorite = { findMany: async () => [] }
  const config = readAuthConfig({})
  const server = createAppServer({
    auth: {
      config,
      getClient: async () => database,
      limiter: createLoginLimiter({
        ip: createRegisterLimiter({ limit: 1000 }),
        account: createRegisterLimiter({ limit: 1000 }),
      }),
    },
    profile: {
      ipLimiter: createRegisterLimiter({ limit: 1000 }),
      userLimiter: createRegisterLimiter({ limit: 1000 }),
    },
    tmdb: {
      token: 'fixture',
      fetchImpl: async () => Response.json({ page: 1, results: [] }),
    },
  })
  const profile = (index, name = database.users[index].name) => ({
    id: ids[index],
    name,
    email: database.users[index].email,
    createdAt: '2026-10-27T10:00:00.000Z',
    favoriteCount: index ? 0 : 3,
  })
  let vite, browser
  const passed = []
  const pass = (message) => {
    passed.push(message)
    console.log(`PASS ${message}`)
  }
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    vite = await createVite({
      root: path.resolve('frontend'),
      configFile: path.resolve('frontend/vite.config.ts'),
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: true,
        proxy: { '/api': `http://127.0.0.1:${server.address().port}` },
      },
    })
    await vite.listen()
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`
    config.allowedOrigins.add(base)
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = [],
      patches = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (
        new URL(request.url()).pathname === '/api/profile' &&
        request.method() === 'PATCH'
      )
        patches.push({
          body: request.postDataJSON(),
          csrf: request.headers()['x-cineverse-csrf'],
        })
    })
    const login = async (email = 'a@fixture.test') => {
      await page.getByLabel('Email', { exact: true }).fill(email)
      await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    }
    await page.goto(base + '/profile')
    await page.waitForURL('**/login')
    assert.equal(
      await page
        .getByRole('link', { name: 'Hồ sơ cá nhân', exact: true })
        .count(),
      0,
    )
    let releaseGet, getSeen
    const getGate = new Promise((resolve) => {
      getSeen = resolve
    })
    await page.route('**/api/profile', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      getSeen()
      await new Promise((resolve) => {
        releaseGet = resolve
      })
      return route.continue()
    })
    await login()
    await page.waitForURL('**/profile')
    await gate(getGate)
    await page
      .getByRole('status')
      .filter({ hasText: 'Đang tải hồ sơ cá nhân' })
      .waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).count(),
      0,
    )
    releaseGet()
    await page.getByRole('heading', { name: 'Fixture A', level: 1 }).waitFor()
    await page.unroute('**/api/profile')
    assert.equal(
      await page.getByRole('link', { name: 'Xem 3 phim yêu thích' }).count(),
      1,
    )
    assert.ok((await page.locator('time').textContent()).includes('2026'))
    assert.equal(
      await page
        .locator('.profile-hero')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      'rgb(76, 93, 70)',
    )
    pass(
      'guest redirect/Login return /profile, accessible loading, real GET DTO/count/date and exact olive color',
    )

    await page.getByRole('button', { name: 'Tài khoản của Fixture A' }).click()
    await page.getByRole('link', { name: 'Hồ sơ cá nhân', exact: true }).click()
    assert.equal(await page.locator('.account-panel').count(), 0)
    const edit = () =>
      page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true })
    await edit().click()
    const input = page.getByLabel('Tên hiển thị', { exact: true })
    await input.waitFor()
    assert.equal(
      await input.evaluate((element) => element === document.activeElement),
      true,
    )
    assert.equal(
      await page
        .getByLabel('Email Chỉ đọc', { exact: true })
        .getAttribute('readonly'),
      '',
    )
    const beforeInvalid = patches.length
    for (const invalid of ['   ', '🎬'.repeat(101), 'A\u007fB']) {
      await input.fill(invalid)
      await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
      await page.locator('#profile-name-error').waitFor()
      assert.equal(await input.getAttribute('aria-invalid'), 'true')
    }
    assert.equal(patches.length, beforeInvalid)
    await input.fill('  Phát Cineverse 🎬  ')
    patchDelay = 150
    const updateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/profile' &&
        response.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    assert.equal(
      await page.getByRole('button', { name: 'Đang lưu…' }).isDisabled(),
      true,
    )
    await page.locator('.profile-edit-form').evaluate((form) => {
      form.requestSubmit()
      form.requestSubmit()
    })
    assert.equal((await updateResponse).status(), 200)
    await page
      .getByRole('heading', { name: 'Phát Cineverse 🎬', level: 1 })
      .waitFor()
    await page
      .getByRole('button', { name: 'Tài khoản của Phát Cineverse 🎬' })
      .waitFor()
    await page
      .getByRole('status')
      .filter({ hasText: 'Đã lưu hồ sơ thành công.' })
      .waitFor()
    assert.equal(patches.length, beforeInvalid + 1)
    assert.deepEqual(patches.at(-1), {
      body: { name: 'Phát Cineverse 🎬' },
      csrf: '1',
    })
    assert.equal(page.url(), base + '/profile')
    patchDelay = 0
    await page.reload()
    await page
      .getByRole('heading', { name: 'Phát Cineverse 🎬', level: 1 })
      .waitFor()
    pass(
      'name validation/Unicode/no invalid request; one PATCH with only trimmed name, CSRF, pending lock; Header updates via Me, refresh persists',
    )

    await edit().click()
    await input.fill('Should fail')
    failPatch = true
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await page.getByRole('alert').filter({ hasText: 'Dịch vụ hồ sơ' }).waitFor()
    assert.equal(await page.locator('.profile-success').count(), 0)
    assert.equal(
      await page
        .getByRole('heading', { name: 'Phát Cineverse 🎬', level: 1 })
        .count(),
      1,
    )
    failPatch = false
    await page.route('**/api/profile', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION_ERROR',
                fields: { name: 'PRIVATE validation detail' },
              },
            },
          })
        : route.continue(),
    )
    await input.fill('Valid but rejected')
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await page.locator('#profile-name-error').waitFor()
    assert.equal(
      (await page.locator('body').textContent()).includes('PRIVATE'),
      false,
    )
    await page.unroute('**/api/profile')
    await input.press('Escape')
    await edit().waitFor()
    assert.equal(
      await edit().evaluate((element) => element === document.activeElement),
      true,
    )
    pass(
      'PATCH 503/400 never announces success; safe field errors; Escape cancels and restores focus',
    )

    // PATCH đã lưu nhưng Me lỗi: không nói Header đã cập nhật; retry Me không gửi lại PATCH.
    await edit().click()
    await input.fill('Nguyễn Phát')
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'AUTH_UNAVAILABLE' } },
      }),
    )
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await page.locator('.profile-sync-notice').waitFor()
    await page.locator('.profile-success').waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Tài khoản của Phát Cineverse 🎬' })
        .count(),
      1,
    )
    await page.unroute('**/api/auth/me')
    const beforeSync = patches.length
    await page.getByRole('button', { name: 'Đồng bộ tên trên Header' }).click()
    await page
      .getByRole('button', { name: 'Tài khoản của Nguyễn Phát' })
      .waitFor()
    assert.equal(patches.length, beforeSync)
    pass(
      'PATCH success + Me 503: explicit sync notice, retry Me fixes Header without duplicate mutation',
    )

    await page.route('**/api/profile', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'AUTH_UNAVAILABLE' } },
      }),
    )
    await page.reload()
    await page.getByRole('heading', { name: 'Chưa thể tải hồ sơ' }).waitFor()
    await page.unroute('**/api/profile')
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
    await page.getByRole('heading', { name: 'Nguyễn Phát', level: 1 }).waitFor()
    pass('GET 503 -> accessible error/Retry -> profile, no fake fallback data')

    await fs.mkdir('.npm-cache/phase-6.4b-screenshots', { recursive: true })
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1100 })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      )
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: 'instant' }),
      )
      await page.screenshot({
        path: `.npm-cache/phase-6.4b-screenshots/profile-${width}.png`,
        fullPage: true,
      })
      await edit().click()
      const bounds = await input.boundingBox()
      assert.ok(bounds.width > 200 && bounds.height >= 44)
      await page.keyboard.press('Tab')
      await input.focus()
      assert.equal(
        await input.evaluate((element) => element.matches(':focus-visible')),
        true,
      )
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      )
      await input.fill('🎬'.repeat(100))
      assert.equal(await input.inputValue(), '🎬'.repeat(100))
      await page.getByRole('button', { name: 'Hủy', exact: true }).click()
    }
    pass(
      'responsive 375/768/1024/1440, view/form no overflow, touch input/focus, no UTF-16 maxLength truncation',
    )

    await page.setViewportSize({ width: 1440, height: 1100 })
    await page
      .getByRole('button', { name: 'Tài khoản của Nguyễn Phát' })
      .click()
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await page.waitForURL('**/login')
    assert.equal(await page.locator('.profile-hero').count(), 0)
    await login('b@fixture.test')
    await page.waitForURL('**/profile')
    await page.getByRole('heading', { name: 'Fixture B', level: 1 }).waitFor()
    assert.equal(
      await page.getByRole('link', { name: 'Xem 0 phim yêu thích' }).count(),
      1,
    )
    assert.equal(
      (await page.locator('.profile-page').textContent()).includes(
        'Nguyễn Phát',
      ),
      false,
    )
    assert.deepEqual(
      await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      })),
      { local: [], session: [] },
    )
    assert.equal(
      (await page.locator('.profile-page').textContent()).includes(
        'passwordHash',
      ),
      false,
    )
    assert.deepEqual(errors, [])
    pass(
      'Logout removes profile/actions; Login B has only B data; no auth/profile storage or internal fields',
    )
    await page.close()

    const harness = await context.newPage()
    harness.setDefaultTimeout(10000)
    const harnessErrors = []
    harness.on('pageerror', (error) => harnessErrors.push(error.message))
    const waitText = (id, value) =>
      harness.waitForFunction(
        ({ id, value }) => document.getElementById(id)?.textContent === value,
        { id, value },
      )
    await harness.goto(base + '/tests/profileHook.browser.html')
    await waitText('profile-name', 'Fixture B')
    let releaseA, seenA
    const aGate = new Promise((resolve) => {
      seenA = resolve
    })
    let first = true
    await harness.route('**/api/profile', async (route) => {
      if (!first) return route.continue()
      first = false
      seenA()
      await new Promise((resolve) => {
        releaseA = resolve
      })
      return route.fulfill({ json: { profile: profile(0, 'Old A profile') } })
    })
    await harness.getByRole('button', { name: 'Login A', exact: true }).click()
    await gate(aGate)
    await waitText('profile-state', 'loading')
    assert.equal(await harness.locator('#profile-name').textContent(), '')
    await harness.getByRole('button', { name: 'Login B', exact: true }).click()
    await waitText('profile-name', 'Fixture B')
    releaseA()
    await pause(100)
    assert.equal(
      await harness.locator('#profile-name').textContent(),
      'Fixture B',
    )
    await harness.unroute('**/api/profile')
    pass(
      'race GET A after Login B ignored even when injected API ignores AbortSignal',
    )

    await harness.getByRole('button', { name: 'Login A', exact: true }).click()
    await waitText('profile-name', 'Nguyễn Phát')
    let releasePatch, patchSeen
    const patchGate = new Promise((resolve) => {
      patchSeen = resolve
    })
    let patchCount = 0
    await harness.route('**/api/profile', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      patchCount++
      patchSeen()
      await new Promise((resolve) => {
        releasePatch = resolve
      })
      return route.fulfill({
        json: { profile: profile(0, 'Late profile name') },
      })
    })
    await harness
      .getByRole('button', { name: 'Save twice', exact: true })
      .click()
    await gate(patchGate)
    await waitText('saving', 'true')
    assert.equal(patchCount, 1)
    await harness.getByRole('button', { name: 'Logout', exact: true }).click()
    await waitText('owner', 'guest')
    await harness.getByRole('button', { name: 'Login B', exact: true }).click()
    await waitText('profile-name', 'Fixture B')
    releasePatch()
    await pause(100)
    assert.equal(
      await harness.locator('#profile-name').textContent(),
      'Fixture B',
    )
    assert.equal(await harness.locator('#owner').textContent(), 'Fixture B')
    await harness.unroute('**/api/profile')
    pass(
      'same-tick PATCH lock, late PATCH after Logout/Login B cannot replace data or Header',
    )

    let mismatches = 0
    await harness.route('**/api/profile', (route) => {
      mismatches++
      return route.fulfill({
        json: { profile: profile(0, 'Never show A data') },
      })
    })
    await harness
      .getByRole('button', { name: 'Retry profile', exact: true })
      .click()
    await waitText('profile-state', 'SESSION_CHANGED')
    assert.equal(await harness.locator('#profile-name').textContent(), '')
    assert.equal(mismatches, 1)
    await harness.unroute('**/api/profile')
    await harness
      .getByRole('button', { name: 'Retry profile', exact: true })
      .click()
    await waitText('profile-name', 'Fixture B')
    let unauthorizedCount = 0
    await harness.route('**/api/profile', (route) => {
      unauthorizedCount++
      database.sessions.clear()
      return route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED' } },
      })
    })
    await harness
      .getByRole('button', { name: 'Retry profile', exact: true })
      .click()
    await waitText('owner', 'guest')
    assert.equal(await harness.locator('#profile-name').count(), 0)
    assert.equal(unauthorizedCount, 1)
    assert.deepEqual(harnessErrors, [])
    pass(
      'owner mismatch DTO hidden; one Me recheck; 401 expires session without retry loop',
    )
    await harness.close()
    console.log(
      `PASS ${passed.length} Profile browser checkpoints; fixtures only, no real account/database changed`,
    )
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    server.closeAllConnections()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
}
main().catch((error) => {
  console.error(error.stack)
  process.exitCode = 1
})
