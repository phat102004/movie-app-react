import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseProfile,
  profileService,
  ProfileApiError,
} from '../src/services/profile.ts'
import { validateProfileName } from '../src/utils/profileForm.ts'
import { authReturnPath } from '../src/utils/authForm.ts'
import { readDisplayName } from '../../backend/auth/name-validation.mjs'

const profile = {
  id: 'e71d28a1-b104-44db-a159-f6af12f314b0',
  name: 'Fixture User',
  email: 'profile@fixture.test',
  createdAt: '2026-10-27T10:00:00.000Z',
  favoriteCount: 3,
}
const originalFetch = globalThis.fetch
function mock(t: { after(fn: () => void): void }, fetcher: typeof fetch) {
  globalThis.fetch = fetcher
  t.after(() => {
    globalThis.fetch = originalFetch
  })
}

test('Profile DTO chỉ lấy 5 trường an toàn; không giữ password/session/reset data', () => {
  assert.deepEqual(
    parseProfile({
      profile: {
        ...profile,
        passwordHash: 'discard',
        sessions: ['discard'],
        token: 'discard',
        _count: { favorites: 3 },
      },
    }),
    profile,
  )
  assert.throws(() => parseProfile({ user: profile }), ProfileApiError)
})

test('Profile validate id/name/email/date và favoriteCount nguyên không âm', () => {
  for (const value of [
    null,
    [],
    {},
    { profile: null },
    { profile: { ...profile, id: 'bad' } },
    { profile: { ...profile, name: '' } },
    { profile: { ...profile, name: 'A\u0000B' } },
    { profile: { ...profile, email: 42 } },
    { profile: { ...profile, createdAt: 'bad' } },
    { profile: { ...profile, createdAt: '2026-02-30T00:00:00.000Z' } },
  ])
    assert.throws(() => parseProfile(value), ProfileApiError)
  for (const favoriteCount of [
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '3',
    null,
    undefined,
  ])
    assert.throws(
      () => parseProfile({ profile: { ...profile, favoriteCount } }),
      ProfileApiError,
    )
  assert.equal(
    parseProfile({ profile: { ...profile, favoriteCount: 0 } }).favoriteCount,
    0,
  )
})

test('Tên Profile khớp backend: trim/Unicode/control và giới hạn 1–100 code points', () => {
  for (const name of [
    '',
    ' \t\n ',
    'A',
    '  Nguyễn Phát 🎬  ',
    '🎬'.repeat(100),
    '🎬'.repeat(101),
    'A'.repeat(100),
    'A'.repeat(101),
    'A\u0000B',
    'A\u007fB',
    null,
    42,
    true,
    [],
    {},
  ]) {
    const client = validateProfileName(name),
      backend = readDisplayName(name)
    assert.equal(client.name, backend.name)
    assert.equal(client.error === null, backend.valid)
  }
  assert.equal(validateProfileName('  A  B  ').name, 'A  B')
})

test('Return URL cho phép đúng /profile; vẫn chặn open redirect/query/auth loop', () => {
  assert.equal(authReturnPath({ from: '/profile' }), '/profile')
  for (const from of [
    'https://evil.invalid/profile',
    '//evil.invalid/profile',
    '/profile?next=https://evil.invalid',
    '/profile/1',
    '/login',
    '/profile#token=bad',
  ])
    assert.equal(authReturnPath({ from }), '/')
})

test('GET dùng đúng endpoint, cookie same-origin/no-store; không body/CSRF', async (t) => {
  mock(t, async (url, options) => {
    assert.equal(url, '/api/profile')
    assert.equal(options?.method, 'GET')
    assert.equal(options?.credentials, 'same-origin')
    assert.equal(options?.cache, 'no-store')
    assert.equal(options?.body, undefined)
    assert.equal(new Headers(options?.headers).get('X-Cineverse-CSRF'), null)
    return Response.json({ profile })
  })
  assert.deepEqual(await profileService.get(), profile)
})

test('PATCH chỉ gửi field name đã trim, cookie và CSRF qua helper hiện có', async (t) => {
  mock(t, async (url, options) => {
    assert.equal(url, '/api/profile')
    assert.equal(options?.method, 'PATCH')
    assert.equal(options?.credentials, 'same-origin')
    assert.equal(options?.cache, 'no-store')
    assert.deepEqual(JSON.parse(String(options?.body)), { name: 'Tên mới 🎬' })
    assert.equal(new Headers(options?.headers).get('X-Cineverse-CSRF'), '1')
    assert.equal(
      new Headers(options?.headers).get('Content-Type'),
      'application/json',
    )
    return Response.json({ profile: { ...profile, name: 'Tên mới 🎬' } })
  })
  assert.equal(
    (await profileService.update('  Tên mới 🎬  ')).name,
    'Tên mới 🎬',
  )
})

test('PATCH tên sai bị chặn trước fetch; không ép kiểu', async (t) => {
  let calls = 0
  mock(t, async () => {
    calls++
    return Response.json({ profile })
  })
  for (const value of [
    '',
    '   ',
    'A'.repeat(101),
    'A\u0001B',
    42 as unknown as string,
  ])
    await assert.rejects(profileService.update(value), {
      code: 'VALIDATION_ERROR',
      status: 400,
    })
  assert.equal(calls, 0)
})

test('PATCH 200 nhưng DTO tên khác yêu cầu không báo lưu thành công', async (t) => {
  mock(t, async () => Response.json({ profile }))
  await assert.rejects(profileService.update('Tên cần lưu'), {
    code: 'INVALID_RESPONSE',
  })
})

for (const status of [401, 403, 429, 500, 503])
  test(`GET/PATCH HTTP ${status} an toàn, giữ status/code/Retry-After`, async (t) => {
    mock(t, async () =>
      Response.json(
        {
          error: {
            code: status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR',
            message: 'PRIVATE connection cookie/token',
            fields: { email: 'discard' },
          },
        },
        { status, headers: { 'Retry-After': '30' } },
      ),
    )
    for (const operation of [
      () => profileService.get(),
      () => profileService.update('Valid'),
    ])
      await assert.rejects(
        operation(),
        (error: unknown) =>
          error instanceof ProfileApiError &&
          error.status === status &&
          error.retryAfter === 30 &&
          !error.message.includes('PRIVATE') &&
          Object.keys(error.fields).length === 0,
      )
  })

test('400 field error chỉ giữ name bằng message client, không message server thô', async (t) => {
  mock(t, async () =>
    Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'PRIVATE SQL',
          fields: { name: 'PRIVATE name', passwordHash: 'discard' },
        },
      },
      { status: 400 },
    ),
  )
  await assert.rejects(
    profileService.update('Valid'),
    (error: unknown) =>
      error instanceof ProfileApiError &&
      !!error.fields.name &&
      !JSON.stringify(error).includes('PRIVATE') &&
      Object.keys(error.fields).join() === 'name',
  )
})

test('GET/PATCH chỉ xác nhận 200 + DTO hợp lệ; không thành công với 201/204/malformed JSON', async (t) => {
  mock(t, async () => Response.json({ profile }, { status: 201 }))
  await assert.rejects(profileService.update('Valid'), {
    code: 'INVALID_RESPONSE',
  })
  globalThis.fetch = async () => new Response(null, { status: 204 })
  await assert.rejects(profileService.update('Valid'), {
    code: 'INVALID_RESPONSE',
  })
  globalThis.fetch = async () => new Response('bad JSON')
  await assert.rejects(profileService.get(), { code: 'INVALID_RESPONSE' })
  globalThis.fetch = async () =>
    Response.json({ profile: { ...profile, favoriteCount: 'bad' } })
  await assert.rejects(profileService.update('Valid'), {
    code: 'INVALID_RESPONSE',
  })
})

test('Network error không lộ raw detail; abort được chuyển tiếp, không dùng late response', async (t) => {
  mock(t, async () => {
    throw new Error('PRIVATE network info')
  })
  await assert.rejects(
    profileService.get(),
    (error: unknown) =>
      error instanceof ProfileApiError &&
      error.code === 'NETWORK_ERROR' &&
      !error.message.includes('PRIVATE'),
  )
  const controller = new AbortController()
  globalThis.fetch = async (_url, options) => {
    assert.ok(options?.signal)
    controller.abort()
    return Response.json({ profile })
  }
  await assert.rejects(profileService.get(controller.signal), {
    name: 'AbortError',
  })
})
