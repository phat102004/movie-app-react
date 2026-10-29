// Production-only lab: synthetic API fixtures; no .env, database or live API calls.
// npm run perf:measure -- --dist frontend/dist --output .npm-cache/phase-8a/after.json
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname, dirname, basename } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback
const dist = resolve(option('--dist', 'frontend/dist'))
const output = resolve(option('--output', '.npm-cache/phase-8a/measurement.json'))
await mkdir(dirname(output), { recursive: true })
const screenshotDirectory = resolve(dirname(output), 'screenshots', basename(output, '.json'))
await mkdir(screenshotDirectory, { recursive: true })
const runs = Number(option('--runs', '3'))
assert.ok(Number.isInteger(runs) && runs > 0 && runs <= 10)
const imageDirectory = resolve('.npm-cache/phase-8a/images')
const imageSources = [
  ['poster', '/1E5baAaEse26fej7uHcjOgEE2t2.jpg', ['w185', 'w342', 'w500', 'w780']],
  ['backdrop', '/s3TBrRGB1iav7gFOCNx3H31MoES.jpg', ['w300', 'w780', 'w1280']],
]
if (process.argv.includes('--prepare-images')) {
  await mkdir(imageDirectory, { recursive: true })
  for (const [kind, path, sizes] of imageSources)
    for (const size of sizes) {
      const response = await fetch(`https://image.tmdb.org/t/p/${size}${path}`, { signal: AbortSignal.timeout(20_000) })
      assert.ok(response.ok && response.headers.get('content-type')?.startsWith('image/'), 'Public image fixture unavailable')
      await writeFile(resolve(imageDirectory, `${kind}-${size}.jpg`), Buffer.from(await response.arrayBuffer()))
    }
  console.info('Public image fixtures cached; no API credentials used.')
  process.exit(0)
}
const imageCache = new Map()
for (const [kind, , sizes] of imageSources)
  for (const size of sizes)
    imageCache.set(`${kind}-${size}`, await readFile(resolve(imageDirectory, `${kind}-${size}.jpg`)))
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const genres = [{ id: 28, name: 'Hành động' }, { id: 878, name: 'Khoa học viễn tưởng' }]
const user = { id: 'e71d28a1-b104-44db-a159-f6af12f314b0', name: 'Performance Fixture', email: 'perf@fixture.test', createdAt: '2026-10-27T10:00:00.000Z' }
const movies = Array.from({ length: 60 }, (_, index) => ({
  id: 27205 + index, title: `Hành trình điện ảnh ${index + 1}`, original_title: `Cinema Journey ${index + 1}`,
  overview: 'Một hành trình khám phá những câu chuyện điện ảnh cùng Cineverse.', release_date: '2010-07-15',
  vote_average: 8.4, vote_count: 200, genre_ids: [28, 878],
  poster_path: `/poster${index}.jpg`, backdrop_path: `/backdrop${index}.jpg`,
}))
const details = (id) => ({ ...movies.find((movie) => movie.id === Number(id)), genres, runtime: 148,
  status: 'Released', production_countries: [{ iso_3166_1: 'US', name: 'United States' }],
  videos: { results: [] }, credits: { cast: [], crew: [] }, recommendations: { page: 1, results: movies.slice(1, 6) },
})
const files = new Map()
async function readDist(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${prefix}${entry.name}`
    if (entry.isDirectory()) await readDist(resolve(directory, entry.name), `${file}/`)
    else {
      const body = await readFile(resolve(directory, entry.name))
      files.set(`/${file}`, { body, gzip: gzipSync(body) })
    }
  }
}
await readDist(dist)
const bundles = [...files].filter(([name]) => /\.(js|css)$/.test(name)).map(([name, value]) => ({
  name, raw: value.body.length, gzip: value.gzip.length, brotli: brotliCompressSync(value.body).length,
}))
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://fixture.test').pathname
  if (path.startsWith('/api/')) {
    const authenticated = request.headers.cookie?.includes('perf_fixture=member')
    let payload, status = 200
    if (path === '/api/auth/me') {
      status = authenticated ? 200 : 401
      payload = authenticated ? { user } : { error: { code: 'UNAUTHENTICATED' } }
    } else if (path === '/api/favorites') payload = { favorites: [27205, 27206, 27207].map((movieId) => ({ movieId, createdAt: user.createdAt })), nextCursor: null }
    else if (path === '/api/profile') payload = { profile: { ...user, favoriteCount: 3 } }
    else if (path === '/api/genres') payload = { genres }
    else if (/^\/api\/movies\/(popular|now_playing|top_rated)$/.test(path)) {
      const offset = path.endsWith('popular') ? 0 : path.endsWith('now_playing') ? 20 : 40
      payload = { page: 1, results: movies.slice(offset, offset + 20) }
    } else if (/^\/api\/movies\/\d+$/.test(path)) payload = details(path.split('/').pop())
    else { status = 404; payload = { error: { code: 'NOT_FOUND' } } }
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(payload))
    return
  }
  const file = files.get(path) ?? (!extname(path) ? files.get('/index.html') : null)
  if (file) {
    response.writeHead(200, {
      'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' }[extname(path)] ?? 'text/html',
      'Content-Encoding': 'gzip', 'Content-Length': file.gzip.length,
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    response.end(file.gzip)
  } else { response.writeHead(404); response.end() }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
const profiles = {
  desktop: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, latency: 40, throughput: 10_000_000 / 8, cpu: 1 },
  mobile: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, latency: 150, throughput: 1_600_000 / 8, cpu: 4 },
}
const browser = await chromium.launch(require('../frontend/tests/browser-options.cjs')).catch((error) => {
  server.close()
  throw error
})
async function fixture(profile, member = false) {
  const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, reducedMotion: 'reduce' })
  if (member) await context.addCookies([{ name: 'perf_fixture', value: 'member', url: base }])
  const page = await context.newPage()
  const requests = [], images = [], errors = []
  page.on('request', (request) => requests.push({ path: new URL(request.url()).pathname, type: request.resourceType() }))
  page.on('pageerror', (error) => errors.push(error.name))
  // Images are public cached fixtures. Simulate per-image latency/bandwidth, not CDN contention.
  // Routing disables browser HTTP cache: every measurement is cold, not warm-cache evidence.
  await page.route('https://image.tmdb.org/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const kind = path.includes('/backdrop') ? 'backdrop' : 'poster'
    const size = path.split('/')[3]
    const body = imageCache.get(`${kind}-${size}`)
    assert.ok(body, `Unknown fixture image size: ${size}`)
    images.push({ path, bytes: body.length })
    await pause(profile.latency + body.length / profile.throughput * 1000)
    await route.fulfill({ contentType: 'image/jpeg', body }).catch(() => {})
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.throughput, uploadThroughput: profile.throughput })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })
  await page.addInitScript(() => {
    window.__perf = { lcp: null, lcpElement: '', cls: 0, events: [], longTasks: [] }
    let session = 0, start = 0, last = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__perf.lcp = entry.startTime
        window.__perf.lcpElement = entry.element?.className || entry.element?.tagName || ''
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue
        if (entry.startTime - last > 1000 || entry.startTime - start > 5000) { session = 0; start = entry.startTime }
        last = entry.startTime
        session += entry.value
        window.__perf.cls = Math.max(window.__perf.cls, session)
      }
    }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.interactionId) window.__perf.events.push(entry.duration)
    }).observe({ type: 'event', durationThreshold: 16, buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perf.longTasks.push(entry.duration)
    }).observe({ type: 'longtask', buffered: true })
  })
  return { context, page, requests, images, errors }
}
const results = { browser: browser.version(), node: process.version, platform: process.platform, generatedAt: new Date().toISOString(), profiles, runs, bundles, home: {}, flows: {}, regression: [] }
try {
  for (const [name, profile] of Object.entries(profiles)) {
    const samples = []
    for (let run = 0; run < runs; run++) {
      const { context, page, requests, images, errors } = await fixture(profile)
      try {
        await page.goto(base)
        await page.locator('.hero-backdrop').waitFor()
        await page.waitForFunction(() => document.querySelector('.hero-backdrop')?.complete)
        await pause(2000)
        const sample = await page.evaluate(() => ({ ...window.__perf,
          resources: performance.getEntriesByType('resource').map((entry) => ({ name: new URL(entry.name).pathname, start: entry.startTime, duration: entry.duration, transfer: entry.transferSize, encoded: entry.encodedBodySize, type: entry.initiatorType })),
          image: [...document.querySelectorAll('img')].filter((img) => img.className === 'hero-backdrop' || img.closest('.movie-card')).slice(0, 6).map((img) => ({ src: img.currentSrc, width: img.getBoundingClientRect().width, naturalWidth: img.naturalWidth, loading: img.loading, priority: img.fetchPriority })),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }))
        sample.requests = [...requests]
        sample.images = [...images]
        await page.screenshot({ path: resolve(screenshotDirectory, `${name}-${run + 1}.png`) })
        const search = page.getByRole('searchbox', { name: 'Tên phim' })
        await search.fill('Cinema Journey ')
        await search.press('1')
        await page.waitForFunction(() => document.querySelectorAll('.movie-card').length === 11)
        await page.getByRole('combobox', { name: 'Sắp xếp', exact: true }).selectOption('rating-desc')
        await pause(300)
        sample.interactionDurations = await page.evaluate(() => window.__perf.events)
        sample.afterSearchRequests = [...requests]
        sample.errors = errors
        assert.equal(sample.overflow, false)
        assert.deepEqual(errors, [])
        samples.push(sample)
      } finally { await context.close() }
    }
    results.home[name] = samples
    console.info(`${name}: ${samples.length} production cold runs complete`)
    const { context, page, requests, errors } = await fixture(profile, true)
    try {
      const snapshots = []
      async function capture(label) {
        await pause(300)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        snapshots.push({ label, requests: [...requests] })
      }
      await page.goto(base)
      await page.locator('.movie-card').first().waitFor()
      await capture('home')
      const split = bundles.some((bundle) => /\/MovieDetailsPage-.*\.js$/.test(bundle.name))
      if (split) assert.equal(requests.some((request) => /MovieDetailsPage-.*\.js$/.test(request.path)), false)
      await page.locator('.movie-card-link').first().click()
      await page.locator('#details-title').waitFor()
      assert.equal(await page.locator('iframe').count(), 0)
      await capture('details')
      if (split) assert.equal(requests.some((request) => /MovieDetailsPage-.*\.js$/.test(request.path)), true)
      await page.goBack()
      await page.locator('.movie-card').first().waitFor()
      await capture('back-home')
      await page.goForward()
      await page.locator('#details-title').waitFor()
      await capture('forward-details')
      // Direct URL/refresh tests exercise static-server SPA fallback and cold lazy chunks.
      for (const [path, selector] of [['/favorites', '.favorites-grid .movie-card'], ['/profile', '.profile-hero'], ['/login', '.auth-page'], ['/register', '.auth-page'], ['/forgot-password', '.auth-page'], ['/reset-password', '.auth-page']]) {
        if (path === '/login') await context.clearCookies()
        await page.goto(base + path)
        await page.locator(selector).first().waitFor()
        await capture(path)
      }
      results.flows[name] = snapshots
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  }
  if (bundles.some((bundle) => /\/MovieDetailsPage-.*\.js$/.test(bundle.name))) {
    const { context, page } = await fixture(profiles.desktop)
    try {
      await page.route('**/assets/MovieDetailsPage-*.js', (route) => route.abort('failed'))
      await page.goto(base)
      await page.locator('.movie-card-link').first().click()
      await page.locator('#route-error-title').waitFor()
      assert.equal(await page.locator('.site-header').isVisible(), true)
      await page.unroute('**/assets/MovieDetailsPage-*.js')
      await page.getByRole('button', { name: 'Tải lại trang', exact: true }).click()
      await page.locator('#details-title').waitFor()
      assert.equal(new URL(page.url()).pathname, '/movies/27205')
      results.regression.push('Failed lazy chunk retains shell; explicit reload recovers direct Details URL')
      await page.route('https://image.tmdb.org/t/p/*/poster0.jpg', (route) => route.abort('failed'))
      await page.goto(base)
      await page.locator('.movie-card').first().locator('.poster-fallback').waitFor()
      results.regression.push('Responsive poster failure retains existing fallback')
    } finally { await context.close() }
  }
  await writeFile(output, JSON.stringify(results, null, 2) + '\n')
  console.info(`Saved ${output}`)
} finally {
  await browser.close()
  await new Promise((done) => server.close(done))
}
