import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApiError,
  getMovieDetails,
  parseMovieDetails,
} from '../src/services/tmdb.ts'
import { isValidMovieId } from '../src/utils/movieId.ts'
import {
  mapTmdbMovieDetails,
  selectTrailer,
} from '../src/utils/mapTmdbMovieDetails.ts'
import type { TmdbVideo } from '../src/types/tmdb.ts'

const trailer: TmdbVideo = {
  id: 'v1',
  key: 'YoHD9XEInc0',
  name: 'Official Trailer',
  site: 'YouTube',
  type: 'Trailer',
  official: true,
  iso_639_1: 'en',
}
const fixture = {
  id: 27205,
  title: 'Kẻ Đánh Cắp Giấc Mơ',
  original_title: 'Inception',
  overview: 'Nội dung thật từ API.',
  release_date: '2010-07-15',
  runtime: 148,
  vote_average: 8.4,
  vote_count: 200,
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  genres: [{ id: 28, name: 'Hành động' }],
  status: 'Released',
  production_countries: [
    { iso_3166_1: 'US', name: 'United States of America' },
  ],
  videos: { results: [trailer] },
  recommendations: {
    page: 1,
    results: [
      { id: 27205, title: 'Duplicate current', genre_ids: [28] },
      { id: 42, title: 'Another movie', genre_ids: [12] },
      { id: 42, title: 'Another movie', genre_ids: [12] },
    ],
  },
}

test('movie ID chỉ nhận số nguyên dương int32, không nhận URL hoặc dạng số không chuẩn', () => {
  for (const id of ['1', '27205', '2147483647'])
    assert.equal(isValidMovieId(id), true)
  for (const id of [
    undefined,
    '',
    '0',
    '-1',
    '01',
    '1.5',
    '1e3',
    ' 42 ',
    'invalid',
    '2147483648',
    '9007199254740993',
    'https://example.com',
    '1/videos',
  ])
    assert.equal(isValidMovieId(id), false)
})

test('details parser và mapper giữ metadata, trailer và loại phim gợi ý trùng ID', () => {
  const data = parseMovieDetails(fixture)
  const mapped = mapTmdbMovieDetails(data, [{ id: 12, name: 'Phiêu lưu' }])
  assert.equal(mapped.id, '27205')
  assert.equal(mapped.releaseDate, '2010-07-15')
  assert.equal(mapped.runtime, 148)
  assert.equal(mapped.rating, 8.4)
  assert.equal(mapped.voteCount, 200)
  assert.equal(mapped.status, 'Released')
  assert.deepEqual(mapped.countries, ['United States of America'])
  assert.equal(mapped.trailer?.key, trailer.key)
  assert.deepEqual(
    mapped.recommendations.map((movie) => movie.id),
    ['42'],
  )
  assert.deepEqual(mapped.recommendations[0].genres, ['Phiêu lưu'])
  assert.equal(fixture.recommendations.results.length, 3)
})

test('metadata thiếu được giữ null/rỗng, không tạo poster, ngày, thời lượng hoặc trailer giả', () => {
  const mapped = mapTmdbMovieDetails(
    parseMovieDetails({
      ...fixture,
      original_title: null,
      poster_path: null,
      backdrop_path: null,
      overview: null,
      release_date: '2025-02-30',
      runtime: 0,
      vote_count: 0,
      status: null,
      production_countries: null,
      genres: [],
      videos: { results: [] },
      recommendations: { page: 1, results: [] },
    }),
    [],
  )
  assert.equal(mapped.poster, '')
  assert.equal(mapped.backdrop, undefined)
  assert.equal(mapped.releaseDate, null)
  assert.equal(mapped.runtime, null)
  assert.equal(mapped.rating, null)
  assert.equal(mapped.voteCount, 0)
  assert.equal(mapped.trailer, null)
  assert.deepEqual(mapped.countries, [])
  assert.deepEqual(mapped.recommendations, [])
})

test('chọn Trailer YouTube an toàn, ưu tiên official rồi vi/en, không sửa mảng nguồn', () => {
  const videos = [
    { ...trailer, id: 'fake', key: 'https://evil.example' },
    { ...trailer, id: 'clip', type: 'Clip', iso_639_1: 'vi' },
    { ...trailer, id: 'other', site: 'Vimeo', iso_639_1: 'vi' },
    { ...trailer, id: 'unofficial', official: false, iso_639_1: 'vi' },
    { ...trailer, id: 'official-en' },
    { ...trailer, id: 'official-vi', iso_639_1: 'vi', name: 'Trailer Việt' },
  ]
  assert.equal(selectTrailer(videos)?.name, 'Trailer Việt')
  assert.equal(videos[0].id, 'fake')
  assert.equal(selectTrailer([{ ...trailer, type: 'Teaser' }]), null)
  assert.equal(selectTrailer([{ ...trailer, key: '<script>' }]), null)
  assert.equal(
    selectTrailer([{ ...trailer, official: false }])?.official,
    false,
  )
  assert.equal(selectTrailer([]), null)
})

test('details JSON validation chặn dữ liệu sai tại boundary', () => {
  for (const value of [
    null,
    {},
    { ...fixture, runtime: -1 },
    { ...fixture, genres: [{ id: '28', name: 'Sai' }] },
    { ...fixture, videos: { results: [{ ...trailer, official: 'true' }] } },
    { ...fixture, production_countries: ['US'] },
    { ...fixture, recommendations: {} },
  ])
    assert.throws(() => parseMovieDetails(value), ApiError)
})

test('service không gọi fetch khi ID sai và không nhận dữ liệu ID khác', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ ...fixture, id: 42 })
  })
  await assert.rejects(
    getMovieDetails('invalid'),
    (error) => error instanceof ApiError && error.status === 400,
  )
  assert.equal(calls, 0)
  await assert.rejects(
    getMovieDetails('27205'),
    (error) => error instanceof ApiError && error.code === 'INVALID_DATA',
  )
})

test('details service dùng URL nội bộ và AbortSignal, không gửi Authorization từ browser', async (t) => {
  const controller = new AbortController()
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit) => {
      assert.equal(url, '/api/movies/27205')
      assert.equal(options.signal, controller.signal)
      assert.equal(options.headers && 'Authorization' in options.headers, false)
      return Response.json(fixture)
    },
  )
  assert.equal((await getMovieDetails('27205', controller.signal)).id, 27205)
})

for (const status of [400, 404, 429, 502]) {
  test(`details service giữ status ${status} để UI xử lý riêng`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      Response.json(
        { error: { code: 'SAFE_ERROR', message: 'Thông báo an toàn' } },
        { status },
      ),
    )
    await assert.rejects(
      getMovieDetails('27205'),
      (error) => error instanceof ApiError && error.status === status,
    )
  })
}
