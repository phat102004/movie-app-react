import assert from 'node:assert/strict'
import test from 'node:test'
import { authService, AuthApiError } from '../src/services/auth.ts'
import {
  validateEmailForm,
  validateNewPasswordForm,
} from '../src/utils/authForm.ts'
import { captureResetToken, clearResetToken } from '../src/utils/resetToken.ts'

test('recovery validation giữ Unicode/khoảng trắng và kiểm tra confirm', () => {
  assert.deepEqual(validateEmailForm(' Fixture@Example.com '), {})
  assert.ok(validateEmailForm('invalid').email)
  const password = '  🎬'.repeat(12)
  assert.deepEqual(
    validateNewPasswordForm({ password, confirmPassword: password }),
    {},
  )
  assert.ok(
    validateNewPasswordForm({ password, confirmPassword: password.trim() })
      .confirmPassword,
  )
  for (const length of [11, 129])
    assert.ok(
      validateNewPasswordForm({
        password: 'x'.repeat(length),
        confirmPassword: '',
      }).password,
    )
})

test('recovery service dùng CSRF/JSON/no-store, không gửi token trên URL và validate response', async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! })
    return Response.json({
      message: String(url).endsWith('/forgot-password')
        ? 'Nếu email này có tài khoản Cineverse, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.'
        : 'Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.',
    })
  }
  await authService.forgotPassword('fixture@example.com')
  await authService.resetPassword('synthetic-token', 'Synthetic password 123!')
  assert.deepEqual(
    calls.map(({ url }) => url),
    ['/api/auth/forgot-password', '/api/auth/reset-password'],
  )
  for (const { init } of calls) {
    assert.equal(init.method, 'POST')
    assert.equal(init.credentials, 'same-origin')
    assert.equal(init.cache, 'no-store')
    assert.equal(new Headers(init.headers).get('x-cineverse-csrf'), '1')
  }
  globalThis.fetch = async () =>
    Response.json({ message: 'Unexpected payload' })
  await assert.rejects(authService.forgotPassword('fixture@example.com'), {
    code: 'INVALID_RESPONSE',
  })
})

test('recovery API errors hiển thị thông báo an toàn, phân biệt SMTP chưa sẵn sàng và link hết hạn', async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: 'EMAIL_UNAVAILABLE', message: 'private-fixture' } },
      { status: 503 },
    )
  await assert.rejects(
    authService.forgotPassword('fixture@example.com'),
    (error: unknown) => {
      assert.ok(error instanceof AuthApiError)
      assert.ok(error.message.includes('Chưa thể gửi email'))
      assert.ok(!error.message.includes('private-fixture'))
      return true
    },
  )
  globalThis.fetch = async () =>
    Response.json({ error: { code: 'INVALID_RESET_TOKEN' } }, { status: 400 })
  await assert.rejects(
    authService.resetPassword('fixture', 'Synthetic password'),
    (error: unknown) => {
      assert.ok(
        error instanceof AuthApiError &&
          error.message.includes('yêu cầu liên kết mới'),
      )
      return true
    },
  )
})

test('token chỉ giữ RAM, xóa fragment/query khỏi history, StrictMode đọc lặp vẫn ổn, rời trang xóa token', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  t.after(() => {
    clearResetToken()
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  const token = 'x'.repeat(43)
  const location = {
    pathname: '/reset-password',
    search: '',
    hash: `#token=${token}`,
  }
  let replacements = 0
  const routerState = { idx: 2, key: 'fixture' }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location,
      history: {
        state: routerState,
        replaceState: (state: unknown, _unused: string, url: string) => {
          assert.equal(state, routerState)
          assert.equal(url, '/reset-password')
          replacements++
          location.hash = ''
          location.search = ''
        },
      },
    },
  })
  assert.ok(captureResetToken() === token)
  assert.ok(captureResetToken() === token)
  assert.equal(replacements, 1)
  clearResetToken()
  assert.equal(captureResetToken(), null)
  location.search = `?token=${token}`
  assert.equal(captureResetToken(), null)
  assert.equal(location.search, '')
})

test('Forgot phân biệt validation/limit/email unavailable/account store/system và 503 không JSON', async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  for (const [status, code, expected] of [
    [400, 'VALIDATION_ERROR', 'email hợp lệ'],
    [429, 'RATE_LIMITED', 'quá nhiều yêu cầu đặt lại mật khẩu'],
    [503, 'EMAIL_UNAVAILABLE', 'Dịch vụ gửi thư chưa sẵn sàng'],
    [503, 'AUTH_UNAVAILABLE', 'Dịch vụ khôi phục tài khoản'],
    [500, 'INTERNAL_ERROR', 'Hệ thống chưa thể xử lý'],
  ] as const) {
    globalThis.fetch = async () =>
      Response.json(
        { error: { code, message: 'private-provider-fixture' } },
        { status, headers: { 'Retry-After': '5' } },
      )
    await assert.rejects(
      authService.forgotPassword('fixture@example.com'),
      (error: unknown) => {
        assert.ok(error instanceof AuthApiError)
        assert.equal(error.status, status)
        assert.equal(error.code, code)
        assert.ok(error.message.includes(expected))
        assert.ok(!error.message.includes('private-provider-fixture'))
        if (status === 429) assert.equal(error.retryAfter, 5)
        return true
      },
    )
  }
  globalThis.fetch = async () =>
    new Response('private-non-json-fixture', { status: 503 })
  await assert.rejects(
    authService.forgotPassword('fixture@example.com'),
    (error: unknown) => {
      assert.ok(
        error instanceof AuthApiError &&
          error.message.includes('Dịch vụ gửi thư chưa sẵn sàng'),
      )
      assert.equal(error.code, 'HTTP_ERROR')
      assert.ok(!error.message.includes('private-non-json-fixture'))
      return true
    },
  )
  // Thông báo mới chỉ áp dụng Forgot, không đổi hành vi Login hiện có.
  await assert.rejects(
    authService.login({ email: 'fixture@example.com', password: 'synthetic' }),
    (error: unknown) => {
      assert.ok(
        error instanceof AuthApiError &&
          error.message.includes('Dịch vụ tài khoản tạm thời không khả dụng'),
      )
      return true
    },
  )
})

test('Forgot network error khác lỗi gửi thư và không lộ message thô', async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async () => {
    throw new Error('private-network-fixture')
  }
  await assert.rejects(
    authService.forgotPassword('fixture@example.com'),
    (error: unknown) => {
      assert.ok(error instanceof AuthApiError)
      assert.equal(error.status, null)
      assert.equal(error.code, 'NETWORK_ERROR')
      assert.ok(error.message.includes('Không thể kết nối máy chủ'))
      assert.ok(!error.message.includes('private-network-fixture'))
      return true
    },
  )
})
