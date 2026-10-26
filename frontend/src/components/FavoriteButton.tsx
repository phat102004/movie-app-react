import { useLocation, useNavigate } from 'react-router'
import { useFavorites } from '../hooks/useFavorites'
import { Icon } from './Icon'
import './Favorites.css'

export function FavoriteButton({
  movieId,
  title,
  compact = false,
}: {
  movieId: number
  title: string
  compact?: boolean
}) {
  const { status, pendingIds, isFavorite, addFavorite, removeFavorite } =
    useFavorites()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const selected = isFavorite(movieId)
  const pending = pendingIds.has(movieId)
  // Đợi AuthProvider xác minh 401 thành guest; tránh Login tự redirect khi Me đang lỗi mạng.
  const needsLogin = status === 'guest'
  const disabled = pending || (!needsLogin && status !== 'ready')
  const label = pending
    ? `Đang cập nhật yêu thích: ${title}`
    : needsLogin
      ? `Đăng nhập để lưu ${title}`
      : `${selected ? 'Bỏ yêu thích' : 'Thêm yêu thích'}: ${title}`
  return (
    <button
      type="button"
      className={`favorite-button ${compact ? 'favorite-button--compact' : ''} ${selected ? 'is-favorite' : ''}`}
      disabled={disabled}
      aria-label={label}
      aria-pressed={status === 'ready' ? selected : undefined}
      aria-busy={pending}
      title={
        status === 'loading'
          ? 'Đang tải trạng thái yêu thích'
          : status === 'error' && !needsLogin
            ? 'Chưa xác định trạng thái yêu thích; hãy thử tải lại danh sách.'
            : label
      }
      onClick={(event) => {
        event.stopPropagation()
        if (needsLogin) {
          void navigate('/login', { state: { from: pathname } })
          return
        }
        void (selected ? removeFavorite(movieId) : addFavorite(movieId))
      }}
    >
      <Icon name="heart" />
      {!compact && (
        <span>
          {pending
            ? 'Đang cập nhật…'
            : status === 'loading'
              ? 'Đang tải yêu thích…'
              : selected
                ? 'Đã yêu thích'
                : 'Lưu yêu thích'}
        </span>
      )}
    </button>
  )
}
