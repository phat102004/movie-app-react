import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createUpstreamScheduler, readTmdbProxyConfig } from '../upstream-scheduler.mjs'
import { tmdbRequestKey } from '../tmdb-client.mjs'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function scheduler(t, options = {}) {
  // Scheduler timers are intentionally unref'd in production. Keep unit tests alive.
  const alive = setTimeout(() => {}, 5000)
  t.after(() => clearTimeout(alive))
  return createUpstreamScheduler(options)
}

test('Scheduler config: bounded defaults and strict explicit environment settings', () => {
  assert.deepEqual(readTmdbProxyConfig({}), { maxConcurrent: 6, maxQueue: 32 })
  assert.deepEqual(readTmdbProxyConfig({ TMDB_MAX_CONCURRENT: '4', TMDB_MAX_QUEUE: '0' }), { maxConcurrent: 4, maxQueue: 0 })
  for (const [name, invalid] of [
    ['TMDB_MAX_CONCURRENT', ['0', '17', '-1', 'true', '', '4.5', '04', '1e1', ' 4']],
    ['TMDB_MAX_QUEUE', ['129', '-1', '', 'Infinity', '0.5', '01', ' ']],
  ]) for (const value of invalid) assert.throws(() => readTmdbProxyConfig({ [name]: value }), new RegExp(name))
  for (const options of [{ maxConcurrent: 0 }, { maxQueue: -1 }, { maxWaiters: 0 }, { timeoutMs: Infinity }, { queueTimeoutMs: 0 }])
    assert.throws(() => createUpstreamScheduler(options))
})

test('Canonical key sorts parameter names but separates page/language/filters/path and repeated value order', () => {
  const key = suffix => tmdbRequestKey('https://api.themoviedb.org/3/movie/popular' + suffix)
  assert.equal(key('?page=1&language=vi-VN'), key('?language=vi-VN&page=1'))
  assert.notEqual(key('?page=1&language=vi-VN'), key('?page=2&language=vi-VN'))
  assert.notEqual(key('?page=1&language=vi-VN'), key('?page=1&language=en-US'))
  assert.notEqual(key('?with_genres=28'), key('?with_genres=35'))
  assert.notEqual(key('?x=1&x=2'), key('?x=2&x=1'))
  assert.notEqual(key(''), tmdbRequestKey('https://api.themoviedb.org/3/genre/movie/list'))
  for (const url of ['http://api.themoviedb.org/3/movie/1', 'https://example.com/3/movie/1',
    'https://synthetic-user:synthetic-password@api.themoviedb.org/3/movie/1',
    'https://api.themoviedb.org/3/movie/1#fragment',
    'https://api.themoviedb.org/3/movie/1?api_key=synthetic'])
    assert.throws(() => tmdbRequestKey(url))
})

test('24 identical in-flight requests share one job; no result retained after completion', async t => {
  const s = scheduler(t)
  const gate = deferred()
  let calls = 0
  const work = () => { calls++; return gate.promise }
  const pending = Array.from({ length: 24 }, () => s.run('same', work))
  assert.deepEqual(s.getStats(), { active: 1, queued: 0, inflight: 1, waiters: 24 })
  gate.resolve({ results: [] })
  for (const result of await Promise.all(pending)) assert.deepEqual(result, { results: [] })
  assert.equal(calls, 1)
  assert.deepEqual(s.getStats(), { active: 0, queued: 0, inflight: 0, waiters: 0 })
  await s.run('same', work)
  assert.equal(calls, 2)
})

test('Different page/language requests are never deduplicated', async t => {
  const s = scheduler(t)
  const gate = deferred()
  let calls = 0
  const keys = ['?page=1&language=vi-VN', '?page=2&language=vi-VN', '?page=1&language=en-US']
  const pending = keys.map(query => s.run(tmdbRequestKey('https://api.themoviedb.org/3/movie/popular' + query), () => { calls++; return gate.promise }))
  assert.equal(calls, 3)
  gate.resolve('done')
  await Promise.all(pending)
})

test('Concurrency shared across jobs, bounded FIFO queue, duplicate queued jobs consume no extra queue slot', async t => {
  const s = scheduler(t, { maxConcurrent: 2, maxQueue: 2 })
  const gates = Array.from({ length: 4 }, deferred)
  const started = []
  const jobs = gates.map((gate, i) => s.run(String(i), () => { started.push(i); return gate.promise }))
  const duplicate = s.run('2', () => { throw new Error('Must share queued job') })
  assert.deepEqual(started, [0, 1])
  assert.deepEqual(s.getStats(), { active: 2, queued: 2, inflight: 4, waiters: 5 })
  await assert.rejects(s.run('overflow', () => {}), { status: 503, code: 'UPSTREAM_BUSY' })
  gates[1].resolve('one')
  await jobs[1]
  assert.deepEqual(started, [0, 1, 2])
  gates[0].resolve('zero')
  await jobs[0]
  assert.deepEqual(started, [0, 1, 2, 3])
  gates[2].resolve('two'); gates[3].resolve('three')
  assert.deepEqual(await Promise.all([...jobs, duplicate]), ['zero', 'one', 'two', 'three', 'two'])
  assert.deepEqual(s.getStats(), { active: 0, queued: 0, inflight: 0, waiters: 0 })
})

test('Global waiter cap bounds duplicate subscribers too; capacity is reusable', async t => {
  const s = scheduler(t, { maxWaiters: 2 })
  const gate = deferred()
  const first = s.run('a', () => gate.promise)
  const second = s.run('a', () => gate.promise)
  await assert.rejects(s.run('a', () => {}), { status: 503, code: 'UPSTREAM_BUSY' })
  await assert.rejects(s.run('b', () => {}), { status: 503, code: 'UPSTREAM_BUSY' })
  gate.resolve('ok')
  await Promise.all([first, second])
  assert.equal(await s.run('b', async () => 'next'), 'next')
})

test('Queue disabled still admits coalesced work but refuses new unique jobs', async t => {
  const s = scheduler(t, { maxConcurrent: 1, maxQueue: 0 })
  const gate = deferred()
  const first = s.run('a', () => gate.promise)
  const same = s.run('a', () => gate.promise)
  await assert.rejects(s.run('b', () => {}), { code: 'UPSTREAM_BUSY' })
  gate.resolve('ok')
  await Promise.all([first, same])
})

test('One client abort only detaches itself; remaining client receives shared data', async t => {
  const s = scheduler(t)
  const gate = deferred()
  const controller = new AbortController()
  let upstreamSignal
  const first = s.run('a', signal => { upstreamSignal = signal; return gate.promise }, { signal: controller.signal })
  const second = s.run('a', () => { throw new Error('Must share') })
  const rejected = assert.rejects(first, { name: 'AbortError' })
  controller.abort()
  await rejected
  assert.equal(upstreamSignal.aborted, false)
  assert.equal(s.getStats().waiters, 1)
  gate.resolve('ok')
  assert.equal(await second, 'ok')
})

test('All subscribers abort running work: abort upstream and release slot for queued work', async t => {
  const s = scheduler(t, { maxConcurrent: 1 })
  const a = new AbortController(), b = new AbortController()
  let signal
  const first = s.run('a', upstream => {
    signal = upstream
    return new Promise((_resolve, reject) => upstream.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  }, { signal: a.signal })
  const second = s.run('a', () => {}, { signal: b.signal })
  const settled = Promise.allSettled([first, second])
  const next = s.run('b', async () => 'next')
  a.abort()
  assert.equal(signal.aborted, false)
  b.abort()
  assert.equal(signal.aborted, true)
  assert.equal(await next, 'next')
  assert.equal((await settled).every(result => result.reason.name === 'AbortError'), true)
  assert.deepEqual(s.getStats(), { active: 0, queued: 0, inflight: 0, waiters: 0 })
})

test('Aborted queued job never invokes work and frees queue capacity immediately', async t => {
  const s = scheduler(t, { maxConcurrent: 1, maxQueue: 1 })
  const gate = deferred(), controller = new AbortController()
  const active = s.run('a', () => gate.promise)
  let calls = 0
  const queued = s.run('b', () => { calls++ }, { signal: controller.signal })
  const rejected = assert.rejects(queued, { name: 'AbortError' })
  controller.abort()
  await rejected
  assert.equal(s.getStats().queued, 0)
  const next = s.run('c', async () => 'c')
  gate.resolve('a')
  await active
  assert.equal(await next, 'c')
  assert.equal(calls, 0)
})

test('Queue deadline frees key/capacity and never starts expired work', async t => {
  const s = scheduler(t, { maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 30 })
  const gate = deferred()
  const active = s.run('a', () => gate.promise)
  let calls = 0
  await assert.rejects(s.run('b', () => { calls++ }), { status: 503, code: 'UPSTREAM_QUEUE_TIMEOUT' })
  assert.deepEqual(s.getStats(), { active: 1, queued: 0, inflight: 1, waiters: 1 })
  const next = s.run('b', async () => 'new')
  gate.resolve('a')
  await active
  assert.equal(await next, 'new')
  assert.equal(calls, 0)
})

test('Timeout rejects every waiter, aborts work and releases slot for next job', async t => {
  const s = scheduler(t, { maxConcurrent: 1, timeoutMs: 30 })
  let signal
  const first = s.run('a', upstream => {
    signal = upstream
    return new Promise((_resolve, reject) => upstream.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  })
  const second = s.run('a', () => {})
  const results = Promise.allSettled([first, second])
  const next = s.run('b', async () => 'b')
  for (const result of await results) assert.equal(result.reason.code, 'UPSTREAM_TIMEOUT')
  assert.equal(signal.aborted, true)
  assert.equal(await next, 'b')
  assert.deepEqual(s.getStats(), { active: 0, queued: 0, inflight: 0, waiters: 0 })
})

test('Network rejection and synchronous throw cannot poison key or stall following work', async t => {
  const s = scheduler(t, { maxConcurrent: 1 })
  const gate = deferred()
  const first = s.run('a', () => gate.promise)
  const rejected = assert.rejects(first, /synthetic network error/)
  const next = s.run('b', async () => 'b')
  gate.reject(new Error('synthetic network error'))
  await rejected
  assert.equal(await next, 'b')
  await assert.rejects(s.run('a', () => { throw new Error('sync') }), /sync/)
  assert.equal(await s.run('a', async () => 'recovered'), 'recovered')
})

test('Late work ignoring abort cannot exceed physical concurrency or delete newer same-key job', async t => {
  const s = scheduler(t, { maxConcurrent: 1, timeoutMs: 30 })
  const gate = deferred()
  const old = s.run('a', () => gate.promise)
  await assert.rejects(old, { code: 'UPSTREAM_TIMEOUT' })
  assert.deepEqual(s.getStats(), { active: 1, queued: 0, inflight: 0, waiters: 0 })
  const newer = s.run('a', async () => 'fresh')
  assert.equal(s.getStats().queued, 1)
  gate.reject(new Error('late failure deliberately ignoring abort'))
  assert.equal(await newer, 'fresh')
  await nextTurn()
  assert.deepEqual(s.getStats(), { active: 0, queued: 0, inflight: 0, waiters: 0 })
})

test('Pre-aborted subscriber never creates job or invokes upstream', async t => {
  const s = scheduler(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(s.run('a', () => { throw new Error('Must not run') }, { signal: controller.signal }), { name: 'AbortError' })
  assert.deepEqual(s.getStats(), { active: 0, queued: 0, inflight: 0, waiters: 0 })
})

test('Falsy promise rejection is still a failure and cannot resolve as successful undefined data', async t => {
  const s = scheduler(t)
  for (const error of [undefined, null, false, 0, ''])
    await assert.rejects(s.run('a', () => Promise.reject(error)), /Upstream task failed/)
  assert.equal(await s.run('a', async () => 'ok'), 'ok')
})
