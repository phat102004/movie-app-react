import { useFavorites } from '../hooks/useFavorites'
import './Favorites.css'

export function FavoritesNotice() {
  const { error, reload, pendingIds } = useFavorites()
  if (!error) return null
  return (
    <div className="favorites-notice page-container" role="alert">
      <span>
        {error.message}
        {error.retryAfter !== null
          ? ` Thử lại sau ${error.retryAfter} giây.`
          : ''}
      </span>
      {error.status !== 401 && (
        <button type="button" disabled={pendingIds.size > 0} onClick={reload}>
          Tải lại yêu thích
        </button>
      )}
    </div>
  )
}
