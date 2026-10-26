// node frontend/tests/authLayout.browser.cjs <path-to-playwright>
// Native Node/Vite + DB mock; SMTP disabled/refused uses the real delivery code.
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { createServer: createTcpServer } = require('node:net')
const path = require('node:path')
const { chromium } = require(process.argv[2] || 'playwright')

async function main() {
  const [
    { createServer: createVite },
    { createAppServer },
    { readAuthConfig },
    { createResetEmailDelivery },
    { memoryDatabase },
  ] = await Promise.all([
    import('../node_modules/vite/dist/node/index.js'),
    import('../../backend/server.mjs'),
    import('../../backend/auth/config.mjs'),
    import('../../backend/auth/reset-email.mjs'),
    import('../../backend/tests/helpers/auth-fixture.mjs'),
  ])
  const database = memoryDatabase([
    {
      id: 'e71d28a1-b104-44db-a159-f6af12f314b0',
      name: 'Layout Fixture',
      email: 'layout@example.test',
      passwordHash: 'unused-fixture-hash',
      createdAt: new Date(),
    },
  ])
  const config = readAuthConfig({})
  let activeDelivery = createResetEmailDelivery({ config, env: {} })
  const server = createAppServer({
    auth: { config, getClient: async () => database },
    passwordReset: {
      getClient: async () => database,
      delivery: {
        ready: () => activeDelivery.ready(),
        send: (mail) => activeDelivery.send(mail),
      },
    },
  })
  let browser, vite
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
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.name))
    const routes = [
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password',
    ]
    for (const width of [320, 375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: width >= 1024 ? 1080 : 900 })
      for (const route of routes) {
        // A synthetic token only enables the reset form; never include it in output/screenshots.
        await page.goto(
          base +
            route +
            (route === '/reset-password' ? '#token=' + 'x'.repeat(43) : ''),
        )
        await page.locator('.auth-card form').waitFor()
        await page.locator('.auth-header-login').waitFor()
        if (route === '/register')
          assert.ok(
            (await page.locator('.auth-intro h1').textContent()).includes(
              'Mỗi câu chuyện bắt đầu từ đây.',
            ),
          )
        if (route === '/login')
          assert.ok(
            (await page.locator('.auth-intro h1').textContent()).includes(
              'mừng bạn',
            ),
          )
        const layout = await page.evaluate(() => {
          const card = document
            .querySelector('.auth-card')
            .getBoundingClientRect()
          const intro = document
            .querySelector('.auth-intro')
            .getBoundingClientRect()
          const section = document
            .querySelector('.auth-page')
            .getBoundingClientRect()
          const footer = document
            .querySelector('.site-footer')
            .getBoundingClientRect()
          const header = document
            .querySelector('header')
            .getBoundingClientRect()
          const styles = getComputedStyle(document.querySelector('.auth-page'))
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            cardWidth: card.width,
            cardBottom: card.bottom,
            cardTop: card.top,
            introWidth: intro.width,
            introHeight: intro.height,
            cardHeight: card.height,
            introBackground: getComputedStyle(
              document.querySelector('.auth-intro'),
            ).backgroundColor,
            introBorderWidth: getComputedStyle(
              document.querySelector('.auth-intro'),
            ).borderTopWidth,
            introTop: intro.top,
            centerDifference: Math.abs(
              (card.top + card.bottom) / 2 - (intro.top + intro.bottom) / 2,
            ),
            footerTop: footer.top,
            footerBottom: footer.bottom,
            sectionBottom: section.bottom,
            sectionWidth: section.width,
            headerBottom: header.bottom,
            columns: styles.gridTemplateColumns.split(' ').length,
            viewportHeight: innerHeight,
            documentHeight: document.documentElement.scrollHeight,
          }
        })
        assert.equal(
          layout.overflow,
          false,
          `${route} ${width}: horizontal overflow`,
        )
        assert.ok(layout.cardWidth <= 441, `${route} ${width}: max card width`)
        assert.ok(
          layout.footerTop >= layout.sectionBottom - 1,
          `${route} ${width}: footer overlap`,
        )
        assert.ok(
          layout.cardTop >= layout.headerBottom,
          `${route} ${width}: header overlap`,
        )
        assert.ok(
          layout.footerBottom >= layout.viewportHeight - 1,
          `${route} ${width}: footer not at bottom`,
        )
        assert.ok(
          layout.documentHeight >= layout.footerBottom - 1,
          `${route} ${width}: clipped page`,
        )
        if (width >= 1024) {
          assert.equal(layout.columns, 2)
          assert.ok(layout.sectionWidth <= 1150)
          assert.ok(layout.cardWidth >= 400)
          const ratio =
            layout.introWidth / (layout.introWidth + layout.cardWidth)
          assert.ok(
            route === '/login' || route === '/register'
              ? Math.abs(ratio - 0.55) < 0.005
              : ratio >= 0.52 && ratio <= 0.55,
          )
          if (route === '/login' || route === '/register')
            assert.ok(Math.abs(layout.introHeight - layout.cardHeight) < 2)
          assert.ok(
            layout.centerDifference < 2,
            `${route} ${width}: columns not centered`,
          )
        } else assert.equal(layout.columns, 1)
        if (route === '/login' || route === '/register') {
          assert.equal(layout.introBackground, 'rgb(76, 93, 70)')
          assert.equal(layout.introBorderWidth, '1px')
          if (width < 1024)
            assert.ok(
              layout.introHeight <= (route === '/register' ? 360 : 340),
              `${width}: welcome banner too tall`,
            )
          const contrast = await page
            .locator('.auth-intro')
            .evaluate((panel) => {
              const luminance = (color) => {
                const rgb = color
                  .match(/[\d.]+/g)
                  .slice(0, 3)
                  .map(Number)
                  .map((value) => {
                    const channel = value / 255
                    return channel <= 0.04045
                      ? channel / 12.92
                      : ((channel + 0.055) / 1.055) ** 2.4
                  })
                return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
              }
              const background = luminance(
                getComputedStyle(panel).backgroundColor,
              )
              return [
                ...panel.querySelectorAll('a, p, h1, em, .auth-editorial-note'),
              ].map((element) => {
                const foreground = luminance(getComputedStyle(element).color)
                return (
                  (Math.max(foreground, background) + 0.05) /
                  (Math.min(foreground, background) + 0.05)
                )
              })
            })
          assert.ok(
            contrast.every((ratio) => ratio >= 4.5),
            `${width}: welcome text contrast`,
          )
        } else {
          assert.equal(layout.introBackground, 'rgba(0, 0, 0, 0)')
          assert.equal(layout.introBorderWidth, '0px')
        }
        if ([320, 1920].includes(width)) {
          // Inputs remain empty; screenshots never contain passwords or token metadata.
          await page.screenshot({
            path: `.npm-cache/phase-6.2e-${route.slice(1)}-${width}.png`,
            fullPage: true,
          })
        }
        if (route === '/login' || route === '/register') {
          await page.screenshot({
            path: `.npm-cache/phase-6.2f-${route.slice(1)}-${width}.png`,
            fullPage: true,
          })
        }
      }
      console.log(
        `PASS auth layout ${width}px: all four pages, columns/card width, vertical alignment, footer, no clipping/overflow`,
      )
    }

    // Keyboard focus: email → password → show/hide → confirm → show/hide → submit.
    await page.goto(base + '/reset-password#token=' + 'x'.repeat(43))
    await page.getByLabel('Mật khẩu mới', { exact: true }).focus()
    await page.keyboard.press('Tab')
    const show = page.getByRole('button', {
      name: 'Hiện mật khẩu mới',
      exact: true,
    })
    assert.equal(
      await show.evaluate((element) => element === document.activeElement),
      true,
    )
    assert.equal(
      await show.evaluate((element) => getComputedStyle(element).outlineStyle),
      'solid',
    )
    await page.keyboard.press('Enter')
    assert.equal(
      await page.locator('#reset-password').getAttribute('type'),
      'text',
    )
    await page.keyboard.press('Tab')
    assert.equal(
      await page
        .locator('#reset-confirmPassword')
        .evaluate((element) => element === document.activeElement),
      true,
    )
    await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click()
    assert.equal(
      await page.locator('#reset-password').getAttribute('aria-describedby'),
      'reset-password-error',
    )
    await page
      .getByLabel('Mật khẩu mới', { exact: true })
      .fill('Synthetic layout password 123!')
    await page
      .getByLabel('Xác nhận mật khẩu mới', { exact: true })
      .fill('Synthetic layout password 123!')
    await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Liên kết không hợp lệ' })
      .waitFor()

    await page.goto(base + '/login')
    await page.getByRole('link', { name: '← Trở về Cineverse' }).focus()
    assert.equal(
      await page
        .locator('.auth-back')
        .evaluate((element) => getComputedStyle(element).outlineColor),
      'rgb(246, 243, 237)',
    )
    await page.getByRole('link', { name: 'Quên mật khẩu?' }).focus()
    assert.equal(
      await page
        .getByRole('link', { name: 'Quên mật khẩu?' })
        .evaluate((element) => getComputedStyle(element).outlineStyle),
      'solid',
    )
    await page.keyboard.press('Enter')
    await page.waitForURL('**/forgot-password')
    await page.getByLabel('Email', { exact: true }).fill('layout@example.test')
    const unavailable = async () => {
      const pending = page.waitForResponse((response) =>
        response.url().endsWith('/api/auth/forgot-password'),
      )
      await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
      const response = await pending
      assert.equal(response.status(), 503)
      assert.equal((await response.json()).error.code, 'EMAIL_UNAVAILABLE')
      await page
        .getByRole('alert')
        .filter({ hasText: 'Dịch vụ gửi thư chưa sẵn sàng' })
        .waitFor()
      assert.equal(await page.locator('.auth-success').count(), 0)
      assert.equal(database.resetTokens.size, 0)
    }
    await unavailable() // Actual backend with disabled email, not a mocked HTTP response.
    const reservation = createTcpServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const closedPort = reservation.address().port
    await new Promise((resolve) => reservation.close(resolve))
    activeDelivery = createResetEmailDelivery({
      config,
      env: {
        PASSWORD_RESET_EMAIL_MODE: 'local',
        PUBLIC_APP_ORIGIN: base,
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(closedPort),
        SMTP_SECURE: 'false',
        SMTP_FROM: 'cineverse@localhost.test',
      },
    })
    await unavailable() // Actual Nodemailer ECONNREFUSED, no SMTP/mail catcher mock.
    for (const [status, code, message] of [
      [400, 'VALIDATION_ERROR', 'email hợp lệ'],
      [429, 'RATE_LIMITED', 'quá nhiều yêu cầu'],
      [503, 'AUTH_UNAVAILABLE', 'Dịch vụ khôi phục tài khoản'],
      [500, 'INTERNAL_ERROR', 'Hệ thống chưa thể xử lý'],
    ]) {
      await page.route('**/api/auth/forgot-password', (route) =>
        route.fulfill({
          status,
          json: { error: { code, message: 'private-fixture' } },
          headers: status === 429 ? { 'Retry-After': '5' } : {},
        }),
      )
      await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
      await page.getByRole('alert').filter({ hasText: message }).waitFor()
      assert.ok(
        !(await page.locator('.auth-card').innerText()).includes(
          'private-fixture',
        ),
      )
      await page.unroute('**/api/auth/forgot-password')
    }
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({ status: 503, body: 'private-fixture' }),
    )
    await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Dịch vụ gửi thư chưa sẵn sàng' })
      .waitFor()
    await page.unroute('**/api/auth/forgot-password')
    await page.route('**/api/auth/forgot-password', (route) =>
      route.abort('failed'),
    )
    await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Không thể kết nối máy chủ' })
      .waitFor()
    await page.unroute('**/api/auth/forgot-password')
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({
        json: {
          message:
            'Nếu email này có tài khoản Cineverse, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.',
        },
      }),
    )
    await page.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click()
    await page
      .getByRole('status')
      .filter({ hasText: 'Nếu email này có tài khoản Cineverse' })
      .waitFor()
    assert.equal(await page.locator('.auth-form-error').count(), 0)
    assert.deepEqual(errors, [])
    console.log(
      'PASS keyboard/focus/validation, invalid reset token; real disabled/refused SMTP returns 503 without success; Forgot HTTP/code/network/success states (latter mocked). No real database/account/email used.',
    )
  } finally {
    await browser?.close()
    await vite?.close()
    server.closeAllConnections()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
  }
}

main().catch(() => {
  // Playwright errors can include navigation URL or fill arguments; never print them.
  console.error(
    'FAIL auth layout/recovery verification. Sensitive details hidden.',
  )
  process.exitCode = 1
})
