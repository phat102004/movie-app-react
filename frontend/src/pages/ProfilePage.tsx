import { useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/useProfile'
import { ProfileEditForm } from '../components/ProfileEditForm'
import { ChangePasswordSection } from '../components/ChangePasswordSection'
import './ProfilePage.css'

function ProfileLoading() {
  return (
    <section
      className="profile-page page-container"
      aria-label="Đang tải hồ sơ"
      aria-busy="true"
    >
      <p role="status">Đang tải hồ sơ cá nhân…</p>
      <div className="profile-loading-panel skeleton" aria-hidden="true" />
      <div className="profile-loading-card skeleton" aria-hidden="true" />
    </section>
  )
}

export function ProfilePage() {
  const {
    user,
    status,
    isSigningOut,
    refreshUser,
    isRefreshing,
    passwordChanged,
    sessionEpoch,
  } = useAuth()
  if (passwordChanged) return <ProfileLoading />
  if (status === 'guest')
    return <Navigate to="/login" replace state={{ from: '/profile' }} />
  if (status === 'loading' || isSigningOut) return <ProfileLoading />
  if (status === 'error' || !user)
    return (
      <section className="profile-page page-container">
        <div className="profile-state">
          <h1>Chưa xác minh được phiên đăng nhập</h1>
          <p role="alert">Vui lòng kiểm tra kết nối và thử lại.</p>
          <button
            type="button"
            className="button button-primary"
            disabled={isRefreshing}
            onClick={() => void refreshUser()}
          >
            Kiểm tra lại phiên
          </button>
        </div>
      </section>
    )
  // Key chỉ remount nội dung trang khi owner thay đổi; không remount App/Header/Router.
  return <ProfileContent key={`${user.id}:${sessionEpoch}`} userId={user.id} />
}

function ProfileContent({ userId }: { userId: string }) {
  const { user, refreshUser, isRefreshing, isChangingPassword } = useAuth()
  const {
    profile,
    error,
    isLoading,
    isSaving,
    saveError,
    saved,
    updateName,
    clearFeedback,
    retry,
  } = useProfile(userId)
  const [editing, setEditing] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const focusEdit = () =>
    requestAnimationFrame(() => editButton.current?.focus())
  if (isLoading) return <ProfileLoading />
  if (error || !profile)
    return (
      <section className="profile-page page-container">
        <div className="profile-state">
          <p className="profile-eyebrow">CINEVERSE / HỒ SƠ CÁ NHÂN</p>
          <h1>Chưa thể tải hồ sơ</h1>
          <p role="alert">
            {error?.message ?? 'Vui lòng thử lại.'}
            {error?.retryAfter !== null && error?.retryAfter !== undefined
              ? ` Thử lại sau ${error.retryAfter} giây.`
              : ''}
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={isRefreshing}
            onClick={retry}
          >
            Thử lại
          </button>
        </div>
      </section>
    )
  const joined = new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(profile.createdAt))
  return (
    <article
      className="profile-page page-container"
      aria-labelledby="profile-title"
    >
      <nav className="profile-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Cineverse</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Hồ sơ cá nhân</span>
      </nav>
      <header className="profile-hero">
        <div className="profile-identity">
          <p className="profile-eyebrow">CINEVERSE / HỒ SƠ CÁ NHÂN</p>
          <div className="profile-avatar" aria-hidden="true">
            {Array.from(profile.name.trim())[0]?.toLocaleUpperCase('vi') ?? 'C'}
          </div>
          <h1 id="profile-title">{profile.name}</h1>
          <p className="profile-introduction">
            Không gian dành riêng cho hành trình điện ảnh của bạn.
          </p>
          <span className="profile-tagline">MỖI BỘ PHIM, MỘT THẾ GIỚI.</span>
        </div>
        <dl className="profile-statistics">
          <div>
            <dt>Phim yêu thích</dt>
            <dd>
              <Link
                to="/favorites"
                aria-label={`Xem ${profile.favoriteCount} phim yêu thích`}
              >
                {profile.favoriteCount.toLocaleString('vi-VN')}
                <span aria-hidden="true"> ↗</span>
              </Link>
            </dd>
          </div>
          <div>
            <dt>Ngày tham gia</dt>
            <dd>
              <time dateTime={profile.createdAt}>{joined}</time>
            </dd>
          </div>
        </dl>
      </header>
      {saved && (
        <p className="profile-success" role="status">
          Đã lưu hồ sơ thành công.
        </p>
      )}
      {user?.name !== profile.name && (
        <div className="profile-sync-notice" role="status">
          <span>
            Tên hồ sơ đã được tải từ máy chủ. Header chưa đồng bộ tên mới.
          </span>
          <button
            type="button"
            disabled={isRefreshing || isSaving}
            onClick={() => void refreshUser()}
          >
            {isRefreshing ? 'Đang đồng bộ…' : 'Đồng bộ tên trên Header'}
          </button>
        </div>
      )}
      <section
        className="profile-account"
        aria-labelledby="profile-account-title"
      >
        <div className="profile-account-heading">
          <div>
            <p className="profile-eyebrow">THÔNG TIN CỦA BẠN</p>
            <h2 id="profile-account-title">Thông tin tài khoản</h2>
            <p>Tên hiển thị giúp không gian Cineverse mang dấu ấn của bạn.</p>
          </div>
          {!editing && (
            <button
              ref={editButton}
              type="button"
              className="profile-secondary-button"
              disabled={isChangingPassword}
              onClick={() => {
                clearFeedback()
                setEditing(true)
                requestAnimationFrame(() =>
                  document.getElementById('profile-name')?.focus(),
                )
              }}
            >
              Chỉnh sửa hồ sơ
            </button>
          )}
        </div>
        {editing ? (
          <ProfileEditForm
            profile={profile}
            isSaving={isSaving}
            error={saveError}
            onChange={clearFeedback}
            onCancel={() => {
              clearFeedback()
              setEditing(false)
              focusEdit()
            }}
            onSave={async (name) => {
              if (await updateName(name)) {
                setEditing(false)
                focusEdit()
              }
            }}
          />
        ) : (
          <dl className="profile-account-values">
            <div>
              <dt>Tên hiển thị</dt>
              <dd>{profile.name}</dd>
            </div>
            <div>
              <dt>
                Email <span className="profile-readonly">Chỉ đọc</span>
              </dt>
              <dd>{profile.email}</dd>
            </div>
          </dl>
        )}
      </section>
      <ChangePasswordSection disabled={editing || isSaving} />
    </article>
  )
}
