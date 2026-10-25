import { HeroBanner } from '../components/HeroBanner'
import { MovieList } from '../components/MovieList'
import { MovieFilters } from '../components/MovieFilters'
import { MovieDataState } from '../components/MovieDataState'
import { defaultMovieFilters, getFilterOptions } from '../data/movieFilters'
import type { MovieFilterValues } from '../types/movieFilters'
import type { useMovies } from '../hooks/useMovies'
import { filterAndSortMovies } from '../utils/filterMovies'
import '../SearchResults.css'

type HomePageProps = {
  catalog: ReturnType<typeof useMovies>
  searchQuery: string
  filters: MovieFilterValues
  onFiltersChange: (filters: MovieFilterValues) => void
  onReset: () => void
}

export function HomePage({
  catalog,
  searchQuery,
  filters,
  onFiltersChange,
  onReset,
}: HomePageProps) {
  const { movies, sections, isLoading, error, retry, lastUpdated } = catalog
  const heroMovie = movies.find((movie) => movie.backdrop) ?? movies[0]
  const filterOptions = getFilterOptions(movies)
  const isSearching = searchQuery.trim().length > 0
  const hasFilterChanges =
    filters.genre !== defaultMovieFilters.genre ||
    filters.year !== defaultMovieFilters.year ||
    filters.minRating !== defaultMovieFilters.minRating ||
    filters.sortBy !== defaultMovieFilters.sortBy
  const isExploring = isSearching || hasFilterChanges
  const visibleMovies = filterAndSortMovies(movies, searchQuery, filters)

  return (
    <div aria-busy={isLoading}>
      {isLoading || error || movies.length === 0 ? (
        <MovieDataState
          status={isLoading ? 'loading' : error ? 'error' : 'empty'}
          message={error ?? undefined}
          onRetry={retry}
        />
      ) : (
        <>
          <HeroBanner key={heroMovie.id} movie={heroMovie} />
          <div id="featured" className="movie-collections page-container">
            <MovieFilters
              filters={filters}
              onFiltersChange={onFiltersChange}
              onReset={onReset}
              canReset={searchQuery.length > 0 || hasFilterChanges}
              genreOptions={filterOptions.genres}
              yearOptions={filterOptions.years}
            />
            <p className="local-search-note">
              Tìm kiếm và bộ lọc chỉ áp dụng cho các phim đã tải từ trang đầu
              của ba danh sách TMDB, không tìm trên toàn bộ TMDB.
            </p>
            {lastUpdated && (
              <p className="last-updated">
                Cập nhật gần nhất: {lastUpdated.toLocaleString('vi-VN')}
              </p>
            )}
            <p className="search-feedback" role="status" aria-atomic="true">
              Tìm thấy {visibleMovies.length} / {movies.length} phim phù hợp
              {isSearching ? ` với “${searchQuery.trim()}”` : ''}.
            </p>
            {isExploring ? (
              <div className="search-results">
                {visibleMovies.length > 0 ? (
                  <MovieList
                    id="search-results"
                    title={
                      isSearching ? 'Kết quả tìm kiếm' : 'Phim dành cho bạn'
                    }
                    subtitle="Những bộ phim phù hợp với lựa chọn của bạn."
                    movies={visibleMovies}
                    index={1}
                    mode="full"
                  />
                ) : (
                  <div className="search-empty-state">
                    <h2>Không tìm thấy phim</h2>
                    <p>
                      Thử đổi từ khóa, thể loại, năm hoặc điểm đánh giá. Chọn
                      “Xóa bộ lọc” để khám phá lại toàn bộ phim.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              sections.map(
                (section, index) =>
                  section.movies.length > 0 && (
                    <MovieList
                      key={section.id}
                      id={
                        section.id === 'featured'
                          ? 'featured-movies'
                          : section.id
                      }
                      title={section.title}
                      subtitle={section.subtitle}
                      movies={section.movies}
                      index={index + 1}
                    />
                  ),
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}
