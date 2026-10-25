import { useAuth } from '../hooks/useAuth'
import './Auth.css'

export function AuthSessionNotice() {
  const { error, isRefreshing, refreshUser } = useAuth()
  if (!error) return null
  return (
    <div className="auth-session-notice page-container" role="status">
      <span>
        Chưa thể kiểm tra phiên đăng nhập. Bạn vẫn có thể khám phá phim.
      </span>
      <button
        type="button"
        onClick={() => void refreshUser()}
        disabled={isRefreshing}
      >
        {isRefreshing ? 'Đang kiểm tra…' : 'Kiểm tra lại phiên'}
      </button>
    </div>
  )
}
