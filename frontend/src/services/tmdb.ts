import type {
  MovieCategory,
  TmdbGenre,
  TmdbMovie,
  TmdbMoviePage,
  TmdbMovieDetails,
  TmdbVideo,
  TmdbCredits,
} from '../types/tmdb.ts'
import { isValidMovieId } from '../utils/movieId.ts'

export class ApiError extends Error {
  status: number | null
  code: string

  constructor(
    message: string,
    status: number | null = null,
    code = 'REQUEST_FAILED',
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidData(): never {
  throw new ApiError(
    'Dữ liệu phim nhận được không hợp lệ. Vui lòng thử lại.',
    null,
    'INVALID_DATA',
  )
}

function readText(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = record[key]
  if (value === undefined || value === null || typeof value === 'string')
    return value
  return invalidData()
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
  max = Infinity,
): number | null | undefined {
  const value = record[key]
  if (value === undefined || value === null) return value
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
  )
    return value
  return invalidData()
}

function parseMovie(value: unknown): TmdbMovie {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id <= 0
  )
    return invalidData()
  const genreIds = value.genre_ids ?? []
  if (
    !Array.isArray(genreIds) ||
    !genreIds.every(
      (id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
    )
  )
    return invalidData()
  return {
    id: value.id,
    title: readText(value, 'title'),
    original_title: readText(value, 'original_title'),
    overview: readText(value, 'overview'),
    poster_path: readText(value, 'poster_path'),
    backdrop_path: readText(value, 'backdrop_path'),
    release_date: readText(value, 'release_date'),
    vote_average: readNumber(value, 'vote_average', 10),
    vote_count: readNumber(value, 'vote_count'),
    genre_ids: genreIds,
  }
}

export function parseMoviePage(value: unknown): TmdbMoviePage {
  if (
    !isRecord(value) ||
    typeof value.page !== 'number' ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    !Array.isArray(value.results)
  )
    return invalidData()
  return { page: value.page, results: value.results.map(parseMovie) }
}

export function parseGenres(value: unknown): TmdbGenre[] {
  if (!isRecord(value) || !Array.isArray(value.genres)) return invalidData()
  return value.genres.map((genre: unknown) => {
    if (
      !isRecord(genre) ||
      typeof genre.id !== 'number' ||
      !Number.isSafeInteger(genre.id) ||
      genre.id <= 0 ||
      typeof genre.name !== 'string' ||
      !genre.name.trim()
    )
      return invalidData()
    return { id: genre.id, name: genre.name.trim() }
  })
}

export function parseCredits(value: unknown): TmdbCredits {
  // Credits là metadata bổ sung: bỏ bản ghi không an toàn, giữ phần còn lại.
  if (!isRecord(value)) return { cast: [], crew: [] }
  const validPerson = (
    person: unknown,
  ): person is Record<string, unknown> & { id: number; name: string } =>
    isRecord(person) &&
    typeof person.id === 'number' &&
    Number.isSafeInteger(person.id) &&
    person.id > 0 &&
    typeof person.name === 'string' &&
    person.name.trim().length > 0

  const cast = Array.isArray(value.cast)
    ? value.cast.filter(validPerson).map((person) => ({
        id: person.id,
        name: person.name.trim(),
        character:
          typeof person.character === 'string' ? person.character.trim() : '',
        profile_path:
          typeof person.profile_path === 'string' ? person.profile_path : null,
        order:
          typeof person.order === 'number' &&
          Number.isSafeInteger(person.order) &&
          person.order >= 0
            ? person.order
            : null,
      }))
    : []
  const crew = Array.isArray(value.crew)
    ? value.crew.filter(validPerson).flatMap((person) =>
        typeof person.job === 'string' && person.job.trim()
          ? [
              {
                id: person.id,
                name: person.name.trim(),
                job: person.job.trim(),
              },
            ]
          : [],
      )
    : []
  return { cast, crew }
}

export function parseMovieDetails(value: unknown): TmdbMovieDetails {
  if (!isRecord(value)) return invalidData()
  const genres = parseGenres(value)
  const movie = parseMovie({
    ...value,
    genre_ids: genres.map((genre) => genre.id),
  })
  const countries = value.production_countries ?? []
  if (
    !Array.isArray(countries) ||
    !countries.every(
      (country) =>
        isRecord(country) &&
        typeof country.iso_3166_1 === 'string' &&
        typeof country.name === 'string',
    )
  )
    return invalidData()
  if (!isRecord(value.videos) || !Array.isArray(value.videos.results))
    return invalidData()
  const videos: TmdbVideo[] = value.videos.results.map((video: unknown) => {
    if (
      !isRecord(video) ||
      typeof video.id !== 'string' ||
      typeof video.key !== 'string' ||
      typeof video.name !== 'string' ||
      typeof video.site !== 'string' ||
      typeof video.type !== 'string' ||
      typeof video.official !== 'boolean' ||
      (video.iso_639_1 !== null && typeof video.iso_639_1 !== 'string')
    )
      return invalidData()
    return {
      id: video.id,
      key: video.key,
      name: video.name,
      site: video.site,
      type: video.type,
      official: video.official,
      iso_639_1: video.iso_639_1,
    }
  })
  return {
    ...movie,
    genres,
    runtime: readNumber(value, 'runtime'),
    status: readText(value, 'status'),
    production_countries: countries.map((country) => ({
      iso_3166_1: country.iso_3166_1,
      name: country.name,
    })),
    videos: { results: videos },
    recommendations: parseMoviePage(value.recommendations),
    credits: parseCredits(value.credits),
  }
}

async function requestJson(
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const response = await fetch(path, {
      signal,
      headers: { Accept: 'application/json' },
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : null
      throw new ApiError(
        typeof error?.message === 'string' && error.message.trim()
          ? error.message
          : 'Không thể tải phim. Vui lòng thử lại.',
        response.status,
        typeof error?.code === 'string' ? error.code : 'HTTP_ERROR',
      )
    }
    if (body === null) return invalidData()
    return body
  } catch (error) {
    if (signal?.aborted || error instanceof ApiError) throw error
    throw new ApiError(
      'Không thể kết nối máy chủ. Kiểm tra mạng và thử lại.',
      null,
      'NETWORK_ERROR',
    )
  }
}

export async function getMoviePage(
  category: MovieCategory,
  signal?: AbortSignal,
): Promise<TmdbMoviePage> {
  return parseMoviePage(await requestJson(`/api/movies/${category}`, signal))
}

export async function getGenres(signal?: AbortSignal): Promise<TmdbGenre[]> {
  return parseGenres(await requestJson('/api/genres', signal))
}

export async function getMovieDetails(
  id: string,
  signal?: AbortSignal,
): Promise<TmdbMovieDetails> {
  if (!isValidMovieId(id))
    throw new ApiError('ID phim không hợp lệ.', 400, 'INVALID_MOVIE_ID')
  const movie = parseMovieDetails(
    await requestJson(`/api/movies/${id}`, signal),
  )
  if (String(movie.id) !== id) return invalidData()
  return movie
}
