import './MovieDataState.css'

type MovieDataStateProps = {
  status: 'loading' | 'error' | 'empty'
  message?: string
  onRetry: () => void
}

export function MovieDataState({
  status,
  message,
  onRetry,
}: MovieDataStateProps) {
  if (status === 'loading') {
    return (
      <section
        className="movie-data-state page-container"
        aria-label="Đang tải phim"
      >
        <p role="status">Đang tải phim từ TMDB…</p>
        <div className="hero-layout skeleton-hero" aria-hidden="true">
          <div className="skeleton skeleton-image" />
          <div className="skeleton-lines">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
          </div>
        </div>
        <div className="skeleton-grid" aria-hidden="true">
          {[1, 2, 3].map((id) => (
            <div key={id} className="skeleton skeleton-poster" />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section
      className="movie-data-state page-container"
      aria-labelledby="data-state-title"
    >
      <div className="api-message">
        <p className="api-message-eyebrow">CINEVERSE / TMDB</p>
        <h1 id="data-state-title">
          {status === 'error'
            ? 'Chưa thể tải phim'
            : 'Chưa có phim để hiển thị'}
        </h1>
        <p role={status === 'error' ? 'alert' : 'status'}>
          {message ??
            'TMDB chưa trả về phim cho những danh sách này. Bạn có thể thử lại sau.'}
        </p>
        <button
          className="button button-primary"
          type="button"
          onClick={onRetry}
        >
          Thử lại
        </button>
      </div>
    </section>
  )
}
