import { ratingOptions, sortOptions } from '../data/movieFilters'
import type { MovieFilterValues, MovieSortOrder } from '../types/movieFilters'
import { Icon } from './Icon'
import './MovieFilters.css'

type MovieFiltersProps = {
  filters: MovieFilterValues
  onFiltersChange: (filters: MovieFilterValues) => void
  onReset: () => void
  canReset: boolean
  genreOptions: string[]
  yearOptions: number[]
}

export function MovieFilters({
  filters,
  onFiltersChange,
  onReset,
  canReset,
  genreOptions,
  yearOptions,
}: MovieFiltersProps) {
  return (
    <section className="movie-filters" aria-labelledby="movie-filters-title">
      <div className="filters-heading">
        <div>
          <p className="filters-eyebrow">TÌM CÂU CHUYỆN TIẾP THEO</p>
          <h2 id="movie-filters-title">Khám phá phim</h2>
        </div>
        <button
          className="filters-reset"
          type="button"
          onClick={onReset}
          disabled={!canReset}
        >
          <Icon name="close" /> Xóa bộ lọc
        </button>
      </div>

      <div className="filter-fields">
        <label
          className={`filter-field ${filters.genre !== '' ? 'is-selected' : ''}`}
        >
          <span>Thể loại</span>
          <select
            value={filters.genre}
            onChange={(event) =>
              onFiltersChange({ ...filters, genre: event.target.value })
            }
          >
            <option value="">Tất cả</option>
            {genreOptions.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>
        </label>

        <label
          className={`filter-field ${filters.year !== '' ? 'is-selected' : ''}`}
        >
          <span>Năm phát hành</span>
          <select
            value={filters.year}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                year:
                  event.target.value === '' ? '' : Number(event.target.value),
              })
            }
          >
            <option value="">Tất cả năm</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <label
          className={`filter-field ${filters.minRating !== 0 ? 'is-selected' : ''}`}
        >
          <span>
            Điểm đánh giá <span className="filter-scale">/ 10</span>
          </span>
          <select
            value={filters.minRating}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                minRating: Number(event.target.value),
              })
            }
          >
            {ratingOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label
          className={`filter-field ${filters.sortBy !== 'default' ? 'is-selected' : ''}`}
        >
          <span>Sắp xếp</span>
          <select
            value={filters.sortBy}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                sortBy: event.target.value as MovieSortOrder,
              })
            }
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}
