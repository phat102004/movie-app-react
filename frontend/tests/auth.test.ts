import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authService,
  AuthApiError,
  parseAuthUser,
} from '../src/services/auth.ts'
import {
  authReturnPath,
  registrationNotice,
  validateLoginForm,
  validateRegisterForm,
} from '../src/utils/authForm.ts'

const user = {
  id: 'e71d28a1-b104-44db-a159-f6af12f314b0',
  name: 'Demo',
  email: 'demo@example.com',
  createdAt: '2026-10-26T00:00:00.000Z',
}
const values = {
  name: ' Demo ',
  email: ' Demo@example.com ',
  password: '  ExamplePassword123!  ',
  confirmPassword: '  ExamplePassword123!  ',
}

test('Auth DTO validation kiểm tra kiểu và chỉ giữ bốn trường an toàn', () => {
  assert.deepEqual(
    parseAuthUser({
      user: { ...user, passwordHash: 'discard', token: 'discard' },
    }),
    user,
  )
  for (const input of [
    null,
    {},
    { user: [] },
    { user: { ...user, id: 'invalid' } },
    { user: { ...user, email: 1 } },
    { user: { ...user, name: '' } },
    { user: { ...user, createdAt: 'bad-date' } },
  ])
    assert.throws(() => parseAuthUser(input), AuthApiError)
})

test('Register/Login validation bao gồm confirm, Unicode length và giữ khoảng trắng password', () => {
  assert.deepEqual(validateRegisterForm(values), {})
  assert.equal(values.password, '  ExamplePassword123!  ')
  assert.ok(
    validateRegisterForm({ ...values, confirmPassword: values.password.trim() })
      .confirmPassword,
  )
  assert.ok(validateRegisterForm({ ...values, name: '  ' }).name)
  assert.ok(validateRegisterForm({ ...values, name: 'a'.repeat(101) }).name)
  assert.ok(validateRegisterForm({ ...values, email: 'invalid' }).email)
  assert.ok(
    validateRegisterForm({ ...values, email: 'a'.repeat(255) + '@example.com' })
      .email,
  )
  for (const length of [11, 129])
    assert.ok(
      validateRegisterForm({ ...values, password: 'a'.repeat(length) })
        .password,
    )
  assert.deepEqual(
    validateRegisterForm({
      ...values,
      name: '🎬'.repeat(100),
      password: '🎞'.repeat(12),
      confirmPassword: '🎞'.repeat(12),
    }),
    {},
  )
  assert.ok(validateLoginForm({ email: user.email, password: '' }).password)
  assert.deepEqual(
    validateLoginForm({ email: user.email, password: 'wrong' }),
    {},
  )
})

test('Return path chỉ cho route nội bộ có thật, chặn open redirect/auth loop', () => {
  assert.equal(authReturnPath({ from: '/favorites' }), '/favorites')
  assert.equal(authReturnPath({ from: '/movies/27205' }), '/movies/27205')
  for (const from of [
    '//evil.example',
    'https://evil.example',
    '/\\evil.example',
    '/login',
    '/register',
    '/movies/invalid',
    '/movies/0',
    '/movies/2147483648',
    '/movies/42?token=bad',
  ])
    assert.equal(authReturnPath({ from }), '/')
  assert.deepEqual(
    registrationNotice({
      registered: true,
      email: user.email,
      password: 'ignored',
    }),
    { registered: true, email: user.email },
  )
})

test('Auth service dùng relative URL, same-origin, CSRF mọi POST và giữ password nguyên vẹn', async () => {
  const original = globalThis.fetch
  const calls: Array<{ path: string; options?: RequestInit }> = []
  globalThis.fetch = async (input, options) => {
    calls.push({ path: String(input), options })
    if (String(input).endsWith('/logout'))
      return new Response(null, { status: 204 })
    return Response.json(
      { user },
      { status: String(input).endsWith('/register') ? 201 : 200 },
    )
  }
  try {
    assert.deepEqual(await authService.register(values), user)
    assert.deepEqual(await authService.login(values), user)
    assert.deepEqual(await authService.me(), user)
    await authService.logout()
    assert.deepEqual(
      calls.map((call) => call.path),
      [
        '/api/auth/register',
        '/api/auth/login',
        '/api/auth/me',
        '/api/auth/logout',
      ],
    )
    for (const { options } of calls) {
      assert.equal(options?.credentials, 'same-origin')
      assert.equal(options?.cache, 'no-store')
      if (options?.method === 'POST') {
        assert.equal(new Headers(options.headers).get('X-Cineverse-CSRF'), '1')
        assert.equal(
          new Headers(options.headers).get('Content-Type'),
          'application/json',
        )
      }
    }
    assert.equal(
      JSON.parse(String(calls[1].options?.body)).password,
      values.password,
    )
    assert.deepEqual(JSON.parse(String(calls[3].options?.body)), {})
  } finally {
    globalThis.fetch = original
  }
})

test('Me 401 là guest; 503/network không trở thành guest; lỗi API không hiển thị raw message', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () =>
      Response.json(
        { error: { message: 'private stack passwordHash' } },
        { status: 401 },
      )
    assert.equal(await authService.me(), null)
    await assert.rejects(
      authService.login(values),
      (error: unknown) =>
        error instanceof AuthApiError &&
        error.status === 401 &&
        error.message === 'Email hoặc mật khẩu không chính xác.',
    )
    for (const status of [400, 409, 429, 503]) {
      globalThis.fetch = async () =>
        Response.json(
          {
            error: {
              code: 'TEST_ERROR',
              message: 'private stack passwordHash',
              fields: { email: 'private internal' },
            },
          },
          { status, headers: { 'Retry-After': '10' } },
        )
      await assert.rejects(authService.register(values), (error: unknown) => {
        assert.ok(error instanceof AuthApiError)
        assert.equal(error.status, status)
        assert.ok(!error.message.includes('private'))
        assert.ok(!JSON.stringify(error.fields).includes('private'))
        assert.equal(error.retryAfter, 10)
        return true
      })
    }
    globalThis.fetch = async () => {
      throw new Error('private network internals')
    }
    await assert.rejects(
      authService.me(),
      (error: unknown) =>
        error instanceof AuthApiError && error.status === null,
    )
  } finally {
    globalThis.fetch = original
  }
})

test('Logout 204 không parse JSON, HTTP 200/malformed success không báo logout thành công', async () => {
  const original = globalThis.fetch
  try {
    const response = new Response(null, { status: 204 })
    response.json = async () => {
      throw new Error('Must not read body')
    }
    globalThis.fetch = async () => response
    await authService.logout()
    globalThis.fetch = async () => Response.json({ user })
    await assert.rejects(authService.logout(), AuthApiError)
    globalThis.fetch = async () => new Response('invalid', { status: 200 })
    await assert.rejects(authService.login(values), AuthApiError)
  } finally {
    globalThis.fetch = original
  }
})

test('Request abort được chuyển tiếp để cleanup không trở thành lỗi UI', async () => {
  const original = globalThis.fetch
  const controller = new AbortController()
  globalThis.fetch = async (_input, options) => {
    assert.ok(options?.signal?.aborted)
    throw new DOMException('Aborted', 'AbortError')
  }
  controller.abort()
  try {
    await assert.rejects(
      authService.me(controller.signal),
      (error: unknown) =>
        error instanceof DOMException && error.name === 'AbortError',
    )
  } finally {
    globalThis.fetch = original
  }
})
