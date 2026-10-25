import type { Movie, MovieSection } from '../types/movie.ts'
import type { TmdbGenre, TmdbMovie, TmdbMoviePage } from '../types/tmdb.ts'

export function getImageUrl(
  path: string | null | undefined,
  size: 'w185' | 'w500' | 'w1280',
): string {
  if (!path || !/^\/[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/i.test(path))
    return ''
  return `https://image.tmdb.org/t/p/${size}${path}`
}

function getReleaseYear(date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = new Date(`${date}T00:00:00Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    return null
  return parsed.getUTCFullYear()
}

export function mapTmdbMovie(
  movie: TmdbMovie,
  genres: readonly TmdbGenre[],
): Movie {
  const genreNames = new Map(genres.map((genre) => [genre.id, genre.name]))
  return {
    id: String(movie.id),
    title:
      movie.title?.trim() || movie.original_title?.trim() || 'Chưa có tên phim',
    originalTitle: movie.original_title?.trim() || '',
    year: getReleaseYear(movie.release_date),
    rating: movie.vote_count === 0 ? null : (movie.vote_average ?? null),
    poster: getImageUrl(movie.poster_path, 'w500'),
    backdrop: getImageUrl(movie.backdrop_path, 'w1280') || undefined,
    description: movie.overview?.trim() || '',
    genres: [
      ...new Set(
        movie.genre_ids
          .map((id) => genreNames.get(id))
          .filter((name): name is string => name !== undefined),
      ),
    ],
  }
}

export type MovieCatalog = { movies: Movie[]; sections: MovieSection[] }

export function buildMovieCatalog(
  popular: TmdbMoviePage,
  nowPlaying: TmdbMoviePage,
  topRated: TmdbMoviePage,
  genres: TmdbGenre[],
): MovieCatalog {
  const sources = [
    {
      id: 'featured',
      title: 'Phim nổi bật',
      subtitle: 'Những bộ phim đang được quan tâm trên TMDB.',
      page: popular,
    },
    {
      id: 'recent',
      title: 'Phim đang chiếu',
      subtitle: 'Những câu chuyện đang có mặt tại rạp.',
      page: nowPlaying,
    },
    {
      id: 'popular',
      title: 'Phim được đánh giá cao',
      subtitle: 'Những lựa chọn được cộng đồng TMDB đánh giá cao.',
      page: topRated,
    },
  ]
  const sections: MovieSection[] = sources.map((source) => ({
    id: source.id,
    title: source.title,
    subtitle: source.subtitle,
    movies: [
      ...new Map(
        source.page.results.map((movie) => [
          movie.id,
          mapTmdbMovie(movie, genres),
        ]),
      ).values(),
    ],
  }))
  const movies = [
    ...new Map(
      sections
        .flatMap((section) => section.movies)
        .map((movie) => [movie.id, movie]),
    ).values(),
  ]
  return { movies, sections }
}
