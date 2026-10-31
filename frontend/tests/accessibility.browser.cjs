// Production UI audit; synthetic HTTP fixtures only, no .env or real database.
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'playwright')
const baseline = process.argv.includes('--baseline')
const root = path.resolve(process.env.CINEVERSE_A11Y_DIST || 'frontend/dist')
const keyboardOnly = process.argv.includes('--keyboard-only')
const captionOnly = process.argv.includes('--caption-only')
const output = path.resolve('.npm-cache/phase-8b', (baseline ? 'before' : 'after') + (captionOnly ? '-caption' : keyboardOnly ? '-keyboard' : ''))
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const user = { id: 'e71d28a1-b104-44db-a159-f6af12f314b0', name: 'Người yêu điện ảnh Cineverse', email: 'a11y@fixture.test', createdAt: '2026-10-27T10:00:00.000Z' }
const genres = [{ id: 28, name: 'Hành động' }, { id: 878, name: 'Khoa học viễn tưởng' }]
const movies = Array.from({ length: 20 }, (_, index) => ({ id: 27205 + index, title: `Hành trình điện ảnh ${index + 1}`, original_title: `Cinema Journey ${index + 1}`, overview: 'Một câu chuyện điện ảnh được dùng làm dữ liệu kiểm thử giao diện.', release_date: '2010-07-15', vote_average: 8.4, vote_count: 200, poster_path: `/poster${index}.jpg`, backdrop_path: '/backdrop.jpg', genre_ids: [28, 878] }))
const movieDetails = (id) => ({ ...movies.find(movie => movie.id === Number(id)), genres, runtime: 148, status: 'Released', production_countries: [{ iso_3166_1: 'US', name: 'United States' }], videos: { results: [] }, recommendations: { page: 1, results: movies.slice(1, 6) }, credits: { crew: [{ id: 1, name: 'Đạo diễn Fixture', job: 'Director' }], cast: [{ id: 2, name: 'Diễn viên Fixture', character: 'Nhân vật', order: 0, profile_path: '/cast.jpg' }] } })

async function main() {
  await fs.mkdir(output, { recursive: true })
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture.test')
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html')
    if (!path.extname(file)) file = path.join(root, 'index.html')
    try {
      const body = await fs.readFile(file)
      response.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.jpg': 'image/jpeg' }[path.extname(file)] || 'application/octet-stream' })
      response.end(body)
    } catch { response.writeHead(404); response.end() }
  })
  let browser
  const result = { mode: baseline ? 'baseline' : 'regression', browser: '', layouts: [], keyboard: [], extraStates: [] }
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch(require('./browser-options.cjs'))
    result.browser = browser.version()
    async function fixture(width, member = false) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      const state = { member, user: { ...user }, favorites: [27205, 27206], delay: 0, writeDelay: 0, hold: null, failure: false, writes: [] }
      await page.route('https://image.tmdb.org/**', route => route.fulfill({ path: path.resolve('frontend/public/images/movies/inception.jpg') }))
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()), method = request.method()
        const json = (payload, status = 200) => route.fulfill({ status, json: payload }).catch(() => {})
        if (method !== 'GET') { state.writes.push({ path: url.pathname, method }); if (state.writeDelay) await pause(state.writeDelay) }
        if (url.pathname === '/api/auth/me') return state.member ? json({ user: state.user }) : json({ error: { code: 'UNAUTHENTICATED' } }, 401)
        if (url.pathname === '/api/auth/login') { state.member = true; return json({ user: state.user }) }
        if (url.pathname === '/api/auth/register') return json({ user: state.user }, 201)
        if (url.pathname === '/api/auth/logout') { state.member = false; return route.fulfill({ status: 204 }) }
        if (url.pathname === '/api/auth/forgot-password') return json({ message: 'Nếu email này có tài khoản Cineverse, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.' })
        if (url.pathname === '/api/auth/reset-password') return json({ message: 'Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.' })
        if (url.pathname === '/api/profile/change-password') { state.member = false; return route.fulfill({ status: 204 }) }
        if (url.pathname === '/api/profile') {
          if (method === 'PATCH') state.user.name = request.postDataJSON().name
          return json({ profile: { ...state.user, favoriteCount: state.favorites.length } })
        }
        if (url.pathname === '/api/favorites') {
          if (method === 'POST') { const movieId = request.postDataJSON().movieId; state.favorites.push(movieId); return json({ favorite: { movieId, createdAt: user.createdAt } }, 201) }
          return json({ favorites: state.favorites.map(movieId => ({ movieId, createdAt: user.createdAt })), nextCursor: null })
        }
        if (/^\/api\/favorites\/\d+$/.test(url.pathname)) { state.favorites = state.favorites.filter(id => id !== Number(url.pathname.split('/').pop())); return route.fulfill({ status: 204 }) }
        if (state.hold) await state.hold
        if (state.delay) await pause(state.delay)
        if (state.failure) return json({ error: { code: 'TMDB_UNAVAILABLE' } }, 503)
        if (url.pathname === '/api/genres') return json({ genres })
        if (/^\/api\/movies\/(popular|now_playing|top_rated)$/.test(url.pathname)) return json({ page: 1, results: movies })
        if (/^\/api\/movies\/\d+$/.test(url.pathname)) {
          const details = movieDetails(url.pathname.split('/').pop())
          if (state.noCastImage) details.credits.cast[0].profile_path = null
          return json(details)
        }
        return json({ error: { code: 'NOT_FOUND' } }, 404)
      })
      return { context, page, state }
    }
    async function axe(page) {
      if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
      return page.evaluate(async () => {
        const report = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })
        return { violations: report.violations.map(rule => ({ id: rule.id, impact: rule.impact, nodes: rule.nodes.map(node => ({ target: node.target, contrast: node.any.filter(check => check.id === 'color-contrast').map(check => check.data), labelData: node.any.filter(check => check.id === 'label-content-name-mismatch').map(check => check.data) })) })), incomplete: report.incomplete.map(rule => ({ id: rule.id, count: rule.nodes.length, targets: rule.nodes.map(node => node.target) })) }
      })
    }
    async function layout(page) {
      return page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        offenders: [...document.querySelectorAll('main *, .header-inner, .account-panel')].filter(el => el.getClientRects().length && (el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1)).slice(0, 8).map(el => el.className || el.tagName),
        headings: [...document.querySelectorAll('h1,h2,h3')].map(el => el.tagName),
        smallControls: [...document.querySelectorAll('button:not(:disabled),input,select,.auth-header-login')].filter(el => el.getClientRects().length && (el.getBoundingClientRect().width < 44 || el.getBoundingClientRect().height < 44)).map(el => ({ selector: el.id || el.className, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
        formWidths: [...document.querySelectorAll('main input')].map(el => ({ id: el.id, width: el.getBoundingClientRect().width })),
        controlContrast: [...document.querySelectorAll('input:not(:disabled),select:not(:disabled)')].filter(el => el.getClientRects().length).map(el => {
          const box = el.closest('.auth-password-input,.profile-password-input,.search-bar') || el
          const background = (element) => {
            for (let node = element; node; node = node.parentElement) {
              const color = getComputedStyle(node).backgroundColor
              if (color !== 'rgba(0, 0, 0, 0)') return color
            }
            return 'rgb(255, 255, 255)'
          }
          const luminance = color => {
            const c = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
            return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
          }
          const contrast = color => {
            const a = luminance(getComputedStyle(box).borderBottomColor), b = luminance(color)
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
          }
          return { id: el.id || el.tagName, ratio: Math.min(contrast(background(box)), contrast(background(box.parentElement))) }
        }),
        welcomeHeight: document.querySelector('.auth-page--welcome .auth-intro')?.getBoundingClientRect().height,
        posterRatio: document.querySelector('.movie-poster') ? (() => { const r = document.querySelector('.movie-poster').getBoundingClientRect(); return r.width / r.height })() : null,
      }))
    }
    const routes = [
      ['/', '.hero-backdrop'], ['/movies/27205', '#details-title'], ['/favorites', '.favorites-grid .movie-card', true],
      ['/login', '.auth-card form'], ['/register', '.auth-card form'], ['/forgot-password', '.auth-card form'],
      ['/reset-password', '.auth-card form'], ['/profile', '#profile-title', true], ['/not-found', '#not-found-title'], ['/movies/invalid', '#not-found-title'],
    ]
    for (const width of keyboardOnly || captionOnly ? [] : [320, 375, 768, 1024, 1440]) {
      for (const [route, selector, member] of routes) {
        const { context, page } = await fixture(width, member)
        try {
          await page.goto(base + route + (route === '/reset-password' ? '#token=' + 'x'.repeat(43) : ''))
          await page.locator(selector).first().waitFor()
          await pause(80)
          result.layouts.push({ width, route, ...await layout(page), ...await axe(page) })
          if ((route === '/login' || route === '/profile' || route === '/') && (width === 320 || width === 1440))
            await page.screenshot({ path: path.join(output, `${width}-${route.replaceAll('/', '') || 'home'}.png`) })
          if (route === '/profile') {
            await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).press('Enter')
            await page.locator('#profile-name:focus').waitFor()
            result.extraStates.push({ width, state: 'profile-edit', ...await layout(page), ...await axe(page) })
            await page.keyboard.press('Escape')
            await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).press('Space')
            await page.locator('#security-currentPassword:focus').waitFor()
            result.extraStates.push({ width, state: 'change-password', ...await layout(page), ...await axe(page) })
          }
        } finally { await context.close() }
      }
      const { context, page } = await fixture(width, true)
      try {
        await page.goto(base)
        await page.locator('.movie-card').first().waitFor()
        const toggle = page.locator('#menu-toggle')
        if (await toggle.isVisible()) {
          await toggle.focus()
          await page.keyboard.press('Enter')
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
          await page.keyboard.press('Tab')
          const inside = await page.evaluate(() => !!document.activeElement?.closest('#main-navigation'))
          result.keyboard.push({ width, check: 'mobile-menu-first-tab-reaches-navigation', pass: inside })
          result.extraStates.push({ width, state: 'navigation-open', ...await layout(page), ...await axe(page) })
          await page.keyboard.press('Escape')
          result.keyboard.push({ width, check: 'mobile-menu-escape-returns-trigger', pass: await toggle.evaluate(el => document.activeElement === el) })
        }
        const account = page.locator('.account-toggle')
        await account.focus()
        await page.keyboard.press('Space')
        await page.keyboard.press('Tab')
        result.keyboard.push({ width, check: 'account-first-tab-profile', pass: await page.locator('.account-profile-link').evaluate(el => document.activeElement === el) })
        result.extraStates.push({ width, state: 'account-open', ...await layout(page), ...await axe(page) })
        await page.keyboard.press('Escape')
        result.keyboard.push({ width, check: 'account-escape-focus', pass: await account.evaluate(el => document.activeElement === el) })
      } finally { await context.close() }
      console.info(`Accessibility ${width}px: routes, expanded forms and keyboard probes complete`)
    }
    // Real Tab/Enter/Space interactions; a fixture is used only for the HTTP DTOs.
    async function check(page, width, label, predicate) {
      result.keyboard.push({ width, check: label, pass: await predicate() })
    }
    async function tabTo(page, selector) {
      for (let i = 0; i < 160; i++) {
        if (await page.evaluate(selector => document.activeElement?.matches(selector), selector)) return
        await page.keyboard.press('Tab')
        const focus = await page.evaluate(() => {
          const el = document.activeElement
          if (!el?.matches('a,button,input,select')) return null
          const r = el.getBoundingClientRect(), s = getComputedStyle(el)
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          const wrapper = el.closest('.search-bar,.profile-password-input,.auth-password-input')
          const visible = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 || wrapper && getComputedStyle(wrapper).outlineStyle !== 'none'
          return { target: el.id || el.className, pass: !!visible && !!hit && el.contains(hit) }
        })
        if (focus && !focus.pass) result.keyboard.push({ width: await page.evaluate(() => innerWidth), check: `tab-focus-visible-unobscured:${focus.target}`, pass: false })
      }
      throw new Error('Keyboard target unreachable')
    }
    async function replace(page, text) {
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type(text)
    }
    for (const width of captionOnly ? [] : [320, 1440]) {
      const discovery = await fixture(width, true)
      try {
        const { page, state } = discovery
        await page.goto(base)
        await page.locator('.movie-card').first().waitFor()
        await page.locator('.skip-link').focus()
        await page.keyboard.press('Enter')
        await tabTo(page, '.filter-field select')
        await page.keyboard.press('ArrowDown')
        await check(page, width, 'native-genre-keyboard', () => page.locator('.filter-field select').first().evaluate(el => el.value === 'Hành động'))
        await tabTo(page, '#movie-search')
        await page.keyboard.type('No matching movie')
        await page.locator('.search-empty-state').waitFor()
        result.extraStates.push({ width, state: 'search-empty', ...await layout(page), ...await axe(page) })
        await tabTo(page, '.search-clear')
        await page.keyboard.press('Space')
        await check(page, width, 'clear-search-restores-input-focus', () => page.locator('#movie-search').evaluate(el => document.activeElement === el && el.value === ''))
        await tabTo(page, '.movie-card-link')
        await page.keyboard.press('Enter')
        await page.locator('#details-title').waitFor()
        await check(page, width, 'card-enter-route-focus', () => page.locator('#main-content').evaluate(el => document.activeElement === el))
        await tabTo(page, '.details-copy .favorite-button')
        state.writeDelay = 120
        await page.keyboard.press('Space')
        await page.locator('.details-copy .favorite-button[aria-pressed=false]').waitFor()
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await check(page, width, 'favorite-keyboard-keeps-focus', () => page.locator('.details-copy .favorite-button').evaluate(el => document.activeElement === el))
        result.extraStates.push({ width, state: 'favorite-unselected', ...await layout(page), ...await axe(page) })
        state.writeDelay = 600
        // Reset this isolated scenario even if the baseline lost focus above.
        await page.locator('.details-copy .favorite-button').focus()
        await page.keyboard.press('Space')
        await page.keyboard.press('Tab')
        await page.evaluate(() => { window.__a11yFocus = document.activeElement })
        await page.locator('.details-copy .favorite-button[aria-pressed=true]').waitFor()
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await check(page, width, 'favorite-completion-does-not-steal-focus', () => page.evaluate(() => document.activeElement === window.__a11yFocus && document.activeElement !== document.body))
      } finally { await discovery.context.close() }
      const feedback = await fixture(width)
      try {
        const { page, state } = feedback
        let release
        state.hold = new Promise(resolve => { release = resolve })
        await page.goto(base)
        await page.locator('.skeleton-hero').waitFor()
        result.extraStates.push({ width, state: 'home-loading', ...await layout(page), ...await axe(page) })
        await check(page, width, 'reduced-motion-skeleton', () => page.locator('.skeleton').first().evaluate(el => getComputedStyle(el).animationName === 'none'))
        state.failure = true
        state.hold = null
        release()
        await page.locator('.api-message [role=alert]').waitFor()
        result.extraStates.push({ width, state: 'home-error', ...await layout(page), ...await axe(page) })
        state.failure = false
        await page.locator('.api-message button').focus()
        await page.keyboard.press('Enter')
        await page.locator('.hero-backdrop').waitFor()
        await check(page, width, 'error-retry-keyboard', () => page.locator('.hero-backdrop').isVisible())
      } finally { await feedback.context.close() }
      const { context, page, state } = await fixture(width)
      try {
        await page.goto(base + '/profile')
        await page.locator('#auth-email').waitFor()
        const returnPath = await page.evaluate(() => history.state?.usr?.from)
        await page.locator('.skip-link').focus()
        await page.keyboard.press('Enter')
        await check(page, width, 'skip-link-preserves-return-path', () => page.evaluate(expected => history.state?.usr?.from === expected, returnPath))
        await check(page, width, 'skip-link-focus-main', () => page.locator('#main-content').evaluate(el => document.activeElement === el))
        await tabTo(page, '.auth-submit')
        await page.keyboard.press('Enter')
        await page.locator('#auth-email:focus[aria-invalid=true]').waitFor()
        await check(page, width, 'login-error-described', () => page.locator('#auth-email').evaluate(el => !!document.getElementById(el.getAttribute('aria-describedby'))?.textContent))
        await page.keyboard.type(user.email)
        await tabTo(page, '#auth-password')
        await page.keyboard.type('Synthetic password 123!')
        await tabTo(page, 'button[aria-controls="auth-password"]')
        await page.keyboard.press('Space')
        await check(page, width, 'password-visibility-space', () => page.locator('#auth-password').evaluate(el => el.type === 'text'))
        await tabTo(page, '.auth-submit')
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => document.querySelector('#profile-title,.hero-backdrop'))
        await check(page, width, 'login-returns-profile', async () => new URL(page.url()).pathname === '/profile')
        if (new URL(page.url()).pathname !== '/profile') await page.goto(base + '/profile')
        await page.locator('#profile-title').waitFor()
        await check(page, width, 'login-return-profile-main-focus', () => page.locator('#main-content').evaluate(el => document.activeElement === el))
        await tabTo(page, '.profile-account:not(.profile-security) button')
        await page.keyboard.press('Enter')
        await page.locator('#profile-name:focus').waitFor()
        await replace(page, ' ')
        await tabTo(page, '.profile-edit-form button[type=submit]')
        await page.keyboard.press('Enter')
        await page.locator('#profile-name:focus[aria-invalid=true]').waitFor()
        await replace(page, 'Người yêu điện ảnh')
        await tabTo(page, '.profile-edit-form button[type=submit]')
        await page.keyboard.press('Enter')
        await page.locator('.profile-success').waitFor()
        await page.locator('.profile-account:not(.profile-security) button:focus').waitFor()
        await check(page, width, 'profile-save-and-focus', () => page.locator('.account-toggle').evaluate(el => el.getAttribute('aria-label').includes('Người yêu điện ảnh')))
        await tabTo(page, '.profile-security button')
        await page.keyboard.press('Enter')
        await page.locator('#security-currentPassword:focus').waitFor()
        await tabTo(page, '#change-password-form button[type=submit]')
        await page.keyboard.press('Enter')
        await page.locator('#security-currentPassword:focus[aria-invalid=true]').waitFor()
        result.extraStates.push({ width, state: 'security-validation', ...await layout(page), ...await axe(page) })
        await page.keyboard.type('Synthetic current 123!')
        await tabTo(page, '#security-newPassword')
        await page.keyboard.type('Synthetic replacement 123!')
        await tabTo(page, '#security-confirmPassword')
        await page.keyboard.type('Does not match 123!')
        await tabTo(page, '#change-password-form button[type=submit]')
        await page.keyboard.press('Enter')
        await page.locator('#security-confirmPassword:focus[aria-invalid=true]').waitFor()
        await replace(page, 'Synthetic replacement 123!')
        await tabTo(page, '#change-password-form button[type=submit]')
        await page.keyboard.press('Enter')
        await page.locator('.auth-success').waitFor()
        await check(page, width, 'change-password-keyboard-complete', async () => new URL(page.url()).pathname === '/login' && state.writes.some(row => row.path === '/api/profile/change-password'))
      } finally { await context.close() }
      const registration = await fixture(width)
      try {
        const { page } = registration
        await page.goto(base + '/register')
        await page.locator('#auth-name').waitFor()
        await page.locator('.skip-link').focus()
        await tabTo(page, '.auth-submit')
        await page.keyboard.press('Enter')
        await page.locator('#auth-name:focus[aria-invalid=true]').waitFor()
        for (const [selector, value] of [['#auth-name', user.name], ['#auth-email', user.email], ['#auth-password', 'Synthetic registered 123!'], ['#auth-confirmPassword', 'Synthetic registered 123!']]) {
          await tabTo(page, selector)
          await page.keyboard.type(value)
        }
        await tabTo(page, '.auth-submit')
        await page.keyboard.press('Enter')
        await page.locator('.auth-success').waitFor()
        await check(page, width, 'register-keyboard-complete', async () => new URL(page.url()).pathname === '/login')
        await page.goto(base + '/forgot-password')
        await page.locator('#recovery-email').waitFor()
        await page.locator('.skip-link').focus()
        await tabTo(page, '.auth-submit')
        await page.keyboard.press('Enter')
        await page.locator('#recovery-email:focus[aria-invalid=true]').waitFor()
        await page.keyboard.type(user.email)
        await tabTo(page, '.auth-submit')
        await page.keyboard.press('Enter')
        await page.locator('.auth-success').waitFor()
        await check(page, width, 'forgot-keyboard-status', () => page.locator('.auth-success').evaluate(el => el.getAttribute('role') === 'status'))
        await page.goto(base + '/reset-password#token=' + 'x'.repeat(43))
        await page.locator('#reset-password').waitFor()
        await page.locator('.skip-link').focus()
        await tabTo(page, '#reset-password')
        await page.keyboard.type('Synthetic recovered 123!')
        await tabTo(page, '#reset-confirmPassword')
        await page.keyboard.type('Synthetic recovered 123!')
        await tabTo(page, '.auth-submit')
        await page.keyboard.press('Enter')
        await page.locator('.auth-success').waitFor()
        await check(page, width, 'reset-keyboard-complete-scrubbed-url', async () => !new URL(page.url()).hash)
      } finally { await registration.context.close() }
      const stress = await fixture(width, true)
      try {
        stress.state.user.name = 'Điện ảnh '.repeat(11).trim()
        stress.state.user.email = 'a'.repeat(64) + '@' + 'b'.repeat(60) + '.' + 'c'.repeat(60) + '.' + 'd'.repeat(62) + '.test'
        await stress.page.goto(base + '/profile')
        await stress.page.locator('#profile-title').waitFor()
        result.extraStates.push({ width, state: 'profile-long-metadata', ...await layout(stress.page), ...await axe(stress.page) })
      } finally { await stress.context.close() }
      for (const [route, selector, member] of [['/', '.hero-backdrop', false], ['/register', '.auth-card form', false], ['/profile', '#profile-title', true]]) {
        const spacing = await fixture(width, member)
        try {
          await spacing.page.goto(base + route)
          await spacing.page.locator(selector).first().waitFor()
          await spacing.page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important } p { margin-bottom: 2em !important }' })
          result.extraStates.push({ width, state: `text-spacing:${route}`, ...await layout(spacing.page), ...await axe(spacing.page) })
        } finally { await spacing.context.close() }
      }
    }
    for (const width of [320, 1440]) {
      const fallback = await fixture(width)
      try {
        fallback.state.noCastImage = true
        await fallback.page.goto(base + '/movies/27205')
        await fallback.page.locator('.cast-photo-fallback small').waitFor()
        const colors = await fallback.page.evaluate(() => [getComputedStyle(document.querySelector('.cast-photo-fallback small')).color, getComputedStyle(document.querySelector('.cast-photo')).backgroundColor])
        const luminance = color => {
          const c = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          return c[0] * .2126 + c[1] * .7152 + c[2] * .0722
        }
        const a = luminance(colors[0]), b = luminance(colors[1])
        result.extraStates.push({ width, state: 'cast-no-photo', captionContrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), ...await layout(fallback.page), ...await axe(fallback.page) })
      } finally { await fallback.context.close() }
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2) + '\n')
    const summary = { pages: result.layouts.length, extraStates: result.extraStates.length,
      overflow: [...result.layouts, ...result.extraStates].filter(row => row.overflow).map(row => ({ width: row.width, route: row.route || row.state })),
      violations: [...new Set([...result.layouts, ...result.extraStates].flatMap(row => row.violations.map(rule => rule.id)))],
      lowControlContrast: [...result.layouts, ...result.extraStates].flatMap(row => row.controlContrast.filter(control => control.ratio < 3).map(control => ({ width: row.width, route: row.route || row.state, ...control }))),
      lowCaptionContrast: result.extraStates.filter(row => row.captionContrast < 4.5).map(row => ({ width: row.width, ratio: row.captionContrast })),
      keyboardFailures: result.keyboard.filter(row => !row.pass) }
    console.info(JSON.stringify({ ...summary, lowControlContrast: summary.lowControlContrast.length }))
    if (!baseline) { assert.deepEqual(summary.overflow, []); assert.deepEqual(summary.violations, []); assert.deepEqual(summary.keyboardFailures, []); assert.deepEqual(summary.lowControlContrast, []); assert.deepEqual(summary.lowCaptionContrast, []) }
  } finally {
    if (browser) await browser.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => {
  console.error(require('./browser-diagnostics.cjs').safeBrowserFailure('accessibility.browser.cjs', error))
  process.exitCode = 1
})
