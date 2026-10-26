import type { Movie } from '../types/movie.ts'
import { ApiError, getMovieDetails } from './tmdb.ts'
import { mapTmdbMovie } from '../utils/mapTmdbMovie.ts'

export type FavoriteMovieResult = {
  movieId: number
  movie: Movie | null
  error: string | null
}

// Một hàng lỗi không chặn các phim khác. Worker pool không tạo Promise cho tất cả ID cùng lúc.
export async function loadFavoriteMovies(
  ids: readonly number[],
  signal: AbortSignal,
  onResult: (result: FavoriteMovieResult) => void,
  load = getMovieDetails,
) {
  let index = 0
  async function worker() {
    while (!signal.aborted && index < ids.length) {
      const movieId = ids[index++]
      try {
        const data = await load(String(movieId), signal)
        if (!signal.aborted)
          onResult({
            movieId,
            movie: mapTmdbMovie(data, data.genres),
            error: null,
          })
      } catch (cause) {
        if (!signal.aborted)
          onResult({
            movieId,
            movie: null,
            error:
              cause instanceof ApiError && cause.status === 404
                ? 'TMDB không còn cung cấp phim này.'
                : 'Chưa thể tải thông tin phim. Vui lòng thử lại.',
          })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker))
}
