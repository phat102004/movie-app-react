import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { createProxyServer } from '../proxy.mjs'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const dataFor = url => url.pathname.includes('/genre/') ? { genres: [] } :
  /^\/3\/movie\/\d+$/.test(url.pathname)
    ? { id: Number(url.pathname.split('/').at(-1)), genres: [], videos: { results: [] }, recommendations: { results: [] } }
    : { page: 1, results: [] }

async function fixture(t, options, onRequest = () => {}) {
  const server = createProxyServer({ token: 'synthetic-private-tmdb-token', ...options })
  let count = 0
  server.on('request', (request, response) => onRequest(request, response, ++count))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const get = (path = '/api/movies/popular', options) => fetch(base + path, options)
  return { get }
}

test('HTTP H03 regression: 24 identical requests create exactly one in-flight fetch, then new request fetches again', { timeout: 5000 }, async t => {
  const gate = deferred(), arrived = deferred()
  let calls = 0
  const { get } = await fixture(t, {
    fetchImpl: async url => { calls++; await gate.promise; return Response.json(dataFor(url)) },
  }, (_req, _res, count) => { if (count === 24) arrived.resolve() })
  const pending = Array.from({ length: 24 }, () => get())
  await arrived.promise
  assert.equal(calls, 1)
  gate.resolve()
  for (const response of await Promise.all(pending)) {
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { page: 1, results: [] })
  }
  assert.equal((await get()).status, 200)
  assert.equal(calls, 2)
})

test('All TMDB endpoint kinds share concurrency slots, held through JSON reading', { timeout: 5000 }, async t => {
  const paths = ['/api/movies/popular', '/api/movies/now_playing', '/api/movies/top_rated',
    '/api/genres', '/api/movies/1', '/api/movies/2', '/api/movies/1/videos', '/api/movies/1/recommendations']
  const gate = deferred(), arrived = deferred()
  let active = 0, peak = 0, calls = 0
  const { get } = await fixture(t, {
    maxConcurrent: 3,
    fetchImpl: async url => {
      calls++; active++; peak = Math.max(peak, active)
      return { ok: true, json: async () => { await gate.promise; active--; return dataFor(url) } }
    },
  }, (_req, _res, count) => { if (count === paths.length) arrived.resolve() })
  const pending = paths.map(path => get(path))
  await arrived.promise
  assert.equal(calls, 3)
  assert.equal(peak, 3)
  gate.resolve()
  for (const response of await Promise.all(pending)) assert.equal(response.status, 200)
  assert.equal(calls, paths.length)
  assert.equal(peak, 3)
  assert.equal(active, 0)
})

test('Default concurrency is six: 24 unique HTTP resources complete with upstream peak exactly six', { timeout: 5000 }, async t => {
  const gate = deferred(), arrived = deferred()
  let active = 0, peak = 0, calls = 0
  const { get } = await fixture(t, {
    fetchImpl: async url => {
      calls++; active++; peak = Math.max(peak, active)
      await gate.promise
      active--
      return Response.json(dataFor(url))
    },
  }, (_req, _res, count) => { if (count === 24) arrived.resolve() })
  const pending = Array.from({ length: 24 }, (_, index) => get(`/api/movies/${index + 1}`))
  await arrived.promise
  assert.equal(calls, 6)
  assert.equal(active, 6)
  gate.resolve()
  for (const response of await Promise.all(pending)) assert.equal(response.status, 200)
  assert.equal(calls, 24)
  assert.equal(peak, 6)
})

test('Bounded HTTP queue overflows with safe 503 + Retry-After and continues afterwards', { timeout: 5000 }, async t => {
  const gate = deferred(), started = deferred(), arrived = deferred()
  let calls = 0
  const { get } = await fixture(t, {
    maxConcurrent: 1, maxQueue: 1,
    fetchImpl: async url => { calls++; started.resolve(); await gate.promise; return Response.json(dataFor(url)) },
  }, (_req, _res, count) => { if (count === 2) arrived.resolve() })
  const first = get('/api/movies/popular')
  await started.promise
  const second = get('/api/genres')
  await arrived.promise
  const overflow = await get('/api/movies/top_rated')
  assert.equal(overflow.status, 503)
  assert.equal(overflow.headers.get('retry-after'), '1')
  assert.equal((await overflow.json()).error.code, 'UPSTREAM_BUSY')
  assert.equal(calls, 1)
  gate.resolve()
  for (const response of await Promise.all([first, second])) assert.equal(response.status, 200)
  assert.equal((await get('/api/movies/top_rated')).status, 200)
  assert.equal(calls, 3)
})

test('HTTP subscriber cap also bounds identical requests without cancelling accepted subscribers', { timeout: 5000 }, async t => {
  const gate = deferred(), arrived = deferred()
  let calls = 0
  const { get } = await fixture(t, {
    maxWaiters: 2,
    fetchImpl: async url => { calls++; await gate.promise; return Response.json(dataFor(url)) },
  }, (_req, _res, count) => { if (count === 2) arrived.resolve() })
  const first = get(), second = get()
  await arrived.promise
  const overflow = await get()
  assert.equal(overflow.status, 503)
  assert.equal((await overflow.json()).error.code, 'UPSTREAM_BUSY')
  gate.resolve()
  for (const response of await Promise.all([first, second])) assert.equal(response.status, 200)
  assert.equal(calls, 1)
})

test('HTTP queue deadline returns 503, never starts expired job, and releases capacity', { timeout: 5000 }, async t => {
  const gate = deferred(), started = deferred()
  let calls = 0
  const { get } = await fixture(t, {
    maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 40,
    fetchImpl: async url => { calls++; started.resolve(); await gate.promise; return Response.json(dataFor(url)) },
  })
  const first = get()
  await started.promise
  const expired = await get('/api/genres')
  assert.equal(expired.status, 503)
  assert.equal(expired.headers.get('retry-after'), '1')
  assert.equal((await expired.json()).error.code, 'UPSTREAM_QUEUE_TIMEOUT')
  assert.equal(calls, 1)
  gate.resolve()
  assert.equal((await first).status, 200)
  assert.equal((await get('/api/genres')).status, 200)
  assert.equal(calls, 2)
})

test('One of two HTTP clients aborting leaves shared upstream alive for the other', { timeout: 5000 }, async t => {
  const gate = deferred(), started = deferred(), arrived = deferred(), closed = deferred()
  let upstreamSignal, calls = 0
  const { get } = await fixture(t, {
    fetchImpl: async (url, { signal }) => { calls++; upstreamSignal = signal; started.resolve(); await gate.promise; return Response.json(dataFor(url)) },
  }, (_req, res, count) => {
    if (count === 1) res.once('close', closed.resolve)
    if (count === 2) arrived.resolve()
  })
  const controller = new AbortController()
  const first = get(undefined, { signal: controller.signal })
  await started.promise
  const second = get()
  await arrived.promise
  const rejected = assert.rejects(first, { name: 'AbortError' })
  controller.abort()
  await rejected
  await closed.promise
  assert.equal(upstreamSignal.aborted, false)
  gate.resolve()
  assert.equal((await second).status, 200)
  assert.equal(calls, 1)
})

test('All HTTP clients aborting cancels shared upstream; a new same-key request succeeds', { timeout: 5000 }, async t => {
  const arrived = deferred(), aborted = deferred()
  let calls = 0
  const { get } = await fixture(t, {
    maxConcurrent: 1,
    fetchImpl: async (url, { signal }) => {
      calls++
      if (calls > 1) return Response.json(dataFor(url))
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        aborted.resolve(); reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true }))
    },
  }, (_req, _res, count) => { if (count === 2) arrived.resolve() })
  const a = new AbortController(), b = new AbortController()
  const first = get(undefined, { signal: a.signal }), second = get(undefined, { signal: b.signal })
  const settled = Promise.allSettled([first, second])
  await arrived.promise
  a.abort(); b.abort()
  await aborted.promise
  for (const result of await settled) assert.equal(result.reason.name, 'AbortError')
  assert.equal((await get()).status, 200)
  assert.equal(calls, 2)
})

test('Timeout while reading body returns 504 and releases slot for next endpoint', { timeout: 5000 }, async t => {
  const started = deferred()
  let calls = 0, wasAborted = false
  const { get } = await fixture(t, {
    maxConcurrent: 1, timeoutMs: 60,
    fetchImpl: async (url, { signal }) => {
      calls++
      if (calls > 1) return Response.json(dataFor(url))
      const stream = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"results":'))
        signal.addEventListener('abort', () => {
          wasAborted = true
          controller.error(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      } })
      started.resolve()
      return new Response(stream)
    },
  })
  const first = get()
  await started.promise
  const second = get('/api/genres')
  const timeout = await first
  assert.equal(timeout.status, 504)
  assert.equal((await timeout.json()).error.code, 'UPSTREAM_TIMEOUT')
  assert.equal(wasAborted, true)
  assert.equal((await second).status, 200)
  assert.equal(calls, 2)
})

for (const status of [404, 429, 500, 503]) {
  test(`Coalesced upstream ${status} preserves mapping, releases key, and never retries automatically`, { timeout: 5000 }, async t => {
    const gate = deferred(), arrived = deferred()
    let calls = 0, bodyCancelled = false
    const { get } = await fixture(t, {
      fetchImpl: async (_url, options) => {
        calls++
        assert.equal(options.redirect, 'error')
        await gate.promise
        return new Response(new ReadableStream({ cancel() { bodyCancelled = true } }), {
          status, headers: { 'Retry-After': '30' },
        })
      },
    }, (_req, _res, count) => { if (count === 2) arrived.resolve() })
    const pending = [get('/api/movies/27205'), get('/api/movies/27205')]
    await arrived.promise
    assert.equal(calls, 1)
    gate.resolve()
    for (const response of await Promise.all(pending)) {
      assert.equal(response.status, status >= 500 ? 502 : status)
      assert.equal((await response.json()).error.code, `TMDB_HTTP_${status}`)
      assert.equal(response.headers.get('retry-after'), status === 429 ? '30' : null)
    }
    assert.equal(bodyCancelled, true)
    assert.equal(calls, 1)
    assert.equal((await get('/api/movies/27205')).status, status >= 500 ? 502 : status)
    assert.equal(calls, 2)
  })
}

test('Shared network/JSON/schema errors do not leak raw details and next request can recover', { timeout: 5000 }, async t => {
  for (const fail of [
    () => { throw new TypeError('synthetic-private-tmdb-token internal-stack Authorization: Bearer synthetic') },
    () => new Response('synthetic-private-tmdb-token invalid JSON'),
    () => Response.json({ unexpected: 'synthetic-private-tmdb-token' }),
  ]) {
    const gate = deferred(), arrived = deferred()
    let calls = 0
    const { get } = await fixture(t, {
      fetchImpl: async url => { calls++; if (calls > 1) return Response.json(dataFor(url)); await gate.promise; return fail() },
    }, (_req, _res, count) => { if (count === 2) arrived.resolve() })
    const pending = [get(), get()]
    await arrived.promise
    gate.resolve()
    for (const response of await Promise.all(pending)) {
      assert.equal(response.status, 502)
      const text = await response.text()
      assert.equal(text.includes('synthetic-private-tmdb-token'), false)
      assert.equal(text.includes('internal-stack'), false)
      assert.equal(text.includes('Authorization'), false)
    }
    assert.equal(calls, 1)
    assert.equal((await get()).status, 200)
    assert.equal(calls, 2)
  }
})

test('Existing 404 convention remains unchanged for catalog versus genres endpoints', async t => {
  const { get } = await fixture(t, {
    fetchImpl: async () => Response.json({ internal: 'synthetic-private-tmdb-token' }, { status: 404 }),
  })
  for (const [path, status] of [['/api/movies/popular', 404], ['/api/genres', 502]]) {
    const response = await get(path)
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.error.code, 'TMDB_HTTP_404')
    assert.equal(JSON.stringify(body).includes('synthetic-private-tmdb-token'), false)
  }
})
