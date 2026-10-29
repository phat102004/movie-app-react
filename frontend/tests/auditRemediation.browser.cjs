// Isolated fixtures only: no local database, real account or live TMDB calls.
const assert = require('node:assert/strict')
const { chromium } = require(process.argv[2] || 'playwright')
const movie = (name = 'Healthy fixture', id = 27205) => ({
  id, title: name, original_title: name, overview: 'Fixture overview',
  release_date: '2010-07-15', vote_average: 8.4, vote_count: 200,
  poster_path: null, backdrop_path: null, genre_ids: [28],
})
const pageBody = name => ({ page: 1, results: [movie(name)] })
const genreBody = { genres: [{ id: 28, name: 'Hành động' }] }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  const { createServer } = await import('../node_modules/vite/dist/node/index.js')
  const vite = await createServer({ root: 'frontend', server: { port: 0, host: '127.0.0.1' } })
  let browser
  let checkpoints = 0
  const check = () => { checkpoints++ }
  try {
    await vite.listen()
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`
    browser = await chromium.launch(require('./browser-options.cjs'))
    async function fixture(handler) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/auth/me') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } })
        if (await handler(route, path)) return
        return route.fulfill({ json: path === '/api/genres' ? genreBody : pageBody() })
      })
      return { page, errors }
    }
    {
      let writes = 0
      const { page } = await fixture(async (_route, path) => {
        if (path === '/api/auth/register') writes++
        return false
      })
      await page.goto(`${base}/register`)
      await page.locator('#auth-name').fill('A\u009fB')
      await page.locator('#auth-email').fill('fixture@example.test')
      await page.locator('#auth-password').fill('SyntheticPassword123!')
      await page.locator('#auth-confirmPassword').fill('SyntheticPassword123!')
      await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click()
      assert.equal(await page.locator('#auth-name').getAttribute('aria-invalid'), 'true')
      assert.equal(await page.locator('#auth-name').evaluate(el => el === document.activeElement), true)
      assert.equal(writes, 0)
      check(); await page.close()
    }
    for (const failed of ['/api/movies/now_playing', '/api/genres']) {
      let failing = true
      const counts = {}
      const { page, errors } = await fixture(async (route, path) => {
        counts[path] = (counts[path] || 0) + 1
        if (path === failed && failing) {
          await route.fulfill({ status: 503, json: { error: { message: 'Fixture unavailable' } } })
          return true
        }
      })
      await page.goto(base)
      const retry = page.getByRole('button', { name: 'Thử lại phần chưa tải' })
      await retry.waitFor()
      await page.getByRole('heading', { name: 'Healthy fixture', exact: true }).first().waitFor()
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      }
      await retry.focus()
      assert.equal(await retry.evaluate(el => el === document.activeElement), true)
      const before = { ...counts }
      failing = false
      await retry.click()
      await page.waitForFunction(() => !document.querySelector('[aria-label="Dữ liệu phim chưa đầy đủ"]'))
      assert.ok(counts[failed] > before[failed])
      for (const path of Object.keys(before)) if (path !== failed) assert.equal(counts[path], before[path])
      assert.deepEqual(errors, [])
      check()
      await page.close()
    }
    {
      const { page } = await fixture(async (route, path) => {
        if (path.startsWith('/api/movies/')) {
          await route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } }); return true
        }
      })
      await page.goto(base)
      await page.getByRole('button', { name: 'Thử lại', exact: true }).waitFor()
      assert.equal(await page.getByRole('heading', { name: 'Healthy fixture' }).count(), 0)
      check(); await page.close()
    }
    {
      const { page } = await fixture(async (route, path) => {
        if (path === '/api/genres') return false
        await route.fulfill(path.endsWith('/popular')
          ? { json: { page: 1, results: [] } }
          : { status: 503, json: { error: { message: 'Unavailable sibling' } } })
        return true
      })
      await page.goto(base)
      await page.getByRole('heading', { name: 'Chưa thể tải phim' }).waitFor()
      await page.getByRole('button', { name: 'Thử lại', exact: true }).waitFor()
      check(); await page.close()
    }
    {
      let optionalMissing = false
      const { page, errors } = await fixture(async (route, path) => {
        if (path !== '/api/movies/27205') return false
        await route.fulfill({ json: {
          ...movie('Details fixture'), genres: genreBody.genres, runtime: 148,
          production_countries: [],
          ...(optionalMissing ? {} : {
            videos: { results: [{ id: 'v', key: 'YoHD9XEInc0', name: 'Fixture trailer', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en' }, {}] },
            recommendations: { page: 1, results: [movie('Related fixture', 42), {}] },
          }),
        } }); return true
      })
      await page.goto(`${base}/movies/27205`)
      await page.getByRole('heading', { name: 'Details fixture', exact: true }).waitFor()
      await page.getByRole('link', { name: /Related fixture/ }).first().waitFor()
      assert.equal(await page.locator('iframe').count(), 0)
      assert.equal(await page.locator('[aria-label="Dữ liệu phim chưa đầy đủ"]').count(), 1)
      optionalMissing = true
      await page.reload()
      await page.getByRole('heading', { name: 'Details fixture', exact: true }).waitFor()
      assert.equal(await page.locator('iframe').count(), 0)
      assert.deepEqual(errors, [])
      check(); await page.close()
    }
    {
      const { page } = await fixture(async () => false)
      await page.addInitScript(() => {
        const schedule = window.setTimeout.bind(window)
        window.setTimeout = (fn, delay, ...args) => schedule(fn, delay === 12000 ? 80 : delay, ...args)
        const original = window.fetch
        window.fetch = (input, options) => String(input).endsWith('/api/movies/popular')
          ? new Promise(() => {}) : original(input, options)
      })
      await page.goto(base)
      await page.getByRole('button', { name: 'Thử lại phần chưa tải' }).waitFor()
      await page.getByText(/phản hồi quá lâu/).first().waitFor()
      await page.getByRole('heading', { name: 'Healthy fixture', exact: true }).first().waitFor()
      check(); await page.close()
    }
    {
      let hold = true
      const pending = []
      const { page, errors } = await fixture(async (route, path) => {
        if (hold) { pending.push({ route, path }); return true }
        await route.fulfill({ json: path === '/api/genres' ? genreBody : pageBody('New response') }); return true
      })
      await page.goto(`${base}/tests/useMovies.browser.html?ignoreAbort`)
      for (let i = 0; i < 100 && pending.length < 4; i++) await wait(20)
      assert.ok(pending.length >= 4)
      hold = false
      await page.getByRole('button', { name: 'Thử lại hook' }).click()
      await page.waitForFunction(() => document.querySelector('#hook-result')?.textContent === 'New response')
      for (const { route, path } of pending) await route.fulfill({ json: path === '/api/genres' ? genreBody : pageBody('Old response') }).catch(() => {})
      await wait(100)
      assert.equal(await page.locator('#hook-result').textContent(), 'New response')
      await page.getByRole('button', { name: 'Bật tắt hook' }).click()
      assert.equal(await page.locator('#hook-status').count(), 0)
      assert.deepEqual(errors, [])
      check(); await page.close()
    }
    console.info(`Audit remediation browser: ${checkpoints} checkpoints passed (partial retry, optional metadata, deadline, stale responses).`)
  } finally {
    await browser?.close()
    await vite.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
