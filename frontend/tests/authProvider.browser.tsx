// Dev-only harness; không được import vào bundle ứng dụng.
import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from '../src/contexts/AuthProvider'
import { useAuth } from '../src/hooks/useAuth'

const originalFetch = globalThis.fetch
if (new URLSearchParams(location.search).has('ignoreAbort')) {
  globalThis.fetch = (input, options) => {
    options?.signal?.addEventListener('abort', () => {
      document.documentElement.dataset.aborted = 'true'
    })
    return originalFetch(input, { ...options, signal: undefined })
  }
}

export function Reader() {
  const auth = useAuth()
  const [actionError, setActionError] = useState('')
  const captured = useRef<{
    changePassword: typeof auth.changePassword
    logout: typeof auth.logout
  } | null>(null)
  return (
    <>
      <output id="auth-status">{auth.status}</output>
      <output id="auth-user">{auth.user?.name ?? 'none'}</output>
      <output id="auth-error">{auth.error?.code ?? ''}</output>
      <output id="action-error">{actionError}</output>
      <output id="changing-password">{String(auth.isChangingPassword)}</output>
      <output id="password-changed">{String(auth.passwordChanged)}</output>
      <button onClick={() => {
        captured.current = { changePassword: auth.changePassword, logout: auth.logout }
        setActionError('')
      }}>Capture account actions</button>
      <button onClick={() => {
        void captured.current?.changePassword({
          currentPassword: 'Synthetic multitab account password!',
          newPassword: 'Synthetic captured new password!',
        }).catch(() => setActionError('captured-change-error'))
      }}>Run captured change</button>
      <button onClick={() => {
        void captured.current?.logout().catch(() => setActionError('captured-logout-error'))
      }}>Run captured logout</button>
      <button
        onClick={() => {
          void auth
            .changePassword({
              currentPassword: 'Old synthetic account password 123!',
              newPassword: 'New synthetic account password 456!',
            })
            .catch(() => setActionError('password-error'))
        }}
      >
        Change password
      </button>
      <button onClick={() => void auth.refreshUser()}>Refresh</button>
      <button
        onClick={() => {
          void auth
            .login({
              email: 'fixture@example.com',
              password: 'SyntheticPassword123!',
            })
            .catch(() => setActionError('login-error'))
        }}
      >
        Login
      </button>
      <button
        onClick={() => {
          void auth.logout().catch(() => setActionError('logout-error'))
        }}
      >
        Logout
      </button>
    </>
  )
}

export function Harness() {
  const [mounted, setMounted] = useState(true)
  return (
    <>
      <button onClick={() => setMounted(!mounted)}>Toggle provider</button>
      {mounted && (
        <AuthProvider>
          <Reader />
        </AuthProvider>
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
