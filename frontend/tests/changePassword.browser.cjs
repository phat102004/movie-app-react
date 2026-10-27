// Native Node + Vite, real Argon2/session code, in-memory DB only. No .env or real account.
// node frontend/tests/changePassword.browser.cjs <path-to-playwright>
const assert = require('node:assert/strict')
const { once } = require('node:events')
const path = require('node:path')
const fs = require('node:fs/promises')
const { chromium } = require(process.argv[2] || 'playwright')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const oldPassword = 'Old synthetic account password 123!'
const newPassword = ' New synthetic account password 456! '
const thirdPassword = 'Third synthetic account password 789!'
let checkpoint = 'setup'
async function waitGate(promise) {
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
    { memoryAccountDatabase },
    { hashRegistrationPassword },
    { createRegisterLimiter },
    { createLoginLimiter },
  ] = await Promise.all([
    import('../node_modules/vite/dist/node/index.js'),
    import('../../backend/server.mjs'),
    import('../../backend/auth/config.mjs'),
    import('../../backend/tests/helpers/account-database.mjs'),
    import('../../backend/auth/password.mjs'),
    import('../../backend/auth/rate-limit.mjs'),
    import('../../backend/auth/login-rate-limit.mjs'),
  ])
  const hash = await hashRegistrationPassword(oldPassword)
  const ids = [
    'e71d28a1-b104-44db-a159-f6af12f314b0',
    'e71d28a1-b104-44db-a159-f6af12f314b1',
  ]
  const { client, favorites } = memoryAccountDatabase(
    ids.map((id, index) => ({
      id,
      name: index ? 'Fixture B' : 'Fixture A',
      email: `${index ? 'b' : 'a'}@fixture.test`,
      passwordHash: hash,
      createdAt: new Date('2026-10-28T00:00:00.000Z'),
    })),
  )
  favorites.set('fixture-a', {
    userId: ids[0],
    movieId: 550,
    createdAt: new Date(),
  })
  const config = readAuthConfig({})
  let holdHash = null
  const server = createAppServer({
    auth: {
      config,
      getClient: async () => client,
      limiter: createLoginLimiter({
        ip: createRegisterLimiter({ limit: 200 }),
        account: createRegisterLimiter({ limit: 200 }),
      }),
    },
    passwordChange: {
      ipLimiter: createRegisterLimiter({ limit: 200 }),
      userLimiter: createRegisterLimiter({ limit: 200 }),
      hashPassword: async (password) => {
        if (holdHash) await holdHash()
        return hashRegistrationPassword(password)
      },
    },
    tmdb: {
      token: 'fixture',
      fetchImpl: async () => Response.json({ page: 1, results: [] }),
    },
  })
  let browser, vite
  const passes = []
  const passed = (value) => {
    passes.push(value)
    console.log(`PASS ${value}`)
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
      requests = []
    page.on('pageerror', () => errors.push('page-error'))
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/profile/change-password')
        requests.push({
          keys: Object.keys(request.postDataJSON()).sort(),
          csrf: request.headers()['x-cineverse-csrf'],
        })
    })
    const login = async (password) => {
      await page.getByLabel('Email', { exact: true }).fill('a@fixture.test')
      await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    }
    const open = () =>
      page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click()
    const field = (name) => page.getByLabel(name, { exact: true })
    const current = () => field('Mật khẩu hiện tại'),
      next = () => field('Mật khẩu mới'),
      confirm = () => field('Xác nhận mật khẩu mới')
    const fill = async (old, newer, confirmation = newer) => {
      await current().fill(old)
      await next().fill(newer)
      await confirm().fill(confirmation)
    }
    const submit = () =>
      page
        .getByRole('button', { name: 'Xác nhận đổi mật khẩu', exact: true })
        .click()
    checkpoint = 'guest-login'
    await page.goto(base + '/profile')
    await page.waitForURL('**/login')
    assert.equal(
      await page.getByRole('heading', { name: 'Bảo mật tài khoản' }).count(),
      0,
    )
    await login(oldPassword)
    await page.waitForURL('**/profile')
    await page.getByRole('heading', { name: 'Bảo mật tài khoản' }).waitFor()
    await open()
    assert.equal(await current().inputValue(), '')
    assert.equal(await next().inputValue(), '')
    assert.equal(await confirm().inputValue(), '')
    checkpoint = 'validation'
    await fill('', 'short', 'different')
    await submit()
    await page.locator('#security-currentPassword-error').waitFor()
    await page.locator('#security-newPassword-error').waitFor()
    await page.locator('#security-confirmPassword-error').waitFor()
    assert.equal(requests.length, 0)
    for (const [label, id] of [
      ['mật khẩu hiện tại', 'currentPassword'],
      ['mật khẩu mới', 'newPassword'],
      ['xác nhận mật khẩu mới', 'confirmPassword'],
    ]) {
      await page
        .getByRole('button', { name: `Hiện ${label}`, exact: true })
        .click()
      assert.equal(
        await page.locator(`#security-${id}`).getAttribute('type'),
        'text',
      )
      await page
        .getByRole('button', { name: `Ẩn ${label}`, exact: true })
        .click()
    }
    await page.getByRole('button', { name: 'Hủy đổi mật khẩu' }).click()
    await open()
    assert.equal(await current().inputValue(), '')
    passed(
      'security section protected; blank fields; client policy/confirm errors; show/hide 3 fields; cancel clears values',
    )

    checkpoint = 'wrong-current-reuse'
    await fill('Wrong synthetic current password', newPassword)
    await submit()
    await page
      .locator('#security-currentPassword-error')
      .filter({ hasText: 'không chính xác' })
      .waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Tài khoản của Fixture A' })
        .count(),
      1,
    )
    await fill(oldPassword, oldPassword)
    await submit()
    await page
      .locator('#security-newPassword-error')
      .filter({ hasText: 'phải khác' })
      .waitFor()
    passed(
      'wrong current password and reuse are field-specific 400, user remains authenticated',
    )

    checkpoint = 'errors-and-pending'
    await page.route('**/api/profile/change-password', async (route) => {
      await pause(200)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'AUTH_UNAVAILABLE',
            message: 'PRIVATE database detail',
          },
        },
      })
    })
    await fill(oldPassword, newPassword)
    const before = requests.length
    await submit()
    assert.equal(
      await page
        .getByRole('button', { name: 'Đang đổi mật khẩu…' })
        .isDisabled(),
      true,
    )
    await page.locator('#change-password-form').evaluate((form) => {
      form.requestSubmit()
      form.requestSubmit()
    })
    await page
      .getByRole('alert')
      .filter({ hasText: 'tạm thời chưa sẵn sàng' })
      .waitFor()
    assert.equal(requests.length, before + 1)
    assert.equal(
      (await page.locator('body').textContent()).includes('PRIVATE'),
      false,
    )
    assert.equal(page.url(), base + '/profile')
    await page.unroute('**/api/profile/change-password')
    await page.route('**/api/profile/change-password', (route) =>
      route.fulfill({ json: { success: true } }),
    )
    await submit()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Phản hồi đổi mật khẩu chưa hợp lệ' })
      .waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Tài khoản của Fixture A' })
        .count(),
      1,
    )
    await page.unroute('**/api/profile/change-password')
    passed(
      'pending blocks repeated submit; safe 503/invalid 200 cannot clear Auth state or announce success',
    )

    checkpoint = 'responsive'
    await fill('', '', '')
    await fs.mkdir('.npm-cache/phase-6.4c-screenshots', { recursive: true })
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1100 })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      )
      const bounds = await current().boundingBox()
      assert.ok(bounds.height >= 44 && bounds.width > 170)
      await page.keyboard.press('Tab')
      await current().focus()
      assert.equal(
        await current().evaluate((element) =>
          element.matches(':focus-visible'),
        ),
        true,
      )
      assert.equal(
        await current().evaluate(
          (element) =>
            getComputedStyle(element.closest('.profile-password-input'))
              .outlineStyle,
        ),
        'solid',
      )
      await page.locator('#security-title').scrollIntoViewIfNeeded()
      await page.screenshot({
        path: `.npm-cache/phase-6.4c-screenshots/security-${width}.png`,
        fullPage: false,
      })
    }
    passed(
      'responsive 375/768/1024/1440, no overflow, labels/aria/focus/touch targets; screenshots contain empty fields only',
    )

    checkpoint = 'success'
    await page.setViewportSize({ width: 1440, height: 1100 })
    const otherA = await browser.newContext(),
      otherB = await browser.newContext()
    for (const [other, email] of [
      [otherA, 'a@fixture.test'],
      [otherB, 'b@fixture.test'],
    ]) {
      const result = await other.request.post(base + '/api/auth/login', {
        headers: { 'X-Cineverse-CSRF': '1', Origin: base },
        data: { email, password: oldPassword },
      })
      assert.equal(result.status(), 200)
    }
    await fill(oldPassword, newPassword)
    await submit()
    checkpoint = 'success-login-redirect'
    await page.waitForURL('**/login')
    checkpoint = 'success-login-notice'
    await page
      .getByRole('status')
      .filter({ hasText: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' })
      .waitFor()
    assert.equal(await page.locator('#change-password-form').count(), 0)
    assert.equal(
      await page.getByLabel('Mật khẩu', { exact: true }).inputValue(),
      '',
    )
    assert.equal(
      await page
        .getByRole('button', { name: 'Tài khoản của Fixture A' })
        .count(),
      0,
    )
    assert.equal(
      (await otherA.request.get(base + '/api/auth/me')).status(),
      401,
    )
    assert.equal(
      (await otherB.request.get(base + '/api/auth/me')).status(),
      200,
    )
    assert.equal(
      (await context.cookies(base)).some((cookie) =>
        cookie.name.includes('cineverse_session'),
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
    assert.ok(
      requests.every(
        (request) =>
          request.csrf === '1' &&
          request.keys.join() === 'currentPassword,newPassword',
      ),
    )
    checkpoint = 'success-old-login-rejected'
    await login(oldPassword)
    await page
      .getByRole('alert')
      .filter({ hasText: 'Email hoặc mật khẩu không chính xác' })
      .waitFor()
    checkpoint = 'success-new-login'
    await login(newPassword)
    await page.waitForURL('**/profile')
    await page.getByRole('link', { name: 'Xem 1 phim yêu thích' }).waitFor()
    passed(
      '204 clears cookie/password UI/Auth/Favorites -> Login notice; old sessions revoked, B intact; old login fails/new login succeeds; Profile/Favorites preserved',
    )
    await otherA.close()
    await otherB.close()

    checkpoint = 'navigate-during-change'
    let releaseHash, hashSeen
    const hashGate = new Promise((resolve) => {
      hashSeen = resolve
    })
    holdHash = async () => {
      hashSeen()
      await new Promise((resolve) => {
        releaseHash = resolve
      })
    }
    await open()
    await fill(newPassword, thirdPassword)
    await submit()
    await waitGate(hashGate)
    await page
      .getByRole('link', { name: 'Cineverse — Trang chủ', exact: true })
      .click()
    await page.waitForURL(base + '/')
    releaseHash()
    await page.waitForURL('**/login')
    await page
      .getByRole('status')
      .filter({ hasText: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' })
      .waitFor()
    holdHash = null
    passed(
      'navigating away during request still clears session and shows Login success via global Auth flow',
    )

    checkpoint = 'stale-me'
    const harness = await context.newPage()
    harness.setDefaultTimeout(10000)
    let releaseMe, meSeen
    const meGate = new Promise((resolve) => {
      meSeen = resolve
    })
    await harness.route('**/api/auth/me', async (route) => {
      meSeen()
      await new Promise((resolve) => {
        releaseMe = resolve
      })
      return route.fulfill({
        json: {
          user: {
            id: ids[0],
            name: 'Stale fixture user',
            email: 'a@fixture.test',
            createdAt: '2026-10-28T00:00:00.000Z',
          },
        },
      })
    })
    await harness.route('**/api/profile/change-password', (route) =>
      route.fulfill({ status: 204 }),
    )
    await harness.goto(base + '/tests/authProvider.browser.html?ignoreAbort')
    await waitGate(meGate)
    await harness
      .getByRole('button', { name: 'Change password', exact: true })
      .click()
    await harness.waitForFunction(
      () =>
        document.getElementById('auth-status')?.textContent === 'guest' &&
        document.getElementById('password-changed')?.textContent === 'true',
    )
    releaseMe()
    await pause(120)
    assert.equal(await harness.locator('#auth-status').textContent(), 'guest')
    assert.equal(await harness.locator('#auth-user').textContent(), 'none')
    assert.deepEqual(errors, [])
    passed(
      'late Me ignored after password-change logout even when fetch ignores AbortSignal',
    )
    await harness.close()
    await page.close()
    console.log(
      `PASS ${passes.length} Change Password browser checkpoints; all accounts/DB mocked, no real password changed`,
    )
  } finally {
    if (browser) await browser.close()
    if (vite) await vite.close()
    server.closeAllConnections()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
}
main().catch((error) => {
  console.error(
    `Change Password browser verification failed at ${checkpoint}; ${error.name}; input/credentials hidden.`,
  )
  process.exitCode = 1
})
