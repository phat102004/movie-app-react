import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCredits, parseMovieDetails } from '../src/services/tmdb.ts'
import { mapTmdbMovieDetails } from '../src/utils/mapTmdbMovieDetails.ts'

const raw = {
  id: 27205,
  title: 'Inception',
  genres: [],
  videos: { results: [] },
  recommendations: { page: 1, results: [] },
}
const credits = {
  cast: [
    {
      id: 3,
      name: '  Actor Three  ',
      character: ' Role Three ',
      profile_path: '/three.jpg',
      order: 2,
    },
    {
      id: 1,
      name: 'Actor One',
      character: 'Role One',
      profile_path: '/one.jpg',
      order: 0,
    },
    {
      id: 2,
      name: 'Actor Two',
      character: 'Role Two',
      profile_path: null,
      order: 1,
    },
  ],
  crew: [
    { id: 10, name: 'Director One', job: 'Director' },
    { id: 11, name: 'Producer', job: 'Producer' },
    { id: 12, name: 'Director Two', job: 'Director' },
    { id: 10, name: 'Director One', job: 'Director' },
    { id: 13, name: 'Wrong Case', job: 'director' },
  ],
}

test('credits parser đọc đúng cast/crew, trim tên/nhân vật và giữ order 0', () => {
  const parsed = parseCredits(credits)
  assert.equal(parsed.cast[0].name, 'Actor Three')
  assert.equal(parsed.cast[0].character, 'Role Three')
  assert.equal(parsed.cast[1].order, 0)
  assert.equal(parsed.cast[2].profile_path, null)
  assert.equal(parsed.crew[0].job, 'Director')
})

test('credits thiếu/sai top-level không chặn movie details, trailer hoặc recommendations', () => {
  for (const value of [
    undefined,
    null,
    {},
    [],
    'bad',
    { cast: 'bad', crew: 10 },
  ]) {
    const parsed = parseMovieDetails({ ...raw, credits: value })
    assert.equal(parsed.id, 27205)
    assert.deepEqual(parsed.credits, { cast: [], crew: [] })
    assert.deepEqual(parsed.videos.results, [])
    assert.deepEqual(parsed.recommendations.results, [])
  }
})

test('credits parser bỏ người không có ID/tên hợp lệ, giữ người thiếu ảnh/nhân vật/order', () => {
  const parsed = parseCredits({
    cast: [
      null,
      {},
      { id: '1', name: 'Bad ID' },
      { id: 0, name: 'Zero' },
      { id: 1.5, name: 'Fraction' },
      { id: 4, name: ' ' },
      {
        id: 5,
        name: 'Valid Person',
        character: 99,
        profile_path: {},
        order: -1,
      },
    ],
    crew: [
      null,
      { id: 10, name: ' Valid Director ', job: ' Director ' },
      { id: 11, name: 'No job' },
    ],
  })
  assert.deepEqual(parsed.cast, [
    {
      id: 5,
      name: 'Valid Person',
      character: '',
      profile_path: null,
      order: null,
    },
  ])
  assert.deepEqual(parsed.crew, [
    { id: 10, name: 'Valid Director', job: 'Director' },
  ])
})

test('cast sai không làm mất crew hợp lệ và ngược lại', () => {
  assert.equal(parseCredits({ cast: false, crew: credits.crew }).crew.length, 5)
  assert.equal(parseCredits({ cast: credits.cast, crew: false }).cast.length, 3)
})

test('mapper sắp theo billing order, giữ người thiếu ảnh và không sửa mảng gốc', () => {
  const parsed = parseMovieDetails({ ...raw, credits })
  const before = structuredClone(parsed.credits)
  const movie = mapTmdbMovieDetails(parsed, [])
  assert.deepEqual(
    movie.cast.map((person) => person.id),
    [1, 2, 3],
  )
  assert.equal(
    movie.cast[0].profileUrl,
    'https://image.tmdb.org/t/p/w185/one.jpg',
  )
  assert.equal(movie.cast[1].profileUrl, '')
  assert.equal(movie.cast[1].character, 'Role Two')
  assert.deepEqual(parsed.credits, before)
})

test('mapper chỉ chọn Director, hỗ trợ nhiều người và loại ID trùng', () => {
  const movie = mapTmdbMovieDetails(parseMovieDetails({ ...raw, credits }), [])
  assert.deepEqual(movie.directors, [
    { id: 10, name: 'Director One', job: 'Director' },
    { id: 12, name: 'Director Two', job: 'Director' },
  ])
})

test('order thiếu/sai xuống cuối, cùng order giữ thứ tự nguồn và trùng ID giữ vai ưu tiên', () => {
  const movie = mapTmdbMovieDetails(
    parseMovieDetails({
      ...raw,
      credits: {
        cast: [
          { id: 9, name: 'Unknown first' },
          { id: 3, name: 'Same order A', order: 1 },
          { id: 2, name: 'Same order B', order: 1 },
          { id: 3, name: 'Lower billing duplicate', order: 5 },
          { id: 8, name: 'Unknown second', order: 1.5 },
        ],
      },
    }),
    [],
  )
  assert.deepEqual(
    movie.cast.map((person) => person.id),
    [3, 2, 9, 8],
  )
  assert.equal(movie.cast[0].name, 'Same order A')
  assert.equal(movie.cast[3].order, null)
})

test('profile_path bên ngoài hoặc malformed không trở thành URL ảnh', () => {
  const movie = mapTmdbMovieDetails(
    parseMovieDetails({
      ...raw,
      credits: {
        cast: [
          {
            id: 1,
            name: 'External',
            profile_path: 'https://example.com/profile.jpg',
          },
          { id: 2, name: 'Traversal', profile_path: '/../private.jpg' },
          { id: 3, name: 'Valid', profile_path: '/safe-name.png' },
        ],
      },
    }),
    [],
  )
  assert.deepEqual(
    movie.cast.map((person) => person.profileUrl),
    ['', '', 'https://image.tmdb.org/t/p/w185/safe-name.png'],
  )
})
