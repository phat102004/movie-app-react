import { HttpError } from '../http.mjs'

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const validMovieId = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= 2_147_483_647
const invalidMovie = () =>
  new HttpError(
    400,
    'INVALID_MOVIE_ID',
    'ID phim phải là số nguyên dương không vượt quá Int32.',
    { movieId: 'movieId phải là number nguyên từ 1 tới 2147483647.' },
  )

export function validateFavoriteInput(input) {
  if (!isRecord(input) || Object.keys(input).some((key) => key !== 'movieId'))
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Chỉ nhận JSON object chứa movieId; không nhận userId hoặc các trường khác.',
    )
  if (!validMovieId(input.movieId)) throw invalidMovie()
  return input.movieId
}

export function parseFavoriteMovieId(value) {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,9}$/.test(value) ||
    !validMovieId(Number(value))
  )
    throw invalidMovie()
  return Number(value)
}

export function parseFavoriteQuery(searchParams) {
  if (
    [...searchParams.keys()].some((key) => key !== 'cursor') ||
    searchParams.getAll('cursor').length > 1
  )
    throw new HttpError(
      400,
      'INVALID_QUERY',
      'GET Favorites chỉ hỗ trợ một tham số cursor; không nhận userId.',
    )
  if (!searchParams.has('cursor')) return null
  const value = searchParams.get('cursor')
  try {
    if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error()
    const decoded = Buffer.from(value, 'base64url')
    if (decoded.toString('base64url') !== value) throw new Error()
    const cursor = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(decoded),
    )
    if (
      !isRecord(cursor) ||
      Object.keys(cursor).length !== 2 ||
      !validMovieId(cursor.movieId) ||
      typeof cursor.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor.createdAt)
    )
      throw new Error()
    const createdAt = new Date(cursor.createdAt)
    if (
      !Number.isFinite(createdAt.getTime()) ||
      createdAt.getUTCFullYear() < 1 ||
      createdAt.toISOString() !== cursor.createdAt
    )
      throw new Error()
    return { createdAt, movieId: cursor.movieId }
  } catch {
    throw new HttpError(
      400,
      'INVALID_CURSOR',
      'Cursor không hợp lệ. Vui lòng tải lại danh sách từ đầu.',
    )
  }
}

export function encodeFavoriteCursor(favorite) {
  return Buffer.from(JSON.stringify(favorite)).toString('base64url')
}
