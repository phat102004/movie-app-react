import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import test from 'node:test'
import { verify } from 'argon2'
import { createAppServer } from '../server.mjs'
import { createRegistrationService } from '../auth/register-service.mjs'
import { createRegisterLimiter } from '../auth/rate-limit.mjs'
import { hashRegistrationPassword, readHashOptions } from '../auth/password.mjs'

const valid = {
  name: '  Nguyen Van A  ',
  email: ' Demo@Example.COM ',
  password: '  ExamplePassword123!  ',
}
const safeUser = {
  id: '0d6732da-03e6-4211-af0b-e116d6207357',
  name: 'Nguyen Van A',
  email: 'demo@example.com',
  createdAt: '2026-10-26T00:00:00.000Z',
}

function mockClient(create) {
  const calls = []
  return {
    calls,
    user: {
      create: async (args) => {
        calls.push(args)
        return create
          ? create(args)
          : {
              ...safeUser,
              name: args.data.name,
              email: args.data.email,
              createdAt: new Date(safeUser.createdAt),
              passwordHash: args.data.passwordHash,
              internalField: 'must-not-leak',
            }
      },
    },
  }
}

async function start(
  t,
  {
    client = mockClient(),
    hashPassword = async () => 'mock-encoded-hash',
    getClient = async () => client,
    limiter = createRegisterLimiter({ limit: 100 }),
    ...registration
  } = {},
) {
  const server = createAppServer({
    registration: {
      registerUser: createRegistrationService({ getClient, hashPassword }),
      limiter,
      ...registration,
    },
    tmdb: {
      token: 'fixture-token',
      fetchImpl: async () => Response.json({ results: [{ id: 27205 }] }),
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(resolve)
      }),
  )
  return { base: `http://127.0.0.1:${server.address().port}`, client }
}

async function post(base, body = valid, options = {}) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify(body),
    ...options,
    headers: {
      'X-Cineverse-CSRF': '1',
      ...(options.headers ?? { 'Content-Type': 'application/json' }),
    },
  })
  return { response, body: await response.json() }
}

test('Register 201: normalize email/name, hash thật, DTO an toàn, không cookie hoặc session', async (t) => {
  let originalPassword
  const { base, client } = await start(t, {
    hashPassword: async (value) => {
      originalPassword = value
      return hashRegistrationPassword(value)
    },
  })
  const { response, body } = await post(base, {
    ...valid,
    id: 'client-id',
    role: 'admin',
    passwordHash: 'client-hash',
    extra: 'ignored',
  })
  assert.equal(response.status, 201)
  assert.deepEqual(body, { user: safeUser })
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  const [args] = client.calls
  assert.deepEqual(Object.keys(args.data).sort(), [
    'email',
    'name',
    'passwordHash',
  ])
  assert.deepEqual(args.select, {
    id: true,
    name: true,
    email: true,
    createdAt: true,
  })
  assert.equal(originalPassword, valid.password)
  assert.notEqual(args.data.passwordHash, valid.password)
  assert.match(args.data.passwordHash, /^\$argon2id\$/)
  assert.equal(await verify(args.data.passwordHash, valid.password), true)
  assert.equal(
    await verify(args.data.passwordHash, valid.password.trim()),
    false,
  )
  assert.ok(!JSON.stringify(body).includes(args.data.passwordHash))
  assert.ok(!JSON.stringify(body).includes('password'))
})

test('validation: trường thiếu/sai kiểu/độ dài, email không hợp lệ, JSON không phải object → 400 trước hash/DB', async (t) => {
  let hashes = 0
  const { base, client } = await start(t, {
    hashPassword: async () => {
      hashes++
      return 'unused'
    },
  })
  const cases = [
    null,
    [],
    'text',
    123,
    true,
    {},
    ...['name', 'email', 'password'].flatMap((field) =>
      [undefined, null, 1, [], {}].map((value) => ({
        ...valid,
        [field]: value,
      })),
    ),
    { ...valid, name: '  ' },
    { ...valid, name: 'a'.repeat(101) },
    { ...valid, name: 'Name\u0000' },
    ...[
      'invalid',
      'a@',
      '@example.com',
      'a@localhost',
      'a..b@example.com',
      '.a@example.com',
      'a.@example.com',
      'a@-example.com',
      'a@exam_ple.com',
      'a@a..com',
      'a@x.123',
      'a b@example.com',
      'a'.repeat(65) + '@example.com',
      'a'.repeat(64) +
        '@' +
        'b'.repeat(63) +
        '.' +
        'c'.repeat(63) +
        '.' +
        'd'.repeat(63) +
        '.com',
    ].map((email) => ({ ...valid, email })),
    { ...valid, password: 'a'.repeat(11) },
    { ...valid, password: 'a'.repeat(129) },
  ]
  for (const input of cases) {
    const { response, body } = await post(base, input)
    assert.equal(response.status, 400)
    assert.equal(body.error.code, 'VALIDATION_ERROR')
    assert.ok(!JSON.stringify(body).includes(valid.password))
  }
  assert.equal(hashes, 0)
  assert.equal(client.calls.length, 0)
})

test('giới hạn hợp lệ: Unicode name 100 ký tự, password 12/128 ký tự và email cộng dấu +', async (t) => {
  const { base } = await start(t)
  for (const length of [12, 128]) {
    const result = await post(base, {
      name: '🎬'.repeat(100),
      email: 'cine+tag@example.com',
      password: '🎞'.repeat(length),
    })
    assert.equal(result.response.status, 201)
  }
})

test('email trùng do P2002 → 409 an toàn, không lộ error/meta của Prisma', async (t) => {
  const client = mockClient(() => {
    throw Object.assign(new Error('private database internals'), {
      code: 'P2002',
      meta: { target: ['email'] },
    })
  })
  const { base } = await start(t, { client })
  const { response, body } = await post(base)
  assert.equal(response.status, 409)
  assert.deepEqual(body, {
    error: { code: 'EMAIL_ALREADY_EXISTS', message: 'Email đã được sử dụng.' },
  })
})

test('hai request đồng thời cùng email: unique constraint quyết định 201/409, không dùng check-then-create', async (t) => {
  let arrivals = 0
  let release
  const barrier = new Promise((resolve) => {
    release = resolve
  })
  const emails = new Set()
  const client = mockClient(async ({ data }) => {
    if (++arrivals === 2) release()
    await barrier
    if (emails.has(data.email))
      throw Object.assign(new Error('unique'), { code: 'P2002' })
    emails.add(data.email)
    return { ...safeUser, createdAt: new Date(safeUser.createdAt) }
  })
  const { base } = await start(t, { client })
  const results = await Promise.all([
    post(base, valid),
    post(base, { ...valid, email: 'demo@example.com' }),
  ])
  assert.deepEqual(
    results.map((result) => result.response.status).sort(),
    [201, 409],
  )
  assert.equal(client.calls.length, 2)
  assert.equal(emails.size, 1)
})

test('database unavailable và lỗi nội bộ được ánh xạ 503/500, không lộ dữ liệu nhạy cảm', async (t) => {
  for (const [code, status] of [
    ['P1001', 503],
    ['P2021', 503],
    ['UNKNOWN', 500],
  ]) {
    const { base } = await start(t, {
      getClient: async () => {
        throw Object.assign(
          new Error(
            'postgresql://private:secret@localhost/private passwordHash secret-token',
          ),
          { code },
        )
      },
    })
    const result = await post(base)
    assert.equal(result.response.status, status)
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /postgresql|passwordHash|secret-token|stack|private/,
    )
    // DB lỗi không làm các route TMDB phụ thuộc Prisma.
    assert.equal((await fetch(`${base}/api/movies/popular`)).status, 200)
  }
})

test('hash failure → 500 an toàn và chưa gọi database', async (t) => {
  const { base, client } = await start(t, {
    hashPassword: async () => {
      throw new Error('secret hash internals')
    },
  })
  const result = await post(base)
  assert.equal(result.response.status, 500)
  assert.doesNotMatch(JSON.stringify(result.body), /secret|hash internals/)
  assert.equal(client.calls.length, 0)
})

test('JSON sai/empty, media type và encoding không hỗ trợ', async (t) => {
  const { base, client } = await start(t)
  for (const body of ['{oops', '', '{"name":']) {
    const result = await post(base, valid, { body })
    assert.equal(result.response.status, 400)
    assert.equal(result.body.error.code, 'INVALID_JSON')
  }
  for (const headers of [
    {},
    { 'Content-Type': 'text/plain' },
    { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
  ]) {
    assert.equal((await post(base, valid, { headers })).response.status, 415)
  }
  assert.equal(
    (await post(base, valid, { body: Buffer.from([0x7b, 0xff, 0x7d]) }))
      .response.status,
    400,
  )
  assert.equal(client.calls.length, 0)
})

test('body lớn hơn 16 KB (Content-Length hoặc chunked) → 413 trước hash/DB', async (t) => {
  const { base, client } = await start(t)
  assert.equal(
    (
      await post(base, valid, {
        body: JSON.stringify({ name: 'x'.repeat(17000) }),
      })
    ).response.status,
    413,
  )
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest(
      `${base}/api/auth/register`,
      {
        method: 'POST',
        headers: {
          'X-Cineverse-CSRF': '1',
          'Content-Type': 'application/json',
          'Transfer-Encoding': 'chunked',
        },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks)),
          }),
        )
      },
    )
    request.on('error', reject)
    request.write('x'.repeat(8192))
    request.end('x'.repeat(8193))
  })
  assert.equal(result.status, 413)
  assert.equal(result.body.error.code, 'PAYLOAD_TOO_LARGE')
  assert.equal(client.calls.length, 0)
})

test('rate limit tính cả request lỗi, không tin X-Forwarded-For; TMDB không bị limit', async (t) => {
  const { base, client } = await start(t, {
    limiter: createRegisterLimiter({ limit: 2 }),
  })
  assert.equal((await post(base, {})).response.status, 400)
  assert.equal((await post(base, {})).response.status, 400)
  const limited = await post(base, valid, {
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.99',
    },
  })
  assert.equal(limited.response.status, 429)
  assert.equal(limited.body.error.code, 'RATE_LIMITED')
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0)
  assert.equal(client.calls.length, 0)
  assert.equal((await fetch(`${base}/api/movies/popular`)).status, 200)
})

test('limiter hết hạn tự cho phép lại và giới hạn kích thước map', () => {
  let time = 0
  const take = createRegisterLimiter({
    limit: 1,
    windowMs: 1000,
    maxEntries: 1,
    now: () => time,
  })
  assert.equal(take('a').allowed, true)
  assert.equal(take('a').allowed, false)
  assert.equal(take('b').allowed, false)
  time = 1001
  assert.equal(take('b').allowed, true)
})

test(
  'body gửi chậm hết timeout → 408; server vẫn phục vụ TMDB',
  { timeout: 3000 },
  async (t) => {
    const { base, client } = await start(t, { bodyTimeoutMs: 50 })
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(
        `${base}/api/auth/register`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cineverse-CSRF': '1',
          },
        },
        (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        },
      )
      request.on('error', reject)
      request.write('{"name":')
    })
    assert.equal(status, 408)
    assert.equal(client.calls.length, 0)
    assert.equal((await fetch(`${base}/api/movies/popular`)).status, 200)
  },
)

test('giới hạn thao tác đồng thời → 429, sau khi xong giải phóng slot', async (t) => {
  let release
  let entered
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  const { base } = await start(t, {
    maxConcurrent: 1,
    registerUser: async () => {
      entered()
      await waiting
      return safeUser
    },
  })
  const first = post(base)
  await started
  const busy = await post(base)
  assert.equal(busy.response.status, 429)
  assert.equal(busy.body.error.code, 'REGISTRATION_BUSY')
  release()
  assert.equal((await first).response.status, 201)
  assert.equal((await post(base)).response.status, 201)
})

test('route chỉ nhận POST đúng path; endpoint chưa triển khai không gọi DB', async (t) => {
  const { base, client } = await start(t)
  const method = await fetch(`${base}/api/auth/register`)
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('allow'), 'POST')
  const invalidUrlStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(base, { path: 'http://[' }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(invalidUrlStatus, 400)
  for (const path of [
    '/api/auth/unknown',
    '/api/auth/register?admin=true',
    '/api/auth/register/',
  ]) {
    const response = await fetch(`${base}${path}`, { method: 'POST' })
    assert.equal(response.status, 404)
  }
  assert.equal(client.calls.length, 0)
})

test('Argon2id dùng salt khác nhau, params hợp lệ và chặn cấu hình yếu/sai', async () => {
  const options = readHashOptions({})
  assert.deepEqual(options, { memoryCost: 19456, timeCost: 2, parallelism: 1 })
  for (const env of [
    { ARGON2_MEMORY_KIB: '8192' },
    { ARGON2_TIME_COST: '1' },
    { ARGON2_PARALLELISM: '0' },
    { ARGON2_TIME_COST: 'NaN' },
    { ARGON2_MEMORY_KIB: '999999999' },
  ])
    assert.throws(
      () => readHashOptions(env),
      (error) => error.code === 'REGISTRATION_UNAVAILABLE',
    )
  const [a, b] = await Promise.all([
    hashRegistrationPassword(valid.password),
    hashRegistrationPassword(valid.password),
  ])
  assert.notEqual(a, b)
  assert.equal(await verify(a, valid.password), true)
  assert.equal(await verify(b, valid.password), true)
})
