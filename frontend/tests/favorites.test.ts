import assert from 'node:assert/strict'
import test from 'node:test'
import {
  favoritesService,
  FavoritesApiError,
  parseFavorite,
  parseFavoritePage,
} from '../src/services/favorites.ts'
import { loadFavoriteMovies } from '../src/services/favoriteMovies.ts'
import { ApiError } from '../src/services/tmdb.ts'
import type { TmdbMovieDetails } from '../src/types/tmdb.ts'
import type { FavoriteMovieResult } from '../src/services/favoriteMovies.ts'

const row = (movieId = 550) => ({
  movieId,
  createdAt: '2026-10-26T10:00:00.000Z',
})
const originalFetch = globalThis.fetch
function mockFetch(t: { after(fn: () => void): void }, fetcher: typeof fetch) {
  globalThis.fetch = fetcher
  t.after(() => {
    globalThis.fetch = originalFetch
  })
}

test('Favorite DTO chỉ giữ movieId/createdAt, từ chối ID và timestamp sai', () => {
  assert.deepEqual(
    parseFavorite({ ...row(), userId: 'discard', token: 'discard' }),
    row(),
  )
  for (const movieId of ['550', 0, -1, 1.1, NaN, Infinity, 2147483648, null])
    assert.throws(() => parseFavorite({ ...row(), movieId }), FavoritesApiError)
  for (const createdAt of ['', null, '2026-02-30T10:00:00.000Z', '2026-01-01'])
    assert.throws(
      () => parseFavorite({ ...row(), createdAt }),
      FavoritesApiError,
    )
})

test('Page validate JSON shape, giới hạn 100, cursor hợp lệ/rỗng', () => {
  assert.deepEqual(parseFavoritePage({ favorites: [], nextCursor: null }), {
    favorites: [],
    nextCursor: null,
  })
  for (const value of [
    null,
    {},
    { favorites: [], nextCursor: 'abc' },
    { favorites: [row()], nextCursor: 'bad cursor' },
    { favorites: [row()] },
    { favorites: Array.from({ length: 101 }, () => row()), nextCursor: null },
  ])
    assert.throws(() => parseFavoritePage(value), FavoritesApiError)
})

test('GET rỗng dùng relative URL, cookie same-origin/no-store, không CSRF hoặc body', async (t) => {
  mockFetch(t, async (url, init) => {
    assert.equal(url, '/api/favorites')
    assert.equal(init?.credentials, 'same-origin')
    assert.equal(init?.cache, 'no-store')
    assert.equal(init?.method, 'GET')
    assert.equal(init?.body, undefined)
    assert.equal(new Headers(init?.headers).get('X-Cineverse-CSRF'), null)
    return Response.json({ favorites: [], nextCursor: null })
  })
  assert.deepEqual(await favoritesService.listAll(), [])
})

test('Đọc tuần tự đủ 205 Favorite qua 3 pages, loại ID trùng, không chỉ lấy trang đầu', async (t) => {
  const calls: string[] = []
  mockFetch(t, async (url) => {
    calls.push(String(url))
    const page = calls.length
    const start = (page - 1) * 100 + 1
    return Response.json({
      favorites: Array.from({ length: page < 3 ? 100 : 5 }, (_, index) =>
        row(start + index),
      ),
      nextCursor: page < 3 ? `cursor${page}` : null,
    })
  })
  const all = await favoritesService.listAll()
  assert.equal(all.length, 205)
  assert.equal(all.at(-1)?.movieId, 205)
  assert.deepEqual(calls, [
    '/api/favorites',
    '/api/favorites?cursor=cursor1',
    '/api/favorites?cursor=cursor2',
  ])
})

test('Cursor lặp bị chặn, không lặp request vô hạn', async (t) => {
  let calls = 0
  mockFetch(t, async () => {
    calls++
    return Response.json({ favorites: [row()], nextCursor: 'loop' })
  })
  await assert.rejects(favoritesService.listAll(), { code: 'INVALID_RESPONSE' })
  assert.equal(calls, 2)
})

test('Giới hạn 100 trang báo lỗi thay vì trả list thiếu; không tải vô hạn', async (t) => {
  let calls = 0
  mockFetch(t, async () =>
    Response.json({ favorites: [row(++calls)], nextCursor: `page${calls}` }),
  )
  await assert.rejects(favoritesService.listAll(), { code: 'PAGINATION_LIMIT' })
  assert.equal(calls, 100)
})

test('Lỗi trang sau không trả partial list thành công', async (t) => {
  let calls = 0
  mockFetch(t, async () =>
    ++calls === 1
      ? Response.json({ favorites: [row()], nextCursor: 'next' })
      : Response.json(
          {
            error: {
              code: 'AUTH_UNAVAILABLE',
              message: 'internal private details',
            },
          },
          { status: 503 },
        ),
  )
  await assert.rejects(
    favoritesService.listAll(),
    (error: unknown) =>
      error instanceof FavoritesApiError &&
      error.status === 503 &&
      !error.message.includes('private'),
  )
})

for (const status of [200, 201])
  test(`POST ${status} hợp lệ: JSON, cookie và cùng CSRF policy của Auth`, async (t) => {
    mockFetch(t, async (url, init) => {
      assert.equal(url, '/api/favorites')
      assert.equal(init?.method, 'POST')
      assert.equal(init?.credentials, 'same-origin')
      assert.equal(init?.body, JSON.stringify({ movieId: 550 }))
      assert.equal(new Headers(init?.headers).get('X-Cineverse-CSRF'), '1')
      assert.equal(
        new Headers(init?.headers).get('Content-Type'),
        'application/json',
      )
      return Response.json({ favorite: row() }, { status })
    })
    assert.deepEqual(await favoritesService.add(550), row())
  })

test('POST response sai ID hoặc malformed JSON không báo thành công', async (t) => {
  mockFetch(t, async () =>
    Response.json({ favorite: row(42) }, { status: 201 }),
  )
  await assert.rejects(favoritesService.add(550), { code: 'INVALID_RESPONSE' })
  globalThis.fetch = async () => new Response('bad-json', { status: 201 })
  await assert.rejects(favoritesService.add(550), { code: 'INVALID_RESPONSE' })
})

test('DELETE 204 không parse JSON, không body/Content-Type, vẫn có cookie và CSRF', async (t) => {
  mockFetch(t, async (url, init) => {
    assert.equal(url, '/api/favorites/550')
    assert.equal(init?.method, 'DELETE')
    assert.equal(init?.credentials, 'same-origin')
    assert.equal(init?.body, undefined)
    assert.equal(new Headers(init?.headers).get('Content-Type'), null)
    assert.equal(new Headers(init?.headers).get('X-Cineverse-CSRF'), '1')
    const response = new Response(null, { status: 204 })
    response.json = async () => {
      throw new Error('Must not parse 204')
    }
    return response
  })
  await favoritesService.remove(550)
})

test('DELETE 200 không được xác nhận như 204; ID sai không gọi fetch', async (t) => {
  let calls = 0
  mockFetch(t, async () => {
    calls++
    return Response.json({})
  })
  await assert.rejects(favoritesService.remove(550), {
    code: 'INVALID_RESPONSE',
  })
  for (const id of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    2147483648,
    '550' as unknown as number,
  ]) {
    await assert.rejects(favoritesService.add(id), { code: 'INVALID_MOVIE_ID' })
    await assert.rejects(favoritesService.remove(id), {
      code: 'INVALID_MOVIE_ID',
    })
  }
  assert.equal(calls, 1)
})

for (const status of [401, 403, 429, 500, 503])
  test(`HTTP ${status} giữ status/code, chỉ dùng message client, không raw exception`, async (t) => {
    mockFetch(t, async () =>
      Response.json(
        {
          error: {
            code: status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR',
            message: 'PRIVATE database/session details',
          },
        },
        { status, headers: { 'Retry-After': '30' } },
      ),
    )
    for (const operation of [
      () => favoritesService.listAll(),
      () => favoritesService.add(550),
      () => favoritesService.remove(550),
    ])
      await assert.rejects(
        operation(),
        (error: unknown) =>
          error instanceof FavoritesApiError &&
          error.status === status &&
          error.retryAfter === 30 &&
          !error.message.includes('PRIVATE'),
      )
  })

test('Network error an toàn; abort dừng paging, không tạo request tiếp theo', async (t) => {
  mockFetch(t, async () => {
    throw new Error('PRIVATE network')
  })
  await assert.rejects(favoritesService.add(550), { code: 'NETWORK_ERROR' })
  const controller = new AbortController()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    controller.abort()
    return Response.json({ favorites: [row()], nextCursor: 'next' })
  }
  await assert.rejects(favoritesService.listAll(controller.signal))
  assert.equal(calls, 1)
})

const metadata = (id: string): TmdbMovieDetails => ({
  id: Number(id),
  title: `Film ${id}`,
  original_title: `Film ${id}`,
  overview: '',
  poster_path: null,
  backdrop_path: null,
  release_date: '2020-01-01',
  vote_average: 8,
  genre_ids: [28],
  genres: [{ id: 28, name: 'Hành động' }],
  production_countries: [],
  videos: { results: [] },
  recommendations: { page: 1, results: [] },
  credits: { cast: [], crew: [] },
})

test('Metadata giới hạn tối đa 4 concurrent requests và dùng mapper Movie', async () => {
  let running = 0,
    peak = 0
  const rows: FavoriteMovieResult[] = []
  await loadFavoriteMovies(
    Array.from({ length: 20 }, (_, index) => index + 1),
    new AbortController().signal,
    (row) => rows.push(row),
    async (id) => {
      peak = Math.max(peak, ++running)
      await new Promise((resolve) => setTimeout(resolve, 2))
      running--
      return metadata(id)
    },
  )
  assert.equal(peak, 4)
  assert.equal(rows.length, 20)
  assert.equal(rows[0].movie?.year, 2020)
  assert.deepEqual(rows[0].movie?.genres, ['Hành động'])
})

test('Metadata 404/503 không làm hỏng phim khác và không trả title giả', async () => {
  const rows: FavoriteMovieResult[] = []
  await loadFavoriteMovies(
    [1, 2, 3],
    new AbortController().signal,
    (row) => rows.push(row),
    async (id) => {
      if (id === '1') throw new ApiError('private', 404)
      if (id === '2') throw new ApiError('private', 503)
      return metadata(id)
    },
  )
  assert.equal(rows.filter((row) => row.movie).length, 1)
  assert.equal(rows.filter((row) => row.error).length, 2)
  assert.ok(rows.every((row) => !row.error?.includes('private')))
})

test('Metadata abort không gọi thêm worker và không commit response muộn', async () => {
  const controller = new AbortController()
  let calls = 0,
    results = 0
  await loadFavoriteMovies(
    [1, 2, 3, 4, 5, 6],
    controller.signal,
    () => results++,
    async (id) => {
      calls++
      controller.abort()
      return metadata(id)
    },
  )
  assert.equal(calls, 1)
  assert.equal(results, 0)
})
