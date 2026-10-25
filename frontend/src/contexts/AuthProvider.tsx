import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './auth-context'
import { authService, asAuthError, AuthApiError } from '../services/auth'
import type {
  AuthSessionApi,
  AuthStatus,
  AuthUser,
  LoginInput,
} from '../types/auth'

type SessionState = {
  user: AuthUser | null
  status: AuthStatus
  error: AuthApiError | null
}

export function AuthProvider({
  children,
  service = authService,
}: {
  children: ReactNode
  service?: AuthSessionApi
}) {
  const [state, setState] = useState<SessionState>({
    user: null,
    status: 'loading',
    error: null,
  })
  const [isRefreshing, setIsRefreshing] = useState(true)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const mounted = useRef(false)
  const version = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const mutation = useRef(false)

  const readSession = useCallback(
    async (pending: AbortController, current: number) => {
      try {
        const user = await service.me(pending.signal)
        if (mounted.current && current === version.current)
          setState({
            user,
            status: user ? 'authenticated' : 'guest',
            error: null,
          })
      } catch (error) {
        if (
          mounted.current &&
          current === version.current &&
          !pending.signal.aborted
        )
          setState((previous) => ({
            user: previous.user,
            status: previous.user ? 'authenticated' : 'error',
            error: asAuthError(error),
          }))
      } finally {
        if (mounted.current && current === version.current)
          setIsRefreshing(false)
      }
    },
    [service],
  )

  const cancelPending = useCallback(() => {
    ++version.current
    controller.current?.abort()
  }, [])

  const refreshUser = useCallback(async () => {
    if (mutation.current) return
    cancelPending()
    const current = version.current
    const pending = new AbortController()
    controller.current = pending
    setIsRefreshing(true)
    await readSession(pending, current)
  }, [cancelPending, readSession])

  useEffect(() => {
    mounted.current = true
    const pending = new AbortController()
    controller.current = pending
    const current = ++version.current
    async function load() {
      await readSession(pending, current)
    }
    void load()
    return () => {
      mounted.current = false
      cancelPending()
    }
  }, [readSession, cancelPending])

  const runMutation = useCallback(
    async (input?: LoginInput) => {
      if (mutation.current)
        throw new AuthApiError(
          'Đang xử lý yêu cầu tài khoản. Vui lòng đợi.',
          null,
          'AUTH_BUSY',
        )
      mutation.current = true
      const current = ++version.current
      controller.current?.abort()
      const pending = new AbortController()
      controller.current = pending
      setIsRefreshing(false)
      if (!input) setIsSigningOut(true)
      try {
        const user = input
          ? await service.login(input, pending.signal)
          : (await service.logout(pending.signal), null)
        if (mounted.current && current === version.current)
          setState({
            user,
            status: user ? 'authenticated' : 'guest',
            error: null,
          })
        return user
      } catch (error) {
        // Nếu mutation thay thế lần /me ban đầu rồi thất bại, trạng thái vẫn chưa biết.
        if (mounted.current && current === version.current)
          setState((previous) =>
            previous.status === 'loading'
              ? { ...previous, status: 'error', error: asAuthError(error) }
              : previous,
          )
        throw asAuthError(error)
      } finally {
        mutation.current = false
        if (mounted.current && current === version.current)
          setIsSigningOut(false)
      }
    },
    [service],
  )

  const login = useCallback(
    async (input: LoginInput) => (await runMutation(input))!,
    [runMutation],
  )
  const logout = useCallback(async () => {
    await runMutation()
  }, [runMutation])

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isRefreshing,
        isSigningOut,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
