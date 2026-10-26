// Native Node + Vite + session/Argon2 thật; User/Session/Favorite chỉ ở RAM.
// node frontend/tests/favorites.browser.cjs <path-to-playwright>
const assert = require('node:assert/strict')
const { once } = require('node:events')
const path = require('node:path')
const fs = require('node:fs/promises')
const { chromium } = require(process.argv[2] || 'playwright')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const password = 'Synthetic favorites password 123!'
const ids = [
  'e71d28a1-b104-44db-a159-f6af12f314b0',
  'e71d28a1-b104-44db-a159-f6af12f314b1',
]
const row = (movieId) => ({ movieId, createdAt: '2026-10-26T10:00:00.000Z' })
const movie = (id) => ({
  id: Number(id),
  title: `Fixture Movie ${id}`,
  original_title: `Movie ${id}`,
  release_date: '2020-01-01',
  vote_average: 8.2,
  vote_count: 20,
  overview: 'Fixture overview',
  genre_ids: [28],
  poster_path: '/fixture.jpg',
  backdrop_path: null,
})

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
  const passwordHash = await hashRegistrationPassword(password)
  const database = memoryDatabase(
    ids.map((id, index) => ({
      id,
      name: index ? 'Fixture B' : 'Fixture A',
      email: index ? 'b@fixture.test' : 'a@fixture.test',
      passwordHash,
      createdAt: new Date(),
    })),
  )
  const favorites = new Map()
  const key = (userId, movieId) => `${userId}:${movieId}`
  let createDelay = 0,
    failCreate = false,
    failDelete = false,
    failGet = false
  let failMetadata = new Set(),
    activeMetadata = 0,
    peakMetadata = 0
  database.favorite = {
    async create({ data }) {
      if (createDelay) await pause(createDelay)
      if (failCreate)
        throw Object.assign(new Error('fixture DB'), { code: 'P1001' })
      if (favorites.has(key(data.userId, data.movieId)))
        throw Object.assign(new Error('fixture unique'), { code: 'P2002' })
      const record = { ...data, createdAt: new Date() }
      favorites.set(key(data.userId, data.movieId), record)
      return record
    },
    async findUnique({ where }) {
      const { userId, movieId } = where.userId_movieId
      return favorites.get(key(userId, movieId)) ?? null
    },
    async findMany({ where, take }) {
      if (failGet)
        throw Object.assign(new Error('fixture DB'), { code: 'P1001' })
      return [...favorites.values()]
        .filter(
          (record) =>
            record.userId === where.userId &&
            (!where.OR ||
              where.OR.some((condition) =>
                condition.createdAt?.lt
                  ? record.createdAt < condition.createdAt.lt
                  : record.createdAt.getTime() ===
                      condition.createdAt.getTime() &&
                    record.movieId < condition.movieId.lt,
              )),
        )
        .sort((a, b) => b.createdAt - a.createdAt || b.movieId - a.movieId)
        .slice(0, take)
    },
    async deleteMany({ where }) {
      if (failDelete)
        throw Object.assign(new Error('fixture DB'), { code: 'P1001' })
      return {
        count: favorites.delete(key(where.userId, where.movieId)) ? 1 : 0,
      }
    },
  }
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
    favorites: {
      ipLimiter: createRegisterLimiter({ limit: 2000 }),
      userLimiter: createRegisterLimiter({ limit: 2000 }),
    },
    tmdb: {
      token: 'fixture',
      fetchImpl: async (url) => {
        if (url.pathname.includes('/genre/'))
          return Response.json({ genres: [{ id: 28, name: 'Hành động' }] })
        if (/\/movie\/\d+$/.test(url.pathname)) {
          const id = Number(url.pathname.split('/').pop())
          peakMetadata = Math.max(peakMetadata, ++activeMetadata)
          await pause(25)
          activeMetadata--
          if (failMetadata.has(id))
            return Response.json(
              { status_message: 'fixture missing' },
              { status: 404 },
            )
          return Response.json({
            ...movie(id),
            genres: [{ id: 28, name: 'Hành động' }],
            production_countries: [],
            videos: { results: [] },
            recommendations: { page: 1, results: [movie(42)] },
            credits: { cast: [], crew: [] },
          })
        }
        return Response.json({ page: 1, results: [movie(550), movie(27205)] })
      },
    },
  })
  let vite, browser
  const checkpoints = []
  const passed = (name) => {
    checkpoints.push(name)
    console.log(`PASS ${name}`)
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
    await context.route('https://image.tmdb.org/**', (route) =>
      route.fulfill({
        path: path.resolve('frontend/public/images/movies/inception.jpg'),
      }),
    )
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = [],
      requests = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (request.url().includes('/api/favorites'))
        requests.push({
          method: request.method(),
          path: new URL(request.url()).pathname,
          csrf: request.headers()['x-cineverse-csrf'],
        })
    })
    const card = () => page.locator('.movie-card').first()
    const heart = () => card().getByRole('button')
    const selected = () =>
      page.waitForFunction(
        () =>
          document
            .querySelector('.movie-card .favorite-button')
            ?.getAttribute('aria-pressed') === 'true',
      )
    const unselected = () =>
      page.waitForFunction(
        () =>
          document
            .querySelector('.movie-card .favorite-button')
            ?.getAttribute('aria-pressed') === 'false',
      )
    const login = async (email = 'a@fixture.test') => {
      await page.getByLabel('Email', { exact: true }).fill(email)
      await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    }
    await page.goto(`${base}/favorites`)
    await page
      .getByRole('heading', { name: 'Một góc điện ảnh dành riêng cho bạn.' })
      .waitFor()
    assert.equal(requests.length, 0)
    await page.goto(base)
    await heart().waitFor()
    await heart().click()
    await page.waitForURL('**/login')
    assert.equal(requests.filter((r) => r.method === 'POST').length, 0)
    await login()
    await page.waitForURL(base + '/')
    await unselected()
    passed('guest: protected prompt, heart → Login, no POST; safe return route')

    createDelay = 180
    const post = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/favorites') &&
        response.request().method() === 'POST',
    )
    const beforePosts = requests.filter((r) => r.method === 'POST').length
    await heart().click()
    assert.equal(await heart().isDisabled(), true)
    await heart().evaluate((button) => {
      button.click()
      button.click()
    })
    assert.equal((await post).status(), 201)
    await selected()
    assert.equal(
      requests.filter((r) => r.method === 'POST').length - beforePosts,
      1,
    )
    assert.equal(page.url(), base + '/')
    createDelay = 0
    await card().locator('.movie-card-link').click()
    await page
      .getByRole('heading', {
        name: 'Fixture Movie 550',
        exact: true,
        level: 1,
      })
      .waitFor()
    assert.equal(
      await page
        .locator('.details-copy .favorite-button')
        .getAttribute('aria-pressed'),
      'true',
    )
    await page.locator('.details-copy .favorite-button').click()
    await page.waitForFunction(
      () =>
        document
          .querySelector('.details-copy .favorite-button')
          ?.getAttribute('aria-pressed') === 'false',
    )
    await page.goBack()
    await unselected()
    passed(
      'POST 201, pending lock/rapid click; heart does not navigate; Card ↔ Details/Back sync; DELETE 204',
    )

    // Request thành công ở server trước đó nhưng local state chưa thấy: POST 200 vẫn đồng bộ đúng.
    favorites.set(key(ids[0], 550), {
      userId: ids[0],
      movieId: 550,
      createdAt: new Date(),
    })
    const duplicate = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/favorites') &&
        response.request().method() === 'POST',
    )
    await heart().click()
    assert.equal((await duplicate).status(), 200)
    await selected()
    failDelete = true
    await heart().click()
    await page.locator('.favorites-notice').waitFor()
    await selected()
    failDelete = false
    await heart().click()
    await unselected()
    failCreate = true
    await heart().click()
    await page.locator('.favorites-notice').waitFor()
    await unselected()
    failCreate = false
    await heart().click()
    await selected()
    passed(
      'duplicate POST 200; POST/DELETE 503 giữ nguyên heart, không báo thành công sai',
    )

    await page.getByRole('link', { name: 'Yêu thích', exact: true }).click()
    await page.locator('.favorites-grid .movie-card').waitFor()
    await page.reload()
    await page.locator('.favorites-grid .movie-card').waitFor()
    assert.equal(
      await page.locator('.favorite-button').getAttribute('aria-pressed'),
      'true',
    )
    await page.locator('.favorite-button').click()
    await page
      .getByRole('link', { name: 'Khám phá phim', exact: true })
      .waitFor()
    passed(
      '/favorites metadata/grid, session cookie refresh, remove updates empty state',
    )

    // Nhiều trang thật qua native route + mock Prisma, 404 một phim không phá cả collection.
    favorites.clear()
    for (let id = 1; id <= 205; id++)
      favorites.set(key(ids[0], id), {
        userId: ids[0],
        movieId: id,
        createdAt: new Date('2026-10-26T10:00:00.000Z'),
      })
    failMetadata = new Set([205])
    peakMetadata = 0
    const beforeGet = requests.filter((r) => r.method === 'GET').length
    await page.reload()
    await page.getByText('205 phim đã lưu', { exact: false }).waitFor()
    await page
      .locator('.favorites-grid > li')
      .nth(23)
      .locator('.movie-card')
      .waitFor()
    assert.equal(
      requests.filter((r) => r.method === 'GET').length - beforeGet,
      3,
    )
    assert.equal(await page.locator('.favorites-grid > li').count(), 24)
    await page.locator('.favorites-unavailable').waitFor()
    assert.equal(await page.locator('.favorites-grid .movie-card').count(), 23)
    assert.ok(peakMetadata <= 4)
    failMetadata.clear()
    await page.getByRole('button', { name: 'Thử lại thông tin phim' }).click()
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.favorites-grid .movie-card').length === 24,
    )
    await page
      .getByRole('button', { name: 'Xem thêm phim', exact: true })
      .click()
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.favorites-grid .movie-card').length === 48,
    )
    passed(
      '205 IDs/3 cursor pages; metadata 4 workers, 24 then 48 rows; partial 404/retry',
    )

    await fs.mkdir('.npm-cache/phase-6.3c-screenshots', { recursive: true })
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      )
      const button = page.locator('.favorite-button').first()
      const bounds = await button.boundingBox()
      assert.ok(bounds.width >= 44 && bounds.height >= 44)
      await page.keyboard.press('Tab')
      await button.focus()
      assert.equal(
        await button.evaluate((element) => element.matches(':focus-visible')),
        true,
      )
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: 'instant' }),
      )
      await page.screenshot({
        path: `.npm-cache/phase-6.3c-screenshots/favorites-${width}.png`,
        fullPage: false,
      })
    }
    passed(
      'responsive 375/768/1024/1440px, no horizontal overflow, 44px touch targets, keyboard focus',
    )

    // Đổi sang B bằng auth UI sau Logout: state A biến mất, metadata cũng không rò sang B.
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.getByRole('button', { name: 'Tài khoản của Fixture A' }).click()
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
    await page
      .getByRole('heading', { name: 'Một góc điện ảnh dành riêng cho bạn.' })
      .waitFor()
    assert.equal(await page.locator('.movie-card').count(), 0)
    await page
      .locator('.favorites-message')
      .getByRole('link', { name: 'Đăng nhập', exact: true })
      .click()
    await login('b@fixture.test')
    await page.waitForURL('**/favorites')
    await page
      .getByRole('link', { name: 'Khám phá phim', exact: true })
      .waitFor()
    assert.equal(await page.locator('.movie-card').count(), 0)
    passed(
      'Logout clears collection; Login B returns /favorites, empty state contains no A data',
    )

    failGet = true
    await page.reload()
    await page
      .getByRole('heading', { name: 'Chưa thể tải bộ sưu tập' })
      .waitFor()
    failGet = false
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
    await page
      .getByRole('link', { name: 'Khám phá phim', exact: true })
      .waitFor()
    assert.ok(
      requests
        .filter((r) => ['POST', 'DELETE'].includes(r.method))
        .every((r) => r.csrf === '1'),
    )
    assert.deepEqual(
      await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      })),
      { local: [], session: [] },
    )
    assert.deepEqual(errors, [])
    passed(
      'GET 503/error/Retry; mutations share CSRF; no favorites/token in storage; no page errors',
    )
    await page.close()

    // Provider race tests: real Auth calls + controlled Favorites response, không tôn trọng AbortSignal.
    const harness = await context.newPage()
    harness.setDefaultTimeout(10000)
    const start = async () => {
      await harness.goto(
        `${base}/tests/favoritesProvider.browser.html?ignoreAbort`,
      )
      await harness.waitForFunction(
        () => document.querySelector('#status')?.textContent !== 'loading',
      )
    }
    await start()
    const text = (id) => harness.locator(`#${id}`).textContent()
    const waitText = (id, value) =>
      harness.waitForFunction(
        ({ id, value }) => document.getElementById(id)?.textContent === value,
        { id, value },
      )
    // Đang ở B; giữ GET A, sau đó login B trước khi GET A trả về.
    let releaseA, sawA
    const aGate = new Promise((resolve) => {
      sawA = resolve
    })
    let getCount = 0
    await harness.route('**/api/favorites', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      getCount++
      if (getCount === 1) {
        sawA()
        await new Promise((resolve) => {
          releaseA = resolve
        })
        return route.fulfill({
          json: { favorites: [row(111)], nextCursor: null },
        })
      }
      return route.fulfill({
        json: { favorites: [row(222)], nextCursor: null },
      })
    })
    await harness.getByRole('button', { name: 'Login A', exact: true }).click()
    await aGate
    await waitText('status', 'loading')
    assert.equal(await text('ids'), '')
    await harness.getByRole('button', { name: 'Login B', exact: true }).click()
    await waitText('ids', '222')
    releaseA()
    await pause(150)
    assert.equal(await text('ids'), '222')
    assert.equal(
      await harness.evaluate(() => document.documentElement.dataset.aborted),
      'true',
    )
    await harness.unroute('**/api/favorites')
    passed(
      'race: old GET A ignored after Login B even when fetch ignores abort',
    )

    let releasePost, postSeen
    const postGate = new Promise((resolve) => {
      postSeen = resolve
    })
    let postCalls = 0
    await harness.route('**/api/favorites', async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { favorites: [], nextCursor: null } })
      postCalls++
      postSeen()
      await new Promise((resolve) => {
        releasePost = resolve
      })
      return route.fulfill({ status: 201, json: { favorite: row(550) } })
    })
    await harness.getByRole('button', { name: 'Reload', exact: true }).click()
    await waitText('status', 'ready')
    await harness
      .getByRole('button', { name: 'Add twice', exact: true })
      .click()
    await postGate
    await waitText('pending', '550')
    assert.equal(postCalls, 1)
    await harness.getByRole('button', { name: 'Logout', exact: true }).click()
    await waitText('owner', 'guest')
    await waitText('ids', '')
    releasePost()
    await pause(150)
    assert.equal(await text('ids'), '')
    await harness.unroute('**/api/favorites')
    passed(
      'race: synchronous same-ID lock; late mutation after Logout ignored and pending cleared',
    )

    // Loading chưa được coi là not-favorite, 401 chỉ refresh Me một lần và kết thúc guest.
    let calls401 = 0
    await harness.route('**/api/favorites', (route) => {
      calls401++
      database.sessions.clear()
      return route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED' } },
      })
    })
    const unauthorized = harness.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/favorites' &&
        response.status() === 401,
    )
    await harness.getByRole('button', { name: 'Login A', exact: true }).click()
    await unauthorized
    await waitText('status', 'guest')
    await waitText('owner', 'guest')
    assert.equal(calls401, 1)
    await harness.unroute('**/api/favorites')
    passed(
      '401 expires shared session via one Me refresh, no retry loop; no old Favorite IDs',
    )

    // 401 ở một mutation phải vô hiệu hóa cả mutation khác đang bay, trước khi Me trả về.
    let release401, releaseOther, releaseMe
    let otherSeen
    const otherGate = new Promise((resolve) => {
      otherSeen = resolve
    })
    await harness.route('**/api/favorites', async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { favorites: [], nextCursor: null } })
      if (route.request().postDataJSON().movieId === 550) {
        await new Promise((resolve) => {
          release401 = resolve
        })
        return route.fulfill({
          status: 401,
          json: { error: { code: 'UNAUTHENTICATED' } },
        })
      }
      otherSeen()
      await new Promise((resolve) => {
        releaseOther = resolve
      })
      return route.fulfill({ status: 201, json: { favorite: row(551) } })
    })
    await harness.getByRole('button', { name: 'Login A', exact: true }).click()
    await waitText('status', 'ready')
    await harness.route('**/api/auth/me', async (route) => {
      await new Promise((resolve) => {
        releaseMe = resolve
      })
      return route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED' } },
      })
    })
    await harness
      .getByRole('button', { name: 'Add twice', exact: true })
      .click()
    await waitText('pending', '550')
    await harness
      .getByRole('button', { name: 'Add other', exact: true })
      .click()
    await otherGate
    const mePending = harness.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/auth/me',
    )
    release401()
    await mePending
    await waitText('error', 'UNAUTHENTICATED')
    await waitText('pending', '')
    releaseOther()
    await pause(150)
    assert.equal(await text('ids'), '')
    assert.equal(await text('status'), 'error')
    releaseMe()
    await waitText('status', 'guest')
    await harness.unroute('**/api/auth/me')
    await harness.unroute('**/api/favorites')
    passed(
      'mutation 401 cancels all pending IDs; another late success cannot repopulate expired session',
    )
    await harness.close()
    console.log(
      `PASS ${checkpoints.length} Favorites browser checkpoints; native HTTP/DB mock only`,
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
