import { useAuth } from '../hooks/useAuth'
import './Auth.css'

export function AuthSessionNotice() {
  const { error, isRefreshing, refreshUser, sessionNotice, dismissSessionNotice } = useAuth()
  if (!error && !sessionNotice) return null
  return (
    <div className="auth-session-notice page-container" role="status">
      <span>
        {sessionNotice ?? 'Chưa thể kiểm tra phiên đăng nhập. Bạn vẫn có thể khám phá phim.'}
      </span>
      <button
        type="button"
        onClick={() => { if (error) void refreshUser(); else dismissSessionNotice() }}
        disabled={isRefreshing}
      >
        {isRefreshing ? 'Đang kiểm tra…' : error ? 'Kiểm tra lại phiên' : 'Đã hiểu'}
      </button>
    </div>
  )
}
