// node frontend/tests/movieDetails.browser.cjs <path-to-playwright> [--live]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.argv[2] || 'playwright')
const base = process.env.CINEVERSE_TEST_URL || 'http://localhost:5173'
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const genres = [
  { id: 28, name: 'Hành động' },
  { id: 878, name: 'Khoa học viễn tưởng' },
]
const first = {
  id: 27205,
  title: 'Kẻ Đánh Cắp Giấc Mơ',
  original_title: 'Inception',
  overview: 'Câu chuyện từ TMDB.',
  release_date: '2010-07-15',
  vote_average: 8.4,
  vote_count: 200,
  poster_path: '/fixture.jpg',
  backdrop_path: '/fixture.jpg',
  genre_ids: [28, 878],
}
const second = {
  id: 42,
  title: 'Phim không ảnh',
  original_title: '',
  overview: '',
  release_date: '',
  vote_average: 0,
  vote_count: 0,
  poster_path: null,
  backdrop_path: null,
  genre_ids: [],
}
const pageBody = { page: 1, results: [first, second] }
function details(id) {
  const movie = id === '27205' ? first : { ...second, id: Number(id) }
  return {
    ...movie,
    genres: id === '27205' ? genres : [],
    runtime: id === '27205' ? 148 : 0,
    status: id === '27205' ? 'Released' : null,
    production_countries:
      id === '27205' ? [{ iso_3166_1: 'US', name: 'United States' }] : [],
    videos: {
      results:
        id === '27205'
          ? [
              {
                id: 'v1',
                key: 'YoHD9XEInc0',
                name: 'Official trailer',
                site: 'YouTube',
                type: 'Trailer',
                official: true,
                iso_639_1: 'en',
              },
            ]
          : [],
    },
    recommendations: {
      page: 1,
      results: id === '27205' ? [first, second, second] : [first],
    },
  }
}
async function fixturePage(browser, options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  const requests = []
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://image.tmdb.org/**', (route) =>
    route.fulfill({
      path: path.resolve('frontend/public/images/movies/inception.jpg'),
    }),
  )
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body>Fixture trailer embed</body></html>',
    }),
  )
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/auth/me')
      return route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED' } },
      })
    requests.push(pathname)
    if (options.handler && (await options.handler(route, pathname))) return
    if (pathname === '/api/genres') return route.fulfill({ json: { genres } })
    if (/\/api\/movies\/(popular|now_playing|top_rated)$/.test(pathname))
      return route.fulfill({ json: pageBody })
    const id = pathname.split('/').pop()
    if (id === '9999')
      return route.fulfill({
        status: 404,
        json: {
          error: { code: 'TMDB_HTTP_404', message: 'Không tìm thấy phim.' },
        },
      })
    return route.fulfill({ json: details(id) })
  })
  return { page, requests, errors }
}
const waitDetails = (page, title = first.title) =>
  page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor()

async function fixtureTests(browser) {
  const { page, requests, errors } = await fixturePage(browser)
  let documentRequests = 0
  page.on('request', (request) => {
    if (
      request.resourceType() === 'document' &&
      request.frame() === page.mainFrame()
    )
      documentRequests++
  })
  await page.goto(base)
  await page.locator('.movie-card').first().waitFor()
  assert.equal(await page.locator('.movie-card').count(), 6)
  const timestamp = await page.locator('.last-updated').textContent()
  const search = page.getByRole('searchbox', { name: 'Tên phim' })
  await search.fill('  INCEPTION  ')
  await page
    .getByRole('combobox', { name: 'Thể loại', exact: true })
    .selectOption('Hành động')
  await page
    .getByRole('combobox', { name: 'Năm phát hành', exact: true })
    .selectOption('2010')
  await page.getByRole('combobox', { name: /Điểm đánh giá/ }).selectOption('8')
  await page
    .getByRole('combobox', { name: 'Sắp xếp', exact: true })
    .selectOption('rating-desc')
  assert.equal(await page.locator('.movie-card').count(), 1)
  const homeRequests = () =>
    requests.filter((url) => /\/(popular|now_playing|top_rated)$/.test(url))
      .length
  const homeBaseline = homeRequests()
  await page.locator('.movie-card-link').first().focus()
  await page.keyboard.press('Enter')
  await waitDetails(page)
  assert.equal(new URL(page.url()).pathname, '/movies/27205')
  assert.equal(
    await page
      .locator('.details-metadata')
      .textContent()
      .then((text) => text.includes('148 phút')),
    true,
  )
  assert.equal(await page.locator('#recommendations .movie-card').count(), 1)
  assert.equal(await page.locator('iframe').count(), 0)
  await page.getByRole('button', { name: 'Xem trailer', exact: true }).click()
  const iframe = page.locator('iframe')
  await iframe.waitFor()
  assert.match(
    await iframe.getAttribute('src'),
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/[a-zA-Z0-9_-]{11}\?autoplay=0/,
  )
  assert.ok(await iframe.getAttribute('title'))
  assert.ok(await iframe.getAttribute('sandbox'))
  const frameBox = await iframe.boundingBox()
  assert.ok(Math.abs(frameBox.width / frameBox.height - 16 / 9) < 0.02)
  await page.getByRole('button', { name: 'Đóng trailer', exact: true }).click()
  assert.equal(await page.locator('iframe').count(), 0)
  await page.locator('#recommendations .movie-card-link').click()
  await waitDetails(page, second.title)
  assert.equal(new URL(page.url()).pathname, '/movies/42')
  await page
    .getByText('Chưa có trailer YouTube hợp lệ', { exact: false })
    .waitFor()
  await page.locator('.details-poster .poster-fallback').waitFor()
  assert.ok(
    (await page.locator('.details-metadata').textContent()).includes(
      'Chưa có thời lượng',
    ),
  )
  assert.ok(
    (await page.locator('.details-score').textContent()).includes(
      '0 lượt đánh giá',
    ),
  )
  await page.goBack()
  await waitDetails(page)
  await page.goBack()
  await page.locator('.last-updated').waitFor()
  assert.equal(await search.inputValue(), '  INCEPTION  ')
  assert.equal(
    await page
      .getByRole('combobox', { name: 'Sắp xếp', exact: true })
      .inputValue(),
    'rating-desc',
  )
  assert.equal(await page.locator('.last-updated').textContent(), timestamp)
  assert.equal(homeRequests(), homeBaseline)
  await page.goForward()
  await waitDetails(page)
  await page.goForward()
  await waitDetails(page, second.title)
  assert.equal(homeRequests(), homeBaseline)
  assert.equal(documentRequests, 1)
  await search.fill('Inception')
  await page.locator('.last-updated').waitFor()
  assert.equal(
    await search.evaluate((input) => document.activeElement === input),
    true,
  )
  assert.equal(new URL(page.url()).pathname, '/')
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click()
  assert.equal(await search.inputValue(), '')
  assert.equal(await page.locator('.movie-card').count(), 6)
  await page.getByRole('link', { name: 'Chi tiết', exact: true }).click()
  await waitDetails(page)
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow ${width}`,
    )
  }
  await page.getByRole('button', { name: 'Mở menu', exact: true }).click()
  assert.equal(
    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Trang chủ', exact: true })
      .isVisible(),
    true,
  )
  await page.keyboard.press('Escape')
  assert.equal(
    await page
      .getByRole('button', { name: 'Mở menu', exact: true })
      .getAttribute('aria-expanded'),
    'false',
  )
  assert.deepEqual(errors, [])
  await page.close()
  console.log(
    'PASS fixture: home search/filters/sort/timestamp; card/hero/related links; Back/Forward; state/cache retained; trailer click-to-load; mobile menu; responsive 1440/768/390/320',
  )

  const direct = await fixturePage(browser)
  await direct.page.goto(base + '/movies/27205')
  await waitDetails(direct.page)
  await direct.page.reload()
  await waitDetails(direct.page)
  assert.equal(
    direct.requests.some((url) =>
      /\/(popular|now_playing|top_rated)$/.test(url),
    ),
    false,
  )
  for (const url of [
    '/movies/invalid',
    '/movies/0',
    '/movies/-1',
    '/movies/2147483648',
  ]) {
    const count = direct.requests.length
    await direct.page.goto(base + url)
    await direct.page
      .getByRole('heading', { name: 'ID phim không hợp lệ' })
      .waitFor()
    assert.equal(direct.requests.length, count)
  }
  for (const url of ['/missing-page', '/movies', '/movies/42/unknown']) {
    await direct.page.goto(base + url)
    await direct.page
      .getByRole('heading', { name: 'Trang này chưa có trong thước phim.' })
      .waitFor()
  }
  await direct.page.goto(base + '/movies/9999')
  await direct.page
    .getByRole('heading', { name: 'Không tìm thấy phim', exact: true })
    .waitFor()
  assert.equal(
    await direct.page.getByRole('button', { name: 'Thử lại' }).count(),
    0,
  )
  assert.deepEqual(direct.errors, [])
  await direct.page.close()
  console.log(
    'PASS fixture: direct URL/refresh, invalid IDs do not request API, missing movie 404, wildcard 404, no unnecessary homepage requests',
  )

  for (const failure of [429, 500, 'network', 'json']) {
    let fail = true
    const test = await fixturePage(browser, {
      handler: async (route, pathname) => {
        if (pathname !== '/api/movies/27205') return false
        await pause(120)
        if (!fail) return false
        if (failure === 'network') await route.abort('failed')
        else if (failure === 'json') await route.fulfill({ body: 'bad JSON' })
        else
          await route.fulfill({
            status: failure,
            json: {
              error: {
                message: 'Lỗi kiểm thử có thể thử lại',
                code: 'FIXTURE',
              },
            },
          })
        return true
      },
    })
    await test.page.goto(base + '/movies/27205')
    await test.page
      .getByRole('status')
      .filter({ hasText: 'Đang tải chi tiết phim' })
      .waitFor()
    await test.page
      .getByRole('heading', { name: 'Chưa thể tải phim' })
      .waitFor()
    fail = false
    await test.page
      .getByRole('button', { name: 'Thử lại', exact: true })
      .click()
    await waitDetails(test.page)
    assert.deepEqual(test.errors, [])
    await test.page.close()
  }
  console.log(
    'PASS fixture: loading, HTTP 429/500, network/malformed JSON errors and Retry',
  )

  const missing = await fixturePage(browser, {
    handler: async (route, pathname) => {
      if (pathname === '/api/genres') {
        await route.fulfill({
          status: 503,
          json: { error: { message: 'Genre unavailable' } },
        })
        return true
      }
      if (pathname === '/api/movies/43') {
        await route.fulfill({
          json: {
            ...details('43'),
            poster_path: '/broken.jpg',
            recommendations: { page: 1, results: [] },
          },
        })
        return true
      }
      return false
    },
  })
  await missing.page.route('https://image.tmdb.org/**/broken.jpg', (route) =>
    route.fulfill({ status: 404, body: '' }),
  )
  await missing.page.goto(base + '/movies/43')
  await waitDetails(missing.page, second.title)
  await missing.page.locator('.details-poster .poster-fallback').waitFor()
  assert.equal(await missing.page.locator('#recommendations').count(), 0)
  assert.deepEqual(missing.errors, [])
  await missing.page.close()
  console.log(
    'PASS fixture: broken poster fallback, empty recommendations hidden, optional genres failure does not block details',
  )

  for (const ignoreAbort of [false, true]) {
    let oldStarted = 0
    let oldFinished = 0
    const race = await fixturePage(browser, {
      handler: async (route, pathname) => {
        if (pathname !== '/api/movies/27205') return false
        oldStarted++
        await pause(700)
        await route.fulfill({ json: details('27205') }).catch(() => {})
        oldFinished++
        return true
      },
    })
    await race.page.goto(
      base +
        '/tests/useMovieDetails.browser.html' +
        (ignoreAbort ? '?ignoreAbort=1' : ''),
    )
    while (!oldStarted) await pause(10)
    const beforeAbort = await race.page.evaluate(() =>
      Number(document.documentElement.dataset.aborted || 0),
    )
    await race.page
      .getByRole('button', { name: 'Phim 42', exact: true })
      .click()
    await race.page.waitForFunction(
      () => document.querySelector('#hook-result').textContent === '42',
    )
    while (oldFinished < oldStarted) await pause(20)
    await pause(100)
    assert.equal(await race.page.locator('#hook-result').textContent(), '42')
    assert.ok(
      await race.page.evaluate(
        (before) =>
          Number(document.documentElement.dataset.aborted || 0) > before,
        beforeAbort,
      ),
    )
    const baseline = race.requests.length
    await race.page.getByRole('button', { name: 'ID sai', exact: true }).click()
    await pause(80)
    assert.equal(race.requests.length, baseline)
    assert.equal(await race.page.locator('#hook-result').textContent(), 'empty')
    await race.page
      .getByRole('button', { name: 'Phim 27205', exact: true })
      .click()
    await pause(80)
    const beforeUnmount = await race.page.evaluate(() =>
      Number(document.documentElement.dataset.aborted || 0),
    )
    await race.page
      .getByRole('button', { name: 'Bật tắt hook', exact: true })
      .click()
    assert.ok(
      await race.page.evaluate(
        (before) =>
          Number(document.documentElement.dataset.aborted || 0) > before,
        beforeUnmount,
      ),
    )
    await race.page.close()
  }
  console.log(
    'PASS hook: ID changes, abort on change/unmount, late responses ignored even when fetch ignores AbortSignal; invalid ID has no requests',
  )
}

async function liveTests(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  })
  const errors = []
  const responses = []
  let browserBearer = false
  let directTmdb = false
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/'))
      browserBearer ||= Boolean(request.headers().authorization)
    directTmdb ||= url.hostname === 'api.themoviedb.org'
  })
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/')) {
      try {
        responses.push({
          status: response.status(),
          text: await response.text(),
        })
      } catch {
        /* StrictMode abort */
      }
    }
  })
  await page.goto(base + '/movies/27205')
  await page
    .locator('.details-original')
    .filter({ hasText: 'Inception' })
    .waitFor({ timeout: 20000 })
  assert.ok(
    (await page.locator('.details-metadata').textContent()).includes(
      '148 phút',
    ),
  )
  await page.waitForFunction(() => {
    const img = document.querySelector('.details-poster img')
    return img && img.complete && img.naturalWidth > 0
  })
  assert.equal(await page.locator('iframe').count(), 0)
  assert.equal(
    await page
      .getByRole('button', { name: 'Xem trailer', exact: true })
      .count(),
    1,
  )
  const recommendation = page
    .locator('#recommendations .movie-card-link')
    .first()
  const nextUrl = await recommendation.getAttribute('href')
  assert.notEqual(nextUrl, '/movies/27205')
  await page.screenshot({ path: '.npm-cache/phase-5-details-desktop.png' })
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `live overflow ${width}`,
    )
  }
  await page.setViewportSize({ width: 390, height: 900 })
  await page.screenshot({ path: '.npm-cache/phase-5-details-mobile.png' })
  await page.getByRole('button', { name: 'Xem trailer', exact: true }).click()
  await page.locator('iframe').waitFor()
  assert.match(
    await page.locator('iframe').getAttribute('src'),
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/[a-zA-Z0-9_-]{11}\?autoplay=0/,
  )
  await page.getByRole('button', { name: 'Đóng trailer', exact: true }).click()
  await recommendation.click()
  await page.waitForURL(base + nextUrl)
  await page.locator('#details-title').waitFor({ timeout: 20000 })
  assert.equal(
    await page.locator('.details-navigation > span').textContent(),
    'TMDB / ' + nextUrl.split('/').pop(),
  )
  await page.goBack()
  await page
    .locator('.details-original')
    .filter({ hasText: 'Inception' })
    .waitFor()
  await page.reload()
  await page
    .locator('.details-original')
    .filter({ hasText: 'Inception' })
    .waitFor()
  await page.goto(base + '/movies/2147483647')
  await page
    .getByRole('heading', { name: 'Không tìm thấy phim', exact: true })
    .waitFor({ timeout: 20000 })
  await page.goto(base)
  await page.locator('.movie-card').first().waitFor({ timeout: 20000 })
  await page.locator('.last-updated').waitFor()
  assert.ok((await page.locator('.movie-card').count()) > 0)
  assert.equal(browserBearer, false)
  assert.equal(directTmdb, false)
  assert.deepEqual(errors, [])
  const env = fs.readFileSync('backend/.env', 'utf8')
  const token = env
    .match(/^TMDB_READ_ACCESS_TOKEN\s*=\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, '')
  assert.ok(token)
  for (const response of responses)
    assert.equal(
      response.text.includes(token),
      false,
      'Credential must not appear in API response',
    )
  const walk = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : [path.join(dir, entry.name)],
      )
  for (const file of [...walk('frontend/src'), ...walk('frontend/dist')])
    assert.equal(
      fs.readFileSync(file, 'utf8').includes(token),
      false,
      'Credential must not appear in frontend source',
    )
  console.log(
    'PASS LIVE: TMDB Inception metadata/poster/trailer data/recommendations, related navigation/Back/refresh, responsive, real TMDB 404; no browser Bearer or credential in source/responses',
  )
  await page.close()
}

;(async () => {
  const browser = await chromium.launch(require('./browser-options.cjs'))
  try {
    await fixtureTests(browser)
    if (process.argv.includes('--live')) await liveTests(browser)
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error.stack)
  process.exitCode = 1
})
