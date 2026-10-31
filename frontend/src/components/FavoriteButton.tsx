import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useFavorites } from '../hooks/useFavorites'
import { useAuth } from '../hooks/useAuth'
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
  const { sessionEpoch, isSessionCurrent } = useAuth()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const restoreEpoch = useRef<number | null>(null)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const selected = isFavorite(movieId)
  const pending = pendingIds.has(movieId)
  // Đợi AuthProvider xác minh 401 thành guest; tránh Login tự redirect khi Me đang lỗi mạng.
  const needsLogin = status === 'guest'
  const disabled = pending || (!needsLogin && status !== 'ready')
  useEffect(() => {
    if (pending || restoreEpoch.current === null) return
    const epoch = restoreEpoch.current
    restoreEpoch.current = null
    const button = buttonRef.current
    // Run after React commits disabled=false; never target another session or
    // take focus back after the user has moved to a different control.
    if (isSessionCurrent(epoch) && button && !button.disabled &&
        (document.activeElement === document.body || document.activeElement === button))
      button.focus({ preventScroll: true })
  }, [pending, disabled, sessionEpoch, isSessionCurrent])
  const label = pending
    ? `Đang cập nhật yêu thích: ${title}`
    : needsLogin
      ? `Đăng nhập để lưu ${title}`
      : `${selected ? 'Bỏ yêu thích' : 'Thêm yêu thích'}: ${title}`
  const visibleLabel = pending
    ? 'Đang cập nhật…'
    : status === 'loading'
      ? 'Đang tải yêu thích…'
      : selected
        ? 'Đã yêu thích'
        : 'Lưu yêu thích'
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`favorite-button ${compact ? 'favorite-button--compact' : ''} ${selected ? 'is-favorite' : ''}`}
      disabled={disabled}
      aria-label={compact ? label : `${visibleLabel}. ${label}`}
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
        restoreEpoch.current = event.detail === 0 && document.activeElement === event.currentTarget ? sessionEpoch : null
        void (selected ? removeFavorite(movieId) : addFavorite(movieId))
      }}
    >
      <Icon name="heart" />
      {!compact && <span>{visibleLabel}</span>}
    </button>
  )
}
