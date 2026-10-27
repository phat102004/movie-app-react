import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionRequestInit, isSessionFailure } from '../src/services/sessionHttp.ts'
import { favoritesService } from '../src/services/favorites.ts'
import { profileService } from '../src/services/profile.ts'
import { passwordChangeService } from '../src/services/passwordChange.ts'
import { authService } from '../src/services/auth.ts'

const owner = '00000000-0000-4000-8000-000000000001'
test('Account assertion is an extra header, preserving CSRF/credentials/deadline and body allowlists', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const calls: { path: string; init: RequestInit }[] = []
  const profile = { id: owner, name: 'Fixture', email: 'fixture@example.test', createdAt: '2026-10-28T00:00:00.000Z', favoriteCount: 0 }
  globalThis.fetch = async (path, init = {}) => {
    calls.push({ path: String(path), init })
    const headers = new Headers(init.headers)
    assert.equal(headers.get('X-Cineverse-Account'), owner)
    assert.equal(init.credentials, 'same-origin')
    assert.equal(init.cache, 'no-store')
    assert.ok(init.signal)
    if (init.method !== 'GET') assert.equal(headers.get('X-Cineverse-CSRF'), '1')
    if (String(path).includes('/auth/') || String(path).includes('change-password') || init.method === 'DELETE')
      return new Response(null, { status: 204 })
    if (path === '/api/profile') return Response.json({ profile })
    if (init.method === 'POST') return Response.json({ favorite: { movieId: 550, createdAt: profile.createdAt } }, { status: 201 })
    return Response.json({ favorites: [], nextCursor: null })
  }
  await favoritesService.listAll(undefined, owner)
  await favoritesService.add(550, undefined, owner)
  await favoritesService.remove(550, undefined, owner)
  await profileService.get(undefined, owner)
  await profileService.update('Fixture', undefined, owner)
  await passwordChangeService.change({ currentPassword: 'Synthetic password!', newPassword: 'Synthetic new password!' }, undefined, owner)
  await authService.logout(undefined, owner)
  assert.equal(calls.length, 7)
  for (const { init } of calls) {
    if (init.body) assert.equal(JSON.stringify(init.body).includes(owner), false)
  }
})

test('Only 401/session-mismatch resyncs; ordinary CSRF/Origin 403 does not loop', () => {
  assert.equal(isSessionFailure({ status: 401, code: 'UNAUTHENTICATED' }), true)
  assert.equal(isSessionFailure({ status: 403, code: 'SESSION_CHANGED' }), true)
  for (const code of ['CSRF_REJECTED', 'ORIGIN_FORBIDDEN', 'HTTP_ERROR'])
    assert.equal(isSessionFailure({ status: 403, code }), false)
  assert.equal(new Headers(sessionRequestInit('POST', undefined, {}).headers).has('X-Cineverse-Account'), false)
})

test('Private API services preserve SESSION_CHANGED without trusting server error text', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => Response.json({ error: { code: 'SESSION_CHANGED', message: 'PRIVATE server detail' } }, { status: 403 })
  for (const request of [
    () => favoritesService.add(550, undefined, owner),
    () => profileService.update('Fixture', undefined, owner),
    () => passwordChangeService.change({ currentPassword: 'Synthetic old!', newPassword: 'Synthetic new!' }, undefined, owner),
  ]) await assert.rejects(request(), (error: unknown) => {
    assert.ok(error instanceof Error && 'code' in error && 'status' in error)
    assert.equal(error.code, 'SESSION_CHANGED')
    assert.equal(error.status, 403)
    assert.equal(error.message.includes('PRIVATE'), false)
    return true
  })
})
