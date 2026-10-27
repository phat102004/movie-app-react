import assert from 'node:assert/strict'
import test from 'node:test'
import {
  passwordChangeService,
  PasswordChangeApiError,
} from '../src/services/passwordChange.ts'
import {
  validatePasswordChangeForm,
  hasPasswordChangedNotice,
} from '../src/utils/passwordChangeForm.ts'
import { isValidPassword } from '../../backend/auth/password-policy.mjs'

const input = {
  currentPassword: ' Old synthetic password 123! ',
  newPassword: ' New synthetic password 456! ',
}
const original = globalThis.fetch
function mock(t: { after(fn: () => void): void }, callback: typeof fetch) {
  globalThis.fetch = callback
  t.after(() => {
    globalThis.fetch = original
  })
}

test('Client policy khớp backend, giữ whitespace và Unicode; confirm chỉ ở UI', () => {
  for (const newPassword of [
    '',
    'x'.repeat(11),
    '🎬'.repeat(12),
    'x'.repeat(128),
    '🎬'.repeat(129),
    ' '.repeat(12),
  ]) {
    const errors = validatePasswordChangeForm({
      ...input,
      newPassword,
      confirmPassword: newPassword,
    })
    assert.equal(!errors.newPassword, isValidPassword(newPassword))
  }
  assert.deepEqual(
    validatePasswordChangeForm({
      ...input,
      confirmPassword: input.newPassword,
    }),
    {},
  )
  assert.ok(
    validatePasswordChangeForm({
      ...input,
      currentPassword: '',
      confirmPassword: input.newPassword,
    }).currentPassword,
  )
  assert.ok(
    validatePasswordChangeForm({
      ...input,
      confirmPassword: input.newPassword.trim(),
    }).confirmPassword,
  )
})

test('POST chỉ gửi hai field, cookie/CSRF/no-store; 204 không parse JSON', async (t) => {
  mock(t, async (url, options) => {
    assert.equal(url, '/api/profile/change-password')
    assert.equal(options?.method, 'POST')
    assert.equal(options?.credentials, 'same-origin')
    assert.equal(options?.cache, 'no-store')
    assert.equal(new Headers(options?.headers).get('X-Cineverse-CSRF'), '1')
    assert.deepEqual(JSON.parse(String(options?.body)), input)
    const result = new Response(null, { status: 204 })
    result.json = async () => {
      throw new Error('Must not parse 204')
    }
    return result
  })
  await passwordChangeService.change({
    ...input,
    confirmPassword: 'discard',
  } as typeof input)
})

test('200/201/invalid JSON không bao giờ được coi là đổi password thành công', async (t) => {
  mock(t, async () => Response.json({ success: true }))
  await assert.rejects(passwordChangeService.change(input), {
    code: 'INVALID_RESPONSE',
  })
  globalThis.fetch = async () => new Response('bad-json', { status: 201 })
  await assert.rejects(passwordChangeService.change(input), {
    code: 'INVALID_RESPONSE',
  })
})

for (const code of ['CURRENT_PASSWORD_INCORRECT', 'PASSWORD_REUSED'])
  test(`${code} có field error an toàn, không echo secret`, async (t) => {
    mock(t, async () =>
      Response.json(
        {
          error: {
            code,
            message: 'PRIVATE password/hash/token',
            fields: { currentPassword: 'PRIVATE', newPassword: 'PRIVATE' },
          },
        },
        { status: 400 },
      ),
    )
    await assert.rejects(
      passwordChangeService.change(input),
      (error: unknown) =>
        error instanceof PasswordChangeApiError &&
        error.code === code &&
        !JSON.stringify(error).includes('PRIVATE') &&
        !!error.fields[
          code === 'PASSWORD_REUSED' ? 'newPassword' : 'currentPassword'
        ],
    )
  })

for (const status of [401, 403, 429, 500, 503])
  test(`HTTP ${status} giữ status/Retry-After và message client`, async (t) => {
    mock(t, async () =>
      Response.json(
        {
          error: {
            code: 'AUTH_UNAVAILABLE',
            message: 'PRIVATE exception/credentials',
          },
        },
        { status, headers: { 'Retry-After': '30' } },
      ),
    )
    await assert.rejects(
      passwordChangeService.change(input),
      (error: unknown) =>
        error instanceof PasswordChangeApiError &&
        error.status === status &&
        error.retryAfter === 30 &&
        !error.message.includes('PRIVATE'),
    )
  })

test('400 validation chỉ nhận tên field đã biết, không giữ dữ liệu server thô', async (t) => {
  mock(t, async () =>
    Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          fields: {
            currentPassword: 'PRIVATE',
            newPassword: 'PRIVATE',
            passwordHash: 'discard',
          },
        },
      },
      { status: 400 },
    ),
  )
  await assert.rejects(
    passwordChangeService.change(input),
    (error: unknown) =>
      error instanceof PasswordChangeApiError &&
      Object.keys(error.fields).sort().join() ===
        'currentPassword,newPassword' &&
      !JSON.stringify(error.fields).includes('PRIVATE'),
  )
})

test('Network/abort không báo thành công; abort chặn response đến muộn', async (t) => {
  mock(t, async () => {
    throw new Error('PRIVATE network data')
  })
  await assert.rejects(
    passwordChangeService.change(input),
    (error: unknown) =>
      error instanceof PasswordChangeApiError &&
      error.code === 'NETWORK_ERROR' &&
      !error.message.includes('PRIVATE'),
  )
  const controller = new AbortController()
  globalThis.fetch = async () => {
    controller.abort()
    return new Response(null, { status: 204 })
  }
  await assert.rejects(passwordChangeService.change(input, controller.signal), {
    name: 'AbortError',
  })
})

test('Login notice chỉ nhận boolean, không đọc token/password hoặc URL', () => {
  assert.equal(
    hasPasswordChangedNotice({ passwordChanged: true, password: 'discard' }),
    true,
  )
  for (const state of [
    null,
    {},
    'https://invalid',
    { passwordChanged: 'true' },
    { passwordChanged: false },
  ])
    assert.equal(hasPasswordChangedNotice(state), false)
})
