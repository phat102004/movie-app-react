// node frontend/tests/movieCast.browser.cjs <path-to-playwright> [--live]
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require(process.argv[2] || 'playwright')
const base = process.env.CINEVERSE_TEST_URL || 'http://localhost:5173'
const widths = [
  [320, 2],
  [390, 2],
  [768, 3],
  [1024, 4],
  [1440, 6],
]
function body(id) {
  const cast = Array.from({ length: 13 }, (_, order) => ({
    id: 100 + order,
    name: `${id} Actor ${order}`,
    character: `Character ${order}`,
    profile_path:
      order === 1 ? null : order === 2 ? '/broken.jpg' : `/person-${order}.jpg`,
    order,
  })).reverse()
  cast.push({
    id: 101,
    name: 'Duplicate Actor',
    character: 'Duplicate Role',
    profile_path: null,
    order: 99,
  })
  cast.push({
    id: 999,
    name: `${id} Unknown Order`,
    character: '',
    profile_path: null,
  })
  const movie = {
    id,
    title: `Movie ${id}`,
    original_title: `Original ${id}`,
    overview: 'Nội dung kiểm thử.',
    release_date: '2010-07-15',
    runtime: 120,
    vote_average: 8,
    vote_count: 20,
    poster_path: '/poster.jpg',
    backdrop_path: '/backdrop.jpg',
    genres: [{ id: 28, name: 'Hành động' }],
    production_countries: [],
    status: 'Released',
    videos: {
      results: [
        {
          id: 'v1',
          key: 'YoHD9XEInc0',
          name: 'Trailer',
          site: 'YouTube',
          type: 'Trailer',
          official: true,
          iso_639_1: 'en',
        },
      ],
    },
    recommendations: {
      page: 1,
      results: Array.from({ length: 10 }, (_, index) => ({
        id: 6001 + index,
        title: `Movie ${6001 + index}`,
        genre_ids: [28],
        poster_path: '/poster.jpg',
      })),
    },
    credits: {
      cast,
      crew: [
        { id: 1, name: `Director ${id}`, job: 'Director' },
        { id: 2, name: 'Producer', job: 'Producer' },
        { id: 3, name: `Co-director ${id}`, job: 'Director' },
      ],
    },
  }
  if (id === 42) delete movie.credits
  if (id === 43) movie.credits = null
  if (id === 44) movie.credits.cast = 'bad-array'
  if (id === 45)
    movie.credits = {
      cast: [{ id: 7, name: 'Only Actor', order: 0 }],
      crew: false,
    }
  return movie
}
async function setup(browser, width) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    reducedMotion: 'reduce',
  })
  const requests = []
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('same key'))
      errors.push(message.text())
  })
  await page.route('https://image.tmdb.org/**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/broken.jpg')
      ? route.fulfill({ status: 404, body: '' })
      : route.fulfill({
          path: path.resolve('frontend/public/images/movies/inception.jpg'),
        }),
  )
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body>Test embed</body></html>',
    }),
  )
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/auth/me')
      return route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED' } },
      })
    requests.push(pathname)
    return route.fulfill({
      json:
        pathname === '/api/genres'
          ? { genres: [{ id: 28, name: 'Hành động' }] }
          : body(Number(pathname.split('/').pop())),
    })
  })
  return { page, requests, errors }
}
const more = (page) =>
  page.getByRole('button', { name: 'Xem thêm diễn viên', exact: true })
const collapse = (page) =>
  page.getByRole('button', { name: 'Thu gọn dàn diễn viên', exact: true })
const count = (page, length) =>
  page.waitForFunction(
    (length) => document.querySelectorAll('.cast-card').length === length,
    length,
  )
const names = (page) => page.locator('.cast-card h3').allTextContents()

async function fixtures(browser) {
  for (const [width, columns] of widths) {
    const { page, requests, errors } = await setup(browser, width)
    await page.goto(base + '/movies/27205')
    await page
      .getByRole('heading', { name: 'Movie 27205', exact: true })
      .waitFor()
    await count(page, columns)
    assert.deepEqual(
      await names(page),
      Array.from({ length: columns }, (_, index) => `27205 Actor ${index}`),
    )
    assert.equal(
      await page.locator('.cast-character').first().textContent(),
      'Character 0',
    )
    assert.equal(
      await page.locator('.details-directors dd').textContent(),
      'Director 27205, Co-director 27205',
    )
    await page
      .locator('.movie-cast')
      .evaluate((section) =>
        section.scrollIntoView({ block: 'start', behavior: 'instant' }),
      )
    await page.locator('.cast-photo-fallback').first().waitFor()
    const photo = await page.locator('.cast-photo').first().boundingBox()
    assert.ok(Math.abs(photo.width / photo.height - 3 / 4) < 0.01)
    assert.equal(
      await page.locator('.cast-photo img').first().getAttribute('loading'),
      'lazy',
    )
    assert.ok(await page.locator('.cast-photo img').first().getAttribute('alt'))
    const baseline = requests.length
    const recCount = await page.locator('#recommendations .movie-card').count()
    await more(page).focus()
    await page.keyboard.press('Enter')
    await count(page, columns * 2)
    assert.equal(await more(page).getAttribute('aria-expanded'), 'true')
    assert.equal(
      await page.locator('#recommendations .movie-card').count(),
      recCount,
    )
    while (await more(page).count()) await more(page).click()
    await count(page, 14)
    assert.deepEqual(await names(page), [
      ...Array.from({ length: 13 }, (_, index) => `27205 Actor ${index}`),
      '27205 Unknown Order',
    ])
    await page
      .locator('.cast-card')
      .filter({ hasText: '27205 Actor 2' })
      .locator('.cast-photo-fallback')
      .waitFor()
    assert.equal(
      await page
        .locator('.cast-card')
        .last()
        .locator('.cast-character')
        .textContent(),
      'Chưa có thông tin nhân vật',
    )
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute('aria-label') ===
        'Thu gọn dàn diễn viên',
    )
    await page.keyboard.press('Enter')
    await count(page, columns)
    // Focus chuyển ở frame tiếp theo sau khi React commit danh sách mới.
    await page.waitForFunction(() =>
      document.activeElement?.textContent?.includes('Xem thêm diễn viên'),
    )
    assert.equal(requests.length, baseline)
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    )
    const order = await page.evaluate(() =>
      [
        '.details-story',
        '.movie-cast',
        '.details-media',
        '#recommendations',
      ].map(
        (selector) =>
          document.querySelector(selector).getBoundingClientRect().top,
      ),
    )
    assert.ok(
      order.every((top, index) => index === 0 || top > order[index - 1]),
    )
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `PASS cast ${width}px: ${columns} columns, 3:4 photos, order/roles/directors, fallback, row expansion/collapse/focus, no API calls or recommendation changes`,
    )
  }
  const { page, requests, errors } = await setup(browser, 1440)
  await page.goto(base + '/movies/27205')
  await count(page, 6)
  await more(page).click()
  await count(page, 12)
  const baseline = requests.length
  await page
    .locator('#recommendations')
    .getByRole('button', { name: /^Xem thêm phim/ })
    .click()
  assert.equal(await page.locator('#recommendations .movie-card').count(), 10)
  await collapse(page).click()
  await count(page, 6)
  assert.equal(await page.locator('#recommendations .movie-card').count(), 10)
  await more(page).click()
  await count(page, 12)
  for (const [width, columns] of widths) {
    await page.setViewportSize({ width, height: 1000 })
    await count(page, columns * 2)
  }
  assert.equal(requests.length, baseline)
  await page.locator('#recommendations .movie-card-link').first().click()
  await page.getByRole('heading', { name: 'Movie 6001', exact: true }).waitFor()
  await count(page, 6)
  assert.equal((await names(page))[0], '6001 Actor 0')
  assert.equal(await more(page).getAttribute('aria-expanded'), 'false')
  assert.equal(await page.locator('iframe').count(), 0)
  await page.getByRole('button', { name: 'Xem trailer', exact: true }).click()
  await page.locator('iframe').waitFor()
  assert.match(await page.locator('iframe').getAttribute('src'), /autoplay=0/)
  for (const id of [42, 43, 44]) {
    await page.goto(base + '/movies/' + id)
    await page
      .getByRole('heading', { name: 'Movie ' + id, exact: true })
      .waitFor()
    assert.equal(await page.locator('.movie-cast').count(), 0)
    assert.equal(
      await page
        .getByRole('button', { name: 'Xem trailer', exact: true })
        .count(),
      1,
    )
    assert.ok((await page.locator('#recommendations .movie-card').count()) > 0)
  }
  await page.goto(base + '/movies/45')
  await page.getByRole('heading', { name: 'Movie 45', exact: true }).waitFor()
  await count(page, 1)
  assert.equal(await more(page).count(), 0)
  assert.equal(
    await page.locator('.details-directors dd').textContent(),
    'Chưa có thông tin',
  )
  assert.deepEqual(errors, [])
  await page.close()
  console.log(
    'PASS cast: independent recommendation controls, resize, route ID reset, trailer preserved, absent/null/malformed credits, short cast, unknown director',
  )
}

async function live(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  let apiRequests = 0
  let browserBearer = false
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('same key'))
      errors.push(message.text())
  })
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      apiRequests++
      browserBearer ||= Boolean(request.headers().authorization)
    }
  })
  const loaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/movies/27205' &&
      response.status() === 200,
  )
  await page.goto(base + '/movies/27205')
  const data = await (await loaded).json()
  await count(page, 6)
  assert.equal(
    await page.locator('.details-directors dd').textContent(),
    'Christopher Nolan',
  )
  const expected = [...data.credits.cast]
    .sort((a, b) => a.order - b.order)
    .slice(0, 6)
  assert.deepEqual(
    await names(page),
    expected.map((person) => person.name),
  )
  assert.deepEqual(
    await page.locator('.cast-character').allTextContents(),
    expected.map((person) => person.character),
  )
  await page
    .locator('.movie-cast')
    .evaluate((section) =>
      section.scrollIntoView({ block: 'start', behavior: 'instant' }),
    )
  await page.waitForFunction(() => {
    const image = document.querySelector('.cast-photo img')
    return image && image.complete && image.naturalWidth > 0
  })
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll('.cast-photo img, .details-backdrop img'),
    ].every((image) => image.complete && image.naturalWidth > 0),
  )
  await page.screenshot({ path: '.npm-cache/phase-5.6-cast-desktop.png' })
  const baseline = apiRequests
  await more(page).click()
  await count(page, 12)
  await collapse(page).click()
  await count(page, 6)
  assert.equal(apiRequests, baseline)
  await page.setViewportSize({ width: 390, height: 900 })
  await count(page, 2)
  await page
    .locator('.movie-cast')
    .evaluate((section) =>
      section.scrollIntoView({ block: 'start', behavior: 'instant' }),
    )
  await page.screenshot({ path: '.npm-cache/phase-5.6-cast-mobile.png' })
  for (const [width, columns] of widths) {
    await page.setViewportSize({ width, height: 1000 })
    await count(page, columns)
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    )
  }
  assert.equal(browserBearer, false)
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      live: 'PASS',
      movieId: data.id,
      cast: data.credits.cast.length,
      directors: data.credits.crew
        .filter((person) => person.job === 'Director')
        .map((person) => person.name),
      extraApiRequestsFromCastControls: apiRequests - baseline,
    }),
  )
  await page.close()
}

;(async () => {
  const browser = await chromium.launch(require('./browser-options.cjs'))
  try {
    if (!process.argv.includes('--live-only')) await fixtures(browser)
    if (process.argv.includes('--live') || process.argv.includes('--live-only'))
      await live(browser)
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error.stack)
  process.exitCode = 1
})
