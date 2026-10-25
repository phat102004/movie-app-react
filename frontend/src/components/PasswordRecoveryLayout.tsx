import type { ReactNode } from 'react'
import { Link } from 'react-router'
import './Auth.css'

export function PasswordRecoveryLayout({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section
      className="auth-page page-container"
      aria-labelledby="recovery-title"
    >
      <div className="auth-intro">
        <Link className="auth-back" to="/login">
          ← Quay lại đăng nhập
        </Link>
        <p className="auth-eyebrow">CINEVERSE / KHÔI PHỤC TÀI KHOẢN</p>
        <h1 id="recovery-title">{title}</h1>
        <p>Một bước nhỏ để trở lại với những câu chuyện bạn yêu thích.</p>
        <span className="auth-editorial-note">MỖI BỘ PHIM, MỘT THẾ GIỚI.</span>
      </div>
      <div className="auth-card">{children}</div>
    </section>
  )
}
