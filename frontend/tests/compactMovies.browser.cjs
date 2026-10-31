// node frontend/tests/compactMovies.browser.cjs <path-to-playwright> [--live]
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require(process.argv[2] || 'playwright')
const base = process.env.CINEVERSE_TEST_URL || 'http://localhost:5173'
const sizes = [
  [320, 2],
  [390, 2],
  [768, 3],
  [1024, 4],
  [1440, 5],
]
const genres = [
  { id: 28, name: 'Hành động' },
  { id: 878, name: 'Khoa học viễn tưởng' },
]
const makeMovies = (start, length) =>
  Array.from({ length }, (_, index) => ({
    id: start + index,
    title: `Phim kiểm thử ${start + index}`,
    original_title: `Story ${start + index}`,
    overview: 'Nội dung dùng riêng trong kiểm thử.',
    release_date: `${2000 + (index % 6)}-07-15`,
    vote_average: 6 + (index % 4),
    vote_count: 100,
    genre_ids: [index % 2 ? 878 : 28],
    poster_path: '/fixture.jpg',
    backdrop_path: '/fixture.jpg',
  }))
const popular = makeMovies(1001, 13)
const recent = makeMovies(2001, 8)
const rated = makeMovies(3001, 2)
const recommendations = makeMovies(4001, 17)
const allMovies = [...popular, ...recent, ...rated]

async function setup(browser, width = 1440) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
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
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/auth/me')
      return route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED' } },
      })
    requests.push(pathname)
    if (pathname === '/api/genres') return route.fulfill({ json: { genres } })
    const lists = { popular, now_playing: recent, top_rated: rated }
    const category = pathname.split('/').pop()
    if (lists[category])
      return route.fulfill({ json: { page: 1, results: lists[category] } })
    const id = Number(category)
    return route.fulfill({
      json: {
        ...popular[0],
        id,
        title: `Chi tiết ${id}`,
        genres,
        runtime: 120,
        status: 'Released',
        production_countries: [],
        videos: { results: [] },
        recommendations: {
          page: 1,
          results:
            id === 42
              ? [recommendations[0]]
              : [{ ...popular[0], id }, ...recommendations, recommendations[0]],
        },
      },
    })
  })
  return { page, requests, errors }
}
const cards = (page, id) => page.locator(`#${id} .movie-card-link`)
const more = (page, id) =>
  page.locator(`#${id}`).getByRole('button', { name: /^Xem thêm phim/ })
const collapse = (page, id) =>
  page.locator(`#${id}`).getByRole('button', { name: /^Thu gọn danh mục/ })
async function waitCount(page, id, count) {
  await page.waitForFunction(
    ({ id, count }) =>
      document.querySelectorAll(`#${id} .movie-card-link`).length === count,
    { id, count },
  )
}
async function waitControlFocus(page, id, prefix) {
  // React commits the card count before MovieList's scheduled focus frame.
  // Wait for the focus outcome too; DOM readiness alone is not sufficient.
  await page.waitForFunction(
    ({ id, prefix }) =>
      document.activeElement?.closest('section')?.id === id &&
      document.activeElement?.getAttribute('aria-label')?.startsWith(prefix),
    { id, prefix },
  )
}
async function ids(page, id) {
  return cards(page, id).evaluateAll((links) =>
    links.map((link) => Number(link.getAttribute('href').split('/').pop())),
  )
}
async function checkLayout(page, id, columns) {
  const layout = await page.locator(`#${id} .movie-grid`).evaluate((grid) => ({
    columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    rows: new Set(
      [...grid.children].map((child) =>
        Math.round(child.getBoundingClientRect().top),
      ),
    ).size,
  }))
  assert.equal(layout.columns, columns)
  assert.equal(layout.rows, 1)
  const poster = await page
    .locator(`#${id} .movie-poster`)
    .first()
    .boundingBox()
  assert.ok(Math.abs(poster.width / poster.height - 2 / 3) < 0.01)
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  )
}

async function fixtures(browser) {
  for (const [width, columns] of sizes) {
    const { page, requests, errors } = await setup(browser, width)
    await page.goto(base)
    await page.locator('.last-updated').waitFor()
    await waitCount(page, 'featured-movies', columns)
    await waitCount(page, 'recent', Math.min(columns, recent.length))
    await waitCount(page, 'popular', 2)
    await checkLayout(page, 'featured-movies', columns)
    assert.equal(await more(page, 'popular').count(), 0)
    const baseline = requests.length
    const timestamp = await page.locator('.last-updated').textContent()
    await more(page, 'featured-movies').focus()
    await page.keyboard.press('Enter')
    await waitCount(page, 'featured-movies', columns * 2)
    assert.equal(
      await more(page, 'featured-movies').getAttribute('aria-expanded'),
      'true',
    )
    assert.equal(
      await cards(page, 'recent').count(),
      Math.min(columns, recent.length),
    )
    assert.deepEqual(
      await ids(page, 'featured-movies'),
      popular.slice(0, columns * 2).map((movie) => movie.id),
    )
    while (await more(page, 'featured-movies').count())
      await more(page, 'featured-movies').click()
    assert.equal(await cards(page, 'featured-movies').count(), popular.length)
    assert.deepEqual(
      await ids(page, 'featured-movies'),
      popular.map((movie) => movie.id),
    )
    await waitControlFocus(page, 'featured-movies', 'Thu gọn danh mục')
    assert.equal(
      await collapse(page, 'featured-movies').evaluate(
        (button) => document.activeElement === button,
      ),
      true,
    )
    await page.keyboard.press('Enter')
    await waitCount(page, 'featured-movies', columns)
    await waitControlFocus(page, 'featured-movies', 'Xem thêm phim')
    assert.equal(
      await more(page, 'featured-movies').evaluate(
        (button) => document.activeElement === button,
      ),
      true,
    )
    assert.ok(
      (await page.evaluate(() => scrollY)) > 0,
      'Collapse must not scroll to page top',
    )
    const box = await more(page, 'featured-movies').boundingBox()
    assert.ok(box.y >= 0 && box.y + box.height <= 1001)
    assert.equal(requests.length, baseline)
    assert.equal(await page.locator('.last-updated').textContent(), timestamp)
    assert.equal(
      await page
        .locator('.movie-poster img')
        .first()
        .evaluate((img) => getComputedStyle(img).transitionDuration),
      '0s',
    )
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `PASS compact ${width}px: ${columns} columns, one row, incremental rows/final partial row, independent sections, collapse/focus/scroll, no API requests`,
    )
  }

  const { page, requests, errors } = await setup(browser)
  await page.goto(base)
  await page.locator('.last-updated').waitFor()
  await more(page, 'featured-movies').click()
  await waitCount(page, 'featured-movies', 10)
  const baseline = requests.length
  for (const [width, columns] of [
    ...sizes,
    [639, 2],
    [640, 3],
    [959, 3],
    [960, 4],
    [1279, 4],
    [1280, 5],
  ]) {
    await page.setViewportSize({ width, height: 1000 })
    await waitCount(page, 'featured-movies', columns * 2)
    await waitCount(page, 'recent', columns)
    assert.equal(
      await page
        .locator('#featured-movies .movie-grid')
        .evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        ),
      columns,
    )
  }
  assert.equal(requests.length, baseline)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const search = page.getByRole('searchbox', { name: 'Tên phim' })
  await search.fill('  STORY  ')
  await waitCount(page, 'search-results', allMovies.length)
  assert.equal(
    await page.locator('#search-results .movie-list-controls').count(),
    0,
  )
  assert.match(await page.locator('.search-feedback').textContent(), /23 \/ 23/)
  await page
    .getByRole('combobox', { name: 'Thể loại', exact: true })
    .selectOption('Hành động')
  await page
    .getByRole('combobox', { name: 'Năm phát hành', exact: true })
    .selectOption('2002')
  await page.getByRole('combobox', { name: /Điểm đánh giá/ }).selectOption('8')
  await page
    .getByRole('combobox', { name: 'Sắp xếp', exact: true })
    .selectOption('rating-desc')
  const expected = allMovies
    .filter(
      (movie) =>
        movie.genre_ids.includes(28) &&
        movie.release_date.startsWith('2002') &&
        movie.vote_average >= 8,
    )
    .sort((a, b) => b.vote_average - a.vote_average)
  await waitCount(page, 'search-results', expected.length)
  assert.deepEqual(
    await ids(page, 'search-results'),
    expected.map((movie) => movie.id),
  )
  assert.match(
    await page.locator('.search-feedback').textContent(),
    new RegExp(`${expected.length} / 23`),
  )
  await search.fill('no-result-83ebf4')
  await page
    .getByRole('heading', { name: 'Không tìm thấy phim', exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click()
  await waitCount(page, 'featured-movies', 5)
  assert.equal(await search.inputValue(), '')
  assert.equal(requests.length, baseline)
  assert.deepEqual(errors, [])
  await page.goto(base + '/movies/27205')
  await page
    .getByRole('heading', { name: 'Chi tiết 27205', exact: true })
    .waitFor()
  await waitCount(page, 'recommendations', 5)
  const detailsBaseline = requests.length
  await more(page, 'recommendations').click()
  await waitCount(page, 'recommendations', 10)
  assert.equal(requests.length, detailsBaseline)
  assert.equal((await ids(page, 'recommendations')).includes(27205), false)
  await cards(page, 'recommendations').nth(7).click()
  await page
    .getByRole('heading', { name: 'Chi tiết 4008', exact: true })
    .waitFor()
  await waitCount(page, 'recommendations', 5)
  assert.equal(
    await more(page, 'recommendations').getAttribute('aria-expanded'),
    'false',
  )
  assert.equal((await ids(page, 'recommendations')).includes(4008), false)
  for (const [width, columns] of sizes) {
    await page.setViewportSize({ width, height: 1000 })
    await waitCount(page, 'recommendations', columns)
    await checkLayout(page, 'recommendations', columns)
  }
  await page.goto(base + '/movies/42')
  await page
    .getByRole('heading', { name: 'Chi tiết 42', exact: true })
    .waitFor()
  await waitCount(page, 'recommendations', 1)
  assert.equal(
    await page.locator('#recommendations .movie-list-controls').count(),
    0,
  )
  assert.deepEqual(errors, [])
  await page.close()
  console.log(
    'PASS compact: resize/breakpoint boundaries; full search results/count/filter/sort/reset; related rows/navigation/reset by ID; short lists; no API requests from display controls',
  )
}

async function live(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  let apiRequests = 0
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests++
  })
  await page.goto(base)
  await page.locator('.last-updated').waitFor({ timeout: 20000 })
  await page.waitForFunction(() => {
    const image = document.querySelector('.hero-backdrop')
    return image?.tagName === 'IMG'
      ? image.complete && image.naturalWidth > 0
      : Boolean(image)
  })
  const heights = {}
  heights.homeDesktop = await page.evaluate(
    () => document.documentElement.scrollHeight,
  )
  await page.screenshot({ path: '.npm-cache/phase-5.5-home-desktop.png' })
  const baseline = apiRequests
  await more(page, 'featured-movies').click()
  await waitCount(page, 'featured-movies', 10)
  assert.equal(await cards(page, 'recent').count(), 5)
  await collapse(page, 'featured-movies').click()
  await waitCount(page, 'featured-movies', 5)
  assert.equal(apiRequests, baseline)
  await page
    .locator('#featured-movies')
    .evaluate((section) =>
      section.scrollIntoView({ block: 'start', behavior: 'instant' }),
    )
  await page.waitForFunction(() => {
    const image = document.querySelector('#featured-movies img')
    return !image || (image.complete && image.naturalWidth > 0)
  })
  await page.screenshot({ path: '.npm-cache/phase-5.5-movies-desktop.png' })
  await page.setViewportSize({ width: 390, height: 900 })
  await waitCount(page, 'featured-movies', 2)
  await page
    .locator('#featured-movies')
    .evaluate((section) =>
      section.scrollIntoView({ block: 'start', behavior: 'instant' }),
    )
  await page.screenshot({ path: '.npm-cache/phase-5.5-movies-mobile.png' })
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await page.screenshot({ path: '.npm-cache/phase-5.5-home-mobile.png' })
  await page.goto(base + '/movies/27205')
  await page.locator('#details-title').waitFor({ timeout: 20000 })
  await waitCount(page, 'recommendations', 2)
  await page.waitForFunction(() => {
    const image = document.querySelector('.details-poster img')
    return image && image.complete && image.naturalWidth > 0
  })
  await page.screenshot({ path: '.npm-cache/phase-5.5-details-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await waitCount(page, 'recommendations', 5)
  heights.detailsDesktop = await page.evaluate(
    () => document.documentElement.scrollHeight,
  )
  await page.screenshot({ path: '.npm-cache/phase-5.5-details-desktop.png' })
  const detailsBaseline = apiRequests
  await more(page, 'recommendations').click()
  await waitCount(page, 'recommendations', 10)
  assert.equal(apiRequests, detailsBaseline)
  await collapse(page, 'recommendations').click()
  await waitCount(page, 'recommendations', 5)
  for (const [width, columns] of sizes) {
    await page.setViewportSize({ width, height: 1000 })
    await waitCount(page, 'recommendations', columns)
    await checkLayout(page, 'recommendations', columns)
  }
  assert.deepEqual(errors, [])
  console.log(
    'PASS LIVE compact: TMDB data, independent expansion/collapse, responsive, no extra API calls; ' +
      JSON.stringify(heights),
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
