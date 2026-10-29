import assert from 'node:assert/strict'
import test from 'node:test'
import { withRequestDeadline } from '../src/services/requestDeadline.ts'
import { ApiError, getGenres, parseMovieDetails } from '../src/services/tmdb.ts'
import { validateProfileName } from '../src/utils/profileForm.ts'
import { validateRegisterForm } from '../src/utils/authForm.ts'

test('M01: deadline covers hung fetch, rejects even if transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal: AbortSignal | undefined
  const pending = withRequestDeadline(async value => { signal = value; return new Promise(() => {}) }, undefined, 100)
  const rejected = assert.rejects(pending, { name: 'TimeoutError' })
  await Promise.resolve()
  t.mock.timers.tick(100)
  await rejected
  assert.equal(signal?.aborted, true)
})

test('M01: body read is within service deadline; timeout has specific ApiError', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let reading!: () => void
  const started = new Promise<void>(resolve => { reading = resolve })
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: () => { reading(); return new Promise(() => {}) } }) as unknown as Response)
  const pending = getGenres()
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof ApiError && error.code === 'REQUEST_TIMEOUT')
  await started
  t.mock.timers.tick(12_000)
  await rejected
})

test('M01: caller abort is preserved, already-aborted caller never fetches', async t => {
  const controller = new AbortController()
  let called = false
  controller.abort()
  await assert.rejects(withRequestDeadline(async () => { called = true }, controller.signal), { name: 'AbortError' })
  assert.equal(called, false)
  const other = new AbortController()
  let workSignal: AbortSignal | undefined
  const pending = withRequestDeadline(async signal => { workSignal = signal; return new Promise(() => {}) }, other.signal)
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await Promise.resolve()
  other.abort()
  await rejected
  assert.equal(workSignal?.aborted, true)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const clear = t.mock.method(globalThis, 'clearTimeout')
  assert.equal(await withRequestDeadline(async () => 'ok'), 'ok')
  assert.ok(clear.mock.callCount() > 0)
})

const core = { id: 27205, title: 'Inception', genres: [], production_countries: [] }
const video = { id: 'v', key: 'YoHD9XEInc0', name: 'Trailer', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en' }
test('M02: missing/error optional aggregates keep core movie and expose warning', () => {
  for (const optional of [undefined, null, { success: false }, { results: 'bad' }]) {
    const movie = parseMovieDetails({ ...core, videos: optional, recommendations: optional })
    assert.equal(movie.title, 'Inception')
    assert.deepEqual(movie.videos.results, [])
    assert.deepEqual(movie.recommendations.results, [])
    assert.equal(movie.metadataWarnings?.length, 2)
  }
})
test('M02: optional records degrade individually; malformed primary data stays fatal', () => {
  const movie = parseMovieDetails({ ...core, videos: { results: [video, {}] },
    recommendations: { page: 1, results: [{ id: 42, title: 'Valid', genre_ids: [] }, { id: 'invalid' }] } })
  assert.equal(movie.videos.results.length, 1)
  assert.equal(movie.recommendations.results[0].id, 42)
  assert.equal(movie.metadataWarnings?.length, 2)
  for (const invalid of [{ ...core, id: 'bad' }, { ...core, title: 5 }, { ...core, genres: null }])
    assert.throws(() => parseMovieDetails(invalid), ApiError)
})
test('L01: frontend Register/Profile reject every C1 control, preserve legitimate Unicode', () => {
  for (let point = 127; point <= 159; point++) {
    const name = 'A' + String.fromCodePoint(point) + 'B'
    assert.ok(validateProfileName(name).error)
    assert.ok(validateRegisterForm({ name, email: 'fixture@example.test', password: 'SyntheticPassword!', confirmPassword: 'SyntheticPassword!' }).name)
  }
  for (const name of ['Nguyễn Thị Ánh', '李明', 'A\u200dB', 'مريم', '😀'])
    assert.equal(validateProfileName(name).error, null)
})
