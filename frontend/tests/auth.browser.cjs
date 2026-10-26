// node frontend/tests/auth.browser.cjs <path-to-playwright>
// Tự mở/đóng Vite và Node server ở cổng tạm; database chỉ là mock trong memory.
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { chromium } = require(process.argv[2] || 'playwright')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fixtureUser = {
  id: 'e71d28a1-b104-44db-a159-f6af12f314b0',
  name: 'Fixture User',
  email: 'fixture@example.com',
  createdAt: '2026-10-26T00:00:00.000Z',
}
const password = '  SyntheticPassword123!  '
const film = {
  id: 27205,
  title: 'Kẻ Đánh Cắp Giấc Mơ',
  original_title: 'Inception',
  overview: 'Fixture movie overview.',
  release_date: '2010-07-15',
  vote_average: 8.4,
  vote_count: 200,
  poster_path: '/fixture.jpg',
  backdrop_path: '/fixture.jpg',
  genre_ids: [28],
}

async function main() {
  const [
    { createServer: createVite },
    { createAppServer },
    { readAuthConfig },
    { createRegistrationService },
    { createRegisterLimiter },
    { createLoginLimiter },
    { memoryDatabase },
  ] = await Promise.all([
    import('../node_modules/vite/dist/node/index.js'),
    import('../../backend/server.mjs'),
    import('../../backend/auth/config.mjs'),
    import('../../backend/auth/register-service.mjs'),
    import('../../backend/auth/rate-limit.mjs'),
    import('../../backend/auth/login-rate-limit.mjs'),
    import('../../backend/tests/helpers/auth-fixture.mjs'),
  ])
  const database = memoryDatabase([])
  database.user.create = async ({ data }) => {
    if (database.users.some((user) => user.email === data.email))
      throw Object.assign(new Error('unique fixture'), { code: 'P2002' })
    const user = { ...data, id: randomUUID(), createdAt: new Date() }
    database.users.push(user)
    return user
  }
  const config = readAuthConfig({})
  const resetMails = []
  let resetOrigin
  const server = createAppServer({
    passwordReset: {
      minimumDurationMs: 0,
      delivery: {
        ready: () => resetOrigin,
        send: async (mail) => {
          resetMails.push(mail)
        },
      },
      forgotLimiter: createLoginLimiter({
        ip: createRegisterLimiter({ limit: 200 }),
        account: createRegisterLimiter({ limit: 200 }),
      }),
    },
    registration: {
      registerUser: createRegistrationService({
        getClient: async () => database,
      }),
      limiter: createRegisterLimiter({ limit: 200 }),
    },
    auth: {
      config,
      getClient: async () => database,
      limiter: createLoginLimiter({
        ip: createRegisterLimiter({ limit: 200 }),
        account: createRegisterLimiter({ limit: 200 }),
      }),
    },
    tmdb: {
      token: 'fixture',
      fetchImpl: async (url) => {
        if (url.pathname.includes('/genre/'))
          return Response.json({ genres: [{ id: 28, name: 'Hành động' }] })
        if (/\/movie\/\d+$/.test(url.pathname))
          return Response.json({
            ...film,
            id: Number(url.pathname.split('/').pop()),
            genres: [{ id: 28, name: 'Hành động' }],
            runtime: 148,
            status: 'Released',
            production_countries: [],
            videos: { results: [] },
            recommendations: {
              page: 1,
              results: [{ ...film, id: 42, title: 'Phim liên quan' }],
            },
            credits: {
              cast: [
                {
                  id: 1,
                  name: 'Fixture Actor',
                  character: 'Lead',
                  order: 0,
                  profile_path: null,
                },
              ],
              crew: [{ id: 2, name: 'Fixture Director', job: 'Director' }],
            },
          })
        return Response.json({ page: 1, results: [film] })
      },
    },
  })
  let vite, browser
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
    resetOrigin = base
    config.allowedOrigins.add(base)
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    })
    await context.route('https://image.tmdb.org/**', (route) =>
      route.fulfill({
        path: path.resolve('frontend/public/images/movies/inception.jpg'),
      }),
    )
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = [],
      posts = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/') && request.method() === 'POST')
        posts.push({
          path: new URL(request.url()).pathname,
          csrf: request.headers()['x-cineverse-csrf'],
        })
    })
    await page.goto(base + '/register')
    await page.getByLabel('Xác nhận mật khẩu', { exact: true }).waitFor()
    assert.equal(await page.locator('.auth-card input').count(), 4)
    await page
      .getByRole('button', { name: 'Tạo tài khoản', exact: true })
      .click()
    assert.equal(
      await page.locator('#auth-name').getAttribute('aria-invalid'),
      'true',
    )
    await page.getByLabel('Họ và tên', { exact: true }).fill('  Fixture User  ')
    await page
      .getByLabel('Email', { exact: true })
      .fill(' Fixture@Example.com ')
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await page
      .getByLabel('Xác nhận mật khẩu', { exact: true })
      .fill('different')
    await page
      .getByRole('button', { name: 'Tạo tài khoản', exact: true })
      .click()
    await page.getByText('Mật khẩu xác nhận chưa khớp.').waitFor()
    assert.equal(posts.length, 0)
    await page
      .getByRole('button', { name: 'Hiện mật khẩu', exact: true })
      .click()
    assert.equal(
      await page.locator('#auth-password').getAttribute('type'),
      'text',
    )
    await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(password)
    let releaseRegister
    const heldRegister = new Promise((resolve) => {
      releaseRegister = resolve
    })
    await page.route('**/api/auth/register', async (route) => {
      await heldRegister
      await route.continue()
    })
    await page
      .getByRole('button', { name: 'Tạo tài khoản', exact: true })
      .click()
    await page.getByRole('button', { name: 'Đang xử lý…' }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Đang xử lý…' }).isDisabled(),
      true,
    )
    assert.equal(await page.locator('.auth-card input:disabled').count(), 4)
    releaseRegister()
    await page.waitForURL('**/login')
    await page.unroute('**/api/auth/register')
    await page
      .getByText('Tài khoản đã được tạo. Hãy đăng nhập để tiếp tục.')
      .waitFor()
    assert.equal(
      await page.getByLabel('Email', { exact: true }).inputValue(),
      'fixture@example.com',
    )
    assert.equal(
      await page.getByLabel('Mật khẩu', { exact: true }).inputValue(),
      '',
    )
    assert.equal(database.sessions.size, 0)
    assert.ok(
      !JSON.stringify(await page.evaluate(() => history.state)).includes(
        password,
      ),
    )
    await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong')
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Email hoặc mật khẩu không chính xác.' })
      .waitFor()
    assert.equal(
      await page.getByLabel('Email', { exact: true }).inputValue(),
      'fixture@example.com',
    )
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page.waitForURL(base + '/')
    await page
      .getByRole('button', { name: 'Tài khoản của Fixture User' })
      .waitFor()
    assert.equal(database.sessions.size, 1)
    await page.getByRole('searchbox', { name: 'Tên phim' }).fill('Inception')
    await page.locator('#search-results .movie-card-link').first().waitFor()
    await page
      .getByRole('combobox', { name: 'Sắp xếp', exact: true })
      .selectOption('rating-desc')
    await page
      .getByRole('button', { name: 'Tài khoản của Fixture User' })
      .click()
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await page.locator('#header-login').waitFor()
    assert.equal(
      await page.getByRole('searchbox', { name: 'Tên phim' }).inputValue(),
      'Inception',
    )
    assert.equal(
      await page
        .getByRole('combobox', { name: 'Sắp xếp', exact: true })
        .inputValue(),
      'rating-desc',
    )
    await page.locator('#header-login').click()
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.com')
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page.waitForURL(base + '/')
    assert.equal(
      await page.getByRole('searchbox', { name: 'Tên phim' }).inputValue(),
      'Inception',
    )
    assert.ok(
      !(await page.evaluate(() => document.cookie)).includes(
        'cineverse_session',
      ),
    )
    await page.reload()
    await page
      .getByRole('button', { name: 'Tài khoản của Fixture User' })
      .waitFor()
    await page.locator('.movie-card-link').first().click()
    await page.waitForURL('**/movies/27205')
    await page.getByText('Fixture Director', { exact: true }).waitFor()
    await page.getByText('Fixture Actor', { exact: true }).waitFor()
    await page.locator('#recommendations .movie-card-link').first().waitFor()
    const account = page.getByRole('button', {
      name: 'Tài khoản của Fixture User',
    })
    await account.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).waitFor()
    await page.keyboard.press('Tab')
    assert.equal(
      await page
        .getByRole('button', { name: 'Đăng xuất', exact: true })
        .evaluate((node) => node === document.activeElement),
      true,
    )
    await page.keyboard.press('Escape')
    assert.equal(await account.getAttribute('aria-expanded'), 'false')
    await account.click()
    await page.locator('#details-title').click()
    assert.equal(await account.getAttribute('aria-expanded'), 'false')
    // Logout lỗi: giữ user, cho retry; sau 204 mới đổi Header.
    await page.route('**/api/auth/logout', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'AUTH_UNAVAILABLE' } },
      }),
    )
    await account.click()
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Dịch vụ tài khoản' })
      .waitFor()
    assert.equal(database.sessions.size, 1)
    await page.unroute('**/api/auth/logout')
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await page.locator('#header-login').waitFor()
    assert.equal(new URL(page.url()).pathname, '/movies/27205')
    await page.reload()
    await page.locator('#header-login').waitFor()
    // Return to movie after Login; guest-only routes redirect, giữ session.
    await page.locator('#header-login').click()
    await page.locator('#header-login').click()
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.com')
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page.waitForURL('**/movies/27205')
    await page.goto(base + '/register')
    await page.waitForURL(base + '/')
    await page
      .getByRole('button', { name: 'Tài khoản của Fixture User' })
      .waitFor()
    // Responsive + ảnh để người dùng kiểm tra sản phẩm.
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `header overflow ${width}`,
      )
      await page
        .getByRole('button', { name: 'Tài khoản của Fixture User' })
        .click()
      const panel = await page.locator('.account-panel').boundingBox()
      assert.ok(
        panel.x >= 0 && panel.x + panel.width <= width,
        `account popup bounds ${width}`,
      )
      await page.keyboard.press('Escape')
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page
      .getByRole('button', { name: 'Tài khoản của Fixture User' })
      .click()
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await page.locator('#header-login').waitFor()
    await page.goto(base + '/register')
    await page.getByLabel('Họ và tên', { exact: true }).waitFor()
    await page.screenshot({
      path: '.npm-cache/phase-6.2c-register-desktop.png',
      fullPage: true,
    })
    await page.getByLabel('Họ và tên', { exact: true }).fill('Existing')
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.com')
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(password)
    await page
      .getByRole('button', { name: 'Tạo tài khoản', exact: true })
      .click()
    await page
      .locator('#auth-email-error')
      .filter({ hasText: 'đã được sử dụng' })
      .waitFor()
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `form overflow ${width}`,
      )
    }
    await page.setViewportSize({ width: 390, height: 900 })
    await page.screenshot({
      path: '.npm-cache/phase-6.2c-register-mobile.png',
      fullPage: true,
    })
    await page.route('**/api/auth/register', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'REGISTRATION_UNAVAILABLE' } },
      }),
    )
    await page
      .getByRole('button', { name: 'Tạo tài khoản', exact: true })
      .click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Dịch vụ tài khoản tạm thời không khả dụng' })
      .waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Tạo tài khoản', exact: true })
        .isEnabled(),
      true,
    )
    await page.unroute('**/api/auth/register')
    // Unknown session không trở thành guest; retry có giới hạn theo click.
    const fresh = await browser.newContext()
    const unknown = await fresh.newPage()
    await unknown.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'AUTH_UNAVAILABLE' } },
      }),
    )
    await unknown.goto(base + '/login')
    await unknown
      .getByText('Chưa thể kiểm tra phiên đăng nhập.', { exact: false })
      .waitFor()
    assert.equal(await unknown.locator('#header-login').count(), 0)
    await unknown.unroute('**/api/auth/me')
    await unknown
      .getByRole('button', { name: 'Kiểm tra lại phiên', exact: true })
      .click()
    await unknown.locator('#header-login').waitFor()
    // Loading + double submit + 429/network errors.
    let submitted = 0,
      release
    const pending = new Promise((resolve) => {
      release = resolve
    })
    await unknown.route('**/api/auth/login', async (route) => {
      submitted++
      await pending
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '5' },
        json: { error: { code: 'RATE_LIMITED' } },
      })
    })
    await unknown
      .getByLabel('Email', { exact: true })
      .fill('fixture@example.com')
    await unknown.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await unknown.locator('.auth-card form').evaluate((form) => {
      form.requestSubmit()
      form.requestSubmit()
    })
    await unknown.getByRole('button', { name: 'Đang xử lý…' }).waitFor()
    assert.equal(
      await unknown.getByRole('button', { name: 'Đang xử lý…' }).isDisabled(),
      true,
    )
    await pause(100)
    assert.equal(submitted, 1)
    release()
    await unknown.getByText('Vui lòng thử lại sau khoảng 5 giây.').waitFor()
    await unknown.unroute('**/api/auth/login')
    await unknown.route('**/api/auth/login', (route) => route.abort('failed'))
    await unknown
      .getByRole('button', { name: 'Đăng nhập', exact: true })
      .click()
    await unknown
      .getByRole('alert')
      .filter({ hasText: 'Không thể kết nối' })
      .waitFor()
    const storage = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }))
    assert.deepEqual(storage, { local: {}, session: {} })
    assert.ok(posts.length > 0 && posts.every(({ csrf }) => csrf === '1'))
    assert.deepEqual(errors, [])
    await fresh.close()
    console.log(
      'PASS UI + Vite + Node (DB mock): Register/validation/409, Login/401/loading/429/network, real HTTP-only cookie/reload/Me, Header keyboard/outside/Escape, Logout failure/retry, return route, responsive, no auth storage, CSRF headers.',
    )
    await providerTests(browser, base)
    await recoveryTests(browser, base, database, resetMails)
    if (process.argv.includes('--regression')) {
      await browser.close()
      browser = null
      const run = require('node:util').promisify(
        require('node:child_process').execFile,
      )
      for (const file of [
        'movieDetails.browser.cjs',
        'compactMovies.browser.cjs',
        'movieCast.browser.cjs',
      ]) {
        const result = await run(
          process.execPath,
          [`frontend/tests/${file}`, process.argv[2]],
          {
            env: { ...process.env, CINEVERSE_TEST_URL: base },
            windowsHide: true,
            timeout: 45000,
          },
        )
        process.stdout.write(result.stdout)
      }
    }
  } finally {
    await browser?.close()
    await vite?.close()
    server.closeAllConnections()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
}

async function providerTests(browser, base) {
  const page = await browser.newPage()
  const late = []
  await page.route('**/api/auth/me', (route) => {
    late.push(route)
  })
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ json: { user: fixtureUser } }),
  )
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({ status: 204 }),
  )
  await page.goto(base + '/tests/authProvider.browser.html?ignoreAbort')
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('#auth-status')?.textContent === 'authenticated',
  )
  for (const route of late.splice(0))
    await route.fulfill({
      status: 401,
      json: { error: { code: 'UNAUTHENTICATED' } },
    })
  await pause(100)
  assert.equal(
    await page.locator('#auth-status').textContent(),
    'authenticated',
  )
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.waitForFunction(
    () => document.documentElement.dataset.aborted === 'true',
  )
  await pause(50)
  await page.getByRole('button', { name: 'Logout', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('#auth-status')?.textContent === 'guest',
  )
  for (const route of late.splice(0))
    await route.fulfill({ json: { user: fixtureUser } })
  await pause(100)
  assert.equal(await page.locator('#auth-status').textContent(), 'guest')
  // Refresh error giữ user đã biết.
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('#auth-status')?.textContent === 'authenticated',
  )
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await pause(50)
  for (const route of late.splice(0))
    await route.fulfill({
      status: 503,
      json: { error: { code: 'AUTH_UNAVAILABLE' } },
    })
  await page.waitForFunction(
    () =>
      document.querySelector('#auth-error')?.textContent === 'AUTH_UNAVAILABLE',
  )
  assert.equal(await page.locator('#auth-user').textContent(), fixtureUser.name)
  assert.equal(
    await page.locator('#auth-status').textContent(),
    'authenticated',
  )
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await pause(50)
  await page
    .getByRole('button', { name: 'Toggle provider', exact: true })
    .click()
  for (const route of late.splice(0))
    await route.fulfill({ json: { user: fixtureUser } })
  assert.equal(await page.locator('#auth-status').count(), 0)
  await page.close()
  console.log(
    'PASS AuthProvider: StrictMode/abort, stale Me after Login/Logout ignored even without transport abort, refresh error preserves user, unmount safe.',
  )
}

async function recoveryTests(browser, base, database, mails) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = [],
    requests = []
  page.on('pageerror', (error) => errors.push(error.name))
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      headers: request.headers(),
      method: request.method(),
    }),
  )
  try {
    await page.goto(base + '/login')
    await page.getByRole('link', { name: 'Quên mật khẩu?' }).click()
    await page.waitForURL('**/forgot-password')
    await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
    await page.locator('#recovery-email[aria-invalid="true"]').waitFor()
    assert.equal(
      await page
        .locator('#recovery-email')
        .evaluate((element) => element === document.activeElement),
      true,
    )
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.com')
    let releaseForgot,
      submittedForgot = 0
    const heldForgot = new Promise((resolve) => {
      releaseForgot = resolve
    })
    await page.route('**/api/auth/forgot-password', async (route) => {
      submittedForgot++
      await heldForgot
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '5' },
        json: { error: { code: 'RATE_LIMITED' } },
      })
    })
    await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
    assert.equal(
      await page.getByRole('button', { name: 'Đang gửi…' }).isDisabled(),
      true,
    )
    await page.locator('.auth-card form').evaluate((form) => {
      form.requestSubmit()
      form.requestSubmit()
    })
    await pause(50)
    assert.equal(submittedForgot, 1)
    releaseForgot()
    await page.getByRole('alert').filter({ hasText: '5 giây' }).waitFor()
    await page.unroute('**/api/auth/forgot-password')
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'EMAIL_UNAVAILABLE' } },
      }),
    )
    await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Chưa thể gửi email' })
      .waitFor()
    assert.equal(await page.locator('.auth-success').count(), 0)
    await page.unroute('**/api/auth/forgot-password')
    await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
    await page
      .getByRole('status')
      .filter({ hasText: 'Nếu email này có tài khoản Cineverse' })
      .waitFor()
    assert.equal(mails.at(-1).email, 'fixture@example.com')
    const resetUrl = mails.at(-1).resetUrl
    const token = new URL(resetUrl).hash.slice(7)
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      )
    }
    await page.screenshot({
      path: '.npm-cache/phase-6.2d-forgot-mobile.png',
      fullPage: true,
    })
    requests.length = 0
    const response = await page.goto(resetUrl)
    await page.getByLabel('Mật khẩu mới', { exact: true }).waitFor()
    assert.ok(page.url() === base + '/reset-password')
    assert.equal(response.headers()['referrer-policy'], 'no-referrer')
    assert.equal(response.headers()['cache-control'], 'no-store')
    assert.equal(
      await page.locator('meta[name="referrer"]').getAttribute('content'),
      'no-referrer',
    )
    assert.equal(await page.locator('iframe').count(), 0)
    await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click()
    await page.locator('#reset-password[aria-invalid="true"]').waitFor()
    const nextPassword = '  Browser recovery password 123!  '
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill(nextPassword)
    await page
      .getByLabel('Xác nhận mật khẩu mới', { exact: true })
      .fill('wrong')
    await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click()
    await page.getByText('Mật khẩu xác nhận chưa khớp.').waitFor()
    await page
      .getByLabel('Xác nhận mật khẩu mới', { exact: true })
      .fill(nextPassword)
    await page
      .getByRole('button', { name: 'Hiện mật khẩu mới', exact: true })
      .click()
    assert.equal(
      await page.locator('#reset-password').getAttribute('type'),
      'text',
    )
    await page
      .getByRole('button', { name: 'Ẩn mật khẩu mới', exact: true })
      .click()
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      )
    }
    await page.screenshot({
      path: '.npm-cache/phase-6.2d-reset-mobile.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({
      path: '.npm-cache/phase-6.2d-reset-desktop.png',
      fullPage: true,
    })
    assert.deepEqual(
      await page.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
      })),
      { local: {}, session: {} },
    )
    assert.ok(
      requests.every(
        ({ url, headers }) =>
          !url.includes(token) && !(headers.referer ?? '').includes(token),
      ),
    )
    assert.ok(requests.every(({ url }) => url.startsWith(base)))
    let releaseReset,
      submittedReset = 0
    const heldReset = new Promise((resolve) => {
      releaseReset = resolve
    })
    await page.route('**/api/auth/reset-password', async (route) => {
      submittedReset++
      await heldReset
      await route.abort('failed')
    })
    await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click()
    assert.equal(
      await page.getByRole('button', { name: 'Đang cập nhật…' }).isDisabled(),
      true,
    )
    await page.locator('.auth-card form').evaluate((form) => {
      form.requestSubmit()
      form.requestSubmit()
    })
    await pause(50)
    assert.equal(submittedReset, 1)
    releaseReset()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Không thể kết nối' })
      .waitFor()
    await page.unroute('**/api/auth/reset-password')
    await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click()
    await page
      .getByRole('status')
      .filter({ hasText: 'Mật khẩu đã được cập nhật' })
      .waitFor()
    assert.equal(database.sessions.size, 0)
    assert.equal(
      await page.getByRole('button', { name: 'Tài khoản của' }).count(),
      0,
    )
    await page
      .getByRole('link', { name: 'Quay lại đăng nhập', exact: true })
      .last()
      .click()
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.com')
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Email hoặc mật khẩu không chính xác' })
      .waitFor()
    await page.getByLabel('Mật khẩu', { exact: true }).fill(nextPassword)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page.waitForURL(base + '/')
    await page.goto(resetUrl)
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill(nextPassword)
    await page
      .getByLabel('Xác nhận mật khẩu mới', { exact: true })
      .fill(nextPassword)
    await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Liên kết không hợp lệ' })
      .waitFor()
    await page.getByRole('link', { name: 'Yêu cầu liên kết mới' }).click()
    await page.getByLabel('Email', { exact: true }).fill('missing@example.com')
    await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
    await page
      .getByRole('status')
      .filter({ hasText: 'Nếu email này có tài khoản Cineverse' })
      .waitFor()
    assert.equal(mails.at(-1).resetUrl, null)
    await page.goto(base + '/reset-password#token=invalid')
    await page
      .getByRole('alert')
      .filter({ hasText: 'Liên kết không hợp lệ' })
      .waitFor()
    assert.equal(page.url(), base + '/reset-password')
    await page.reload()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Liên kết không hợp lệ' })
      .waitFor()
    assert.deepEqual(errors, [])
    console.log(
      'PASS Recovery UI + native Node (DB/email mock): Login → Forgot → Reset → Login, SMTP unavailable, generic known/unknown, validation/focus/show-hide, password changed/reused token rejected, sessions revoked, responsive 1440/1024/768/390/320, URL scrub/no token in storage/referrer/resource URLs, no third-party on reset.',
    )
  } finally {
    await context.close()
  }
}

main().catch(() => {
  // Playwright có thể đính kèm reset URL hoặc giá trị input vào lỗi.
  console.error('Auth browser verification failed; sensitive details hidden.')
  process.exitCode = 1
})
