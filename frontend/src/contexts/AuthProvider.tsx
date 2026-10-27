import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './auth-context'
import { authService, asAuthError, AuthApiError } from '../services/auth'
import {
  passwordChangeService,
  asPasswordChangeError,
} from '../services/passwordChange'
import type {
  PasswordChangeInput,
  PasswordChangeApi,
} from '../types/passwordChange'
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
type AuthMutation =
  | { kind: 'login'; input: LoginInput }
  | { kind: 'logout' }
  | { kind: 'password-change'; input: PasswordChangeInput }

export function AuthProvider({
  children,
  service = authService,
  passwordService = passwordChangeService,
}: {
  children: ReactNode
  service?: AuthSessionApi
  passwordService?: PasswordChangeApi
}) {
  const [state, setState] = useState<SessionState>({
    user: null,
    status: 'loading',
    error: null,
  })
  const [isRefreshing, setIsRefreshing] = useState(true)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const acknowledgePasswordChange = useCallback(
    () => setPasswordChanged(false),
    [],
  )
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
    async (action: AuthMutation) => {
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
      if (action.kind === 'logout') setIsSigningOut(true)
      if (action.kind === 'password-change') setIsChangingPassword(true)
      else setPasswordChanged(false)
      try {
        const user =
          action.kind === 'login'
            ? await service.login(action.input, pending.signal)
            : action.kind === 'logout'
              ? (await service.logout(pending.signal), null)
              : (await passwordService.change(action.input, pending.signal),
                null)
        if (mounted.current && current === version.current) {
          setState({
            user,
            status: user ? 'authenticated' : 'guest',
            error: null,
          })
          if (action.kind === 'password-change') setPasswordChanged(true)
        }
        return user
      } catch (error) {
        // Nếu mutation thay thế lần /me ban đầu rồi thất bại, trạng thái vẫn chưa biết.
        if (mounted.current && current === version.current) {
          if (
            action.kind === 'password-change' &&
            asPasswordChangeError(error).status === 401
          ) {
            setState({ user: null, status: 'guest', error: null })
          } else
            setState((previous) =>
              previous.status === 'loading'
                ? { ...previous, status: 'error', error: asAuthError(error) }
                : previous,
            )
        }
        throw action.kind === 'password-change'
          ? asPasswordChangeError(error)
          : asAuthError(error)
      } finally {
        mutation.current = false
        if (mounted.current && current === version.current) {
          setIsSigningOut(false)
          setIsChangingPassword(false)
        }
      }
    },
    [service, passwordService],
  )

  const login = useCallback(
    async (input: LoginInput) => (await runMutation({ kind: 'login', input }))!,
    [runMutation],
  )
  const logout = useCallback(async () => {
    await runMutation({ kind: 'logout' })
  }, [runMutation])
  const changePassword = useCallback(
    async (input: PasswordChangeInput) => {
      await runMutation({ kind: 'password-change', input })
    },
    [runMutation],
  )

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isRefreshing,
        isSigningOut,
        isChangingPassword,
        passwordChanged,
        acknowledgePasswordChange,
        changePassword,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
