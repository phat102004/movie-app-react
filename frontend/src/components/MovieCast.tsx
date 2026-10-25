import { useRef, useState } from 'react'
import type { CastMember } from '../types/movieDetails'
import { useMovieColumns } from '../hooks/useMovieColumns'
import './MovieList.css'
import './MovieCast.css'

type MovieCastProps = { cast: CastMember[] }

function CastCard({ member }: { member: CastMember }) {
  const [imageFailed, setImageFailed] = useState(false)
  const initials = member.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('vi-VN')
  return (
    <article className="cast-card">
      <div className="cast-photo">
        {member.profileUrl && !imageFailed ? (
          <img
            src={member.profileUrl}
            alt={`Chân dung ${member.name}`}
            width="185"
            height="247"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div
            className="cast-photo-fallback"
            role="img"
            aria-label={`Chưa có ảnh của ${member.name}`}
          >
            <span aria-hidden="true">{initials}</span>
            <small aria-hidden="true">Chưa có ảnh</small>
          </div>
        )}
      </div>
      <h3>{member.name}</h3>
      <p className="cast-character">
        {member.character || 'Chưa có thông tin nhân vật'}
      </p>
    </article>
  )
}

export function MovieCast({ cast }: MovieCastProps) {
  const movieColumns = useMovieColumns()
  const columns = movieColumns === 5 ? 6 : movieColumns
  const [visibleRows, setVisibleRows] = useState(1)
  const sectionRef = useRef<HTMLElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const collapseRef = useRef<HTMLButtonElement>(null)
  const visibleCast = cast.slice(0, visibleRows * columns)
  const hasMore = visibleCast.length < cast.length
  const isExpanded = visibleCast.length > columns

  function showMore() {
    setVisibleRows((rows) => rows + 1)
    if ((visibleRows + 1) * columns >= cast.length)
      requestAnimationFrame(() =>
        collapseRef.current?.focus({ preventScroll: true }),
      )
  }

  function collapse() {
    setVisibleRows(1)
    requestAnimationFrame(() => {
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

  if (cast.length === 0) return null
  return (
    <section
      ref={sectionRef}
      className="movie-cast"
      aria-labelledby="cast-title"
    >
      <header className="cast-heading">
        <p className="cast-eyebrow">NHỮNG GƯƠNG MẶT TRÊN MÀN ẢNH</p>
        <h2 id="cast-title">Dàn diễn viên chính</h2>
      </header>
      <ul
        id="cast-grid"
        className="cast-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {visibleCast.map((member) => (
          <li key={member.id}>
            <CastCard member={member} />
          </li>
        ))}
      </ul>
      {cast.length > columns && (
        <div className="movie-list-controls">
          <p className="movie-list-count" role="status" aria-atomic="true">
            Đang hiển thị {visibleCast.length} / {cast.length} diễn viên
          </p>
          <div className="movie-list-actions">
            {hasMore && (
              <button
                ref={moreRef}
                type="button"
                className="movie-list-button"
                onClick={showMore}
                aria-controls="cast-grid"
                aria-expanded={isExpanded}
              >
                Xem thêm diễn viên <span aria-hidden="true">+</span>
              </button>
            )}
            {isExpanded && (
              <button
                ref={collapseRef}
                type="button"
                className="movie-list-button"
                onClick={collapse}
                aria-label="Thu gọn dàn diễn viên"
                aria-controls="cast-grid"
                aria-expanded={isExpanded}
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
