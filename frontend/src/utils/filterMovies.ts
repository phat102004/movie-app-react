import type { Movie } from '../types/movie'
import type { MovieFilterValues } from '../types/movieFilters'

export function filterAndSortMovies(
  movies: readonly Movie[],
  query: string,
  filters: MovieFilterValues,
): Movie[] {
  const normalizedQuery = query.trim().toLowerCase()

  const filteredMovies = movies.filter((movie) => {
    const matchesQuery =
      movie.title.toLowerCase().includes(normalizedQuery) ||
      movie.originalTitle.toLowerCase().includes(normalizedQuery)
    const matchesGenre =
      filters.genre === '' || movie.genres.includes(filters.genre)
    const matchesYear = filters.year === '' || movie.year === filters.year
    const matchesRating =
      filters.minRating === 0 ||
      (movie.rating !== null && movie.rating >= filters.minRating)

    // Mỗi phim phải thỏa mãn đồng thời tất cả điều kiện.
    return matchesQuery && matchesGenre && matchesYear && matchesRating
  })

  // Sao chép trước khi sort, giữ nguyên thứ tự dữ liệu nguồn.
  const sortedMovies = [...filteredMovies]

  switch (filters.sortBy) {
    case 'year-desc':
      return sortedMovies.sort(
        (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity),
      )
    case 'year-asc':
      return sortedMovies.sort(
        (a, b) => (a.year ?? Infinity) - (b.year ?? Infinity),
      )
    case 'rating-desc':
      return sortedMovies.sort(
        (a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity),
      )
    case 'title-asc':
      return sortedMovies.sort((a, b) => a.title.localeCompare(b.title, 'vi'))
    default:
      return filteredMovies
  }
}
