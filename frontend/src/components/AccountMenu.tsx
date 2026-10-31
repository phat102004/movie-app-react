import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { asAuthError } from '../services/auth'
import { authReturnPath } from '../utils/authForm'
import './Auth.css'

export function AccountMenu() {
  const { user, status, logout, isSigningOut, isChangingPassword } = useAuth()
  const { pathname, state } = useLocation()
  const returnTo =
    pathname === '/login' || pathname === '/register'
      ? authReturnPath(state)
      : pathname
  const [openUserId, setOpenUserId] = useState<string | null>(null)
  const open = !!user && openUserId === user.id
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpenUserId(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  async function signOut() {
    setError(null)
    try {
      await logout()
      if (mounted.current) {
        setOpenUserId(null)
        requestAnimationFrame(() =>
          document.getElementById('header-login')?.focus(),
        )
      }
    } catch (error) {
      if (mounted.current) {
        setError(asAuthError(error).message)
        setOpenUserId(user?.id ?? null)
      }
    }
  }

  if (status === 'loading' || status === 'error')
    return (
      <span
        className="auth-header-status"
        role="status"
        aria-label={
          status === 'loading'
            ? 'Đang kiểm tra phiên đăng nhập'
            : 'Chưa xác minh phiên đăng nhập'
        }
      >
        <span
          className="auth-avatar auth-avatar-placeholder"
          aria-hidden="true"
        >
          ·
        </span>
        <span className="auth-status-label">
          {status === 'loading' ? 'Đang kiểm tra…' : 'Chưa xác minh phiên'}
        </span>
      </span>
    )
  if (!user)
    return (
      <Link
        id="header-login"
        className="auth-header-login"
        to="/login"
        state={{ from: returnTo }}
      >
        Đăng nhập
      </Link>
    )
  return (
    <div
      className="account-menu"
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpenUserId(null)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpenUserId(null)
          toggle.current?.focus()
        }
      }}
    >
      <button
        type="button"
        className="account-toggle"
        ref={toggle}
        aria-label={`Tài khoản của ${user.name}`}
        aria-expanded={open}
        aria-controls="account-panel"
        onClick={() => setOpenUserId(open ? null : user.id)}
      >
        <span
          className="auth-avatar"
          aria-hidden="true"
          data-initial={Array.from(user.name.trim())[0]?.toLocaleUpperCase('vi') ?? 'C'}
        />
        <span className="account-name">{user.name}</span>
        <span className="account-chevron" aria-hidden="true" />
      </button>
      {open && (
        <nav
          className="account-panel"
          id="account-panel"
          aria-label="Tài khoản"
        >
          <p className="account-panel-name">{user.name}</p>
          <p className="account-panel-email">{user.email}</p>
          <Link
            className="account-profile-link"
            to="/profile"
            onClick={() => setOpenUserId(null)}
          >
            Hồ sơ cá nhân
          </Link>
          {error && (
            <p className="auth-field-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="account-logout"
            type="button"
            disabled={isSigningOut || isChangingPassword}
            onClick={() => void signOut()}
          >
            {isSigningOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </button>
        </nav>
      )}
    </div>
  )
}
