import { useRef, useState } from 'react'
import type { MovieSection } from '../types/movie'
import { useMovieColumns } from '../hooks/useMovieColumns'
import { MovieCard } from './MovieCard'
import './MovieList.css'

type MovieListProps = MovieSection & {
  index: number
  mode?: 'compact' | 'full'
}

export function MovieList({
  id,
  title,
  subtitle,
  movies,
  index,
  mode = 'compact',
}: MovieListProps) {
  const columns = useMovieColumns()
  const [visibleRows, setVisibleRows] = useState(1)
  const sectionRef = useRef<HTMLElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const collapseRef = useRef<HTMLButtonElement>(null)
  const visibleMovies =
    mode === 'full' ? movies : movies.slice(0, visibleRows * columns)
  const hasMore = visibleMovies.length < movies.length
  const isExpanded = mode === 'compact' && visibleMovies.length > columns
  const gridId = `${id}-grid`

  function showMore() {
    setVisibleRows((rows) => rows + 1)
    if ((visibleRows + 1) * columns >= movies.length)
      requestAnimationFrame(() =>
        collapseRef.current?.focus({ preventScroll: true }),
      )
  }

  function collapse() {
    setVisibleRows(1)
    requestAnimationFrame(() => {
      // Nút Thu gọn bị gỡ khỏi DOM: chuyển focus sang Xem thêm còn lại.
      const button = moreRef.current
      button?.focus({ preventScroll: true })
      const bounds = button?.getBoundingClientRect()
      if (bounds && (bounds.top < 0 || bounds.bottom > window.innerHeight))
        sectionRef.current?.scrollIntoView({
          block: 'start',
          behavior: 'instant',
        })
    })
  }

  return (
    <section
      ref={sectionRef}
      id={id}
      className="movie-section"
      aria-labelledby={`${id}-title`}
    >
      <div className="section-heading">
        <div>
          <div className="section-title-row">
            <span className="section-accent" />
            <h2 id={`${id}-title`}>{title}</h2>
          </div>
          <p>{subtitle}</p>
        </div>
        <span className="section-index">
          {String(index).padStart(2, '0')} <span>/ BỘ SƯU TẬP</span>
        </span>
      </div>
      <ul
        id={gridId}
        className="movie-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {visibleMovies.map((movie) => (
          <li key={movie.id}>
            <MovieCard movie={movie} />
          </li>
        ))}
      </ul>
      {mode === 'compact' && movies.length > columns && (
        <div className="movie-list-controls">
          <p className="movie-list-count" role="status" aria-atomic="true">
            Đang hiển thị {visibleMovies.length} / {movies.length} phim
          </p>
          <div className="movie-list-actions">
            {hasMore && (
              <button
                ref={moreRef}
                type="button"
                className="movie-list-button"
                onClick={showMore}
                aria-label={`Xem thêm phim trong ${title}`}
                aria-expanded={isExpanded}
                aria-controls={gridId}
              >
                Xem thêm <span aria-hidden="true">+</span>
              </button>
            )}
            {isExpanded && (
              <button
                ref={collapseRef}
                type="button"
                className="movie-list-button"
                onClick={collapse}
                aria-label={`Thu gọn danh mục ${title}`}
                aria-expanded={isExpanded}
                aria-controls={gridId}
              >
                Thu gọn <span aria-hidden="true">−</span>
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
