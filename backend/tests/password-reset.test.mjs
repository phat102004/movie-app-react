import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { once } from 'node:events'
import {
  memoryDatabase,
  startAuthServer,
  authRequest,
  cookieFrom,
} from './helpers/auth-fixture.mjs'
import {
  createPasswordResetService,
  forgotMessage,
  hashResetToken,
} from '../auth/password-reset-service.mjs'
import {
  createResetEmailDelivery,
  readResetEmailConfig,
} from '../auth/reset-email.mjs'
import { readAuthConfig } from '../auth/config.mjs'
import {
  hashRegistrationPassword,
  verifyLoginPassword,
} from '../auth/password.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import { createLoginLimiter } from '../auth/login-rate-limit.mjs'
import { createSessionService } from '../auth/session-service.mjs'

const email = 'fixture@example.com'
const oldPassword = 'Old synthetic password 123!'
const newPassword = '  New synthetic password 456!  '
const initialHash = hashRegistrationPassword(oldPassword)
const tokenFrom = (mail) => new URL(mail.resetUrl).hash.slice(7)

async function setup(t, options = {}) {
  let instant = new Date('2026-10-26T00:00:00Z')
  const mails = []
  const client = memoryDatabase([
    {
      id: 'e71d28a1-b104-44db-a159-f6af12f314b0',
      name: 'Fixture',
      email,
      passwordHash: await initialHash,
      createdAt: instant,
    },
    {
      id: 'e71d28a1-b104-44db-a159-f6af12f314b1',
      name: 'Other',
      email: 'other@example.com',
      passwordHash: await initialHash,
      createdAt: instant,
    },
  ])
  const delivery = options.delivery ?? {
    ready: () => 'http://localhost:5173',
    send: async (mail) => {
      mails.push(mail)
    },
  }
  const now = () => instant
  const service = createPasswordResetService({
    getClient: async () => client,
    delivery,
    now,
    minimumDurationMs: 0,
  })
  const server = await startAuthServer(t, {
    client,
    now,
    passwordReset: { service, ...options.routes },
  })
  return {
    ...server,
    client,
    service,
    mails,
    now,
    advance: (ms) => {
      instant = new Date(instant.getTime() + ms)
    },
  }
}

test('forgot: email chuẩn hóa, known/unknown cùng response, token 256-bit chỉ lưu SHA256 và TTL 20 phút', async (t) => {
  const f = await setup(t)
  const known = await authRequest(f.base, 'forgot-password', {
    body: { email: ' Fixture@Example.COM ' },
  })
  const unknown = await authRequest(f.base, 'forgot-password', {
    body: { email: 'missing@example.com' },
  })
  assert.equal(known.response.status, 200)
  assert.equal(unknown.response.status, 200)
  assert.deepEqual(known.body, unknown.body)
  assert.deepEqual(known.body, { message: forgotMessage })
  assert.equal(f.mails.length, 2)
  assert.equal(f.mails[0].email, email)
  assert.equal(f.mails[1].resetUrl, null)
  const raw = tokenFrom(f.mails[0])
  assert.equal(Buffer.from(raw, 'base64url').length, 32)
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(raw))
  const [stored] = f.client.resetTokens.values()
  assert.ok(stored.tokenHash === hashResetToken(raw))
  assert.equal(stored.expiresAt - stored.createdAt, 20 * 60_000)
  assert.ok(!JSON.stringify([...f.client.resetTokens.values()]).includes(raw))
  assert.ok(!JSON.stringify(known.body).includes(raw))
  assert.equal(known.response.headers.get('cache-control'), 'no-store')
  assert.equal(known.response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(known.response.headers.get('set-cookie'), null)
})

test('forgot: token ngẫu nhiên khác nhau; yêu cầu mới thay token cũ', async (t) => {
  const f = await setup(t)
  await f.service.forgot({ email })
  await f.service.forgot({ email })
  const [oldToken, newToken] = f.mails.map(tokenFrom)
  assert.ok(oldToken !== newToken)
  assert.equal(f.client.resetTokens.size, 1)
  await assert.rejects(
    f.service.reset({ token: oldToken, password: newPassword }),
    { code: 'INVALID_RESET_TOKEN' },
  )
  await f.service.reset({ token: newToken, password: newPassword })
})

test('forgot: email sai/json sai bị từ chối trước email delivery', async (t) => {
  const f = await setup(t)
  for (const input of [
    null,
    [],
    {},
    { email: 'x' },
    { email: 'a..b@example.com' },
    { email: 'x@localhost' },
    { email: 'x'.repeat(255) },
  ]) {
    const result = await authRequest(f.base, 'forgot-password', { body: input })
    assert.equal(result.response.status, 400)
  }
  assert.equal(f.mails.length, 0)
})

test('forgot: thiếu cấu hình email báo 503 cho cả hai trường hợp, không đọc User', async (t) => {
  const delivery = createResetEmailDelivery({
    config: readAuthConfig({}),
    env: {},
  })
  const f = await setup(t, { delivery })
  const responses = []
  for (const address of [email, 'missing@example.com']) {
    const result = await authRequest(f.base, 'forgot-password', {
      body: { email: address },
    })
    assert.equal(result.response.status, 503)
    assert.equal(result.body.error.code, 'EMAIL_UNAVAILABLE')
    responses.push(result.body)
  }
  assert.deepEqual(responses[0], responses[1])
  assert.equal(
    f.client.calls.filter(([op]) => op === 'user.findUnique').length,
    0,
  )
})

test('forgot: provider lỗi không báo gửi thành công, không lộ lỗi nội bộ, xóa hash token gửi lỗi', async (t) => {
  const config = readAuthConfig({})
  const delivery = createResetEmailDelivery({
    config,
    env: {
      PASSWORD_RESET_EMAIL_MODE: 'local',
      PUBLIC_APP_ORIGIN: 'http://localhost:5173',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'cineverse@localhost.test',
    },
    createTransport: () => ({
      sendMail: async () => {
        throw new Error('private-provider-fixture')
      },
    }),
  })
  const f = await setup(t, { delivery })
  const results = []
  for (const address of [email, 'missing@example.com']) {
    const result = await authRequest(f.base, 'forgot-password', {
      body: { email: address },
    })
    assert.equal(result.response.status, 503)
    assert.ok(!JSON.stringify(result.body).includes('private-provider-fixture'))
    results.push(result.body)
  }
  assert.deepEqual(results[0], results[1])
  assert.equal(f.client.resetTokens.size, 0)
})

test('forgot: giới hạn theo email chuẩn hóa độc lập với IP; giới hạn IP chặn nhiều địa chỉ', async (t) => {
  const f = await setup(t, {
    routes: {
      forgotLimiter: createLoginLimiter({
        ip: createRegisterLimiter({ limit: 3 }),
        account: createRegisterLimiter({ limit: 1 }),
      }),
    },
  })
  assert.equal(
    (await authRequest(f.base, 'forgot-password', { body: { email } })).response
      .status,
    200,
  )
  const limited = await authRequest(f.base, 'forgot-password', {
    body: { email: ' Fixture@Example.COM ' },
  })
  assert.equal(limited.response.status, 429)
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0)
  await authRequest(f.base, 'forgot-password', {
    body: { email: 'missing@example.com' },
  })
  assert.equal(
    (
      await authRequest(f.base, 'forgot-password', {
        body: { email: 'another@example.com' },
      })
    ).response.status,
    429,
  )
  assert.equal(f.mails.length, 2)
})

test('reset: thành công Argon2id, password cũ sai/mới đúng, chỉ thu hồi session đúng User, không tự login', async (t) => {
  const f = await setup(t)
  const login = await authRequest(f.base, 'login', {
    body: { email, password: oldPassword },
  })
  const cookie = cookieFrom(login)
  const otherLogin = await authRequest(f.base, 'login', {
    body: { email: 'other@example.com', password: oldPassword },
  })
  await f.service.forgot({ email })
  const token = tokenFrom(f.mails[0])
  const result = await authRequest(f.base, 'reset-password', {
    body: { token, password: newPassword },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.response.headers.get('set-cookie'), null)
  assert.deepEqual(Object.keys(result.body), ['message'])
  const hash = f.client.users[0].passwordHash
  assert.match(hash, /^\$argon2id\$/)
  assert.ok(hash !== (await initialHash))
  assert.ok(await verifyLoginPassword(hash, newPassword))
  assert.ok(!(await verifyLoginPassword(hash, oldPassword)))
  assert.equal(f.client.resetTokens.size, 0)
  assert.equal(
    (await authRequest(f.base, 'me', { cookie })).response.status,
    401,
  )
  assert.equal(
    (await authRequest(f.base, 'me', { cookie: cookieFrom(otherLogin) }))
      .response.status,
    200,
  )
  assert.equal(
    (
      await authRequest(f.base, 'login', {
        body: { email, password: oldPassword },
      })
    ).response.status,
    401,
  )
  assert.equal(
    (
      await authRequest(f.base, 'login', {
        body: { email, password: newPassword },
      })
    ).response.status,
    200,
  )
  for (const secret of [token, hash, newPassword, oldPassword])
    assert.ok(!JSON.stringify(result.body).includes(secret))
  const reused = await authRequest(f.base, 'reset-password', {
    body: { token, password: newPassword },
  })
  assert.equal(reused.response.status, 400)
  assert.equal(reused.body.error.code, 'INVALID_RESET_TOKEN')
})

test('reset: token sai/hết hạn/cú pháp sai và password không đạt policy không thay dữ liệu', async (t) => {
  const f = await setup(t)
  await f.service.forgot({ email })
  const token = tokenFrom(f.mails[0])
  for (const value of ['', 'wrong', randomBytes(32).toString('base64url')])
    assert.equal(
      (
        await authRequest(f.base, 'reset-password', {
          body: { token: value, password: newPassword },
        })
      ).body.error.code,
      'INVALID_RESET_TOKEN',
    )
  for (const password of ['short', 'a'.repeat(129), null])
    assert.equal(
      (
        await authRequest(f.base, 'reset-password', {
          body: { token, password },
        })
      ).body.error.code,
      'VALIDATION_ERROR',
    )
  f.advance(20 * 60_000)
  assert.equal(
    (
      await authRequest(f.base, 'reset-password', {
        body: { token, password: newPassword },
      })
    ).body.error.code,
    'INVALID_RESET_TOKEN',
  )
  assert.ok(f.client.users[0].passwordHash === (await initialHash))
})

test('reset: hai request đồng thời chỉ một thành công', async (t) => {
  const f = await setup(t)
  await f.service.forgot({ email })
  const input = { token: tokenFrom(f.mails[0]), password: newPassword }
  const results = await Promise.all([
    authRequest(f.base, 'reset-password', { body: input }),
    authRequest(f.base, 'reset-password', { body: input }),
  ])
  assert.deepEqual(
    results.map((result) => result.response.status).sort(),
    [200, 400],
  )
  assert.equal(f.client.resetTokens.size, 0)
})

test('reset: transaction rollback nếu thu hồi session thất bại; token và hash cũ giữ nguyên', async (t) => {
  const f = await setup(t)
  await f.service.forgot({ email })
  const input = { token: tokenFrom(f.mails[0]), password: newPassword }
  f.client.session.deleteMany = async () => {
    throw new Error('fixture transaction failure')
  }
  const result = await authRequest(f.base, 'reset-password', { body: input })
  assert.equal(result.response.status, 500)
  assert.equal(f.client.resetTokens.size, 1)
  assert.ok(f.client.users[0].passwordHash === (await initialHash))
})

test('login đang chạy trước reset không thể tạo session bằng hash cũ sau reset', async (t) => {
  const f = await setup(t)
  const sessions = createSessionService({
    getClient: async () => f.client,
    config: f.config,
  })
  const previousHash = f.client.users[0].passwordHash
  await f.service.forgot({ email })
  await f.service.reset({ token: tokenFrom(f.mails[0]), password: newPassword })
  await assert.rejects(sessions.create(f.client.users[0].id, previousHash), {
    code: 'INVALID_CREDENTIALS',
  })
  assert.equal(f.client.sessions.size, 0)
})

test('reset: kiểm tra lại hạn sử dụng sau Argon2; token hết hạn trong lúc hash không được dùng', async (t) => {
  const f = await setup(t)
  await f.service.forgot({ email })
  const service = createPasswordResetService({
    getClient: async () => f.client,
    now: f.now,
    hashPassword: async () => {
      f.advance(20 * 60_000)
      return 'never-committed-fixture'
    },
  })
  await assert.rejects(
    service.reset({ token: tokenFrom(f.mails[0]), password: newPassword }),
    { code: 'INVALID_RESET_TOKEN' },
  )
  assert.ok(f.client.users[0].passwordHash === (await initialHash))
  assert.equal(f.client.resetTokens.size, 1)
})

test('reset: token mới phát hành trong lúc request cũ hash làm request cũ thất bại', async (t) => {
  const f = await setup(t)
  await f.service.forgot({ email })
  const oldToken = tokenFrom(f.mails[0])
  const service = createPasswordResetService({
    getClient: async () => f.client,
    now: f.now,
    hashPassword: async () => {
      await f.service.forgot({ email })
      return 'never-committed-fixture'
    },
  })
  await assert.rejects(
    service.reset({ token: oldToken, password: newPassword }),
    { code: 'INVALID_RESET_TOKEN' },
  )
  assert.ok(f.client.users[0].passwordHash === (await initialHash))
  assert.ok(
    [...f.client.resetTokens.values()][0].tokenHash ===
      hashResetToken(tokenFrom(f.mails[1])),
  )
})

test('HTTP recovery và email delivery không log password/token/reset URL', async (t) => {
  const f = await setup(t)
  const captured = []
  const methods = ['log', 'info', 'warn', 'error', 'debug']
  const previous = methods.map((method) => console[method])
  try {
    methods.forEach((method) => {
      console[method] = (...args) => captured.push(args.join(' '))
    })
    await authRequest(f.base, 'forgot-password', { body: { email } })
    await authRequest(f.base, 'reset-password', {
      body: { token: tokenFrom(f.mails[0]), password: newPassword },
    })
  } finally {
    methods.forEach((method, index) => {
      console[method] = previous[index]
    })
  }
  const output = captured.join('\n')
  for (const secret of [
    newPassword,
    tokenFrom(f.mails[0]),
    f.mails[0].resetUrl,
  ])
    assert.ok(!output.includes(secret))
})

test('recovery endpoints: CSRF/Origin/method/content-type/body limits và reset rate limit', async (t) => {
  const f = await setup(t, {
    routes: { resetLimiter: createRegisterLimiter({ limit: 1 }) },
  })
  for (const path of ['forgot-password', 'reset-password']) {
    for (const headers of [
      { 'X-Cineverse-CSRF': '' },
      { Origin: 'https://attacker.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ])
      assert.equal(
        (await authRequest(f.base, path, { body: {}, headers })).response
          .status,
        403,
      )
    assert.equal(
      (await authRequest(f.base, path, { method: 'GET' })).response.status,
      405,
    )
    assert.equal(
      (
        await authRequest(f.base, path, {
          body: {},
          headers: { 'Content-Type': 'text/plain' },
        })
      ).response.status,
      415,
    )
  }
  assert.equal(
    (
      await authRequest(f.base, 'forgot-password', {
        body: { email: 'x'.repeat(17000) },
      })
    ).response.status,
    413,
  )
  const limited = await authRequest(f.base, 'reset-password', { body: {} })
  assert.equal(limited.response.status, 429)
  assert.equal(f.client.resetTokens.size, 0)
})

test('SMTP config: local chỉ loopback/dev; production bắt buộc TLS, credentials, trusted origin', () => {
  const env = {
    PASSWORD_RESET_EMAIL_MODE: 'local',
    PUBLIC_APP_ORIGIN: 'http://localhost:5173',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1025',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'cineverse@localhost.test',
  }
  const dev = readAuthConfig({})
  assert.equal(readResetEmailConfig({}, dev), null)
  assert.equal(readResetEmailConfig(env, dev).options.logger, false)
  for (const change of [
    { SMTP_HOST: 'external.example' },
    { PUBLIC_APP_ORIGIN: 'https://attacker.example' },
    { SMTP_FROM: 'a@example.com\r\nBcc: attacker@example.com' },
    { SMTP_PORT: 'x' },
  ])
    assert.throws(() => readResetEmailConfig({ ...env, ...change }, dev), {
      code: 'EMAIL_UNAVAILABLE',
    })
  const prod = readAuthConfig({
    NODE_ENV: 'production',
    AUTH_ALLOWED_ORIGINS: 'https://cineverse.example',
  })
  assert.throws(
    () =>
      readResetEmailConfig(
        { ...env, PUBLIC_APP_ORIGIN: 'https://cineverse.example' },
        prod,
      ),
    { code: 'EMAIL_UNAVAILABLE' },
  )
  const smtp = {
    ...env,
    PASSWORD_RESET_EMAIL_MODE: 'smtp',
    PUBLIC_APP_ORIGIN: 'https://cineverse.example',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'fixture',
    SMTP_PASSWORD: 'synthetic-test-only',
    SMTP_PORT: '587',
  }
  assert.equal(readResetEmailConfig(smtp, prod).options.requireTLS, true)
  assert.throws(
    () => readResetEmailConfig({ ...smtp, SMTP_PASSWORD: '' }, prod),
    { code: 'EMAIL_UNAVAILABLE' },
  )
})

test('Nodemailer thực gửi vào SMTP catcher giả lập local; không log nội dung hoặc URL', async (t) => {
  const messages = []
  const catcher = createServer((socket) => {
    socket.setEncoding('utf8')
    socket.write('220 localhost fixture\r\n')
    let buffer = '',
      data = '',
      reading = false
    socket.on('data', (chunk) => {
      buffer += chunk
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n')
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (reading) {
          if (line === '.') {
            messages.push(data)
            data = ''
            reading = false
            socket.write('250 queued\r\n')
          } else data += line + '\r\n'
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n')
        else if (/^DATA/.test(line)) {
          reading = true
          socket.write('354 send data\r\n')
        } else if (/^QUIT/.test(line)) socket.end('221 bye\r\n')
        else socket.write('250 ok\r\n')
      }
    })
    socket.on('error', () => {})
  })
  catcher.listen(0, '127.0.0.1')
  await once(catcher, 'listening')
  t.after(() => new Promise((resolve) => catcher.close(resolve)))
  const delivery = createResetEmailDelivery({
    config: readAuthConfig({}),
    env: {
      PASSWORD_RESET_EMAIL_MODE: 'local',
      PUBLIC_APP_ORIGIN: 'http://localhost:5173',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(catcher.address().port),
      SMTP_SECURE: 'false',
      SMTP_FROM: 'cineverse@localhost.test',
    },
  })
  await delivery.send({
    email,
    resetUrl: 'http://localhost:5173/reset-password#token=synthetic-test-only',
  })
  await delivery.send({ email: 'missing@example.com', resetUrl: null })
  assert.equal(messages.length, 2)
  assert.ok(messages[0].includes('Subject:'))
  assert.ok(!messages[1].includes('#token='))
})

test('local SMTP không lắng nghe: 503 an toàn, không success/token còn lại, backend tiếp tục hoạt động', async (t) => {
  // Lấy cổng loopback trống rồi đóng; không phụ thuộc Mailpit cài trên máy.
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const delivery = createResetEmailDelivery({
    config: readAuthConfig({}),
    env: {
      PASSWORD_RESET_EMAIL_MODE: 'local',
      PUBLIC_APP_ORIGIN: 'http://localhost:5173',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      SMTP_SECURE: 'false',
      SMTP_FROM: 'cineverse@localhost.test',
    },
  })
  const f = await setup(t, { delivery })
  const results = []
  for (const address of [email, 'missing@example.com']) {
    const result = await authRequest(f.base, 'forgot-password', {
      body: { email: address },
    })
    assert.equal(result.response.status, 503)
    assert.equal(result.body.error.code, 'EMAIL_UNAVAILABLE')
    assert.equal(result.body.message, undefined)
    assert.ok(!JSON.stringify(result.body).includes(String(port)))
    assert.ok(!JSON.stringify(result.body).includes('ECONNREFUSED'))
    results.push(result.body)
  }
  assert.deepEqual(results[0], results[1])
  assert.equal(f.client.resetTokens.size, 0)
  assert.equal((await authRequest(f.base, 'me')).response.status, 401)
  const movies = await fetch(f.base + '/api/movies/popular')
  assert.equal(movies.status, 200)
})
