import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApiError,
  getMoviePage,
  getGenres,
  parseMoviePage,
} from '../src/services/tmdb.ts'
import { mapTmdbMovie, buildMovieCatalog } from '../src/utils/mapTmdbMovie.ts'
import { getFilterOptions } from '../src/data/movieFilters.ts'
import { filterAndSortMovies } from '../src/utils/filterMovies.ts'
import type { TmdbMovie } from '../src/types/tmdb.ts'
import type { MovieFilterValues } from '../src/types/movieFilters.ts'

const movie: TmdbMovie = {
  id: 42,
  title: 'Phim kiểm thử',
  original_title: 'Test Movie',
  overview: 'Mô tả từ API',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  release_date: '2024-05-12',
  vote_average: 8,
  vote_count: 10,
  genre_ids: [28, 999],
}
const genres = [{ id: 28, name: 'Hành động' }]

test('mapper giữ ID thật, tên, ảnh, mô tả, năm/điểm và thể loại đúng', () => {
  const mapped = mapTmdbMovie(movie, genres)
  assert.equal(mapped.id, '42')
  assert.equal(mapped.originalTitle, 'Test Movie')
  assert.equal(mapped.year, 2024)
  assert.equal(mapped.rating, 8)
  assert.equal(mapped.poster, 'https://image.tmdb.org/t/p/w500/poster.jpg')
  assert.equal(mapped.backdrop, 'https://image.tmdb.org/t/p/w1280/backdrop.jpg')
  assert.deepEqual(mapped.genres, ['Hành động'])
})

test('mapper không bịa metadata khi null, thiếu ngày/điểm, thiếu bản dịch', () => {
  const mapped = mapTmdbMovie(
    {
      id: 1,
      title: ' ',
      original_title: 'Original',
      poster_path: null,
      overview: '',
      genre_ids: [],
      release_date: '2024-02-30',
    },
    [],
  )
  assert.equal(mapped.title, 'Original')
  assert.equal(mapped.year, null)
  assert.equal(mapped.rating, null)
  assert.equal(mapped.poster, '')
  assert.equal(mapped.description, '')
  assert.equal(mapped.backdrop, undefined)
  assert.deepEqual(mapped.genres, [])
  assert.equal(mapTmdbMovie({ ...movie, vote_count: 0 }, genres).rating, null)
  assert.equal(
    mapTmdbMovie({ ...movie, poster_path: 'https://example.com/x.jpg' }, genres)
      .poster,
    '',
  )
})

test('catalog loại trùng ID, giữ nhóm và tạo options từ dữ liệu đã tải', () => {
  const page = { page: 1, results: [movie, movie] }
  const catalog = buildMovieCatalog(
    page,
    { page: 1, results: [] },
    page,
    genres,
  )
  assert.equal(catalog.movies.length, 1)
  assert.equal(catalog.sections.length, 3)
  assert.equal(catalog.sections[0].movies.length, 1)
  assert.deepEqual(getFilterOptions(catalog.movies), {
    genres: ['Hành động'],
    years: [2024],
  })
})

test('tìm kiếm/bộ lọc kết hợp với phim API, xử lý null và không sửa nguồn', () => {
  const known = mapTmdbMovie(movie, genres)
  const unknown = mapTmdbMovie(
    { id: 3, original_title: 'Unknown', genre_ids: [] },
    [],
  )
  const movies = Object.freeze([unknown, known])
  const filters: MovieFilterValues = {
    genre: '',
    year: '',
    minRating: 0,
    sortBy: 'default',
  }
  assert.equal(filterAndSortMovies(movies, '', filters).length, 2)
  assert.deepEqual(
    filterAndSortMovies(movies, ' TEST ', {
      ...filters,
      genre: 'Hành động',
      year: 2024,
      minRating: 8,
    }).map((m) => m.id),
    ['42'],
  )
  assert.deepEqual(
    filterAndSortMovies(movies, '', { ...filters, minRating: 8 }).map(
      (m) => m.id,
    ),
    ['42'],
  )
  for (const sortBy of ['year-asc', 'year-desc', 'rating-desc'] as const) {
    assert.equal(
      filterAndSortMovies(movies, '', { ...filters, sortBy })[1].id,
      '3',
    )
  }
  assert.equal(movies[0].id, '3')
})

test('runtime validation chặn sai kiểu, ID, điểm và JSON shape', () => {
  for (const value of [
    null,
    {},
    { page: 1, results: [{ id: '42' }] },
    { page: 1, results: [{ ...movie, vote_average: 11 }] },
    { page: 1, results: [{ ...movie, title: 5 }] },
  ]) {
    assert.throws(() => parseMoviePage(value), ApiError)
  }
  assert.deepEqual(parseMoviePage({ page: 1, results: [] }).results, [])
})

test('service fetch đúng endpoint, chuyển signal, kiểm tra JSON', async (t) => {
  const controller = new AbortController()
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit) => {
      assert.ok(options.signal instanceof AbortSignal)
      assert.notEqual(options.signal, controller.signal)
      assert.equal(options.headers && 'Authorization' in options.headers, false)
      return Response.json(
        url === '/api/genres' ? { genres } : { page: 1, results: [movie] },
      )
    },
  )
  assert.equal(
    (await getMoviePage('popular', controller.signal)).results[0].id,
    42,
  )
  assert.deepEqual(await getGenres(controller.signal), genres)
})

for (const status of [401, 429, 503]) {
  test(`service chuyển HTTP ${status} thành ApiError`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      Response.json(
        { error: { message: 'Thông báo kiểm thử', code: 'HTTP_FIXTURE' } },
        { status },
      ),
    )
    await assert.rejects(
      getMoviePage('popular'),
      (error: unknown) => error instanceof ApiError && error.status === status,
    )
  })
}

test('service xử lý mạng, dữ liệu sai và AbortSignal', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('network')
  })
  await assert.rejects(
    getMoviePage('popular'),
    (error: unknown) =>
      error instanceof ApiError && error.code === 'NETWORK_ERROR',
  )
  fetchMock.mock.mockImplementation(async () => new Response('not JSON'))
  await assert.rejects(
    getMoviePage('popular'),
    (error: unknown) =>
      error instanceof ApiError && error.code === 'INVALID_DATA',
  )
  const controller = new AbortController()
  controller.abort()
  fetchMock.mock.mockImplementation(async () => {
    throw new DOMException('Aborted', 'AbortError')
  })
  await assert.rejects(getMoviePage('popular', controller.signal), {
    name: 'AbortError',
  })
})
