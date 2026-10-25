import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createProxyServer } from '../proxy.mjs'

async function startServer(t, options) {
  const server = createProxyServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(resolve)
      }),
  )
  return `http://127.0.0.1:${server.address().port}`
}

test('thiếu token trả 503 và không gọi upstream', async (t) => {
  const base = await startServer(t, {
    fetchImpl: () => {
      throw new Error('Không được gọi')
    },
  })
  const response = await fetch(`${base}/api/movies/popular`)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'TMDB_NOT_CONFIGURED')
})

test('chỉ cho phép endpoint đã khai báo, không nhận URL hoặc query tùy ý', async (t) => {
  const base = await startServer(t, {
    token: 'test-token',
    fetchImpl: () => {
      throw new Error('Không được gọi')
    },
  })
  for (const path of [
    '/api/search/movie',
    '/api/movies/42/credits',
    '/api/movies/popular?url=https://example.com',
  ]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404)
  }
  const response = await fetch(`${base}/api/genres`, { method: 'POST' })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
})

test('proxy dùng Bearer ở server, vi-VN và trang 1, trả JSON phim/thể loại', async (t) => {
  const calls = []
  const base = await startServer(t, {
    token: 'fixture-private-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return Response.json(
        url.pathname.includes('/genre/')
          ? { genres: [{ id: 28, name: 'Hành động' }] }
          : { page: 1, results: [{ id: 1 }] },
      )
    },
  })
  for (const path of [
    '/api/movies/popular',
    '/api/movies/now_playing',
    '/api/movies/top_rated',
    '/api/genres',
  ]) {
    const response = await fetch(`${base}${path}`)
    assert.equal(response.status, 200)
    assert.equal(
      (await response.text()).includes('fixture-private-token'),
      false,
    )
  }
  assert.equal(calls.length, 4)
  for (const { url, options } of calls) {
    assert.equal(url.origin, 'https://api.themoviedb.org')
    assert.equal(url.searchParams.get('language'), 'vi-VN')
    assert.equal(options.headers.Authorization, 'Bearer fixture-private-token')
    assert.equal(url.searchParams.has('api_key'), false)
    if (url.pathname.startsWith('/3/movie/'))
      assert.equal(url.searchParams.get('page'), '1')
  }
})

for (const status of [401, 403, 429, 500]) {
  test(`upstream ${status} có thông báo an toàn và status phù hợp`, async (t) => {
    const base = await startServer(t, {
      token: 'fixture-private-token',
      fetchImpl: async () =>
        Response.json(
          { status_message: 'fixture-private-token' },
          { status, headers: { 'Retry-After': '30' } },
        ),
    })
    const response = await fetch(`${base}/api/movies/popular`)
    assert.equal(response.status, status === 500 ? 502 : status)
    const data = await response.json()
    assert.equal(data.error.code, `TMDB_HTTP_${status}`)
    assert.equal(JSON.stringify(data).includes('fixture-private-token'), false)
    if (status === 429) assert.equal(response.headers.get('retry-after'), '30')
  })
}

test('mạng lỗi và JSON không hợp lệ trả lỗi 502, không làm crash server', async (t) => {
  for (const fetchImpl of [
    async () => {
      throw new TypeError('network')
    },
    async () => new Response('invalid JSON'),
    async () => Response.json({ unexpected: [] }),
  ]) {
    const base = await startServer(t, { token: 'fixture', fetchImpl })
    assert.equal((await fetch(`${base}/api/movies/popular`)).status, 502)
  }
})

test('timeout hủy upstream và trả 504', async (t) => {
  let aborted = false
  const base = await startServer(t, {
    token: 'fixture',
    timeoutMs: 25,
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        )
      }),
  })
  assert.equal((await fetch(`${base}/api/movies/popular`)).status, 504)
  assert.equal(aborted, true)
})

test('client hủy request cũng hủy request TMDB', async (t) => {
  let notifyStarted
  let notifyAborted
  const started = new Promise((resolve) => {
    notifyStarted = resolve
  })
  const aborted = new Promise((resolve) => {
    notifyAborted = resolve
  })
  const base = await startServer(t, {
    token: 'fixture',
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        notifyStarted()
        signal.addEventListener(
          'abort',
          () => {
            notifyAborted()
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        )
      }),
  })
  const controller = new AbortController()
  const pending = fetch(`${base}/api/movies/popular`, {
    signal: controller.signal,
  })
  await started
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  await aborted
})

test('mảng phim rỗng là response thành công, không tự thêm phim mẫu', async (t) => {
  const base = await startServer(t, {
    token: 'fixture',
    fetchImpl: async () => Response.json({ page: 1, results: [] }),
  })
  const response = await fetch(`${base}/api/movies/popular`)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).results, [])
})

test('details proxy ghép videos/recommendations, giữ origin cố định và không gắn page cho details', async (t) => {
  const base = await startServer(t, {
    token: 'private-fixture',
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, 'https://api.themoviedb.org')
      assert.equal(url.pathname, '/3/movie/27205')
      assert.equal(
        url.searchParams.get('append_to_response'),
        'videos,recommendations,credits',
      )
      assert.equal(url.searchParams.get('include_video_language'), 'vi,en,null')
      assert.equal(url.searchParams.get('language'), 'vi-VN')
      assert.equal(url.searchParams.has('page'), false)
      assert.equal(options.headers.Authorization, 'Bearer private-fixture')
      return Response.json({
        id: 27205,
        genres: [],
        videos: { results: [] },
        recommendations: { page: 1, results: [] },
      })
    },
  })
  const response = await fetch(`${base}/api/movies/27205`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).id, 27205)
})

test('ID không hợp lệ trả 400 trước khi gọi TMDB, endpoint/query ngoài allowlist bị chặn', async (t) => {
  let calls = 0
  const base = await startServer(t, {
    token: 'fixture',
    fetchImpl: async () => {
      calls++
      return Response.json({})
    },
  })
  for (const id of [
    'invalid',
    '0',
    '-1',
    '01',
    '1.5',
    '1e3',
    '2147483648',
    '999999999999999999999999',
  ]) {
    const response = await fetch(`${base}/api/movies/${id}`)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'INVALID_MOVIE_ID')
  }
  for (const path of [
    '/api/movies/42/credits',
    '/api/movies/42/videos/extra',
    '/api/movies/42?url=https://example.com',
    '/api/movies/42?append_to_response=credits',
  ])
    assert.equal((await fetch(base + path)).status, 404)
  assert.equal(
    (await fetch(`${base}/api/movies/42`, { method: 'POST' })).status,
    405,
  )
  assert.equal(calls, 0)
})

test('videos và recommendations chỉ nhận ID hợp lệ, page chỉ dùng cho recommendations', async (t) => {
  const base = await startServer(t, {
    token: 'fixture',
    fetchImpl: async (url) => {
      assert.equal(url.origin, 'https://api.themoviedb.org')
      assert.equal(
        url.searchParams.has('page'),
        url.pathname.endsWith('/recommendations'),
      )
      assert.equal(url.searchParams.has('append_to_response'), false)
      return Response.json({ id: 27205, page: 1, results: [] })
    },
  })
  for (const suffix of ['videos', 'recommendations'])
    assert.equal(
      (await fetch(`${base}/api/movies/27205/${suffix}`)).status,
      200,
    )
})

for (const status of [400, 404, 429, 500]) {
  test(`details upstream ${status} có lỗi an toàn, không lộ nội dung upstream`, async (t) => {
    const base = await startServer(t, {
      token: 'secret-fixture',
      fetchImpl: async () =>
        Response.json(
          { token: 'secret-fixture', internal: 'private-stack' },
          { status },
        ),
    })
    const response = await fetch(`${base}/api/movies/27205`)
    assert.equal(response.status, status === 500 ? 502 : status)
    const data = await response.json()
    assert.equal(data.error.code, `TMDB_HTTP_${status}`)
    assert.equal(JSON.stringify(data).includes('secret-fixture'), false)
    assert.equal(JSON.stringify(data).includes('private-stack'), false)
  })
}

test('details sai ID hoặc thiếu JSON aggregate trả 502', async (t) => {
  for (const data of [
    {
      id: 42,
      genres: [],
      videos: { results: [] },
      recommendations: { results: [] },
    },
    { id: 27205, genres: [] },
  ]) {
    const base = await startServer(t, {
      token: 'fixture',
      fetchImpl: async () => Response.json(data),
    })
    assert.equal((await fetch(`${base}/api/movies/27205`)).status, 502)
  }
})

test('credits thiếu hoặc sai cấu trúc không chặn response chi tiết chính', async (t) => {
  for (const credits of [undefined, null, { cast: 'bad', crew: null }]) {
    const base = await startServer(t, {
      token: 'fixture',
      fetchImpl: async (url) => {
        assert.equal(
          url.searchParams.get('append_to_response'),
          'videos,recommendations,credits',
        )
        return Response.json({
          id: 27205,
          genres: [],
          videos: { results: [] },
          recommendations: { page: 1, results: [] },
          credits,
        })
      },
    })
    const response = await fetch(`${base}/api/movies/27205`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).id, 27205)
  }
})
