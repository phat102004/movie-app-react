import assert from 'node:assert/strict'
import test from 'node:test'
import { filterAndSortMovies } from '../src/utils/filterMovies.ts'
import type { Movie } from '../src/types/movie.ts'
import type {
  MovieFilterValues,
  MovieSortOrder,
} from '../src/types/movieFilters.ts'

function makeMovie(
  id: string,
  title: string,
  originalTitle: string,
  year: number,
  rating: number,
  genres: string[],
): Movie {
  return {
    id,
    title,
    originalTitle,
    year,
    rating,
    genres,
    poster: '/poster.jpg',
    description: '',
  }
}

// Dữ liệu kiểm tra có cả điểm dưới ngưỡng để phát hiện lỗi so sánh.
const movies: readonly Movie[] = Object.freeze(
  [
    makeMovie('a', 'Ánh sáng', 'Avengers: Endgame', 2019, 8, [
      'Hành động',
      'Khoa học viễn tưởng',
    ]),
    makeMovie('b', 'Bình minh', 'Before Dawn', 2024, 6.5, ['Tình cảm']),
    makeMovie('c', 'Chân trời', 'New Horizons', 2019, 7.9, ['Hành động']),
    makeMovie('d', 'Đêm tối', 'Dark Night', 2020, 4.9, ['Kinh dị']),
    makeMovie('e', 'Em và mùa hè', 'Summer Comedy', 2021, 5, ['Hài hước']),
    makeMovie('f', 'Gia đình', 'Family', 2022, 7, ['Hoạt hình']),
  ].map((movie) => Object.freeze(movie)),
)

function filterValues(
  changes: Partial<MovieFilterValues> = {},
): MovieFilterValues {
  return { genre: '', year: '', minRating: 0, sortBy: 'default', ...changes }
}

function ids(result: Movie[]) {
  return result.map((movie) => movie.id)
}

test('mặc định và từ khóa chỉ có khoảng trắng giữ nguyên danh sách nguồn', () => {
  assert.deepEqual(ids(filterAndSortMovies(movies, '', filterValues())), [
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
  ])
  assert.deepEqual(ids(filterAndSortMovies(movies, '   ', filterValues())), [
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
  ])
})

test('tìm một phần tên tiếng Việt và tên gốc, không phân biệt hoa/thường, trim đầu/cuối', () => {
  assert.deepEqual(
    ids(filterAndSortMovies(movies, '  AVENGERS  ', filterValues())),
    ['a'],
  )
  assert.deepEqual(ids(filterAndSortMovies(movies, 'Endg', filterValues())), [
    'a',
  ])
  assert.deepEqual(
    ids(filterAndSortMovies(movies, '  CHÂN  ', filterValues())),
    ['c'],
  )
})

test('lọc thể loại chính xác trong mảng genres và lọc năm dạng số', () => {
  assert.deepEqual(
    ids(filterAndSortMovies(movies, '', filterValues({ genre: 'Hành động' }))),
    ['a', 'c'],
  )
  assert.deepEqual(
    ids(filterAndSortMovies(movies, '', filterValues({ year: 2024 }))),
    ['b'],
  )
})

test('điểm tối thiểu bao gồm giá trị bằng ngưỡng 5, 7 và 8', () => {
  for (const [minRating, expected] of [
    [0, ['a', 'b', 'c', 'd', 'e', 'f']],
    [5, ['a', 'b', 'c', 'e', 'f']],
    [7, ['a', 'c', 'f']],
    [8, ['a']],
  ] as const) {
    assert.deepEqual(
      ids(filterAndSortMovies(movies, '', filterValues({ minRating }))),
      expected,
    )
  }
})

test('từ khóa, thể loại, năm và đánh giá phải cùng thỏa mãn', () => {
  const filters = filterValues({
    genre: 'Hành động',
    year: 2019,
    minRating: 8,
    sortBy: 'rating-desc',
  })
  assert.deepEqual(ids(filterAndSortMovies(movies, 'avengers', filters)), ['a'])
  assert.deepEqual(filterAndSortMovies(movies, 'Before', filters), [])
  assert.deepEqual(
    filterAndSortMovies(movies, 'avengers', { ...filters, year: 2024 }),
    [],
  )
  assert.deepEqual(
    filterAndSortMovies(movies, 'avengers', { ...filters, genre: 'Tình cảm' }),
    [],
  )
})

test('trả về mảng rỗng nếu không có kết quả, kể cả dữ liệu nguồn rỗng', () => {
  assert.deepEqual(filterAndSortMovies(movies, 'không có', filterValues()), [])
  assert.deepEqual(
    filterAndSortMovies(movies, '', filterValues({ genre: 'Không tồn tại' })),
    [],
  )
  assert.deepEqual(
    filterAndSortMovies([], '', filterValues({ sortBy: 'year-desc' })),
    [],
  )
})

test('cả năm cách sắp xếp cho đúng thứ tự và giữ thứ tự nguồn khi bằng năm', () => {
  const expectedOrders: { sortBy: MovieSortOrder; expected: string[] }[] = [
    { sortBy: 'default', expected: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { sortBy: 'year-desc', expected: ['b', 'f', 'e', 'd', 'a', 'c'] },
    { sortBy: 'year-asc', expected: ['a', 'c', 'd', 'e', 'f', 'b'] },
    { sortBy: 'rating-desc', expected: ['a', 'c', 'f', 'b', 'e', 'd'] },
    { sortBy: 'title-asc', expected: ['a', 'b', 'c', 'd', 'e', 'f'] },
  ]
  for (const { sortBy, expected } of expectedOrders) {
    assert.deepEqual(
      ids(filterAndSortMovies(movies, '', filterValues({ sortBy }))),
      expected,
    )
  }
})

test('sort chỉ áp dụng trên kết quả lọc và không thay đổi nguồn hoặc object bộ lọc', () => {
  const snapshot = JSON.stringify(movies)
  const filters = Object.freeze(
    filterValues({ minRating: 7, sortBy: 'year-desc' }),
  )
  assert.deepEqual(ids(filterAndSortMovies(movies, '', filters)), [
    'f',
    'a',
    'c',
  ])
  assert.equal(JSON.stringify(movies), snapshot)
  assert.equal(filters.sortBy, 'year-desc')
  assert.deepEqual(ids(filterAndSortMovies(movies, '', filterValues())), [
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
  ])
})
