// Production dist served by the real Node static handler; no Vite dev proxy.
// All account/movie HTTP responses are browser fixtures, never a real database.
const assert = require('node:assert/strict')
const path = require('node:path')
const { once } = require('node:events')
const { chromium } = require(process.argv[2] || 'playwright')

async function main() {
  const [{ createAppServer }, { createFrontendHandler }] = await Promise.all([
    import('../../backend/server.mjs'), import('../../backend/frontend.mjs'),
  ])
  const frontend = await createFrontendHandler(path.resolve('frontend/dist'))
  const server = createAppServer({ frontend })
  let browser
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch(require('./browser-options.cjs'))
    const user = { id: '00000000-0000-4000-8000-000000000001', name: 'Hosting Fixture', email: 'hosting@fixture.test', createdAt: '2026-10-28T00:00:00.000Z' }
    const movie = { id: 27205, title: 'Hosting Movie Fixture', original_title: 'Fixture Cinema', overview: 'Fixture plot', release_date: '2010-07-15', vote_average: 8.4, vote_count: 200, genre_ids: [], poster_path: null, backdrop_path: null }
    async function setup() {
      const context = await browser.newContext({ viewport: { width: 375, height: 900 }, reducedMotion: 'reduce' })
      let authenticated = false
      await context.route('https://**/*', route => route.abort())
      await context.route('**/api/**', route => {
        const url = new URL(route.request().url()).pathname
        if (url === '/api/auth/login') { authenticated = true; return route.fulfill({ json: { user } }) }
        if (url === '/api/auth/me') return route.fulfill(authenticated ? { json: { user } } : { status: 401, json: { error: { code: 'UNAUTHENTICATED' } } })
        if (url === '/api/profile') return route.fulfill({ json: { profile: { ...user, favoriteCount: 0 } } })
        if (url === '/api/favorites') return route.fulfill({ json: { favorites: [], nextCursor: null } })
        if (url === '/api/genres') return route.fulfill({ json: { genres: [] } })
        if (url === '/api/movies/27205') return route.fulfill({ json: { ...movie, genres: [], runtime: 148, status: 'Released', production_countries: [], videos: { results: [] }, recommendations: { page: 1, results: [] }, credits: { cast: [], crew: [] } } })
        return route.fulfill({ json: { page: 1, results: [movie] } })
      })
      return context.newPage()
    }
    const page = await setup()
    await page.goto(base)
    await page.locator('.movie-card-link').first().waitFor()
    assert.equal((await page.evaluate(() => performance.getEntriesByType('resource').map(row => row.name))).some(url => /LoginPage-.*\.js/.test(url)), false)
    await page.locator('.movie-card-link').first().click()
    await page.waitForURL('**/movies/27205')
    await page.getByRole('heading', { name: movie.title, exact: true }).waitFor()
    await page.goBack(); await page.waitForURL(base + '/')
    await page.goForward(); await page.waitForURL('**/movies/27205')
    await page.reload()
    await page.getByRole('heading', { name: movie.title, exact: true }).waitFor()
    assert.equal((await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), true)
    await page.goto(base + '/profile')
    await page.waitForURL('**/login')
    await page.getByLabel('Email', { exact: true }).fill(user.email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic hosting browser password!')
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await page.waitForURL('**/profile')
    await page.locator('#profile-title').filter({ hasText: user.name }).waitFor()
    const missing = await page.request.get(base + '/assets/missing-chunk.js')
    assert.equal(missing.status(), 404)
    assert.match(missing.headers()['content-type'], /application\/json/)
    assert.equal((await page.request.get(base + '/backend/.env')).status(), 404)
    assert.equal((await page.request.get(base + '/health/live')).status(), 200)
    const broken = await setup()
    await broken.route('**/assets/MovieDetailsPage-*.js', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await broken.goto(base + '/movies/27205')
    await broken.locator('#route-error-title').waitFor()
    await broken.unroute('**/assets/MovieDetailsPage-*.js')
    await broken.getByRole('button', { name: 'Tải lại trang', exact: true }).click()
    await broken.getByRole('heading', { name: movie.title, exact: true }).waitFor()
    console.log('PASS production Node hosting: lazy routes, movie links, deep-link refresh, Back/Forward, Profile return after Login, mobile reflow, private/missing asset 404 and chunk failure/reload recovery; fixtures only')
  } finally {
    if (browser) await browser.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => {
  console.error(require('./browser-diagnostics.cjs').safeBrowserFailure('hosting.browser.cjs', error))
  process.exitCode = 1
})
