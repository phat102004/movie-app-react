import type { Movie } from '../types/movie.ts'
import type { MovieFilterValues, MovieSortOrder } from '../types/movieFilters'

export const defaultMovieFilters: MovieFilterValues = {
  genre: '',
  year: '',
  minRating: 0,
  sortBy: 'default',
}

export function getFilterOptions(movies: readonly Movie[]) {
  return {
    genres: [...new Set(movies.flatMap((movie) => movie.genres))].sort((a, b) =>
      a.localeCompare(b, 'vi'),
    ),
    years: [
      ...new Set(
        movies
          .map((movie) => movie.year)
          .filter((year): year is number => year !== null),
      ),
    ].sort((a, b) => b - a),
  }
}

export const ratingOptions = [
  { value: 0, label: 'Tất cả đánh giá' },
  { value: 5, label: 'Từ 5 điểm' },
  { value: 7, label: 'Từ 7 điểm' },
  { value: 8, label: 'Từ 8 điểm' },
]

export const sortOptions: { value: MovieSortOrder; label: string }[] = [
  { value: 'default', label: 'Mặc định' },
  { value: 'year-desc', label: 'Năm phát hành mới nhất' },
  { value: 'year-asc', label: 'Năm phát hành cũ nhất' },
  { value: 'rating-desc', label: 'Điểm đánh giá cao nhất' },
  { value: 'title-asc', label: 'Tên phim A–Z' },
]
