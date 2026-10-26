import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { useFavorites } from '../hooks/useFavorites'
import { useFavoriteMovies } from '../hooks/useFavoriteMovies'
import { MovieCard } from '../components/MovieCard'
import { FavoriteButton } from '../components/FavoriteButton'
import '../components/Favorites.css'

export function FavoritesPage() {
  const { user, status: authStatus, refreshUser, isRefreshing } = useAuth()
  const { favorites, status, reload, pendingIds } = useFavorites()
  const [visibleCount, setVisibleCount] = useState(24)
  const visible = favorites.slice(0, visibleCount)
  const { rows, retry } = useFavoriteMovies(
    status === 'ready' ? visible.map((favorite) => favorite.movieId) : [],
  )

  let content
  if (!user && authStatus === 'error') {
    content = (
      <div className="favorites-message">
        <h2>Chưa xác minh được phiên đăng nhập</h2>
        <p>Vui lòng kiểm tra lại kết nối để tiếp tục.</p>
        <button
          className="button button-primary"
          disabled={isRefreshing}
          onClick={() => void refreshUser()}
        >
          Kiểm tra lại phiên
        </button>
      </div>
    )
  } else if (status === 'guest') {
    content = (
      <div className="favorites-message">
        <h2>Một góc điện ảnh dành riêng cho bạn.</h2>
        <p>Đăng nhập để lưu và tìm lại những câu chuyện bạn yêu thích.</p>
        <Link
          className="button button-primary"
          to="/login"
          state={{ from: '/favorites' }}
        >
          Đăng nhập
        </Link>
      </div>
    )
  } else if (status === 'loading') {
    content = (
      <>
        <p role="status">Đang tải danh sách yêu thích…</p>
        <ul
          className="favorites-grid"
          aria-label="Đang tải yêu thích"
          aria-busy="true"
        >
          {[1, 2, 3, 4].map((id) => (
            <li key={id} aria-hidden="true">
              <div className="skeleton favorites-skeleton" />
            </li>
          ))}
        </ul>
      </>
    )
  } else if (status === 'error') {
    content = (
      <div className="favorites-message">
        <h2>Chưa thể tải bộ sưu tập</h2>
        <p>Trạng thái yêu thích chưa được xác định. Vui lòng thử lại.</p>
        <button
          type="button"
          className="button button-primary"
          onClick={reload}
          disabled={pendingIds.size > 0}
        >
          Thử lại
        </button>
      </div>
    )
  } else if (!favorites.length) {
    content = (
      <div className="favorites-message">
        <span className="favorites-chapter">BỘ SƯU TẬP / 00</span>
        <h2>Câu chuyện tiếp theo đang chờ bạn.</h2>
        <p>
          Bạn chưa lưu bộ phim nào. Chạm vào trái tim trên một phim để bắt đầu
          bộ sưu tập.
        </p>
        <Link className="button button-primary" to="/">
          Khám phá phim
        </Link>
      </div>
    )
  } else {
    const hasErrors = visible.some(({ movieId }) => rows.get(movieId)?.error)
    const isLoading = visible.some(({ movieId }) => !rows.has(movieId))
    content = (
      <>
        <div className="favorites-summary">
          <p role="status">
            {favorites.length} phim đã lưu · Đang hiển thị {visible.length} phim
            {isLoading ? ' · Đang tải thông tin phim…' : ''}
          </p>
          <button
            className="favorites-text-button"
            type="button"
            disabled={pendingIds.size > 0}
            onClick={reload}
          >
            Làm mới danh sách
          </button>
        </div>
        {hasErrors && (
          <div className="favorites-partial-error" role="status">
            <span>
              Một số phim chưa tải được thông tin. Các phim khác vẫn có thể xem.
            </span>
            <button type="button" onClick={retry}>
              Thử lại thông tin phim
            </button>
          </div>
        )}
        <ul
          className="favorites-grid"
          aria-label="Phim yêu thích"
          aria-busy={isLoading}
        >
          {visible.map(({ movieId }) => {
            const result = rows.get(movieId)
            return (
              <li key={movieId}>
                {result?.movie ? (
                  <MovieCard movie={result.movie} />
                ) : result?.error ? (
                  <article className="favorites-unavailable">
                    <p className="favorites-chapter">TMDB / {movieId}</p>
                    <h2>Thông tin phim chưa có</h2>
                    <p>{result.error}</p>
                    <Link to={`/movies/${movieId}`}>Mở trang chi tiết</Link>
                    <FavoriteButton
                      movieId={movieId}
                      title={`phim ${movieId}`}
                    />
                  </article>
                ) : (
                  <div
                    className="skeleton favorites-skeleton"
                    aria-label={`Đang tải phim ${movieId}`}
                  />
                )}
              </li>
            )
          })}
        </ul>
        {visible.length < favorites.length && (
          <div className="favorites-more">
            <button
              type="button"
              className="button button-primary"
              onClick={() => setVisibleCount((count) => count + 24)}
            >
              Xem thêm phim
            </button>
          </div>
        )}
      </>
    )
  }
  return (
    <section
      className="favorites-page page-container"
      aria-labelledby="favorites-title"
    >
      <header className="favorites-heading">
        <p className="favorites-chapter">CINEVERSE / KHÔNG GIAN CỦA BẠN</p>
        <h1 id="favorites-title">
          Những câu chuyện <em>bạn muốn giữ lại.</em>
        </h1>
        <p>Bộ sưu tập phim yêu thích, dành riêng cho bạn.</p>
      </header>
      {content}
    </section>
  )
}
