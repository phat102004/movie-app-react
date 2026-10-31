// Phase 8C: real production assets, synthetic HTTP only. Never reads .env.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
// Reviewed against actual forced-color screenshots. A new target must be
// investigated rather than silently excluded from the gate as another false positive.
const reviewedForcedContrast = {
  '/login': new Set(['.auth-back', '.auth-eyebrow', '#auth-title', 'em', '.auth-intro > p:nth-child(4)', '.auth-editorial-note']),
  '/profile': new Set(['.profile-identity > .profile-eyebrow', '#profile-title', '.profile-introduction', 'div:nth-child(1) > dt', 'div:nth-child(2) > dt', 'time']),
}

exports.validate = async function ({ browser, base, fixture, axe, layout, baseline }) {
  const output = path.resolve('.npm-cache/phase-8c', baseline ? 'before' : 'after')
  await fs.mkdir(output, { recursive: true })
  const report = { browser: browser.version(), baseline, reflow: [], forcedColors: [], touch: [], checks: [], nativeZoom: null, assistiveTechnology: 'AX tree only; no NVDA/VoiceOver or real mobile device' }
  const check = (name, pass, evidence) => report.checks.push({ name, pass, evidence })
  async function snapshot(page, group, label, metadata = {}) {
    report[group].push({ label, ...metadata, ...await layout(page), ...await axe(page) })
  }
  const routes = [
    ['/', '.movie-card'], ['/movies/27205', '#details-title'], ['/favorites', '.favorites-grid', true],
    ['/login', '.auth-card form'], ['/register', '.auth-card form'], ['/forgot-password', '.auth-card form'],
    ['/reset-password', '.auth-card form'], ['/profile', '#profile-title', true], ['/unknown', '#not-found-title'],
  ]
  try {
    // WCAG reflow geometry: 1280x900 / 2 or / 4. DPR is for physical pixels,
    // not evidence of native browser zoom (media queries use the CSS viewport).
    for (const factor of [2, 4]) {
      for (const [route, ready, member] of routes) {
        const { context, page } = await fixture(1280 / factor, member, {
          viewport: { width: 1280 / factor, height: 900 / factor }, deviceScaleFactor: factor,
        })
        try {
          await page.goto(base + route + (route === '/reset-password' ? '#token=' + 'x'.repeat(43) : ''))
          await page.locator(ready).first().waitFor()
          await snapshot(page, 'reflow', route, { factor, method: 'CSS viewport + DPR, NOT native browser zoom' })
          if (route === '/') {
            const menu = page.locator('#menu-toggle')
            await menu.click()
            await snapshot(page, 'reflow', 'expanded-header', { factor })
            await menu.press('Escape')
            await page.locator('#movie-search').fill('Không có phim nào như thế này')
            await snapshot(page, 'reflow', 'empty-search', { factor })
          }
          if (route === '/profile') {
            await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click()
            await page.locator('#security-currentPassword').waitFor()
            await snapshot(page, 'reflow', 'change-password', { factor })
          }
          if (factor === 4 && ['/login', '/profile', '/'].includes(route))
            await page.screenshot({ path: path.join(output, `reflow-${route.slice(1) || 'home'}.png`), fullPage: true })
        } finally { await context.close() }
      }
      console.info(`UX reflow geometry ${factor * 100}% complete (not native zoom)`)
    }
    {
      const { context, page } = await fixture(1280)
      try {
        await page.goto(base)
        const dimensions = () => page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, visualScale: visualViewport.scale }))
        const before = await dimensions()
        await page.keyboard.press('Control+Equal')
        await pause(100)
        report.nativeZoom = { before, after: await dimensions(), method: 'Ctrl+Equal attempted in headless browser; unchanged geometry means unavailable' }
      } finally { await context.close() }
    }
    for (const route of ['/', '/login', '/profile']) {
      const { context, page, state } = await fixture(375, route !== '/login', { forcedColors: 'active' })
      try {
        if (route === '/') state.favorites = [27205] // One selected and one unselected visible card.
        await page.goto(base + route)
        await page.locator(route === '/' ? '.movie-card' : route === '/login' ? '.auth-card form' : '#profile-title').first().waitFor()
        check(`forced-colors-media-${route}`, await page.evaluate(() => matchMedia('(forced-colors: active)').matches))
        const primary = page.locator('button[type="submit"], .button-primary').first()
        if (await primary.count()) {
          const colors = await primary.evaluate(el => {
            const style = getComputedStyle(el)
            return { border: style.borderTopColor, width: style.borderTopWidth, style: style.borderTopStyle, background: style.backgroundColor, foreground: style.color }
          })
          check(`forced-colors-primary-border-${route}`, colors.border !== colors.background && colors.border !== 'rgba(0, 0, 0, 0)' && colors.width !== '0px' && colors.style !== 'none', colors)
        }
        if (route === '/') {
          const selected = page.locator('.favorite-button[aria-pressed="true"]').first()
          await selected.waitFor()
          await page.locator('.favorite-button[aria-pressed="false"]').first().waitFor()
          const paint = await selected.evaluate(el => ({ pressed: el.getAttribute('aria-pressed'), fill: getComputedStyle(el.querySelector('svg')).fill, unselectedFill: getComputedStyle(document.querySelector('.favorite-button[aria-pressed="false"] svg')).fill, borderStyle: getComputedStyle(el).borderTopStyle }))
          check('forced-colors-favorite-state-noncolor', (paint.fill !== 'none' && paint.fill !== paint.unselectedFill) || paint.borderStyle === 'double', paint)
          await selected.focus()
          check('forced-colors-focus-visible', await selected.evaluate(el => getComputedStyle(el).outlineStyle !== 'none'))
          await snapshot(page, 'forcedColors', 'home-selected-favorite')
          let release
          state.hold = new Promise(resolve => { release = resolve })
          await page.goto(base + '/movies/27205')
          await page.locator('.details-loading [role="status"]').waitFor()
          await snapshot(page, 'forcedColors', 'loading')
          check('forced-colors-loading-text', await page.locator('.details-loading [role="status"]').isVisible())
          state.failure = true
          state.hold = null
          release()
          await page.getByRole('alert').waitFor()
          await snapshot(page, 'forcedColors', 'error-retry')
        }
        if (route === '/login') {
          await page.locator('button[type="submit"]').click()
          await page.locator('#auth-email-error').waitFor()
          check('forced-colors-form-error-text-and-focus', await page.locator('#auth-email').evaluate(el =>
            el.getAttribute('aria-invalid') === 'true' && el.getAttribute('aria-describedby') === 'auth-email-error' && document.activeElement === el))
        }
        if (route === '/profile') {
          await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click()
          await page.locator('#profile-name').waitFor()
        }
        if (route !== '/') await snapshot(page, 'forcedColors', route)
        check(`forced-colors-auto-adjust-${route}`, await page.locator('main').evaluate(el =>
          [...el.querySelectorAll('a,button,input,h1,p,em,dt,time,span')].every(node => getComputedStyle(node).forcedColorAdjust === 'auto')))
        await page.screenshot({ path: path.join(output, `forced-${route.slice(1) || 'home'}.png`), fullPage: true })
      } finally { await context.close() }
    }
    {
      const { context, page, state } = await fixture(375, true, { isMobile: true, hasTouch: true, deviceScaleFactor: 2, viewport: { width: 375, height: 812 } })
      try {
        await page.goto(base)
        await page.locator('.movie-card').first().waitFor()
        await page.locator('#menu-toggle').tap()
        check('touch-menu-opens', await page.locator('#menu-toggle').getAttribute('aria-expanded') === 'true')
        await snapshot(page, 'touch', 'portrait-navigation')
        await page.locator('#menu-toggle').tap()
        await page.locator('.favorite-button').first().tap()
        await page.waitForFunction(() => document.querySelector('.favorite-button')?.getAttribute('aria-pressed') === 'false')
        check('touch-favorite-toggle', true)
        await page.setViewportSize({ width: 812, height: 375 })
        await snapshot(page, 'touch', 'landscape')
        state.member = false
        await page.goto(base + '/register')
        await page.locator('.auth-card form').waitFor()
        await page.setViewportSize({ width: 375, height: 812 })
        await page.locator('input[type="email"]').tap()
        // A reduced layout height is only a keyboard-occlusion stress proxy.
        await page.setViewportSize({ width: 375, height: 380 })
        await page.locator('input[type="email"]').scrollIntoViewIfNeeded()
        check('keyboard-height-proxy-input-reachable', await page.locator('input[type="email"]').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }))
        await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).scrollIntoViewIfNeeded()
        await snapshot(page, 'touch', 'keyboard-height-proxy')
      } finally { await context.close() }
    }
    {
      const { context, page } = await fixture(1024)
      try {
        await page.goto(base)
        await page.locator('.movie-card').first().waitFor()
        const motion = await page.locator('.movie-card img').first().evaluate(el => ({ media: matchMedia('(prefers-reduced-motion: reduce)').matches, transition: getComputedStyle(el).transitionDuration, animation: getComputedStyle(el).animationName }))
        check('reduced-motion', motion.media && motion.transition === '0s' && motion.animation === 'none', motion)
        // At this breakpoint navigation is collapsed; expand it before asking
        // the AX tree for a navigation landmark (hidden DOM must stay absent).
        await page.locator('#menu-toggle').click()
        const cdp = await context.newCDPSession(page)
        const { nodes } = await cdp.send('Accessibility.getFullAXTree')
        const roles = nodes.filter(node => !node.ignored).map(node => node.role?.value)
        check('ax-tree-landmarks', ['banner', 'navigation', 'main', 'contentinfo', 'search'].every(role => roles.includes(role)), [...new Set(roles)])
        await page.keyboard.press('Escape')
        const titleBefore = await page.title()
        // Use a lower catalog row so Back restoration is observable.
        const card = page.locator('.movie-card a').last()
        await card.scrollIntoViewIfNeeded()
        const oldScroll = await page.evaluate(() => scrollY)
        await card.click()
        await page.locator('#details-title').waitFor()
        await pause(100)
        const titleAfter = await page.title()
        check('route-document-title', titleAfter !== titleBefore && titleAfter.includes('Hành trình'), { before: titleBefore, after: titleAfter })
        await page.goBack()
        await page.locator('.movie-card').first().waitFor()
        await pause(250)
        const restored = await page.evaluate(() => scrollY)
        check('back-restores-catalog-scroll', oldScroll > 100 && Math.abs(oldScroll - restored) < 3, { oldScroll, restored })
        await page.goForward()
        await page.locator('#details-title').waitFor()
        check('forward-details', new URL(page.url()).pathname.startsWith('/movies/'))
        if (!baseline) {
          await page.goto(base + '/movies/27206')
          await page.locator('#details-title').waitFor()
          await page.waitForFunction(() => document.title === 'Hành trình điện ảnh 2 | Cineverse')
          check('details-id-changes-title', true)
          await page.goto(base + '/movies/invalid')
          await page.locator('#not-found-title').waitFor()
          check('invalid-movie-title', (await page.title()).includes('ID phim không hợp lệ'))
          for (const [route, name] of [['/login', 'Đăng nhập'], ['/LOGIN/', 'Đăng nhập'], ['/register', 'Đăng ký'], ['/forgot-password', 'Quên mật khẩu'], ['/reset-password', 'Đặt lại mật khẩu']]) {
            await page.goto(base + route)
            await page.locator('.auth-card form, .auth-card .auth-form-error').first().waitFor()
            await page.waitForFunction(expected => document.title === expected + ' | Cineverse', name)
            check(`auth-title-${route}`, (await page.title()) === name + ' | Cineverse')
          }
        }
      } finally { await context.close() }
    }
    if (!baseline) {
      const { context, page, state } = await fixture(1024)
      try {
        state.delay = 1200
        const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/movies/27205')
        await page.goto(base + '/movies/27205')
        await requested
        await page.locator('.details-loading [role="status"]').waitFor()
        await page.locator('.brand').click()
        await page.locator('.movie-card').first().waitFor()
        await pause(200)
        check('late-details-cannot-overwrite-home-title', (await page.title()) === 'Trang chủ | Cineverse')
        await page.goto(base + '/unknown')
        await page.locator('#not-found-title').waitFor()
        check('not-found-title', (await page.title()).includes('Trang này chưa có'))
      } finally { await context.close() }
    }
    // Transport fault injection, never a real TMDB outage or real credentials.
    {
      const { context, page, state } = await fixture(375)
      try {
        state.delay = 900
        await page.goto(base + '/movies/27205')
        await page.getByRole('status').first().waitFor()
        check('slow-network-announcement', true)
        await page.locator('#details-title').waitFor()
        await page.route('**/api/movies/27205', route => route.abort('internetdisconnected'))
        await page.reload()
        await page.getByRole('alert').waitFor()
        check('offline-transport-error', await page.getByRole('button', { name: 'Thử lại', exact: true }).isVisible())
        await page.unroute('**/api/movies/27205')
        state.delay = 0
        await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
        await page.locator('#details-title').waitFor()
        check('retry-recovers', true)
        check('details-title-after-retry', baseline || (await page.title()).includes('Hành trình điện ảnh 1'))
        state.delay = 13_000
        await page.reload()
        await page.getByRole('alert').waitFor({ timeout: 16_000 })
        check('request-deadline-error', await page.getByRole('button', { name: 'Thử lại', exact: true }).isVisible())
        state.delay = 0
        await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
        await page.locator('#details-title').waitFor()
        await page.route('https://image.tmdb.org/**', route => route.abort())
        await page.reload()
        await page.locator('.details-poster .poster-fallback').waitFor()
        check('broken-poster-fallback', true)
      } finally { await context.close() }
    }
    {
      const { context, page, state } = await fixture(375, true)
      try {
        state.favorites = []
        await page.goto(base + '/favorites')
        await page.locator('.favorites-message').waitFor()
        check('empty-favorites', await page.locator('.favorites-message a').isVisible())
        await snapshot(page, 'touch', 'empty-favorites')
      } finally { await context.close() }
    }
    {
      const { context, page } = await fixture(375)
      try {
        await page.route('**/MovieDetailsPage-*.js', route => route.abort())
        await page.goto(base + '/movies/27205')
        await page.locator('#route-error-title').waitFor()
        check('chunk-failure-keeps-shell', await page.locator('.brand').isVisible() && await page.getByRole('button', { name: 'Tải lại trang', exact: true }).isVisible())
        await snapshot(page, 'touch', 'chunk-failure')
      } finally { await context.close() }
    }
  } finally {
    const snapshots = [...report.reflow, ...report.forcedColors, ...report.touch]
    report.summary = {
      snapshots: snapshots.length,
      axeViolations: [...report.reflow, ...report.touch].reduce((sum, item) => sum + item.violations.length, 0),
      // Axe evaluates authored colors, while forced colors replace paints in
      // the browser. Preserve these diagnostics for screenshot/manual review;
      // the ordinary-color suite still runs every contrast rule unchanged.
      forcedColorsContrastReview: report.forcedColors.flatMap(item => item.violations.filter(rule => rule.id === 'color-contrast').map(rule => ({ state: item.label, targets: rule.nodes.map(node => node.target) }))),
      unexpectedForcedContrast: report.forcedColors.flatMap(item => item.violations.filter(rule => rule.id === 'color-contrast').flatMap(rule => rule.nodes.filter(node => !reviewedForcedContrast[item.label]?.has(node.target.join(' '))).map(node => ({ state: item.label, target: node.target })))),
      forcedColorsOtherViolations: report.forcedColors.reduce((sum, item) => sum + item.violations.filter(rule => rule.id !== 'color-contrast').length, 0),
      overflow: snapshots.filter(item => item.overflow).length, checks: report.checks.length, failures: report.checks.filter(item => !item.pass).map(item => item.name),
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    console.info(JSON.stringify(report.summary))
  }
  if (!baseline) {
    assert.equal(report.summary.axeViolations, 0, 'advanced axe checks')
    assert.equal(report.summary.forcedColorsOtherViolations, 0, 'forced colors semantic checks')
    assert.deepEqual(report.summary.unexpectedForcedContrast, [], 'new forced-color contrast diagnostics require review')
    assert.equal(report.summary.overflow, 0, 'advanced reflow')
    assert.deepEqual(report.summary.failures, [], 'advanced UX checkpoints')
  }
}
